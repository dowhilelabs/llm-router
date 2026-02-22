# LLM Router

Smart model selection proxy for AI providers (Anthropic, OpenAI, Ollama, Google).

```
Your App → localhost:8402 (Router) → Best Model for Job
```

## Quick Start

```bash
# Install dependencies
bun install

# Run with defaults
bun run dev

# Or with env vars
DEBUG=true \
ANTHROPIC_API_KEY=sk-... \
OPENAI_API_KEY=sk-... \
bun run dev
```

## How It Works

The router analyzes each request and selects the cheapest capable model:

| Pattern | Example | Routes To | Cost |
|---------|---------|-----------|------|
| **Heartbeat** | `HEARTBEAT_OK` | Ollama gemma:2b | Free |
| **Simple** | "hi", "thanks" | Ollama gemma:2b | Free |
| **Coding** | "Fix this bug" | GPT-4o Codex | $0.003 |
| **Complex** | Long code block | Claude Sonnet | $0.005 |
| **Reasoning** | "Explain quantum" | Claude Opus | $0.015 |

## Logging & Observability

The router automatically tracks:
- **Routing decisions** - What model was chosen and why
- **Cost savings** - How much you saved vs baseline (default: Claude Opus)
- **Provider distribution** - Which providers are handling requests
- **Model usage** - Which models are being used most

All routing decisions are logged to console in real-time:
```
[14:23:45] 🏠 ollama/gemma:2b ($0.0000) 💰 Saved $0.0150 (100.0%) | 1.2ms | Simple greeting - using local fast model
[14:23:46] ☁️  openai/gpt-4o ($0.0025) 💰 Saved $0.0175 (87.5%) | 45.8ms | Code query with complexity 50 - using balanced coding model
[14:23:47] ☁️  anthropic/claude-opus ($0.0150) ⚠️  Extra $0.0050 | 112.3ms | High complexity (92) - using reasoning model
```

**Legend:**
- 🏠 = Local (Ollama) - Free
- ☁️ = Cloud provider
- 💰 = Saved money vs baseline
- ⚠️ = More expensive than baseline (but better quality needed)

### Stats API

```bash
# Get JSON stats with recent logs
curl http://localhost:8402/stats | jq

# Get human-readable summary
curl http://localhost:8402/stats/summary
```

### Custom Logging

```typescript
import { getLogger, createLogger } from "@dowhilelabs/llm-router";

// Get the singleton logger
const logger = getLogger();

// View stats
console.log(logger.getStats());
console.log(logger.getSummary());

// Get recent logs
const recent = logger.getLogs(100);

// Create an isolated logger for testing
const testLogger = createLogger({
  console: false,
  memory: true,
  maxMemoryEntries: 1000,
});
```

## Configuration

### Environment Variables

```bash
PORT=8402                    # Router port
HOST=127.0.0.1               # Bind address
DEBUG=true                   # Debug logging
ENGINE=default               # Decision engine

# Provider API keys
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Optional: Custom Ollama URL
OLLAMA_URL=http://localhost:11434
```

### Config File

```json
{
  "port": 8402,
  "host": "127.0.0.1",
  "defaultEngine": "default",
  "apiKeys": {
    "anthropic": "sk-...",
    "openai": "sk-...",
    "google": "..."
  },
  "baseUrls": {
    "ollama": "http://localhost:11434"
  },
  "debug": true
}
```

Use with `--config`:
```bash
bun run src/index.ts --config=./config.json
```

## Custom Decision Engine

The router is pluggable. Create your own engine:

```typescript
import { DecisionEngine, RoutingContext, RoutingDecision } from "./types";

class MyEngine implements DecisionEngine {
  readonly name = "custom";
  readonly version = "1.0.0";

  decide(context: RoutingContext): RoutingDecision {
    // Your custom logic here
    const isCode = context.prompt.includes("```");
    
    return {
      config: isCode ? MODELS["codex"] : MODELS["gemma-2b"],
      confidence: 0.9,
      reasoning: "Custom logic",
      estimatedCost: 0,
      fallbackChain: [],
    };
  }
}

// Register it
import { registerEngine } from "./engines";
registerEngine("custom", new MyEngine(), 100);
```

## API Endpoints

### Regular Proxy

All requests are automatically routed to the best model.

```bash
# OpenAI format
curl http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Preview Routing

See where a prompt would go without making the actual request:

```bash
curl http://localhost:8402/preview \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello world!"}]
  }'
```

Response:
```json
{
  "decision": {
    "provider": "ollama",
    "model": "gemma:2b",
    "confidence": 0.9,
    "reasoning": "Simple greeting - using local fast model",
    "estimatedCost": 0
  }
}
```

### Health Check

```bash
curl http://localhost:8402/health
```

### List Engines

```bash
curl http://localhost:8402/engines
```

### View Routing Stats

See total cost savings and routing metrics:

```bash
# JSON format
curl http://localhost:8402/stats

# Human-readable summary
curl http://localhost:8402/stats/summary
```

Example output:
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

### Response Headers

Every proxied request includes cost tracking headers:

```
x-router-model: gpt-4o
x-router-provider: openai
x-router-cost: 0.003456
x-router-savings: 0.011544
x-router-savings-percent: 77.0
```

In debug mode, also includes:
```
x-router-decision: Code query with complexity 45 - using balanced coding model
x-router-latency-ms: 2.3
```

## Integrating with OpenClaw

Point OpenClaw's provider URLs to the router:

```json
{
  "providers": {
    "anthropic": { "baseUrl": "http://localhost:8402/v1" },
    "openai": { "baseUrl": "http://localhost:8402/v1" }
  }
}
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ LLM Router  │────▶│   Models    │
│  (Your App) │◄────│  :8402      │◄────│ (Multiple)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │ Decision   │
                    │  Engine     │
                    │ (Pluggable) │
                    └─────────────┘
```

## Built-in Models

| Alias | Provider | Cost/1k | Use For |
|-------|----------|---------|---------|
| `gemma-2b` | Ollama | Free | Simple, heartbeat |
| `llama3-8b` | Ollama | Free | Coding, reasoning |
| `kimi` | Ollama | Free | Long context |
| `claude-haiku` | Anthropic | $0.25 | Fast, cheap |
| `claude-sonnet` | Anthropic | $3 | Balanced |
| `claude-opus` | Anthropic | $15 | Complex reasoning |
| `gpt-4o-mini` | OpenAI | $0.15 | Fast, cheap |
| `gpt-4o` | OpenAI | $2.50 | Balanced |
| `codex` | OpenAI | $3 | Coding specialist |
| `gemini-flash` | Google | $0.075 | Long context |

## Development

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Build for production
bun run build
```

## License

MIT
