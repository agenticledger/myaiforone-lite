#!/usr/bin/env node
/**
 * MyAIforOne Lite MCP Server
 *
 * Exposes a slim tool set for the Lite edition — chat, agent management,
 * and the remote Agent Registry. ~18 tools vs the full server's 100+.
 *
 * Usage (stdio): node server/mcp-server-lite/dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as api from "./lib/api-client.js";

const MCP_VERSION = "1.1.0";
const startedAt = Date.now();
const DEBUG = process.env.DEBUG === "1" || process.env.MYAIFORONE_MCP_DEBUG === "1";

// ═══════════════════════════════════════════════════════════════════
//  LOGGING — writes to ~/.myaiforone/logs/mcp-lite.log
// ═══════════════════════════════════════════════════════════════════

const logDir = join(homedir(), ".myaiforone", "logs");
const logPath = join(logDir, "mcp-lite.log");

function mlog(level: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  // stderr is visible to MCP harness in some setups
  if (DEBUG || level === "ERROR") process.stderr.write(line);
  try {
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    appendFileSync(logPath, line);
  } catch { /* ignore log write failures */ }
}

function dlog(msg: string): void {
  if (DEBUG) mlog("DEBUG", msg);
}

// ═══════════════════════════════════════════════════════════════════
//  SELF-TEST ON BOOT — ping gateway + registry, log one summary line
// ═══════════════════════════════════════════════════════════════════

interface BootStatus {
  gateway: "ok" | "unreachable";
  gatewayUrl: string;
  gatewayError?: string;
  registry: "ok" | "unreachable";
  registryUrl: string;
  registryError?: string;
  agentCount?: number;
}

let _bootStatus: BootStatus | null = null;
let _lastError: string | null = null;

async function selfTest(): Promise<BootStatus> {
  const gatewayUrl = process.env.MYAGENT_API_URL || "http://localhost:4889";
  const registryUrl = process.env.MYAGENT_REGISTRY_URL || "https://myaiforone.com";

  const status: BootStatus = {
    gateway: "unreachable",
    gatewayUrl,
    registry: "unreachable",
    registryUrl,
  };

  // Check gateway
  try {
    const t0 = Date.now();
    const r = await api.health();
    const ms = Date.now() - t0;
    if (r && !r.error) {
      status.gateway = "ok";
      mlog("INFO", `Gateway OK at ${gatewayUrl} (${ms}ms)`);
    } else {
      status.gatewayError = r?.error || "unknown error";
      mlog("WARN", `Gateway responded with error: ${status.gatewayError}`);
    }
  } catch (e: any) {
    status.gatewayError = e.code === "ECONNREFUSED"
      ? `gateway at ${gatewayUrl} unreachable — is the server running?`
      : e.message;
    mlog("ERROR", `Gateway check failed: ${status.gatewayError}`);
  }

  // Check registry
  try {
    const t0 = Date.now();
    const r = await api.browseAgentRegistry();
    const ms = Date.now() - t0;
    if (Array.isArray(r)) {
      status.registry = "ok";
      status.agentCount = r.length;
      mlog("INFO", `Registry OK at ${registryUrl} (${ms}ms, ${r.length} agents available)`);
    } else if (r && !r.error) {
      status.registry = "ok";
      mlog("INFO", `Registry OK at ${registryUrl} (${ms}ms)`);
    } else {
      status.registryError = r?.error || "unexpected response";
      mlog("WARN", `Registry responded with error: ${status.registryError}`);
    }
  } catch (e: any) {
    status.registryError = e.code === "ECONNREFUSED"
      ? `registry at ${registryUrl} unreachable`
      : `registry ${registryUrl} returned: ${e.message}`;
    mlog("WARN", `Registry check failed: ${status.registryError}`);
  }

  // Summary line
  const gwLabel = status.gateway === "ok" ? "gateway OK" : `gateway FAIL: ${status.gatewayError}`;
  const regLabel = status.registry === "ok"
    ? `registry OK${status.agentCount ? ` (${status.agentCount} agents)` : ""}`
    : `registry FAIL: ${status.registryError}`;
  const overall = status.gateway === "ok" && status.registry === "ok" ? "ready" : "degraded";
  mlog("INFO", `Boot self-test: ${overall} — ${gwLabel}, ${regLabel}`);

  return status;
}

