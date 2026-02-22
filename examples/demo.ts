/**
 * Demo: Testing the router with sample requests
 * 
 * Usage:
 *   # Terminal 1: Start the router
 *   bun run dev
 *
 *   # Terminal 2: Run this demo
 *   bun run examples/demo.ts
 */

const ROUTER_URL = "http://localhost:8402";

/** Test cases that show different routing behaviors */
const testCases = [
  {
    name: "Heartbeat",
    prompt: "HEARTBEAT_OK",
    expectedModel: "gemma:2b",
  },
  {
    name: "Simple greeting",
    prompt: "Hi! How are you?",
    expectedModel: "gemma:2b",
  },
  {
    name: "Code question",
    prompt: "I have a bug in my async function. The promise keeps hanging.",
    expectedModel: "codex",
  },
  {
    name: "Complex coding",
    prompt: `I need to refactor my Node.js microservice architecture. 
    Currently using Express, but considering Fastify. 
    How do I handle circuit breaker patterns?
    Here's my current code:
    
    \`\`\`javascript
    app.post('/api/data', async (req, res) => {
      try {
        const result = await externalApi.call();
        res.json(result);
      } catch (e) {
        res.status(500).json(e);
      }
    });
    \`\`\``,
    expectedModel: "gpt-4o",
  },
  {
    name: "Reasoning task",
    prompt: "Explain quantum entanglement and how it differs from classical correlation. Why can't it be used for faster-than-light communication?",
    expectedModel: "claude-opus",
  },
];

async function testRouting() {
  console.log("🚀 LLM Router Demo\n");
  console.log(`Testing against ${ROUTER_URL}\n`);
  console.log("═".repeat(100));

  for (const test of testCases) {
    try {
      const response = await fetch(`${ROUTER_URL}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: test.prompt }],
        }),
      });

      if (!response.ok) {
        console.error(`❌ ${test.name}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const decision = data.decision;
      const savings = data.savings;

      const modelMatch = decision.model.includes("gemma")
        ? "✅"
        : decision.model.includes("codex") || decision.model.includes("opus")
          ? "✅"
          : "ℹ️";

      console.log(`\n${modelMatch} ${test.name}`);
      console.log(`   Model: ${decision.provider}/${decision.model}`);
      console.log(
        `   Confidence: ${(decision.confidence * 100).toFixed(1)}%`
      );
      console.log(`   Cost: $${decision.estimatedCost.toFixed(6)}`);
      console.log(
        `   💰 Saved: $${savings.savedAmount.toFixed(6)} (${savings.savingsPercent.toFixed(1)}%)`
      );
      console.log(`   Reason: ${decision.reasoning}`);

      if (decision.fallbackChain.length > 0) {
        console.log(
          `   Fallbacks: ${decision.fallbackChain.map((f) => `${f.provider}/${f.model}`).join(" → ")}`
        );
      }
    } catch (error) {
      console.error(`❌ ${test.name}: ${error}`);
    }
  }

  console.log("\n" + "═".repeat(100));

  // Fetch stats
  try {
    const statsResponse = await fetch(`${ROUTER_URL}/stats`);
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log("\n📊 Routing Stats:");
      console.log(`   Total Requests: ${stats.stats.totalRequests}`);
      console.log(
        `   Total Cost: $${stats.stats.totalEstimatedCost.toFixed(4)}`
      );
      console.log(
        `   Without Router: $${stats.stats.totalBaselineCost.toFixed(4)}`
      );
      console.log(
        `   💰 SAVED: $${stats.stats.totalSavings.toFixed(4)} (${stats.stats.averageSavingsPercent.toFixed(1)}%)`
      );
    }
  } catch (error) {
    console.error("Could not fetch stats:", error);
  }

  console.log("\n✨ Demo complete!");
}

testRouting().catch(console.error);
