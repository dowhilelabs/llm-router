/**
 * Model Registry
 * 
 * Central registry of all available models and their configurations.
 * Users can extend this with their own models.
 */

import type { ModelConfig, Provider } from "./types.ts";

/** Built-in model registry */
export const MODELS: Record<string, ModelConfig> = {
  // Ollama - Local models (free)
  "gemma-2b": {
    provider: "ollama" as Provider,
    model: "gemma:2b",
    costPer1kTokens: 0,
    maxTokens: 4096,
    contextWindow: 4096,
    strengths: ["simple", "fast", "free", "heartbeat", "classify"],
  },
  "llama3-8b": {
    provider: "ollama" as Provider,
    model: "llama3:8b",
    costPer1kTokens: 0,
    maxTokens: 8192,
    contextWindow: 8192,
    strengths: ["coding", "reasoning", "local"],
  },
  "kimi": {
    provider: "ollama" as Provider,
    model: "kimi-k2.5",
    costPer1kTokens: 0,
    maxTokens: 32768,
    contextWindow: 128000,
    strengths: ["long-context", "code", "local"],
  },
  
  // Anthropic
  "claude-haiku": {
    provider: "anthropic" as Provider,
    model: "claude-3-haiku-20240307",
    costPer1kTokens: 0.25,
    maxTokens: 4096,
    contextWindow: 200000,
    strengths: ["fast", "cheap", "simple", "classification"],
  },
  "claude-sonnet": {
    provider: "anthropic" as Provider,
    model: "claude-3-5-sonnet-20241022",
    costPer1kTokens: 3,
    maxTokens: 8192,
    contextWindow: 200000,
    strengths: ["coding", "reasoning", "balanced"],
  },
  "claude-opus": {
    provider: "anthropic" as Provider,
    model: "claude-3-opus-20240229",
    costPer1kTokens: 15,
    maxTokens: 4096,
    contextWindow: 200000,
    strengths: ["reasoning", "complex", "agentic"],
  },
  
  // OpenAI
  "gpt-4o-mini": {
    provider: "openai" as Provider,
    model: "gpt-4o-mini",
    costPer1kTokens: 0.15,
    maxTokens: 16384,
    contextWindow: 128000,
    strengths: ["fast", "cheap", "simple"],
  },
  "gpt-4o": {
    provider: "openai" as Provider,
    model: "gpt-4o",
    costPer1kTokens: 2.5,
    maxTokens: 16384,
    contextWindow: 128000,
    strengths: ["balanced", "coding", "vision"],
  },
  "gpt-4-turbo": {
    provider: "openai" as Provider,
    model: "gpt-4-turbo-preview",
    costPer1kTokens: 10,
    maxTokens: 4096,
    contextWindow: 128000,
    strengths: ["reasoning", "complex", "coding"],
  },
  "codex": {
    provider: "openai" as Provider,
    model: "gpt-4o-codex",
    costPer1kTokens: 3,
    maxTokens: 8192,
    contextWindow: 128000,
    strengths: ["coding", "diff", "agentic"],
  },
  
  // Google
  "gemini-flash": {
    provider: "google" as Provider,
    model: "gemini-2.0-flash-exp",
    costPer1kTokens: 0.075,
    maxTokens: 8192,
    contextWindow: 1000000,
    strengths: ["fast", "cheap", "long-context"],
  },
  "gemini-pro": {
    provider: "google" as Provider,
    model: "gemini-1.5-pro-latest",
    costPer1kTokens: 3.5,
    maxTokens: 8192,
    contextWindow: 2000000,
    strengths: ["reasoning", "long-context", "complex"],
  },
};

/** Get a model by alias or name */
export function getModel(alias: string): ModelConfig | undefined {
  return MODELS[alias] || Object.values(MODELS).find(m => m.model === alias);
}

/** Get models by provider */
export function getModelsByProvider(provider: Provider): ModelConfig[] {
  return Object.values(MODELS).filter(m => m.provider === provider);
}

/** Get models by strength tag */
export function getModelsByStrength(strength: string): ModelConfig[] {
  return Object.values(MODELS).filter(m => m.strengths.includes(strength));
}

/** Get cheapest model for a given capability */
export function getCheapestModel(strength: string, preferLocal = true): ModelConfig | undefined {
  const models = getModelsByStrength(strength);
  if (preferLocal) {
    const local = models.filter(m => m.costPer1kTokens === 0);
    if (local.length > 0) return local[0];
  }
  return models.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens)[0];
}

/** Get best model by capability tier */
export function getModelForTier(tier: "simple" | "medium" | "complex" | "reasoning"): ModelConfig {
  switch (tier) {
    case "simple":
      return getCheapestModel("simple", true) || MODELS["gemma-2b"];
    case "medium":
      return getCheapestModel("balanced") || MODELS["claude-sonnet"];
    case "complex":
      return getCheapestModel("coding") || MODELS["gpt-4o"];
    case "reasoning":
      return getCheapestModel("reasoning") || MODELS["claude-opus"];
  }
}
