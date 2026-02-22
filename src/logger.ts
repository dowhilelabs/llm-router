/**
 * Logging Module
 *
 * Tracks routing decisions, costs, and estimated savings.
 */

import type { ModelConfig, RoutingDecision } from "./types.ts";

/** Log entry for a routing decision */
export interface RoutingLogEntry {
  timestamp: string;
  requestId: string;
  prompt: string;
  promptLength: number;
  selected: ModelConfig;
  confidence: number;
  reasoning: string;
  estimatedCost: number;
  /** What the user would have paid without routing */
  baselineCost: number;
  /** How much we saved */
  estimatedSavings: number;
  /** Savings percentage */
  savingsPercent: number;
  /** Processing time in ms */
  latencyMs: number;
  /** Whether this was a fallback (original model failed) */
  wasFallback: boolean;
}

/** Stats aggregator */
export interface CostStats {
  totalRequests: number;
  totalEstimatedCost: number;
  totalBaselineCost: number;
  totalSavings: number;
  averageSavingsPercent: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
}

/** Logger options */
export interface LoggerOptions {
  /** Enable console logging */
  console?: boolean;
  /** Store logs in memory (for stats) */
  memory?: boolean;
  /** Max entries to keep in memory */
  maxMemoryEntries?: number;
  /** Optional: write to file */
  filePath?: string;
}

class RouterLogger {
  private options: LoggerOptions;
  private logs: RoutingLogEntry[] = [];
  private stats: CostStats = {
    totalRequests: 0,
    totalEstimatedCost: 0,
    totalBaselineCost: 0,
    totalSavings: 0,
    averageSavingsPercent: 0,
    byProvider: {},
    byModel: {},
  };

  constructor(options: LoggerOptions = {}) {
    this.options = {
      console: true,
      memory: true,
      maxMemoryEntries: 10000,
      ...options,
    };
  }

  /**
   * Log a routing decision
   * @param decision The routing decision
   * @param baselineModel What model would have been used without routing (e.g., "claude-opus")
   * @param latencyMs Time spent classifying
   * @param requestId Unique request identifier
   * @param wasFallback Whether this was a fallback after primary model failed
   */
  logDecision(
    decision: RoutingDecision,
    baselineModel: string,
    latencyMs: number,
    requestId: string = crypto.randomUUID(),
    wasFallback: boolean = false
  ): RoutingLogEntry {
    // Estimate baseline cost (assume 2k tokens for baseline)
    const baselineCostPer1k = this.getModelCost(baselineModel);
    const baselineCost = baselineCostPer1k * 2;

    // Calculate savings
    const savings = baselineCost - decision.estimatedCost;
    const savingsPercent = baselineCost > 0 
      ? (savings / baselineCost) * 100 
      : 0;

    const entry: RoutingLogEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      prompt: decision.reasoning, // Don't log full prompt for privacy
      promptLength: decision.reasoning.length,
      selected: decision.config,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      estimatedCost: decision.estimatedCost,
      baselineCost,
      estimatedSavings: savings,
      savingsPercent,
      latencyMs,
      wasFallback,
    };

    // Console output
    if (this.options.console) {
      this.logToConsole(entry);
    }

    // Memory storage
    if (this.options.memory) {
      this.logs.push(entry);
      this.trimLogs();
      this.updateStats(entry);
    }