// ═══════════════════════════════════════════════════════════════════
//  SAFE API WRAPPER — catches errors, logs them, returns structured failures
// ═══════════════════════════════════════════════════════════════════

type ToolResult = { content: Array<{ type: "text"; text: string }> };

async function safeCall(
  toolName: string,
  fn: () => Promise<any>,
  offlineHint?: string,
): Promise<ToolResult> {
  const t0 = Date.now();
  try {
    dlog(`→ ${toolName} called`);
    const r = await fn();
    const ms = Date.now() - t0;
    dlog(`← ${toolName} OK (${ms}ms)`);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  } catch (e: any) {
    const ms = Date.now() - t0;
    let errorMsg: string;

    if (e.code === "ECONNREFUSED") {
      const isRegistry = offlineHint === "registry";
      errorMsg = isRegistry
        ? `Registry unreachable (${e.message}). The remote Agent Registry at myaiforone.com is down or your network is offline. Local tools (list_agents, health_check) still work.`
        : `Gateway unreachable at ${process.env.MYAGENT_API_URL || "localhost:4889"} (ECONNREFUSED). Is the MyAIforOne server running?`;
    } else if (e.code === "ETIMEDOUT" || e.code === "FETCH_ERROR") {
      errorMsg = `Network timeout calling ${toolName}: ${e.message}`;
    } else {
      errorMsg = `${toolName} failed: ${e.message}`;
    }

    _lastError = `[${new Date().toISOString()}] ${errorMsg}`;
    mlog("ERROR", `${toolName}: ${errorMsg} (${ms}ms)`);
    return { content: [{ type: "text", text: JSON.stringify({ error: errorMsg }, null, 2) }] };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "myaiforone-lite",
  version: MCP_VERSION,
});

// ═══════════════════════════════════════════════════════════════════
//  #1 — STATUS / HEALTH (always works, never depends on registry)
// ═══════════════════════════════════════════════════════════════════

server.tool("myaiforone_status", "Full diagnostic status — gateway reachable? registry reachable? MCP uptime, version, last error. Call this FIRST when tools seem broken.", {}, async () => {
  const gatewayUrl = process.env.MYAGENT_API_URL || "http://localhost:4889";
  const registryUrl = process.env.MYAGENT_REGISTRY_URL || "https://myaiforone.com";
  const uptimeMs = Date.now() - startedAt;
  const uptimeMin = Math.round(uptimeMs / 60000);

  // Live checks
  let gateway: "ok" | "unreachable" = "unreachable";
  let gatewayDetail = "";
  try {
    const t0 = Date.now();
    const r = await api.health();
    gateway = (r && !r.error) ? "ok" : "unreachable";
    gatewayDetail = `responded in ${Date.now() - t0}ms`;
  } catch (e: any) {
    gatewayDetail = e.code === "ECONNREFUSED"
      ? `ECONNREFUSED — server not running at ${gatewayUrl}`
      : e.message;
  }

  let registry: "ok" | "unreachable" = "unreachable";
  let registryDetail = "";
  try {
    const t0 = Date.now();
    const res = await fetch(`${registryUrl}/api/registry/agents?limit=1`);
    registry = res.ok ? "ok" : "unreachable";
    registryDetail = res.ok ? `responded in ${Date.now() - t0}ms` : `HTTP ${res.status}`;
  } catch (e: any) {
    registryDetail = e.message;
  }

  const result = {
    mcpServer: "myaiforone-lite",
    version: MCP_VERSION,
    uptime: `${uptimeMin}m`,
    uptimeMs,
    gateway: { status: gateway, url: gatewayUrl, detail: gatewayDetail },
    registry: { status: registry, url: registryUrl, detail: registryDetail },
    lastError: _lastError,
    logFile: logPath,
    bootStatus: _bootStatus,
  };

  mlog("INFO", `Status check: gateway=${gateway}, registry=${registry}`);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool("health_check", "Quick check if the MyAIforOne gateway is running", {}, async () => {
  return safeCall("health_check", () => api.health());
});

// ═══════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_agents", "List all installed agents (works offline — only talks to local gateway)", {
  org: z.string().optional().describe("Filter by organization name"),
}, async ({ org }) => {
  return safeCall("list_agents", () => api.listAgents(org));
});

