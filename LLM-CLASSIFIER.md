# LLM-Based Classifier Engine

A two-stage decision engine that uses a fast local Ollama model to classify prompt complexity before routing.

## Architecture

```
User Prompt
    ↓
Stage 1: Fast Classification
    → smollm2:135m (local, ~50ms)
    → Returns: tier + confidence + reasoning
    ↓
Stage 2: Model Selection
    → Maps tier to appropriate model
    → Returns: RoutingDecision
    ↓
Route to Provider
```

## Overview

The LLM classifier engine trades a small amount of latency (~50-100ms) for significantly better routing accuracy.

- **Uses**: `smollm2:135m` (271MB) - extremely fast local model
- **Classification**: simple | medium | complex | reasoning
- **Cost**: Ollama runs locally (free)

## How It Works

### 1. Classification Prompt

The classifier sends a structured prompt to the local LLM:

```
You are a prompt classifier. Analyze the user request and classify its complexity.

Classify into one of these tiers:
- simple: Greetings, one-word answers, simple facts, basic questions (< 50 tokens)
- medium: Explanations, summaries, creative writing, moderate code help
- complex: Multi-step reasoning, debugging, refactoring, analysis, detailed planning
- reasoning: Research, novel problems, system design, philosophy, deep analysis

Respond ONLY with valid JSON...
```

### 2. Response Parsing

The classifier expects JSON like:

```json
{
  "tier": "complex",
  "confidence": 0.92,
  "reasoning": "Multi-step coding task with code provided",
  "indicators": ["code-block", "refactor", "issues"]
}
```

### 3. Model Mapping

| Tier | Model | When to Use |
|------|-------|-------------|
| **simple** | gemma:2b / llama3.2:1b | Heartbeats, greetings, facts |
| **medium** | claude-haiku / gpt-4o-mini | Explanations, summaries |
| **complex** | claude-sonnet / gpt-4o | Coding, debugging, analysis |
| **reasoning** | claude-opus / gpt-4-turbo | Research, novel problems |

## Usage

### As Default Engine

```bash
# Set via environment
ENGINE=llm-classifier bun run dev

# Or in config.json
{
  "defaultEngine": "llm-classifier",
  "apiKeys": { ... }
}
```

### Via Preview Endpoint

```bash
curl http://localhost:8402/preview \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Explain quantum mechanics"}],
    "metadata": { "engine": "llm-classifier" }
  }'
```

### Programmatic

```typescript
import { LLMClassifierEngine, registerEngine } from "@dowhilelabs/llm-router";

// Create with custom options
const engine = new LLMClassifierEngine({
  ollamaUrl: "http://localhost:11434",
  classifierModel: "smollm2:135m",  // or "gemma3:270m"
  timeoutMs: 5000,
  enableCache: true,
  cacheTtlMs: 60000,
});

// Register
registerEngine("my-classifier", engine, 90);

// Use
const decision = await engine.decide({
  prompt: "Write me a poem about stars",
});

console.log(decision.config.model);  // e.g., "gemma:2b"
console.log(decision.reasoning);     // "LLM classified as simple (0.89 confidence): ..."
```

## Configuration Options

```typescript
interface LLMClassifierOptions {
  /** Ollama base URL */
  ollamaUrl: string;        // default: "http://localhost:11434"
  
  /** Model for classification */
  classifierModel: string;  // default: "smollm2:135m"
  
  /** Classification timeout */
  timeoutMs: number;        // default: 5000
  
  /** Enable result caching */
  enableCache: boolean;     // default: true
  
  /** Cache TTL in milliseconds */
  cacheTtlMs: number;       // default: 60000
}
```

## Caching

Classifications are cached to avoid redundant LLM calls:

- **Key**: Hash of prompt (first 200 chars)
- **TTL**: 60 seconds (configurable)
- **Size**: Max 1000 entries (LRU eviction)

This means repeated similar prompts get instant classification.

## Performance

On an M4 Mac Mini:

| Model | Classification Time | Total Overhead |
|-------|--------------------:|---------------:|
| smollm2:135m | ~30-50ms | ~50-100ms |
| gemma3:270m | ~40-80ms | ~60-120ms |

For a complex query that would be sent to Claude Opus (~$0.015), this overhead is negligible.

## When to Use

**Use LLM classifier when:**
- ✅ Routing accuracy matters more than 50ms latency
- ✅ You have diverse prompt types (code, reasoning, simple)
- ✅ You want explainable routing decisions
- ✅ You run Ollama locally anyway

**Use rule-based (default) when:**
- ✅ Maximum speed is critical
- ✅ Prompt patterns are predictable
- ✅ You don't want to run Ollama

## Classification Examples

| Prompt | Tier | Model | Reasoning |
|--------|------|-------|-----------|
| "HEARTBEAT_OK" | simple | gemma:2b | Status check |
| "Hi!" | simple | gemma:2b | Greeting |
| "What is 2+2?" | simple | gemma:2b | Simple math |
| "Explain photosynthesis" | medium | claude-haiku | Educational explanation |
| "Fix this bug" | complex | claude-sonnet | Code debugging |
| "Refactor auth system" | complex | claude-sonnet | Multi-step code task |
| "Design a distributed system" | reasoning | claude-opus | Novel architecture |

## Error Handling

If classification fails (Ollama down, timeout, invalid JSON):

1. Falls back to `medium` tier
2. Uses `claude-haiku` or `gpt-4o-mini`
3. Logs warning to console
4. Continues with degraded confidence

## Comparison: Rule-Based vs LLM Classifier

| Aspect | Rule-Based | LLM Classifier |
|--------|-----------:|---------------:|
| Latency | <1ms | ~50-100ms |
| Accuracy | ~85% | ~95% |
| Explainability | Regex patterns | Natural language |
| Requires Ollama | No | Yes |
| Nuanced detection | Limited | Excellent |
| Cacheable | N/A | Yes |

## Troubleshooting

### Classification is slow

```bash
# Check Ollama is running
ollama ps

# Test classification directly
time ollama run smollm2:135m \
  'Classify this: "Write a function to sort a list"'
```

### Wrong classifications

- Check the classifier temperature (default: 0.1)
- Consider using `gemma3:270m` for better reasoning
- Adjust the classification prompt in `llm-classifier.ts`

### Cache not working

- Cache is disabled if `enableCache: false`
- TTL may have expired
- Different prompts hash differently (first 200 chars)

## Advanced: Custom Classification Prompt

Edit the `CLASSIFICATION_PROMPT` constant in `src/engines/llm-classifier.ts`:

```typescript
const CLASSIFICATION_PROMPT = `Your custom instructions here...

User request to classify:
"""
{{PROMPT}}
"""

JSON response:`;
```

This lets you:
- Add custom tiers
- Include domain-specific indicators
- Change the confidence scale
- Add company-specific rules
