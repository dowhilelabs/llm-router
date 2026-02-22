/**
 * Demo: LLM-Based Classifier Engine
 *
 * Shows how the two-stage routing works:
 *   1. Fast local LLM (smollm2:135m) classifies complexity
 *   2. Decision code selects appropriate model based on classification
 *
 * Usage:
 *   # Terminal 1: Start Ollama with smollm2:135m
 *   ollama pull smollm2:135m
 *   ollama serve
 *
 *   # Terminal 2: Start the router
 *   bun run dev
 *
 *   # Terminal 3: Run this demo
 *   ENGINE=llm-classifier bun run examples/llm-classifier-demo.ts
 */

import {
  LLMClassifierEngine,
  registerEngine,
} from "../src/engines/index.ts";

const ROUTER_URL = "http://localhost:8402";

/** Test cases showing different complexity levels */
const testCases = [
  {
    name: "Heartbeat",
    prompt: "HEARTBEAT_OK",
    expectedTier: "simple",
  },
  {
    name: "Simple greeting",
    prompt: "Hi! How are you doing today?",
    expectedTier: "simple",
  },
  {
    name: "Basic fact",
    prompt: "What is the capital of France?",
    expectedTier: "simple",
  },
  {
    name: "Explanation request",
    prompt: "Can you explain how a car engine works in simple terms?",
    expectedTier: "medium",
  },
  {
    name: "Code help",
    prompt: "I'm getting an error in my React component. The state isn't updating.",
    expectedTier: "complex",
  },
  {
    name: "Deep reasoning",
    prompt:
      "Compare the trade-offs between microservices and monolithic architectures for a high-traffic e-commerce platform. Consider operational complexity, team structure, and scaling characteristics.",
    expectedTier: "reasoning",
  },
  {
    name: "Multi-step coding",
    prompt: `I need to refactor this authentication system. Here's the current implementation:
    
\`\`\`typescript
class AuthManager {
  async login(email: string, password: string) {
    const user = await db.findUser(email);
    if (user.password === password) {
      return { token: generateToken(user) };
    }
    throw new Error("Invalid credentials");
  }
}
\`\`\`

Issues I see: plaintext password comparison, no rate limiting, no session management. 
Can you help me redesign this to use proper hashing, add rate limiting, and implement JWT refresh tokens?`,
    expectedTier: "complex",
  },
];

async function testLLMClassifier() {
  console.log("🧠 LLM Classifier Engine Demo\n");
  console.log("═".repeat(100));

  // First, test the engine directly
  console.log("\n📋 Direct Engine Test\n");

  const engine = new LLMClassifierEngine({
    ollamaUrl: "http://localhost:11434",
    classifierModel: "smollm2:135m",
    timeoutMs: 10000,
    enableCache: true,
    cacheTtlMs: 60000,
  });

  for (const test of testCases.slice(0, 3)) {
    console.log(`\n📝 ${test.name}`);
    console.log(`   Prompt: "${test.prompt.slice(0, 60)}${test.prompt.length > 60 ? "..." : ""}"`);

    const start = Date.now();
    const decision = await engine.decide({
      prompt: test.prompt,
    });
    const elapsed = Date.now() - start;

    console.log(`   ⏱️  Classification: ${elapsed}ms`);
    console.log(`   🎯 Selected: ${decision.config.provider}/${decision.config.model}`);
    console.log(`   💰 Cost: $${decision.estimatedCost.toFixed(6)}`);
    console.log(`   🧠 ${decision.reasoning}`);
  }

  // Then test via the router API
  console.log("\n" + "═".repeat(100));
  console.log("\n🌐 Router API Test (with llm-classifier engine)\n");

  // Check if router is running
  try {
    const health = await fetch(`${ROUTER_URL}/health`);
    if (!health.ok) {
      console.error("❌ Router not running at", ROUTER_URL);
      console.log("   Start it with: ENGINE=llm-classifier bun run dev");
      return;
    }
  } catch {
    console.error("❌ Router not running at", ROUTER_URL);
    console.log("   Start it with: ENGINE=llm-classifier bun run dev");
    return;
  }

  for (const test of testCases) {
    try {
      const response = await fetch(`${ROUTER_URL}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: test.prompt }],
          // Force llm-classifier engine
          metadata: { engine: "llm-classifier" },
        }),
      });

      if (!response.ok) {
        console.error(`❌ ${test.name}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const decision = data.decision;

      // Extract tier from reasoning
      const tierMatch = decision.reasoning.match(/classified as (\w+)/);
      const detectedTier = tierMatch ? tierMatch[1] : "unknown";

      const match = detectedTier.toLowerCase() === test.expectedTier.toLowerCase();
      const icon = match ? "✅" : "⚠️";

      console.log(`\n${icon} ${test.name} (expected: ${test.expectedTier})`);
      console.log(`   Prompt: "${test.prompt.slice(0, 50)}${test.prompt.length > 50 ? "..." : ""}"`);
      console.log(`   Model: ${decision.provider}/${decision.model}`);
      console.log(`   Cost: $${decision.estimatedCost.toFixed(6)}`);
      console.log(`   Classification: ${detectedTier}`);

      if (data.savings) {
        console.log(
          `   💰 Saved: $${data.savings.savedAmount.toFixed(6)} (${data.savings.savingsPercent.toFixed(1)}%)`
        );
      }
    } catch (error) {
      console.error(`❌ ${test.name}:`, error);
    }
  }

  // Show stats
  console.log("\n" + "═".repeat(100));
  try {
    const stats = await fetch(`${ROUTER_URL}/stats/summary`);
    if (stats.ok) {
      const text = await stats.text();
      console.log("\n" + text);
    }
  } catch {
    // Ignore
  }

  console.log("\n✨ Demo complete!");
}

// Run if called directly
if (import.meta.main) {
  testLLMClassifier().catch(console.error);
}