server.tool("get_agent", "Get detailed info about a specific agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  return safeCall("get_agent", () => api.getAgent(agentId));
});

server.tool("get_agent_instructions", "Get an agent's CLAUDE.md system prompt", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  return safeCall("get_agent_instructions", () => api.getAgentInstructions(agentId));
});

server.tool("uninstall_agent", "Remove an installed agent", {
  agentId: z.string().describe("Agent ID to remove"),
  confirmAlias: z.string().describe("Agent alias to confirm deletion (e.g. @finance)"),
}, async ({ agentId, confirmAlias }) => {
  return safeCall("uninstall_agent", () => api.deleteAgent(agentId, confirmAlias));
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════════

server.tool("send_message", "Send a message to an agent and get a response", {
  agentId: z.string().describe("Agent ID to message"),
  text: z.string().describe("Message text"),
}, async ({ agentId, text }) => {
  return safeCall("send_message", () => api.sendMessage(agentId, text));
});

server.tool("start_stream", "Start a streaming chat with an agent", {
  agentId: z.string().describe("Agent ID to message"),
  text: z.string().describe("Message text"),
}, async ({ agentId, text }) => {
  return safeCall("start_stream", () => api.startStream(agentId, text));
});

server.tool("get_chat_job_raw", "Poll a streaming chat job for new output", {
  jobId: z.string().describe("Job ID from start_stream"),
  after: z.number().optional().describe("Byte offset to resume from"),
}, async ({ jobId, after }) => {
  return safeCall("get_chat_job_raw", () => api.getChatJobRaw(jobId, after));
});

server.tool("stop_chat_job", "Stop a running chat job", {
  jobId: z.string().describe("Job ID to stop"),
}, async ({ jobId }) => {
  return safeCall("stop_chat_job", () => api.stopJob(jobId));
});

server.tool("reset_session", "Reset an agent's conversation session", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  return safeCall("reset_session", () => api.resetSession(agentId));
});

// ═══════════════════════════════════════════════════════════════════
//  AGENT REGISTRY (remote — myaiforone.com)
// ═══════════════════════════════════════════════════════════════════

server.tool("browse_agent_registry", "Browse or search the Agent Registry for available agents to install", {
  query: z.string().optional().describe("Search query (e.g. 'finance', 'project management')"),
  category: z.string().optional().describe("Filter by category"),
}, async ({ query, category }) => {
  return safeCall("browse_agent_registry", () => api.browseAgentRegistry(query, category), "registry");
});

server.tool("get_agent_detail", "Get full details of a specific agent in the Registry by id or slug", {
  id: z.string().describe("Registry agent ID or slug"),
}, async ({ id }) => {
  return safeCall("get_agent_detail", () => api.getRegistryAgent(id), "registry");
});

server.tool("install_agent", "Install an agent from the Agent Registry", {
  registryId: z.string().describe("Registry agent ID to install"),
}, async ({ registryId }) => {
  return safeCall("install_agent", async () => {
    // 1. Fetch the full agent package from the registry
    const pkg = await api.getRegistryAgentPackage(registryId);
    if (pkg.error) {
      throw new Error(`Registry returned error: ${pkg.error}`);
    }

    // 2. Create the agent locally using the package data
    const createBody: any = {
      agentId: pkg.agentId,
      name: pkg.name,
      alias: pkg.alias,
      description: pkg.description,
      persistent: pkg.persistent ?? true,
      streaming: pkg.streaming ?? true,
      tools: pkg.tools,
      skills: pkg.skills,
      mcps: pkg.mcps,
      instructions: pkg.claudeMd,
    };
    if (pkg.workspace) createBody.workspace = pkg.workspace;
    if (pkg.organization) {
      createBody.org = [{ organization: pkg.organization, function: pkg.function || "", title: pkg.title || "", reportsTo: pkg.reportsTo || "" }];
    }

    const createResult = await api.createAgent(createBody);

    // 3. Return result with any required MCP keys the user needs to provide
    return {
      ...createResult,
      requiredMcpKeys: pkg.requiredMcpKeys || [],
    };
  }, "registry");
});

// ═══════════════════════════════════════════════════════════════════
//  MCP KEYS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_mcps", "List configured MCP servers", {}, async () => {
  return safeCall("list_mcps", () => api.listMcps());
});

