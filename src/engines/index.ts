/**
 * Decision Engine Registry
 * 
 * Pluggable engine system. Register your own engines here.
 */

import type { 
  DecisionEngine, 
  RoutingContext, 
  RoutingDecision,
  DecisionEngineFactory,
} from "../types.ts";
import { defaultEngine, DefaultEngine } from "./default.ts";
import { llmClassifierEngine, LLMClassifierEngine } from "./llm-classifier.ts";

/** Registry of available engines */
const engines = new Map<string, DecisionEngine>();

/** Factory registry for lazy initialization */
const factories = new Map<string, DecisionEngineFactory>();

/** Engine priorities - higher = tried first */
const priorities = new Map<string, number>();

/** Initialize with default engine */
export function initializeRegistry(): void {
  registerEngine("default", defaultEngine, 100);
  registerEngine("llm-classifier", llmClassifierEngine, 80);
  registerFactory("custom", () => new DefaultEngine(), 50);
  registerFactory("llm", () => new LLMClassifierEngine(), 80);
}

/** Register an engine instance */
export function registerEngine(
  name: string, 
  engine: DecisionEngine, 
  priority: number = 0
): void {
  engines.set(name, engine);
  priorities.set(name, priority);
}

/** Register an engine factory for lazy initialization */
export function registerFactory(
  name: string,
  factory: DecisionEngineFactory,
  priority: number = 0
): void {
  factories.set(name, factory);
  priorities.set(name, priority);
}

/** Get an engine by name */
export function getEngine(name: string): DecisionEngine | undefined {
  // Check if already instantiated
  if (engines.has(name)) {
    return engines.get(name);
  }
  
  // Check factories
  const factory = factories.get(name);
  if (factory) {
    const engine = factory();
    engines.set(name, engine);
    return engine;
  }
  
  return undefined;
}

/** Route a request using the selected engine */
export async function route(
  context: RoutingContext,
  engineName: string = "default"
): Promise<RoutingDecision> {
  const engine = getEngine(engineName);
  
  if (!engine) {
    throw new Error(`Engine not found: ${engineName}`);
  }
  
  const decision = await engine.decide(context);
  
  if (!decision) {
    throw new Error(`Engine ${engineName} returned null decision`);
  }
  
  return decision;
}

/** 
 * Auto-route using the best available engine.
 * Tries engines by priority until one returns a decision.
 */
export async function autoRoute(
  context: RoutingContext
): Promise<RoutingDecision> {
  const sortedEngines = Array.from(engines.entries())
    .sort((a, b) => (priorities.get(b[0]) || 0) - (priorities.get(a[0]) || 0));
  
  for (const [name, engine] of sortedEngines) {
    // Check confidence if available
    if (engine.getConfidence) {
      const confidence = await engine.getConfidence(context);
      if (confidence < 0.3) continue; // Skip low-confidence engines
    }
    
    const decision = await engine.decide(context);
    if (decision) {
      return decision;
    }
  }
  
  // Fallback to default
  const defaultDecision = await defaultEngine.decide(context);
  if (!defaultDecision) {
    throw new Error("No engine could handle the request");
  }
  return defaultDecision;
}

/** List all registered engines */
export function listEngines(): Array<{ 
  name: string; 
  version: string; 
  priority: number > {
  return Array.from(engines.entries()).map(([name, engine]) => ({
    name,
    version: engine.version,
    priority: priorities.get(name) || 0,
  }));
}

/** Remove an engine */
export function unregisterEngine(name: string): boolean {
  const result = engines.delete(name);
  factories.delete(name);
  priorities.delete(name);
  return result;
}

// Initialize on import
initializeRegistry();

// Exports
export { defaultEngine, DefaultEngine };
export {
  llmClassifierEngine,
  LLMClassifierEngine,
  type LLMClassifierOptions,
} from "./llm-classifier.ts";

// Convenience routing functions
export { defaultEngine as decide };
