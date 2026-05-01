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
import * as api from "./lib/api-client.js";

const server = new McpServer({
  name: "myaiforone-lite",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════════════════════════════

server.tool("health_check", "Check if the MyAIforOne gateway is running", {}, async () => {
  const r = await api.health();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_agents", "List all installed agents", {
  org: z.string().optional().describe("Filter by organization name"),
}, async ({ org }) => {
  const r = await api.listAgents(org);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_agent", "Get detailed info about a specific agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgent(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_agent_instructions", "Get an agent's CLAUDE.md system prompt", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgentInstructions(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("uninstall_agent", "Remove an installed agent", {
  agentId: z.string().describe("Agent ID to remove"),
  confirmAlias: z.string().describe("Agent alias to confirm deletion (e.g. @finance)"),
}, async ({ agentId, confirmAlias }) => {
  const r = await api.deleteAgent(agentId, confirmAlias);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════════

server.tool("send_message", "Send a message to an agent and get a response", {
  agentId: z.string().describe("Agent ID to message"),
  text: z.string().describe("Message text"),
}, async ({ agentId, text }) => {
  const r = await api.sendMessage(agentId, text);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("start_stream", "Start a streaming chat with an agent", {
  agentId: z.string().describe("Agent ID to message"),
  text: z.string().describe("Message text"),
}, async ({ agentId, text }) => {
  const r = await api.startStream(agentId, text);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_chat_job_raw", "Poll a streaming chat job for new output", {
  jobId: z.string().describe("Job ID from start_stream"),
  after: z.number().optional().describe("Byte offset to resume from"),
}, async ({ jobId, after }) => {
  const r = await api.getChatJobRaw(jobId, after);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("stop_chat_job", "Stop a running chat job", {
  jobId: z.string().describe("Job ID to stop"),
}, async ({ jobId }) => {
  const r = await api.stopJob(jobId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("reset_session", "Reset an agent's conversation session", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.resetSession(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AGENT REGISTRY (remote — myaiforone.com)
// ═══════════════════════════════════════════════════════════════════

server.tool("browse_agent_registry", "Browse or search the Agent Registry for available agents to install", {
  query: z.string().optional().describe("Search query (e.g. 'finance', 'project management')"),
  category: z.string().optional().describe("Filter by category"),
}, async ({ query, category }) => {
  const r = await api.browseAgentRegistry(query, category);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_agent_detail", "Get full details of a specific agent in the Registry by id or slug", {
  id: z.string().describe("Registry agent ID or slug"),
}, async ({ id }) => {
  const r = await api.getRegistryAgent(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("install_agent", "Install an agent from the Agent Registry", {
  registryId: z.string().describe("Registry agent ID to install"),
}, async ({ registryId }) => {
  // 1. Fetch the full agent package from the registry
  const pkg = await api.getRegistryAgentPackage(registryId);
  if (pkg.error) {
    return { content: [{ type: "text", text: `Error fetching agent package: ${pkg.error}` }] };
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
  const result: any = {
    ...createResult,
    requiredMcpKeys: pkg.requiredMcpKeys || [],
  };

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MCP KEYS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_mcps", "List configured MCP servers", {}, async () => {
  const r = await api.listMcps();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("save_mcp_key", "Save an API key for an agent's MCP connection", {
  agentId: z.string().describe("Agent ID"),
  mcpName: z.string().describe("MCP server name"),
  envVar: z.string().describe("Environment variable name"),
  value: z.string().describe("API key value"),
}, async ({ agentId, mcpName, envVar, value }) => {
  const r = await api.saveMcpKey(agentId, mcpName, envVar, value);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  UPGRADE
// ═══════════════════════════════════════════════════════════════════

server.tool("upgrade_to_pro", "Upgrade this MyAIforOne installation from Lite to Pro edition — unlocks all agents, tools, boards, projects, and automations", {
  licenseKey: z.string().optional().describe("Optional license key for Pro activation"),
}, async ({ licenseKey }) => {
  const r = await api.upgradeToPro(licenseKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════

server.tool("get_service_config", "Get gateway service configuration", {}, async () => {
  const r = await api.getServiceConfig();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATES (local — for upgrade-path compatibility)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_templates", "List available agent templates", {
  category: z.string().optional().describe("Filter by category"),
}, async ({ category }) => {
  const r = await api.listTemplates(category);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("deploy_template", "Deploy a local agent template", {
  templateId: z.string().describe("Template ID to deploy"),
  agentId: z.string().optional().describe("Custom agent ID (default: auto-generated)"),
  name: z.string().optional().describe("Custom display name"),
  alias: z.string().optional().describe("Custom alias"),
}, async ({ templateId, agentId, name, alias }) => {
  const r = await api.deployTemplate(templateId, { agentId, name, alias });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MyAIforOne Lite MCP server failed to start:", err);
  process.exit(1);
});
