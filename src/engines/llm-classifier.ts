/**
 * LLM-Based Classifier Decision Engine
 *
 * Uses a fast local Ollama model (smollm2:135m) to classify prompt complexity,
 * then routes to an appropriate model based on that classification.
 *
 * Two-stage routing:
 *   1. Fast classification (smollm2:135m) → complexity score
 *   2. Decision code maps complexity → target model
 *
 * This is slower than rule-based (~50-100ms overhead) but more accurate
 * for nuanced classification.
 */

import type {
  DecisionEngine,
  RoutingContext,
  RoutingDecision,
  ModelConfig,
} from "../types.ts";
import { getModel, MODELS } from "../models.ts";

/** Classification result from the LLM */
interface ClassificationResult {
  /** Complexity tier */
  tier: "simple" | "medium" | "complex" | "reasoning";
  /** Confidence 0-1 */
  confidence: number;
  /** Why this classification */
  reasoning: string;
  /** Specific indicators detected */
  indicators: string[];
}

/** LLM Classifier Engine Options */
export interface LLMClassifierOptions {
  /** Ollama base URL */
  ollamaUrl: string;
  /** Model to use for classification */
  classifierModel: string;
  /** Timeout for classification in ms */
  timeoutMs: number;
  /** Whether to cache classifications */
  enableCache: boolean;
  /** Cache TTL in ms */
  cacheTtlMs: number;
}

/** Default options */
const DEFAULT_OPTIONS: LLMClassifierOptions = {
  ollamaUrl: "http://localhost:11434",
  classifierModel: "smollm2:135m",
  timeoutMs: 5000,
  enableCache: true,
  cacheTtlMs: 60000, // 1 minute cache
};

/** Classification prompt template */
const CLASSIFICATION_PROMPT = `You are a prompt classifier. Analyze the user request and classify its complexity.

Classify into one of these tiers:
- simple: Greetings, one-word answers, simple facts, basic questions (< 50 tokens)
- medium: Explanations, summaries, creative writing, moderate code help
- complex: Multi-step reasoning, debugging, refactoring, analysis, detailed planning
- reasoning: Research, novel problems, system design, philosophy, deep analysis

Respond ONLY with valid JSON in this exact format:
{
  "tier": "simple|medium|complex|reasoning",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why",
  "indicators": ["keyword1", "keyword2"]
}

User request to classify:
"""
{{PROMPT}}
"""

JSON response:`;

