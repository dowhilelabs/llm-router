/**
 * LLM Router
 *
 * Smart model selection proxy for AI providers.
 *
 * Usage:
 *   bun run src/index.ts              # Default config
 *   bun run src/index.ts --config=./config.json  # Custom config
 *
 * Environment variables:
 *   PORT=8402
 *   HOST=127.0.0.1
 *   DEBUG=true
 *   ANTHROPIC_API_KEY=...
 *   OPENAI_API_KEY=...
 *   OLLAMA_URL=http://localhost:11434
 */

import { start } from "./server.ts";
import type { RouterConfig } from "./types.ts";
import { readFileSync, existsSync } from "fs";

/** Parse args for config file */
function parseArgs(): { configPath?: string } {
  const args = process.argv.slice(2);
  const configArg = args.find((arg) => arg.startsWith("--config="));
  return {
    configPath: configArg ? configArg.split("=")[1] : undefined,
  };
}

/** Load config from file or environment */
function loadConfig(): RouterConfig {
  const { configPath } = parseArgs();

  // Default config
  const config: RouterConfig = {
    port: parseInt(process.env.PORT || "8402"),
    host: process.env.HOST || "127.0.0.1",
    defaultEngine: process.env.ENGINE || "default",
    apiKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      google: process.env.GOOGLE_API_KEY,
      ollama: undefined, // Ollama is local
      local: undefined,
    },
    baseUrls: process.env.OLLAMA_URL
      ? { ollama: process.env.OLLAMA_URL }
      : undefined,
    timeoutMs: parseInt(process.env.TIMEOUT || "120000"),
    debug: process.env.DEBUG === "true",
  };

  // Load from JSON config file if provided
  if (configPath && existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      Object.assign(config, fileConfig);
      console.log(`Loaded config from ${configPath}`);
    } catch (error) {
      console.error(`Failed to load config: ${error}`);
      process.exit(1);
    }
  }

  return config;
}

/** Main entry point */
async function main() {
  const config = loadConfig();

  if (config.debug) {
    console.log("Config:", JSON.stringify(config.apiKeys, (_k, v) =>
      v ? "***" : undefined, 2));
  }

  const { stop } = await start(config);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await stop();
    process.exit(0);
  });
}

// Run if called directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });
}

// Exports
export { loadConfig };
export type { RouterConfig } from "./types.ts";
export { autoRoute, registerEngine, registerFactory } from "./engines/index.ts";
export { createApp, start } from "./server.ts";
export { 
  getLogger, 
  createLogger,
  type RoutingLogEntry,
  type CostStats,
  type LoggerOptions,
} from "./logger.ts";
