# Logging & Cost Tracking

The LLM Router automatically tracks all routing decisions and cost savings.

## Console Output

Every request logs a real-time summary to console:

```
[14:23:45] 🏠 ollama/gemma:2b ($0.0000) 💰 Saved $0.0150 (100.0%) | 1.2ms | Simple greeting - using local fast model
[14:23:46] ☁️  openai/gpt-4o ($0.0025) 💰 Saved $0.0175 (87.5%) | 45.8ms | Code query with complexity 50 - using balanced coding model
[14:23:47] ☁️  anthropic/claude-opus ($0.0150) ⚠️  Extra $0.0050 | 112.3ms | High complexity (92) - using reasoning model
```

**Legend:**
- 🏠 = Local (Ollama) - free
- ☁️ = Cloud provider - paid
- 💰 = Saved money vs baseline model
- ⚠️ = More expensive but necessary for quality
- Time = routing decision latency (not including model response)

## Response Headers

Every proxied request includes cost headers:

```http
x-router-model: gpt-4o
x-router-provider: openai
x-router-cost: 0.003456
x-router-savings: 0.011544
x-router-savings-percent: 77.0
```

Debug mode adds:
```http
x-router-decision: Code query with complexity 45 - using balanced coding model
x-router-latency-ms: 2.3
```

## Stats Endpoints

### JSON Stats

```bash
curl http://localhost:8402/stats | jq
```

Response:
```json
{
  "stats": {
    "totalRequests": 1234,
    "totalEstimatedCost": 12.34,
    "totalBaselineCost": 45.67,
    "totalSavings": 33.33,
    "averageSavingsPercent": 73.0,
    "byProvider": {
      "ollama": 800,
      "anthropic": 300,
      "openai": 134
    },
    "byModel": {
      "gemma:2b": 800,
      "claude-sonnet": 250,
      "gpt-4o": 134
    }
  },
  "recentLogs": [
    {
      "timestamp": "2025-02-22T14:23:47.123Z",
      "requestId": "uuid-here",
      "prompt": "Explain quantum entanglement...",
      "promptLength": 156,
      "selected": {
        "provider": "anthropic",
        "model": "claude-opus-20240229",
        "costPer1kTokens": 15,
        "maxTokens": 4096,
        "contextWindow": 200000,
        "strengths": ["reasoning", "complex", "agentic"]
      },
      "confidence": 0.95,
      "reasoning": "High complexity (92) - using reasoning model",
      "estimatedCost": 0.015,
      "baselineCost": 0.015,
      "estimatedSavings": 0.0,
      "savingsPercent": 0.0,
      "latencyMs": 112.3,
      "wasFallback": false
    }
  ]
}
```

### Text Summary

```bash
curl http://localhost:8402/stats/summary
```

Output:
```
📊 Routing Stats:
  Requests: 1,234
  Total Cost: $12.34
  Without Router: $45.67
  💰 SAVED: $33.33 (73.0%)

By Provider:
  ollama: 800
  anthropic: 300
  openai: 134

Top Models:
  gemma:2b: 800
  claude-sonnet: 250
  gpt-4o: 134
```

## Baseline Model Calculation

The router uses **Claude Opus** ($15/1k tokens) as the conservative baseline for savings calculation.

This means:
- If every request went to Opus, you'd pay maximum
- By routing intelligently, you save money
- Even if a request goes to an expensive model, it shows any net savings vs the baseline

Example:
```
Request: "Write me a poem"
Baseline model: Claude Opus ($0.015 per 1k tokens)
Selected model: Ollama gemma:2b (free)
Baseline cost: $0.030 (for estimated 2k tokens)
Selected cost: $0.000
Savings: $0.030 (100%)
```

If you provide an explicit model request:
```
Request: POST body contains model="gpt-4o"
Baseline model: GPT-4o ($0.0025 per 1k tokens)
Selected model: Ollama kimi (free)
Baseline cost: $0.005
Selected cost: $0.000
Savings: $0.005 (100%)
```

## Programmatic Access

```typescript
import { getLogger } from "@dowhilelabs/llm-router";

const logger = getLogger();

// Get full stats
const stats = logger.getStats();
console.log(`Total saved: $${stats.totalSavings.toFixed(2)}`);
console.log(`Savings rate: ${stats.averageSavingsPercent.toFixed(1)}%`);

// Get recent logs
const recent = logger.getLogs(10);
for (const entry of recent) {
  console.log(`${entry.selected.model}: $${entry.estimatedCost} (saved $${entry.estimatedSavings})`);
}

// Get formatted summary
console.log(logger.getSummary());

// Reset stats (useful for testing)
logger.reset();
```

## Custom Logger Instances

```typescript
import { createLogger } from "@dowhilelabs/llm-router";

const testLogger = createLogger({
  console: false,      // Don't log to console
  memory: true,        // Keep logs in memory
  maxMemoryEntries: 100, // Only keep last 100
});

// Use it independently
testLogger.log(context, decision, latencyMs);
const testStats = testLogger.getStats();
```

## Production Considerations

### Privacy

The router **does not store prompt content** in stats. Only:
- First 200 characters (for logging)
- Prompt length (metadata)
- Routing decision (why it chose that model)

### Storage

Logs are kept in memory with a configurable limit (default 10,000 entries).

For production, consider:
- Exporting stats regularly via `/stats` endpoint
- Shipping logs to observability platform (Datadog, New Relic, etc.)
- Setting `maxMemoryEntries` to prevent unbounded growth

### Performance

Decision logging adds minimal overhead:
- <1ms for typical requests
- No I/O (all in-memory)
- Minimal CPU for stats calculations

See `latencyMs` in response headers for actual routing decision time.

## Observability Patterns

### Monitor Cost Trends

```bash
# Daily savings calculation
for day in {1..30}; do
  curl -s http://localhost:8402/stats | jq '.stats.totalSavings'
done
```

### Alert on Expensive Requests

```bash
# Watch for requests costing > $0.01
curl -s http://localhost:8402/stats | jq '.recentLogs[] | select(.estimatedCost > 0.01)'
```

### Track Provider Usage

```bash
# Get provider distribution
curl -s http://localhost:8402/stats | jq '.stats.byProvider'
```

### Model Preference Metrics

```bash
# See which models are handling traffic
curl -s http://localhost:8402/stats | jq '.stats.byModel | sort_by(.) | reverse | .[0:5]'
```

## Example Integration

With OpenClaw or your app:

```typescript
// After making a request through the router
const response = await fetch("http://localhost:8402/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ /* ... */ }),
});

// Check routing headers
const model = response.headers.get("x-router-model");
const savings = response.headers.get("x-router-savings");
const savingsPercent = response.headers.get("x-router-savings-percent");

console.log(`Request routed to ${model}`);
console.log(`Saved $${savings} (${savingsPercent}% of baseline)`);
```
