/**
 * LLM Router Server
 * 
 * Hono-based HTTP proxy that routes requests to appropriate models.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import type {
  RouterConfig,
  RoutingContext,
  Provider,
} from "./types.ts";
import { autoRoute } from "./engines/index.ts";

/** Default configuration */
const DEFAULT_CONFIG: Omit<RouterConfig, "apiKeys"> = {
  port: 8402,
  host: "127.0.0.1",
  defaultEngine: "default",
  timeoutMs: 120000,
  debug: false,
};

/** Provider base URLs */
const PROVIDER_URLS: Record<Provider, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  ollama: "http://localhost:11434",
  google: "https://generativelanguage.googleapis.com",
  local: "http://localhost:8000",
};

/** Extract prompt from request body */
function extractPrompt(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  
  // OpenAI/Anthropic format
  const b = body as { messages?: Array<{ content?: string }>; prompt?: string };
  
  if (b.prompt) return b.prompt;
  
  if (b.messages?.length > 0) {
    const lastMessage = b.messages[b.messages.length - 1];
    if (typeof lastMessage.content === "string") {
      return lastMessage.content;
    }
    if (Array.isArray(lastMessage.content)) {
      // Multi-modal content, extract text
      return lastMessage.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
  }
  
  return "";
}

/** Build routing context from request */
function buildContext(
  c: Context,
  config: RouterConfig
): RoutingContext {
  const body = c.req.json as unknown;
  const prompt = extractPrompt(body);
  
  // Extract model hint from request
  const requestedModel = (body as Record<string, unknown>)?.model as string | undefined;
  
  // Extract conversation history if available
  const conversationHistory: string[] = [];
  const messages = (body as Record<string, unknown>)?.messages as Array<{ content: string }> | undefined;
  if (messages) {
    for (const msg of messages.slice(0, -1)) {
      if (typeof msg.content === "string") {
        conversationHistory.push(msg.content);
      }
    }
  }
  
  return {
    prompt,
    requestedModel,
    conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    metadata: {
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("x-forwarded-for") || "unknown",
    },
  };
}

/** Create the Hono app */
export function createApp(config: RouterConfig): Hono {
  const app = new Hono();
  
  // Middleware
  app.use(cors());
  
  // Request logging in debug mode
  if (config.debug) {
    app.use(async (c, next) => {
      console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
      await next();
    });
  }
  
  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      version: "0.1.0",
      engine: config.defaultEngine,
    });
  });
  
  // Engine info
  app.get("/engines", (c) => {
    const { listEngines } = require("./engines/index.ts");
    return c.json({ engines: listEngines() });
  });
  
  // Preview routing (no actual call)
  app.post("/preview", async (c) => {
    try {
      const context = buildContext(c, config);
      const decision = await autoRoute(context);
      
      return c.json({
        decision: {
          provider: decision.config.provider,
          model: decision.config.model,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          estimatedCost: decision.estimatedCost,
        },
        context: {
          prompt: context.prompt.slice(0, 100) + (context.prompt.length > 100 ? "..." : ""),
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  });
  
  // Main proxy endpoint
  app.all("/*", async (c) => {
    try {
      const context = buildContext(c, config);
      
      if (!context.prompt) {
        return c.json({ error: "Could not extract prompt from request" }, 400);
      }
      
      // Get routing decision
      const decision = await autoRoute(context);
      
      if (config.debug) {
        console.log(`[Router] ${decision.config.provider}/${decision.config.model}: ${decision.reasoning}`);
      }
      
      // Get provider base URL
      const baseUrl = config.baseUrls?.[decision.config.provider] ||
                      PROVIDER_URLS[decision.config.provider];
      
      // Get API key for this provider
      const apiKey = config.apiKeys[decision.config.provider];
      if (!apiKey && decision.config.provider !== "ollama" && 
          decision.config.provider !== "local") {
        return c.json(
          { error: `No API key configured for ${decision.config.provider}` },
          500
        );
      }
      
      // Build target URL
      const targetUrl = `${baseUrl}${c.req.path}`;
      
      // Clone headers
      const headers = new Headers();
      c.req.raw.headers.forEach((value, key) => {
        headers.set(key, value);
      });
      
      // Set provider-specific auth
      if (decision.config.provider === "anthropic") {
        headers.set("x-api-key", apiKey!);
        headers.set("anthropic-version", "2023-06-01");
      } else if (decision.config.provider === "openai") {
        headers.set("authorization", `Bearer ${apiKey}`);
      } else if (decision.config.provider === "google") {
        headers.set("x-goog-api-key", apiKey!);
      }
      
      // Update model in request body
      const body = await c.req.json();
      body.model = decision.config.model;
      
      // Make the request
      const response = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      
      // Clone response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      // Add routing debug headers if debug mode
      if (config.debug) {
        responseHeaders["x-router-decision"] = decision.reasoning;
        responseHeaders["x-router-model"] = decision.config.model;
        responseHeaders["x-router-provider"] = decision.config.provider;
      }
      
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Router error:", error);
      return c.json(
        { 
          error: error instanceof Error ? error.message : "Unknown error",
          ...(config.debug && { stack: error instanceof Error ? error.stack : undefined }),
        },
        500
      );
    }
  });
  
  return app;
}

/** Start the server */
export async function start(config: RouterConfig): Promise<{ 
  app: Hono; 
  stop: () => Promise<void> 
}> {
  const app = createApp(config);
  
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
  });
  
  console.log(`LLM Router listening on http://${config.host}:${config.port}`);
  console.log(`Engine: ${config.defaultEngine}`);
  console.log(`Debug mode: ${config.debug ? "ON" : "OFF"}`);
  
  return {
    app,
    stop: async () => {
      server.stop();
      console.log("Server stopped");
    },
  };
}