server.tool("save_mcp_key", "Save an API key for an agent's MCP connection", {
  agentId: z.string().describe("Agent ID"),
  mcpName: z.string().describe("MCP server name"),
  envVar: z.string().describe("Environment variable name"),
  value: z.string().describe("API key value"),
}, async ({ agentId, mcpName, envVar, value }) => {
  return safeCall("save_mcp_key", () => api.saveMcpKey(agentId, mcpName, envVar, value));
});

// ═══════════════════════════════════════════════════════════════════
//  UPGRADE
// ═══════════════════════════════════════════════════════════════════

server.tool("upgrade_to_pro", "Upgrade this MyAIforOne installation from Lite to Pro edition — unlocks all agents, tools, boards, projects, and automations", {
  licenseKey: z.string().optional().describe("Optional license key for Pro activation"),
}, async ({ licenseKey }) => {
  return safeCall("upgrade_to_pro", () => api.upgradeToPro(licenseKey));
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════

server.tool("get_service_config", "Get gateway service configuration", {}, async () => {
  return safeCall("get_service_config", () => api.getServiceConfig());
});

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATES (local — for upgrade-path compatibility)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_templates", "List available agent templates", {
  category: z.string().optional().describe("Filter by category"),
}, async ({ category }) => {
  return safeCall("list_templates", () => api.listTemplates(category));
});

server.tool("deploy_template", "Deploy a local agent template", {
  templateId: z.string().describe("Template ID to deploy"),
  agentId: z.string().optional().describe("Custom agent ID (default: auto-generated)"),
  name: z.string().optional().describe("Custom display name"),
  alias: z.string().optional().describe("Custom alias"),
}, async ({ templateId, agentId, name, alias }) => {
  return safeCall("deploy_template", () => api.deployTemplate(templateId, { agentId, name, alias }));
});

// ═══════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════

async function main() {
  mlog("INFO", `MyAIforOne Lite MCP server v${MCP_VERSION} starting (pid=${process.pid})`);
  mlog("INFO", `Gateway URL: ${process.env.MYAGENT_API_URL || "http://localhost:4889"}`);
  mlog("INFO", `Log file: ${logPath}`);
  if (DEBUG) mlog("DEBUG", "Debug mode enabled — logging all JSON-RPC frames");

  // Self-test: ping gateway + registry, log summary
  _bootStatus = await selfTest();

  const transport = new StdioServerTransport();

  // Log JSON-RPC frames in debug mode
  if (DEBUG) {
    const origSend = transport.send?.bind(transport);
    if (origSend) {
      (transport as any).send = (msg: any) => {
        dlog(`JSON-RPC OUT: ${JSON.stringify(msg).slice(0, 500)}`);
        return origSend(msg);
      };
    }
  }

  await server.connect(transport);
  mlog("INFO", "MCP server connected via stdio — tools registered, ready");
}

main().catch((err) => {
  const msg = `MyAIforOne Lite MCP server failed to start: ${err.message || err}`;
  mlog("ERROR", msg);
  process.stderr.write(msg + "\n");
  process.exit(1);
});
