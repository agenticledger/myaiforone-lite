/**
 * Streamable HTTP MCP endpoint — exposes the same tool set as the stdio MCP
 * server at server/mcp-server/ over an HTTP transport so remote clients
 * (another MyAIforOne install, Claude.ai, etc.) can call the gateway's
 * tools via plain Bearer auth.
 *
 * Design: rather than duplicate the ~1600-line tool registry, we spawn the
 * existing stdio MCP server as a long-lived child process and proxy
 * tools/list + tools/call through it. That way the two entry points can
 * never drift apart.
 *
 * Auth: same model as /api/* (see src/web-ui.ts):
 *   - When service.auth.enabled is false → open (personal gateway default).
 *   - When true → require a matching Bearer token from service.apiKeys[] or
 *     legacy service.auth.tokens[].
 */
import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import { extractBearer, isAuthEnabled, matchToken } from "./auth-helper.js";
import { log } from "./logger.js";

export interface AttachMcpHttpOptions {
  config: AppConfig;
  /** Package root — used to locate server/mcp-server/dist/index.js. */
  baseDir: string;
  /** The web UI port; used by the stdio child to call back into /api/*. */
  port: number;
}

/**
 * Lazy-initialized proxy to the stdio MCP child. The first /mcp request
 * pays the spawn cost; subsequent requests share the same child. On child
 * exit we reset and lazily respawn on the next request.
 */
class StdioProxy {
  private opts: AttachMcpHttpOptions;
  private client: Client | null = null;
  private tools: Tool[] = [];
  private initPromise: Promise<void> | null = null;

  constructor(opts: AttachMcpHttpOptions) {
    this.opts = opts;
  }

  async ensureReady(): Promise<void> {
    if (this.client) return;
    if (!this.initPromise) {
      this.initPromise = this.init().catch((err) => {
        // Reset so the next request retries from scratch
        this.initPromise = null;
        this.client = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  private async init(): Promise<void> {
    const scriptPath = join(this.opts.baseDir, "server", "mcp-server", "dist", "index.js");

    // Pick an apiKey the stdio child can use to call back into /api/* when
    // auth.enabled is true. When auth is disabled the child just omits the
    // Authorization header. We prefer real apiKeys[] then fall back to legacy
    // auth.tokens[0]; if none exist and auth is on, API calls will 401 —
    // which is the correct behavior for a misconfigured install.
    const authCfg = (this.opts.config.service as any).auth as { enabled?: boolean; tokens?: string[] } | undefined;
    const apiKeys = ((this.opts.config.service as any).apiKeys as Array<{ key: string }>) || [];
    const callbackToken = apiKeys[0]?.key || authCfg?.tokens?.[0] || "";

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      MYAGENT_API_URL: `http://localhost:${this.opts.port}`,
    };
    if (authCfg?.enabled && callbackToken) {
      env.MYAGENT_API_TOKEN = callbackToken;
    }

    const transport = new StdioClientTransport({
      command: process.execPath, // current node binary
      args: [scriptPath],
      env,
      stderr: "inherit",
    });

    const client = new Client(
      { name: "myaiforone-http-proxy", version: "1.0.0" },
      { capabilities: {} }
    );

    transport.onclose = () => {
      log.warn("[mcp-http] stdio MCP child closed — will respawn on next request");
      this.client = null;
      this.initPromise = null;
      this.tools = [];
    };

    await client.connect(transport);
    const listed = await client.listTools();
    this.tools = listed.tools as Tool[];
    this.client = client;
    log.info(`[mcp-http] stdio MCP proxy ready — ${this.tools.length} tools available`);
  }

  getTools(): Tool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    if (!this.client) throw new Error("MCP proxy not initialized");
    return await this.client.callTool({ name, arguments: args || {} });
  }
}

/**
 * Build a per-session MCP Server that forwards tools/list and tools/call to
 * the shared stdio proxy. Per-session is required by StreamableHTTPServerTransport
 * because each session holds its own request/response state.
 */
function createSessionServer(proxy: StdioProxy): Server {
  const server = new Server(
    { name: "myaiforone-http", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await proxy.ensureReady();
    return { tools: proxy.getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await proxy.ensureReady();
    const { name, arguments: args } = request.params;
    try {
      const result = await proxy.callTool(name, args as Record<string, unknown> | undefined);
      // Pass the child's result through verbatim — it's already in MCP tool
      // result shape ({ content: [...] }).
      return result as any;
    } catch (err: any) {
      const message = err?.message || String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Attach POST/GET/DELETE /mcp to the given Express app.
 *
 * Auth:
 *   - service.auth.enabled === false → open (matches /api/*).
 *   - otherwise → require a Bearer token matching apiKeys[] or auth.tokens[].
 */
export function attachMcpHttp(app: Express, opts: AttachMcpHttpOptions): void {
  const proxy = new StdioProxy(opts);

  // Per-session transport + server pairs, keyed by the Mcp-Session-Id header.
  interface Session {
    server: Server;
    transport: StreamableHTTPServerTransport;
  }
  const sessions = new Map<string, Session>();

  function checkAuth(req: ExpressRequest, res: ExpressResponse): boolean {
    if (!isAuthEnabled(opts.config)) return true;
    const token = extractBearer(req.headers.authorization as string | undefined);
    const matched = matchToken(opts.config, token);
    if (matched) {
      (req as any).apiKey = matched;
      return true;
    }
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized — provide a valid Bearer API key" },
      id: null,
    });
    return false;
  }

  app.post("/mcp", async (req, res) => {
    if (!checkAuth(req, res)) return;

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    // Existing session — reuse its transport
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — initialize a fresh Server + transport pair
    try {
      await proxy.ensureReady();
    } catch (err: any) {
      log.warn(`[mcp-http] proxy init failed: ${err?.message || err}`);
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: `MCP proxy init failed: ${err?.message || err}` },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const server = createSessionServer(proxy);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    const newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { server, transport });
    }
  });

  app.get("/mcp", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing Mcp-Session-Id — send an initialize POST first" });
      return;
    }
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const { transport, server } = sessions.get(sessionId)!;
    await transport.close();
    await server.close();
    sessions.delete(sessionId);
    res.status(200).json({ status: "session closed" });
  });

  log.info("[mcp-http] /mcp endpoint attached (Streamable HTTP, proxies stdio MCP)");
}
