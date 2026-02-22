/**
 * Default Decision Engine
 * 
 * A simple, effective classification engine that uses keyword analysis
 * and complexity scoring to route requests.
 * 
 * Inspired by ClawRouter but simplified for pluggability.
 */

import type {
  DecisionEngine,
  RoutingContext,
  RoutingDecision,
  ModelConfig,
} from "../types.ts";
import {
  getModel,
  getModelForTier,
  MODELS,
} from "../models.ts";

/** Patterns for classification */
const PATTERNS = {
  // Heartbeat - minimal, status-only
  heartbeat: /\bHEARTBEAT_OK\b|\bHEARTBEAT\b/i,
  
  // Simple commands
  simple: /\b(hello|hi|hey|thanks|ok|yes|no)\b/i,
  
  // Coding indicators
  code: /\b(import|export|const|let|var|function|class|async|await|=>)\b/,
  codeBlock: /```[\s\S]*?```/,
  git: /\b(git|npm|yarn|bun|pnpm|docker|dockerfile)\b/,
  filePath: /\/\w+\.\w+/,
  
  // Business/industry content
  business: /\b(price|cost|revenue|profit|margin|seo|marketing|funnel)\b/i,
  
  // Reasoning/complexity
  reasoning: /\b(explain|why|how|compare|analyze|architecture|design)\b/i,
  questionComplexity: /\?{2,}|\b(what if|consider|imagine|scenario)\b/i,
};

/** Score calculation */
function calculateComplexity(prompt: string): number {
  let score = 0;
  const length = prompt.length;
  
  // Length factor (longer = more complex)
  if (length > 200) score += Math.min(15, (length - 100) / 50);
  
  // Code blocks = high complexity
  const codeBlocks = (prompt.match(/```/g) || []).length / 2;
  score += codeBlocks * 20;
  
  // Questions = complexity
  const questions = (prompt.match(/\?/g) || []).length;
  score += questions * 3;
  
  // Reasoning indicators
  if (PATTERNS.reasoning.test(prompt)) score += 10;
  if (PATTERNS.questionComplexity.test(prompt)) score += 15;
  
  // Business complexity
  if (PATTERNS.business.test(prompt)) score += 8;
  
  // File paths = likely code
  if (PATTERNS.filePath.test(prompt)) score += 12;
  
  return Math.min(100, score);
}

/** Detect if this is a code-heavy query */
function isCodeQuery(prompt: string): boolean {
  return PATTERNS.code.test(prompt) ||
         PATTERNS.git.test(prompt) ||
         PATTERNS.codeBlock.test(prompt) ||
         PATTERNS.filePath.test(prompt);
}

/** Detect if this is a heartbeat/status query */
function isHeartbeat(prompt: string): boolean {
  return PATTERNS.heartbeat.test(prompt);
}

/** Detect if this is simple */
function isSimpleQuery(prompt: string): boolean {
  return PATTERNS.simple.test(prompt) && prompt.length < 100;
}

/** Build fallback chain (cheaper alternatives if primary fails) */
function buildFallbackChain(primary: ModelConfig): ModelConfig[] {
  const fallbacks: ModelConfig[] = [];
  
  // Try same provider, cheaper model
  const sameProvider = Object.values(MODELS)
    .filter(m => m.provider === primary.provider && m.model !== primary.model)
    .sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
  fallbacks.push(...sameProvider.slice(0, 2));
  
  // Try free (Ollama) alternatives
  if (primary.provider !== "ollama") {
    const ollamaModels = [
      MODELS["llama3-8b"],
      MODELS["gemma-2b"],
    ].filter(Boolean);
    fallbacks.push(...ollamaModels);
  }
  
  return fallbacks;
}

/**
 * Default Decision Engine Implementation
 */
export class DefaultEngine implements DecisionEngine {
  readonly name = "default";
  readonly version = "1.0.0";
  
  decide(context: RoutingContext): RoutingDecision {
    const { prompt, requestedModel, userPreferences } = context;
    
    // Check for explicit heartbeat pattern
    if (isHeartbeat(prompt)) {
      const config = MODELS["gemma-2b"];
      return {
        config,
        confidence: 0.99,
        reasoning: "Heartbeat pattern detected - using cheapest local model",
        estimatedCost: 0,
        fallbackChain: [],
      };
    }
    
    // Check for simple queries
    if (isSimpleQuery(prompt)) {
      const config = MODELS["gemma-2b"];
      return {
        config,
        confidence: 0.9,
        reasoning: "Simple greeting/command - using local fast model",
        estimatedCost: 0,
        fallbackChain: [MODELS["claude-haiku"]],
      };
    }
    
    // Calculate complexity
    const complexity = calculateComplexity(prompt);
    
    // Route based on complexity + code detection
    let config: ModelConfig;
    let reasoning: string;
    
    if (isCodeQuery(prompt)) {
      if (complexity > 50) {
        config = MODELS["codex"] || MODELS["claude-sonnet"];
        reasoning = `Code query with complexity ${complexity} - using specialized coding model`;
      } else {
        config = MODELS["claude-sonnet"];
        reasoning = `Code query with complexity ${complexity} - using balanced coding model`;
      }
    } else if (complexity > 70) {
      config = MODELS["claude-opus"];
      reasoning = `High complexity (${complexity}) - using reasoning model`;
    } else if (complexity > 40) {
      config = MODELS["claude-sonnet"] || MODELS["gpt-4o"];
      reasoning = `Medium complexity (${complexity}) - using balanced model`;
    } else if (complexity > 20) {
      config = MODELS["claude-haiku"] || MODELS["gemini-flash"];
      reasoning = `Low complexity (${complexity}) - using fast cheap model`;
    } else {
      config = MODELS["kimi"] || MODELS["gemma-2b"];
      reasoning = `Very low complexity (${complexity}) - using local model`;
    }
    
    // Honor user preferences if specified
    if (userPreferences?.preferredProvider && 
        config.provider !== userPreferences.preferredProvider) {
      const preferred = Object.values(MODELS).find(
        m => m.provider === userPreferences.preferredProvider
      );
      if (preferred) {
        config = preferred;
        reasoning += ` (user preferred ${userPreferences.preferredProvider})`;
      }
    }
    
    // Honor explicit model request
    if (requestedModel) {
      const explicit = getModel(requestedModel);
      if (explicit) {
        config = explicit;
        reasoning = `Explicit model request: ${requestedModel}`;
      }
    }
    
    return {
      config,
      confidence: Math.max(0.5, 1 - (complexity / 200)),
      reasoning,
      estimatedCost: config.costPer1kTokens * 2, // Rough estimate for 2k tokens
      fallbackChain: buildFallbackChain(config),
    };
  }
  
  getConfidence(context: RoutingContext): number {
    const { prompt } = context;
    
    if (isHeartbeat(prompt)) return 0.99;
    if (isSimpleQuery(prompt)) return 0.9;
    
    const complexity = calculateComplexity(prompt);
    return Math.max(0.5, 1 - (complexity / 200));
  }
}

/** Export singleton instance */
export const defaultEngine = new DefaultEngine();