/** Simple in-memory cache for classifications */
class ClassificationCache {
  private cache = new Map<string, { result: ClassificationResult; timestamp: number }>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): ClassificationResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  set(key: string, result: ClassificationResult): void {
    this.cache.set(key, { result, timestamp: Date.now() });

    // Simple LRU: keep only last 1000 entries
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * LLM-Based Classifier Decision Engine
 */
export class LLMClassifierEngine implements DecisionEngine {
  readonly name = "llm-classifier";
  readonly version = "1.0.0";
  private options: LLMClassifierOptions;
  private cache: ClassificationCache;

  constructor(options: Partial<LLMClassifierOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new ClassificationCache(this.options.cacheTtlMs);
  }

  async decide(context: RoutingContext): Promise<RoutingDecision> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = this.getCacheKey(context.prompt);
    let classification: ClassificationResult;

    if (this.options.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        classification = cached;
      } else {
        classification = await this.classifyWithLLM(context.prompt);
        this.cache.set(cacheKey, classification);
      }
    } else {
      classification = await this.classifyWithLLM(context.prompt);
    }

    // Map classification to model
    const decision = this.mapClassificationToModel(
      classification,
      context,
      Date.now() - startTime
    );

    return decision;
  }

  getConfidence(context: RoutingContext): number {
    // This engine is confident when the prompt is not extremely short
    // (very short prompts are better handled by rule-based)
    if (context.prompt.length < 20) return 0.3;
    if (context.prompt.length < 100) return 0.6;
    return 0.85;
  }

  /**
   * Call the local Ollama model to classify the prompt
   */
  private async classifyWithLLM(prompt: string): Promise<ClassificationResult> {
    const classificationPrompt = CLASSIFICATION_PROMPT.replace(
      "{{PROMPT}}",
      prompt.replace(/"/g, '\\"').slice(0, 2000) // Escape quotes and limit length
    );

    try {
      const response = await fetch(
        `${this.options.ollamaUrl}/api/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.options.classifierModel,
            prompt: classificationPrompt,
            stream: false,
            options: {
              temperature: 0.1, // Low temp for consistent classification
              num_predict: 200, // Limit output tokens
            },
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        }
      );

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json();
      const rawResponse = data.response?.trim() || "";

      // Extract JSON from response (handle potential markdown)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse;

      const result = JSON.parse(jsonStr) as ClassificationResult;

      // Validate result
      if (!["simple", "medium", "complex", "reasoning"].includes(result.tier)) {
        result.tier = "medium"; // Default fallback
      }
      if (result.confidence < 0 || result.confidence > 1) {
        result.confidence = 0.5;
      }

      return result;
    } catch (error) {
      // If classification fails, fall back to medium tier
      console.warn("Classification failed:", error);
      return {
        tier: "medium",
        confidence: 0.5,
        reasoning: "Classification failed, using fallback",
        indicators: ["fallback"],
      };
    }
  }

  /**
   * Map classification result to a specific model
   */
  private mapClassificationToModel(
    classification: ClassificationResult,
    context: RoutingContext,
    classificationLatencyMs: number
  ): RoutingDecision {
    const { tier, confidence, reasoning, indicators } = classification;

    // Honor user preferences if they specified a model
    if (context.requestedModel) {
      const explicit = getModel(context.requestedModel);
      if (explicit) {
        return {
          config: explicit,
          confidence: 1.0,
          reasoning: `Explicit model request: ${context.requestedModel} (classified as ${tier})`,
          estimatedCost: explicit.costPer1kTokens * 2,
          fallbackChain: this.buildFallbackChain(explicit),
        };
      }
    }

    // Map tier to model
    let selectedModel: ModelConfig;
    let selectionReasoning: string;

    switch (tier) {
      case "simple":
        selectedModel = MODELS["gemma-2b"] || MODELS["llama3.2-1b"];
        selectionReasoning = `LLM classified as simple (${confidence.toFixed(2)} confidence): ${reasoning}`;
        break;

      case "medium":
        selectedModel = MODELS["claude-haiku"] || MODELS["gpt-4o-mini"];
        selectionReasoning = `LLM classified as medium (${confidence.toFixed(2)} confidence): ${reasoning}`;
        break;

      case "complex":
        selectedModel = MODELS["claude-sonnet"] || MODELS["gpt-4o"];
        selectionReasoning = `LLM classified as complex (${confidence.toFixed(2)} confidence): ${reasoning}`;
        break;

      case "reasoning":
        selectedModel = MODELS["claude-opus"] || MODELS["gpt-4-turbo"];
        selectionReasoning = `LLM classified as reasoning (${confidence.toFixed(2)} confidence): ${reasoning}`;
        break;
    }

    // Add classification overhead to reasoning
    selectionReasoning += ` [classification: ${classificationLatencyMs.toFixed(0)}ms]`;

    // Add indicators if present
    if (indicators?.length > 0) {
      selectionReasoning += ` [indicators: ${indicators.join(", ")}]`;
    }

    return {
      config: selectedModel,
      confidence: confidence * 0.9, // Slightly reduce confidence due to classification overhead
      reasoning: selectionReasoning,
      estimatedCost: selectedModel.costPer1kTokens * 2,
      fallbackChain: this.buildFallbackChain(selectedModel),
    };
  }

  /**
   * Build fallback chain for a model
   */
  private buildFallbackChain(primary: ModelConfig): ModelConfig[] {
    const fallbacks: ModelConfig[] = [];

    // Add models in order of preference
    const fallbackOrder = [
      "claude-haiku",
      "gpt-4o-mini",
      "llama3.2-3b",
      "gemma-2b",
    ];

    for (const alias of fallbackOrder) {
      const model = getModel(alias);
      if (model && model.model !== primary.model) {
        fallbacks.push(model);
      }
    }

    return fallbacks.slice(0, 3);
  }

  /**
   * Generate cache key for a prompt
   */
  private getCacheKey(prompt: string): string {
    // Simple hash of first 200 chars
    let hash = 0;
    const str = prompt.slice(0, 200);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /** Clear the classification cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Update options at runtime */
  updateOptions(options: Partial<LLMClassifierOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.cacheTtlMs) {
      this.cache = new ClassificationCache(options.cacheTtlMs);
    }
  }
}

/** Export singleton with defaults */
export const llmClassifierEngine = new LLMClassifierEngine();