    return entry;
  }

  /** Log a routing decision with full context */
  log(
    context: {
      prompt: string;
      requestedModel?: string;
    },
    decision: RoutingDecision,
    latencyMs: number
  ): RoutingLogEntry {
    // Determine baseline: what would have been used without routing
    const baselineModel = context.requestedModel || "claude-opus"; // Conservative baseline

    // Truncate prompt for logging (privacy)
    const truncatedPrompt = context.prompt.slice(0, 200) + 
      (context.prompt.length > 200 ? "..." : "");

    const requestId = crypto.randomUUID();

    const entry: RoutingLogEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      prompt: truncatedPrompt,
      promptLength: context.prompt.length,
      selected: decision.config,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      estimatedCost: decision.estimatedCost,
      baselineCost: this.getModelCost(baselineModel) * 2,
      estimatedSavings: 0,
      savingsPercent: 0,
      latencyMs,
      wasFallback: false,
    };

    entry.estimatedSavings = entry.baselineCost - entry.estimatedCost;
    entry.savingsPercent = entry.baselineCost > 0 
      ? (entry.estimatedSavings / entry.baselineCost) * 100 
      : 0;

    if (this.options.console) {
      this.logToConsole(entry);
    }

    if (this.options.memory) {
      this.logs.push(entry);
      this.trimLogs();
      this.updateStats(entry);
    }

    return entry;
  }

  private logToConsole(entry: RoutingLogEntry): void {
    const savingsStr = entry.estimatedSavings > 0 
      ? `💰 Saved $${entry.estimatedSavings.toFixed(4)} (${entry.savingsPercent.toFixed(1)}%)`
      : entry.estimatedSavings < 0
        ? `⚠️  Extra $${Math.abs(entry.estimatedSavings).toFixed(4)}`
        : `💰 Free`;

    const emoji = entry.selected.provider === "ollama" ? "🏠" : "☁️";
    
    console.log(
      `[${entry.timestamp.slice(11, 19)}] ` +
      `${emoji} ${entry.selected.provider}/${entry.selected.model} ` +
      `($${entry.estimatedCost.toFixed(4)}) ` +
      `${savingsStr} ` +
      `| ${entry.latencyMs.toFixed(1)}ms ` +
      `| ${entry.reasoning.slice(0, 60)}${entry.reasoning.length > 60 ? "..." : ""}`
    );
  }

  private getModelCost(modelName: string): number {
    // Approximate costs per 1k tokens (input)
    const costs: Record<string, number> = {
      "claude-opus": 15,
      "claude-3-opus": 15,
      "claude-sonnet": 3,
      "claude-3-5-sonnet": 3,
      "claude-haiku": 0.25,
      "claude-3-haiku": 0.25,
      "gpt-4-turbo": 10,
      "gpt-4": 30,
      "gpt-4o": 2.5,
      "gpt-4o-mini": 0.15,
      "gpt-4o-codex": 3,
      "codex": 3,
    };

    return costs[modelName] || 5; // Default conservative
  }

  private trimLogs(): void {
    if (this.logs.length > (this.options.maxMemoryEntries || 10000)) {
      this.logs.splice(0, this.logs.length - (this.options.maxMemoryEntries || 10000));
    }
  }

  private updateStats(entry: RoutingLogEntry): void {
    this.stats.totalRequests++;
    this.stats.totalEstimatedCost += entry.estimatedCost;
    this.stats.totalBaselineCost += entry.baselineCost;
    this.stats.totalSavings += entry.estimatedSavings;
    
    // Update average savings
    this.stats.averageSavingsPercent = 
      (this.stats.totalSavings / this.stats.totalBaselineCost) * 100;

    // By provider
    const provider = entry.selected.provider;
    this.stats.byProvider[provider] = (this.stats.byProvider[provider] || 0) + 1;

    // By model
    const model = entry.selected.model;
    this.stats.byModel[model] = (this.stats.byModel[model] || 0) + 1;
  }

  /** Get current stats */
  getStats(): CostStats {
    return { ...this.stats };
  }

  /** Get all logs (recent first) */
  getLogs(limit: number = 100): RoutingLogEntry[] {
    return this.logs.slice(-limit).reverse();
  }

  /** Get formatted summary for display */
  getSummary(): string {
    const s = this.stats;
    const savings = s.totalSavings;
    const percent = s.averageSavingsPercent;
    
    return [
      `📊 Routing Stats:`,
      `  Requests: ${s.totalRequests.toLocaleString()}`,
      `  Total Cost: $${s.totalEstimatedCost.toFixed(4)}`,
      `  Without Router: $${s.totalBaselineCost.toFixed(4)}`,
      `  💰 SAVED: $${savings.toFixed(4)} (${percent.toFixed(1)}%)`,
      ``,
      `By Provider:`,
      ...Object.entries(s.byProvider).map(([p, c]) => `  ${p}: ${c}`),
      ``,
      `Top Models:`,
      ...Object.entries(s.byModel)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([m, c]) => `  ${m}: ${c}`),
    ].join("\n");
  }

  /** Reset stats */
  reset(): void {
    this.logs = [];
    this.stats = {
      totalRequests: 0,
      totalEstimatedCost: 0,
      totalBaselineCost: 0,
      totalSavings: 0,
      averageSavingsPercent: 0,
      byProvider: {},
      byModel: {},
    };
  }
}

// Singleton instance
let defaultLogger: RouterLogger | null = null;

/** Get or create default logger */
export function getLogger(options?: LoggerOptions): RouterLogger {
  if (!defaultLogger) {
    defaultLogger = new RouterLogger(options);
  }
  return defaultLogger;
}

/** Create a new logger instance */
export function createLogger(options?: LoggerOptions): RouterLogger {
  return new RouterLogger(options);
}

// Export types
export { RouterLogger };
