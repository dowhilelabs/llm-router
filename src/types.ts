/**
 * Core types for the LLM Router
 * 
 * The decision engine is designed to be pluggable.
 * Implement DecisionEngine to create custom routing logic.
 */

export type Provider = "anthropic" | "openai" | "ollama" | "google" | "local";

export interface ModelConfig {
  provider: Provider;
  model: string;
  costPer1kTokens: number;
  maxTokens: number;
  contextWindow: number;
  strengths: string[];
}

export interface RoutingContext {
  prompt: string;
  conversationHistory?: string[];
  requestedModel?: string;
  requestedProvider?: Provider;
  userPreferences?: UserPreferences;
  metadata?: Record<string, unknown>;
}

export interface UserPreferences {
  preferredProvider?: Provider;
  maxCost?: number;
  minQuality?: "low" | "medium" | "high";
  allowFallback?: boolean;
}

export interface RoutingDecision {
  config: ModelConfig;
  confidence: number;
  reasoning: string;
  estimatedCost: number;
  fallbackChain: ModelConfig[];
}

/** 
 * Pluggable decision engine interface.
 * Implement this to create custom routing strategies.
 */
export interface DecisionEngine {
  readonly name: string;
  readonly version: string;
  
  /**
   * Analyze the context and return a routing decision.
   * @returns RoutingDecision or null if this engine cannot handle the request
   */
  decide(context: RoutingContext): RoutingDecision | null | Promise<RoutingDecision | null>;
  
  /**
   * Optional: Provide a confidence score for this engine's ability to handle the request.
   * Higher scores = this engine is more likely to make the right decision.
   * Used when multiple engines are registered.
   */
  getConfidence?(context: RoutingContext): number | Promise<number>;
}

/** 
 * Provider adapter interface.
 * Each provider (Anthropic, OpenAI, Ollama, etc.) implements this.
 */
export interface ProviderAdapter {
  readonly provider: Provider;
  
  /** Check if this adapter can handle the given request */
  canHandle(config: ModelConfig): boolean;
  
  /** Forward the request to the provider */
  forward(request: Request, config: ModelConfig): Promise<Response>;
  
  /** List available models from this provider */
  listModels(): Promise<ModelConfig[]>;
  
  /** Estimate cost for a given prompt/completion */
  estimateCost(promptTokens: number, completionTokens: number, model: string): number;
}

/** Request/Response types for the proxy */
export interface ProxyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Configuration for the router */
export interface RouterConfig {
  /** Port to listen on */
  port: number;
  
  /** Host to bind to */
  host: string;
  
  /** Default decision engine to use */
  defaultEngine: string;
  
  /** Provider API keys */
  apiKeys: Record<Provider, string | undefined>;
  
  /** Provider base URLs (optional, for customization) */
  baseUrls?: Partial<Record<Provider, string>>;
  
  /** Timeout for provider requests in ms */
  timeoutMs: number;
  
  /** Enable debug logging */
  debug: boolean;
}

/** Factory function type for creating decision engines */
export type DecisionEngineFactory = () => DecisionEngine;

/** Registry entry for a provider adapter */
export interface AdapterRegistration {
  adapter: ProviderAdapter;
  priority: number;
}

/** Registry entry for a decision engine */
export interface EngineRegistration {
  engine: DecisionEngine;
  priority: number;
  enabled: boolean;
}
