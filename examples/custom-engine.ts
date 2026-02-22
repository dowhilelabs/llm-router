/"**
 * Example: Custom Decision Engine
 *
 * This shows how to create a pluggable decision engine.
 * Replace the logic with your own classification strategy.
 */

import type {
  DecisionEngine,
  RoutingContext,
  RoutingDecision,
} from "../src/types.ts";
import { getModel, MODELS } from "../src/models.ts";

/**
 * Company-Specific Router
 *
 * Routes based on business logic:
 * - Accounting queries → Claude Haiku (cheap, accurate)
 * - Legal questions → Claude Sonnet (complex reasoning)
 * - Code queries → GPT-4o Codex (best coding)
 * - Everything else → Free local model
 */
export class CompanyEngine implements DecisionEngine {
  readonly name = "company-router";
  readonly version = "1.0.0";

  decide(context: RoutingContext): RoutingDecision {
    const prompt = context.prompt.toLowerCase();

    // Detect intent using keywords
    const intents = {
      accounting: /\b(invoice|bill|payment|expense|revenue|profit|margin)\b/,
      legal:
        /\b(contract|terms|liability|compliance|regulation|legal|law)\b/,
      coding:
        /\b(bug|fix|refactor|optimize|code|function|class|error)\b/,
      urgent:
        /\b(urgent|asap|critical|emergency|down|broken|failure)\b/,
      simple:
        /\b(ok|thanks|hi|hello|bye|good)\b/,
    };

    // Score each intent
    const scores: Record<string, number> = {};
    for (const [intent, pattern] of Object.entries(intents)) {
      scores[intent] = (prompt.match(pattern) || []).length;
    }

    // Pick highest scoring intent
    const topIntent = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    if (topIntent[1] > 0) {
      switch (topIntent[0]) {
        case "accounting":
          return this.routeTo("claude-haiku", "Accounting query detected");
        case "legal":
          return this.routeTo("claude-sonnet", "Legal question detected");
        case "coding":
          return this.routeTo("codex", "Coding task detected");
        case "urgent":
          return this.routeTo("claude-opus", "Urgent/critical - using best model");
        case "simple":
          return this.routeTo("gemma-2b", "Simple greeting/command");
      }
    }

    // Default to free local model
    return this.routeTo("gemma-2b", "No clear category - using default");
  }

  private routeTo(alias: string, reasoning: string): RoutingDecision {
    const config = getModel(alias) || MODELS["gemma-2b"];
    return {
      config,
      confidence: 0.85,
      reasoning,
      estimatedCost: config.costPer1kTokens * 2,
      fallbackChain: [
        MODELS["claude-sonnet"],
        MODELS["gpt-4o"],
      ],
    };
  }

  // Optional: tell router how confident you are
  getConfidence(context: RoutingContext): number {
    const intentCount = Object.keys({
      accounting: /\b(invoice|bill|payment)\b/.test(context.prompt),
      legal: /\b(contract|terms)\b/.test(context.prompt),
      coding: /\b(bug|fix|code)\b/.test(context.prompt),
    }).length;
    return 0.5 + intentCount * 0.2;
  }
}

// Export singleton
export const companyEngine = new CompanyEngine();

/**
 * Usage in main.ts:
 *
 * import { registerEngine } from "./engines/index.ts";
 * import { companyEngine } from "./examples/custom-engine.ts";
 *
 * registerEngine("company", companyEngine, 100); // Priority 100 = first
 *
 * // Router will now use your custom engine
 */
