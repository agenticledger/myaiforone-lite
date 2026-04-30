#!/usr/bin/env node
/**
 * MyAIforOne MCP Server
 *
 * Exposes the MyAgent gateway's API as MCP tools for Claude Code,
 * Claude Desktop, and other MCP-compatible clients.
 *
 * Usage (stdio): node server/mcp-server/index.js
 * Usage (HTTP):  MYAGENT_MCP_PORT=3100 node server/mcp-server/index.js --http
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as api from "./lib/api-client.js";

const server = new McpServer({
  name: "myaiforone",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD & HEALTH
// ═══════════════════════════════════════════════════════════════════

server.tool("health_check", "Check if the MyAgent gateway is running", {}, async () => {
  const r = await api.health();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_dashboard", "Get full dashboard: all agents, channels, accounts, uptime", {}, async () => {
  const r = await api.dashboard();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_agents", "List all agents, optionally filtered by organization", {
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

server.tool("create_agent", "Create a new agent with full configuration", {
  agentId: z.string().describe("Unique agent ID (lowercase, hyphens)"),
  name: z.string().describe("Display name"),
  alias: z.string().describe("Mention alias (e.g. @myagent)"),
  description: z.string().optional().describe("Agent description"),
  workspace: z.string().optional().describe("Working directory path"),
  organization: z.string().optional().describe("Organization name"),
  function: z.string().optional().describe("Org function/department"),
  title: z.string().optional().describe("Org title/role"),
  reportsTo: z.string().optional().describe("Alias of the agent this one reports to (e.g. @pricingstrat)"),
  persistent: z.boolean().optional().describe("Keep conversation history"),
  streaming: z.boolean().optional().describe("Enable streaming responses"),
  advancedMemory: z.boolean().optional().describe("Enable semantic memory"),
  autonomousCapable: z.boolean().optional().describe("Can run autonomous goals"),
  tools: z.array(z.string()).optional().describe("Allowed tools list"),
  skills: z.array(z.string()).optional().describe("Shared skill names"),
  mcps: z.array(z.string()).optional().describe("MCP server names"),
  prompts: z.array(z.string()).optional().describe("Prompt template names"),
  subAgents: z.union([z.array(z.string()), z.literal("*")]).optional().describe("Sub-agents for group agent"),
  claudeAccount: z.string().optional().describe("Claude account name"),
  timeout: z.number().optional().describe("Timeout in ms"),
  heartbeatInstructions: z.string().optional().describe("Custom heartbeat instructions — saved to heartbeat.md. Defines what the agent does during a heartbeat check."),
  agentClass: z.enum(["standard", "platform", "builder", "board"]).optional().describe("Agent class: standard (default), platform (Lab creators), builder (app developer agents), board (board-only widget agents)"),
  executor: z.string().optional().describe("Executor override: 'claude' (default) or 'ollama:<model>' (e.g. 'ollama:gemma2'). Requires multiModelEnabled in service config."),
  voice: z.string().optional().describe("Voice override: provider id (e.g. 'browser', 'grok') or 'provider:voiceId' (e.g. 'grok:Eve'). Requires voiceModeEnabled in service config."),
  wiki: z.boolean().optional().describe("Enable wiki knowledge base for this agent"),
  wikiSync: z.object({ enabled: z.boolean().optional(), schedule: z.string().optional() }).optional().describe("Wiki sync config: { enabled, schedule (cron expression, default '0 0 * * *') }"),
  shared: z.boolean().optional().describe("Create as a shared agent (multi-user). Agent home is created under SharedAgents/ instead of PersonalAgents/."),
  conversationLogMode: z.enum(["shared", "per-user"]).optional().describe("Conversation log mode: 'shared' (default, all users share one log) or 'per-user' (separate log per sender)."),
  avatar: z.string().optional().describe("Avatar identifier (e.g. 'avatar-01' through 'avatar-80'). If omitted, a random unused avatar is auto-assigned."),
  boardEnabled: z.boolean().optional().describe("Enable this agent's output to appear on boards"),
  boardLayout: z.enum(["small", "medium", "large"]).optional().describe("Default widget size when added to a board"),
}, async (args) => {
  const body: any = { ...args };
  if (args.organization) {
    body.org = [{ organization: args.organization, function: args.function || "", title: args.title || "", reportsTo: args.reportsTo || "" }];
    delete body.organization; delete body.function; delete body.title; delete body.reportsTo;
  }
  const r = await api.createAgent(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_agent", "Update an existing agent's configuration", {
  agentId: z.string().describe("Agent ID to update"),
  name: z.string().optional(),
  alias: z.string().optional(),
  description: z.string().optional(),
  workspace: z.string().optional(),
  organization: z.string().optional().describe("Organization name"),
  function: z.string().optional().describe("Org function/department"),
  title: z.string().optional().describe("Org title/role"),
  reportsTo: z.string().optional().describe("Alias of the agent this one reports to (e.g. @pricingstrat)"),
  persistent: z.boolean().optional(),
  streaming: z.boolean().optional(),
  advancedMemory: z.boolean().optional(),
  autonomousCapable: z.boolean().optional().describe("Can run autonomous goals"),
  timeout: z.number().optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  mcps: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  subAgents: z.union([z.array(z.string()), z.literal("*")]).optional().describe("Sub-agents for group agent"),
  claudeAccount: z.string().optional(),
  instructions: z.string().optional().describe("Update CLAUDE.md content"),
  heartbeatInstructions: z.string().optional().describe("Custom heartbeat instructions — saved to heartbeat.md. Defines what the agent does during a heartbeat check."),
  agentClass: z.enum(["standard", "platform", "builder", "board"]).optional().describe("Agent class: standard (default), platform (Lab creators), builder (app developer agents), board (board-only widget agents)"),
  executor: z.string().optional().describe("Executor override: 'claude' (default) or 'ollama:<model>' (e.g. 'ollama:gemma2'). Requires multiModelEnabled in service config."),
  voice: z.string().optional().describe("Voice override: provider id (e.g. 'browser', 'grok') or 'provider:voiceId' (e.g. 'grok:Eve'). Requires voiceModeEnabled in service config."),
  wiki: z.boolean().optional().describe("Enable wiki knowledge base for this agent"),
  wikiSync: z.object({ enabled: z.boolean().optional(), schedule: z.string().optional() }).optional().describe("Wiki sync config: { enabled, schedule (cron expression, default '0 0 * * *') }"),
  conversationLogMode: z.enum(["shared", "per-user"]).optional().describe("Update conversation log mode: 'shared' (one log for all users) or 'per-user' (separate log per sender)."),
  avatar: z.string().optional().describe("Avatar identifier (e.g. 'avatar-01' through 'avatar-80'). Set to empty string to remove."),
  boardEnabled: z.boolean().optional().describe("Enable this agent's output to appear on boards"),
  boardLayout: z.enum(["small", "medium", "large"]).optional().describe("Default widget size when added to a board"),
}, async ({ agentId, ...body }) => {
  const payload: any = { ...body };
  if (body.organization !== undefined) {
    payload.org = [{ organization: body.organization, function: body.function || "", title: body.title || "", reportsTo: body.reportsTo || "" }];
    delete payload.organization; delete payload.function; delete payload.title; delete payload.reportsTo;
  }
  const r = await api.updateAgent(agentId, payload);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_agent", "Delete an agent (auto-resolves confirmation alias)", {
  agentId: z.string().describe("Agent ID to delete"),
}, async ({ agentId }) => {
  // Server requires confirmAlias — fetch it from the agent's config first
  const agent = await api.getAgent(agentId);
  const alias = agent?.config?.aliases?.[0] || agent?.config?.mentionAliases?.[0] || agentId;
  const r = await api.deleteAgent(agentId, alias);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════════

server.tool("send_message", "Send a message to an agent and get the response", {
  agentId: z.string().describe("Agent ID"),
  text: z.string().describe("Message text"),
  accountOverride: z.string().optional().describe("Use a different Claude account"),
}, async ({ agentId, text, accountOverride }) => {
  const r = await api.sendMessage(agentId, text, accountOverride);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delegate_message", "Send a message between agents (inter-agent delegation)", {
  agentId: z.string().describe("Target agent ID"),
  text: z.string().describe("Message text"),
}, async ({ agentId, text }) => {
  const r = await api.delegate(agentId, text);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  SESSIONS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_sessions", "List active conversation sessions for an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listSessions(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("reset_session", "Reset an agent's conversation session", {
  agentId: z.string().describe("Agent ID"),
  senderId: z.string().optional().describe("Specific sender to reset"),
}, async ({ agentId, senderId }) => {
  const r = await api.resetSession(agentId, senderId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MODEL OVERRIDES
// ═══════════════════════════════════════════════════════════════════

server.tool("get_model", "Get the current model override for an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getModel(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("set_model", "Set a model override for an agent (opus, sonnet, haiku, or full model ID)", {
  agentId: z.string().describe("Agent ID"),
  model: z.string().describe("Model: opus, sonnet, haiku, or full ID"),
}, async ({ agentId, model }) => {
  const r = await api.setModel(agentId, model);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("clear_model", "Clear model override, use agent default", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.clearModel(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  COST
// ═══════════════════════════════════════════════════════════════════

server.tool("get_agent_cost", "Get cost breakdown for an agent (today, week, all-time, by day)", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgentCost(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_all_costs", "Get cost summary across ALL agents", {}, async () => {
  const r = await api.getAllCosts();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  SKILLS
// ═══════════════════════════════════════════════════════════════════

server.tool("get_agent_skills", "List all skills available to an agent (shared + org + agent-specific)", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgentSkills(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_org_skills", "List all skills in an organization", {
  orgName: z.string().describe("Organization name"),
}, async ({ orgName }) => {
  const r = await api.getOrgSkills(orgName);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_tasks", "List tasks assigned to an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listTasks(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_task", "Create a task for an agent", {
  agentId: z.string().describe("Agent ID"),
  title: z.string().describe("Task title"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  project: z.string().optional(),
}, async ({ agentId, ...body }) => {
  const r = await api.createTask(agentId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_task", "Update a task status or details", {
  agentId: z.string().describe("Agent ID"),
  taskId: z.string().describe("Task ID"),
  status: z.string().optional(),
  title: z.string().optional(),
}, async ({ agentId, taskId, ...body }) => {
  const r = await api.updateTask(agentId, taskId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_task", "Delete a task", {
  agentId: z.string().describe("Agent ID"),
  taskId: z.string().describe("Task ID"),
}, async ({ agentId, taskId }) => {
  const r = await api.deleteTask(agentId, taskId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_all_tasks", "Get all tasks across all agents", {}, async () => {
  const r = await api.allTasks();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_automations", "List all goals and crons across all agents", {}, async () => {
  const r = await api.listAutomations();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_goal", "Create an autonomous goal for an agent", {
  agentId: z.string().describe("Agent ID"),
  id: z.string().describe("Goal ID"),
  description: z.string().describe("What the goal does"),
  heartbeat: z.string().describe("Cron expression for schedule"),
  successCriteria: z.string().optional(),
  instructions: z.string().optional(),
}, async ({ agentId, ...body }) => {
  const r = await api.createGoal(agentId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("toggle_goal", "Enable or disable a goal", {
  agentId: z.string(), goalId: z.string(),
}, async ({ agentId, goalId }) => {
  const r = await api.toggleGoal(agentId, goalId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("trigger_goal", "Manually trigger a goal run", {
  agentId: z.string(), goalId: z.string(),
}, async ({ agentId, goalId }) => {
  const r = await api.triggerGoal(agentId, goalId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_cron", "Create a scheduled cron job for an agent", {
  agentId: z.string().describe("Agent ID"),
  schedule: z.string().describe("Cron expression"),
  message: z.string().describe("Message to send on trigger"),
  channel: z.string().describe("Channel name"),
  chatId: z.string().describe("Chat ID"),
  enabled: z.boolean().optional().describe("Start enabled (default true)"),
}, async ({ agentId, ...body }) => {
  const r = await api.createCron(agentId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MCPs
// ═══════════════════════════════════════════════════════════════════

server.tool("list_mcps", "List registered MCP servers", {}, async () => {
  const r = await api.listMcps();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_mcp_catalog", "Get the pre-hosted MCP catalog", {}, async () => {
  const r = await api.mcpCatalog();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_channels", "List all messaging channels with config and agent routes", {}, async () => {
  const r = await api.listChannels();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_channel", "Update channel settings (sticky routing, enabled)", {
  channelName: z.string().describe("Channel name (slack, telegram, imessage, discord, whatsapp)"),
  enabled: z.boolean().optional(),
  stickyRouting: z.enum(["none", "sticky", "prefix"]).optional(),
  stickyPrefix: z.string().optional(),
  stickyTimeoutMs: z.number().optional(),
}, async ({ channelName, ...body }) => {
  const r = await api.updateChannel(channelName, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("set_channel_credentials", "Set channel authentication credentials (tokens, keys). Auto-enables the channel. After calling, tell the user to go to Admin → Settings and click Restart.", {
  channelName: z.string().describe("Channel name: slack, telegram, whatsapp, discord, or imessage"),
  botToken: z.string().optional().describe("Bot token (Slack xoxb-..., Telegram from BotFather, Discord bot token)"),
  appToken: z.string().optional().describe("Slack app-level token (xapp-...) — required for Slack Socket Mode"),
  mode: z.string().optional().describe("Slack connection mode (default: 'socket')"),
  authDir: z.string().optional().describe("WhatsApp auth directory (default: './data/whatsapp-auth')"),
}, async ({ channelName, ...credentials }) => {
  // Filter out undefined values
  const creds = Object.fromEntries(Object.entries(credentials).filter(([_, v]) => v !== undefined));
  const r = await api.setChannelCredentials(channelName, creds);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("add_agent_route", "Add an agent route to a channel", {
  channelName: z.string().describe("Channel name"),
  agentId: z.string().describe("Agent ID"),
  chatId: z.string().describe("Chat/channel ID"),
  requireMention: z.boolean().optional().describe("Require @mention (default true)"),
  allowFrom: z.array(z.string()).optional().describe("Allowed sender patterns"),
}, async ({ channelName, ...body }) => {
  const r = await api.addAgentRoute(channelName, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ACTIVITY & LOGS
// ═══════════════════════════════════════════════════════════════════

server.tool("get_activity", "Get recent activity feed across all agents", {
  limit: z.number().optional().describe("Max entries (default 100)"),
}, async ({ limit }) => {
  const r = await api.activity(limit);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_agent_logs", "Get paginated conversation logs for an agent", {
  agentId: z.string().describe("Agent ID"),
  limit: z.number().optional().describe("Max entries (default 50)"),
  offset: z.number().optional(),
  search: z.string().optional().describe("Keyword filter"),
}, async ({ agentId, limit, offset, search }) => {
  const r = await api.agentLogs(agentId, limit, offset, search);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MEMORY
// ═══════════════════════════════════════════════════════════════════

server.tool("get_agent_memory", "List memory entries for an agent", {
  agentId: z.string().describe("Agent ID"),
  limit: z.number().optional().describe("Max daily files"),
}, async ({ agentId, limit }) => {
  const r = await api.agentMemory(agentId, limit);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("search_memory", "Search an agent's memory by keyword", {
  agentId: z.string().describe("Agent ID"),
  query: z.string().describe("Search keyword"),
}, async ({ agentId, query }) => {
  const r = await api.searchMemory(agentId, query);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("clear_memory_context", "Clear an agent's context.md file", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.clearMemoryContext(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  PAIRING
// ═══════════════════════════════════════════════════════════════════

server.tool("list_paired_senders", "List paired/authorized senders", {}, async () => {
  const r = await api.listPairing();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("pair_sender", "Manually authorize a sender", {
  senderKey: z.string().describe("Format: channel:senderId"),
}, async ({ senderKey }) => {
  const r = await api.pairSender(senderKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIG / ACCOUNTS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_accounts", "List Claude accounts (name → config directory)", {}, async () => {
  const r = await api.listAccounts();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_service_config", "Get service settings (personalAgentsDir, personalRegistryDir, port, logLevel)", {}, async () => {
  const r = await api.getServiceConfig();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_service_config", "Update service settings (restart required)", {
  personalAgentsDir: z.string().optional(),
  personalRegistryDir: z.string().optional(),
  webUIPort: z.number().optional(),
  logLevel: z.string().optional(),
  logFile: z.string().optional(),
  pairingCode: z.string().optional(),
  webhookSecret: z.string().optional(),
  multiModelEnabled: z.boolean().optional().describe("Enable/disable multi-model support via Ollama"),
  platformDefaultExecutor: z.string().optional().describe("Default executor for all agents (e.g. 'claude' or 'ollama:gemma2')"),
  ollamaBaseUrl: z.string().optional().describe("Ollama API base URL (default: http://localhost:11434)"),
  voiceModeEnabled: z.boolean().optional().describe("Enable/disable Voice Mode (TTS + STT) features in the Web UI"),
  platformDefaultVoice: z.string().optional().describe("Default voice spec — provider id (e.g. 'browser', 'grok') or 'provider:voiceId' (e.g. 'grok:Ara')"),
  voiceAutoPlay: z.boolean().optional().describe("Auto-play agent replies as audio when voice mode is on"),
  voiceMaxChars: z.number().optional().describe("Truncate TTS input to this many characters (default 2000, max 15000)"),
}, async (body) => {
  const r = await api.updateServiceConfig(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("test_provider", "Test an API key for a cloud provider (OpenAI, Grok, Gemini, Groq, Together, Mistral)", {
  provider: z.string().describe("Provider name: openai, grok, gemini, groq, together, or mistral"),
}, async ({ provider }) => {
  const r = await api.testProvider(provider);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  VOICE MODE (TTS + STT)
// ═══════════════════════════════════════════════════════════════════

server.tool(
  "list_voices",
  "List available voice providers and voices. Returns full snapshot when no provider specified, or one provider's voices when specified.",
  {
    provider: z.string().optional().describe("Filter to one provider: 'browser', 'grok', etc."),
    agentId: z.string().optional().describe("Resolve effective voice for a specific agent (uses agent override → platform default → fallback)"),
  },
  async ({ provider, agentId }) => {
    if (provider || agentId) {
      const r = await api.listVoices(provider, agentId);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }
    const r = await api.getVoiceConfig();
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  "set_platform_voice",
  "Set the platform default voice. Pass provider id ('browser', 'grok') or 'provider:voiceId' (e.g. 'grok:Ara'). Optionally enable voice mode in the same call.",
  {
    voice: z.string().describe("Voice spec: 'browser', 'grok', 'grok:Ara', etc."),
    enable: z.boolean().optional().describe("Also set voiceModeEnabled to true"),
    autoPlay: z.boolean().optional().describe("Set voiceAutoPlay flag"),
    maxChars: z.number().optional().describe("Set voiceMaxChars (default 2000)"),
  },
  async ({ voice, enable, autoPlay, maxChars }) => {
    const body: any = { platformDefaultVoice: voice };
    if (enable !== undefined) body.voiceModeEnabled = enable;
    if (autoPlay !== undefined) body.voiceAutoPlay = autoPlay;
    if (maxChars !== undefined) body.voiceMaxChars = maxChars;
    const r = await api.updateServiceConfig(body);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  "set_agent_voice",
  "Set a per-agent voice override. Pass empty string to clear and use the platform default.",
  {
    agentId: z.string().describe("Agent ID"),
    voice: z.string().describe("Voice spec: provider id ('grok'), 'provider:voiceId' ('grok:Eve'), or '' to clear"),
  },
  async ({ agentId, voice }) => {
    const r = await api.updateAgent(agentId, { voice: voice || undefined });
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  "test_voice",
  "Synthesize a sample voice line via the configured TTS provider. Returns audio (base64) on success or { clientSide: true } when the resolved provider is the browser.",
  {
    text: z.string().optional().describe("Text to speak (default: 'Hello, this is a sample of the selected voice.')"),
    provider: z.string().optional().describe("Provider override: 'browser', 'grok'. Defaults to platform/agent resolution."),
    voiceId: z.string().optional().describe("Voice id within the provider (e.g. 'Ara')"),
    agentId: z.string().optional().describe("Resolve voice as if speaking for this agent"),
  },
  async ({ text, provider, voiceId, agentId }) => {
    const r = await api.ttsTest(text || "Hello, this is a sample of the selected voice.", provider, voiceId, agentId);
    // Don't dump the full base64 audio in the textual response — summarize.
    if (r.audioBase64) {
      const summary = {
        ok: true,
        provider: r.provider,
        voiceId: r.voiceId,
        characters: r.characters,
        bytes: r.bytes,
        contentType: r.contentType,
        note: "Audio bytes returned (base64) — playback must happen in the client.",
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════════

server.tool("get_profile", "Get the user's profile (name, role, industry, AI experience, interests)", {}, async () => {
  const r = await api.getProfile();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_profile", "Update the user's profile", {
  name: z.string().optional().describe("User's name"),
  role: z.string().optional().describe("Role / job title"),
  industry: z.string().optional().describe("Industry or domain"),
  aiExperience: z.enum(["beginner", "intermediate", "advanced"]).optional().describe("AI experience level"),
  interests: z.array(z.string()).optional().describe("List of interests or focus areas"),
}, async (body) => {
  const r = await api.updateProfile(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  APPS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_apps", "List all registered apps", {}, async () => {
  const r = await api.listApps();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_app", "Register a new app", {
  name: z.string().describe("App name"),
  url: z.string().optional(),
  provider: z.string().optional(),
  category: z.string().optional(),
  githubRepo: z.string().optional(),
}, async (body) => {
  const r = await api.createApp(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  FILES
// ═══════════════════════════════════════════════════════════════════

server.tool("list_agent_files", "List files in an agent's FileStorage", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listFiles(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  REGISTRY
// ═══════════════════════════════════════════════════════════════════

server.tool("browse_registry", "Browse the marketplace/registry by type", {
  type: z.enum(["skills", "agents", "mcps", "prompts", "apps"]).describe("Registry type"),
}, async ({ type }) => {
  const r = await api.marketplace(type);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL AGENTS
// ═══════════════════════════════════════════════════════════════════

server.tool("recover_agent", "Recover agent from session corruption", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.recoverAgent(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL SESSIONS
// ═══════════════════════════════════════════════════════════════════

server.tool("delete_session", "Delete a specific sender's session", {
  agentId: z.string().describe("Agent ID"),
  senderId: z.string().describe("Sender ID (or 'default')"),
}, async ({ agentId, senderId }) => {
  const r = await api.deleteSession(agentId, senderId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  NAMED SESSION TABS
// ═══════════════════════════════════════════════════════════════════

server.tool("create_session_tab", "Create a named session tab on an agent's chat page, optionally routing messages to a different agent. Use targetAgentId to make this tab talk directly to another agent (e.g. create an 'agentcreator' tab on hub that routes to agentcreator). Returns the tab object including the tabId to use as senderId.", {
  agentId: z.string().describe("Agent ID whose chat page will host the tab (e.g. 'hub')"),
  tabId: z.string().describe("Unique tab ID — use a short slug like 'agentcreator-1' or 'project-alpha'"),
  label: z.string().describe("Human-readable tab label shown in the UI"),
  targetAgentId: z.string().optional().describe("If set, messages sent in this tab route to this agent instead of agentId. Use this to create a dedicated channel to a specialist agent."),
}, async ({ agentId, tabId, label, targetAgentId }) => {
  const r = await api.createSessionTab(agentId, tabId, label, targetAgentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_session_tabs", "List all named session tabs for an agent (includes closed/archived sessions with last message preview)", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listSessionTabs(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_session_tab_history", "Get the full conversation history for a specific named session tab", {
  agentId: z.string().describe("Agent ID"),
  tabId: z.string().describe("Tab ID (from list_session_tabs)"),
}, async ({ agentId, tabId }) => {
  const r = await api.getSessionTabHistory(agentId, tabId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("rename_session_tab", "Rename a named session tab", {
  agentId: z.string().describe("Agent ID"),
  tabId: z.string().describe("Tab ID (from list_session_tabs)"),
  label: z.string().describe("New name for the session"),
}, async ({ agentId, tabId, label }) => {
  const r = await api.renameSessionTab(agentId, tabId, label);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_session_tab", "Permanently delete a named session tab and its Claude session state", {
  agentId: z.string().describe("Agent ID"),
  tabId: z.string().describe("Tab ID (from list_session_tabs)"),
}, async ({ agentId, tabId }) => {
  const r = await api.deleteSessionTab(agentId, tabId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL TASKS
// ═══════════════════════════════════════════════════════════════════

server.tool("get_task_stats", "Get task statistics (counts by status) for an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.taskStats(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_project", "Create a project for organizing tasks", {
  agentId: z.string().describe("Agent ID"),
  name: z.string().describe("Project name"),
}, async ({ agentId, name }) => {
  const r = await api.createProject(agentId, name);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  PROJECTS (cross-agent initiatives)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_projects", "List all projects (cross-agent initiatives)", {}, async () => {
  const r = await api.listProjects();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_project", "Get a project's full details and task rollup", {
  projectId: z.string().describe("Project ID"),
}, async ({ projectId }) => {
  const r = await api.getProject(projectId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_initiative", "Create a new cross-agent project/initiative", {
  name: z.string().describe("Project name"),
  description: z.string().optional().describe("What this project is about"),
  owner: z.string().optional().describe("Agent ID that owns the project (defaults to caller)"),
  teamMembers: z.array(z.string()).optional().describe("Agent IDs participating in the project"),
  plan: z.string().optional().describe("Markdown plan for the project"),
  notes: z.string().optional().describe("Additional notes"),
}, async ({ name, description, owner, teamMembers, plan, notes }) => {
  const r = await api.createInitiative({ name, description, owner, teamMembers, plan, notes });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_project", "Update a project's details, plan, status, or notes", {
  projectId: z.string().describe("Project ID"),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  owner: z.string().optional(),
  teamMembers: z.array(z.string()).optional(),
  plan: z.string().optional(),
  notes: z.string().optional(),
}, async ({ projectId, ...body }) => {
  const r = await api.updateProject(projectId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_project", "Delete a project", {
  projectId: z.string().describe("Project ID"),
}, async ({ projectId }) => {
  const r = await api.deleteProject(projectId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("link_to_project", "Link an entity (task, agent, org, app, artifact) to a project", {
  projectId: z.string().describe("Project ID"),
  type: z.enum(["task", "agent", "org", "app", "artifact"]).describe("Entity type to link"),
  value: z.any().describe("Entity value — for task: {agentId, taskId}; for agent/org/app: string ID; for artifact: {name, path?, url?, type?}"),
}, async ({ projectId, type, value }) => {
  const r = await api.linkToProject(projectId, type, value);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("unlink_from_project", "Remove a linked entity from a project", {
  projectId: z.string().describe("Project ID"),
  type: z.enum(["task", "agent", "org", "app", "artifact"]).describe("Entity type to unlink"),
  value: z.any().describe("Entity value to unlink"),
}, async ({ projectId, type, value }) => {
  const r = await api.unlinkFromProject(projectId, type, value);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_project_status", "Get a formatted status report for a project with progress and task details", {
  projectId: z.string().describe("Project ID"),
}, async ({ projectId }) => {
  const r = await api.getProjectStatus(projectId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("execute_project", "Start autonomous execution of a project — creates a scheduled goal that works through tasks", {
  projectId: z.string().describe("Project ID"),
  schedule: z.string().optional().describe("Cron schedule for execution checks (default: every 15 min)"),
  reportTo: z.string().optional().describe("Channel:chatId for notifications (e.g. slack:C0ALHTDD6JF)"),
}, async ({ projectId, schedule, reportTo }) => {
  const r = await api.executeProject(projectId, { schedule, reportTo });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("pause_project", "Pause autonomous execution of a project", {
  projectId: z.string().describe("Project ID"),
}, async ({ projectId }) => {
  const r = await api.pauseProject(projectId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  BOARDS (glanceable widget surfaces)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_boards", "List all boards", {}, async () => {
  const r = await api.listBoards();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_board", "Get a board with enriched widget data (agent names, last output)", {
  boardId: z.string().describe("Board ID"),
}, async ({ boardId }) => {
  const r = await api.getBoard(boardId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_board", "Create a new board", {
  name: z.string().describe("Board name"),
  description: z.string().optional().describe("Board description"),
  defaultBoard: z.boolean().optional().describe("Set as the default board (shown on page load)"),
  refreshSchedule: z.string().optional().describe("Cron expression for auto-refresh (e.g. '0 */2 * * *' for every 2 hours)"),
}, async ({ name, description, defaultBoard, refreshSchedule }) => {
  const r = await api.createBoard({ name, description, defaultBoard, refreshSchedule });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_board", "Update a board's name, description, status, or refresh schedule", {
  boardId: z.string().describe("Board ID"),
  name: z.string().optional().describe("New board name"),
  description: z.string().optional().describe("New description"),
  status: z.enum(["active", "paused", "archived"]).optional().describe("Board status"),
  defaultBoard: z.boolean().optional().describe("Set as default board"),
  refreshSchedule: z.string().optional().describe("Cron expression for auto-refresh"),
}, async ({ boardId, ...updates }) => {
  const r = await api.updateBoard(boardId, updates);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_board", "Delete a board", {
  boardId: z.string().describe("Board ID"),
}, async ({ boardId }) => {
  const r = await api.deleteBoard(boardId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("add_board_widget", "Add an agent widget to a board. Same agent can appear multiple times with different scopes (all, goal, cron).", {
  boardId: z.string().describe("Board ID"),
  agentId: z.string().describe("Agent ID to add as a widget"),
  w: z.number().optional().describe("Widget width in grid columns (default 18 of 36-column grid)"),
  h: z.number().optional().describe("Widget height in grid rows (default 1)"),
  title: z.string().optional().describe("Override display title"),
  scope: z.enum(["all", "goal", "cron"]).optional().describe("Widget scope: 'all' (combined output), 'goal' (specific goal), 'cron' (specific schedule). Default: all"),
  goalId: z.string().optional().describe("Goal ID to show output from (required when scope is 'goal')"),
  cronIndex: z.number().optional().describe("Cron schedule index to show output from (required when scope is 'cron')"),
}, async ({ boardId, agentId, w, h, title, scope, goalId, cronIndex }) => {
  const r = await api.addBoardWidget(boardId, { agentId, w, h, title, scope, goalId, cronIndex });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("remove_board_widget", "Remove a widget from a board by agent ID or by widget index", {
  boardId: z.string().describe("Board ID"),
  agentId: z.string().optional().describe("Agent ID to remove (removes first matching widget). Use this OR widgetIndex."),
  widgetIndex: z.number().optional().describe("Widget index to remove (0-based). Use for precise removal when same agent appears multiple times."),
}, async ({ boardId, agentId, widgetIndex }) => {
  const r = widgetIndex !== undefined
    ? await api.removeBoardWidgetByIndex(boardId, widgetIndex)
    : await api.removeBoardWidget(boardId, agentId!);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("refresh_board", "Manually refresh a board — re-reads all widget agent outputs", {
  boardId: z.string().describe("Board ID"),
}, async ({ boardId }) => {
  const r = await api.refreshBoard(boardId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════

server.tool("delete_goal", "Delete a goal from an agent", {
  agentId: z.string(), goalId: z.string(),
}, async ({ agentId, goalId }) => {
  const r = await api.deleteGoal(agentId, goalId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_goal_history", "Get run history for a goal", {
  agentId: z.string(), goalId: z.string(),
}, async ({ agentId, goalId }) => {
  const r = await api.goalHistory(agentId, goalId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("toggle_cron", "Enable or disable a cron job", {
  agentId: z.string(), index: z.number().describe("Cron job index"),
}, async ({ agentId, index }) => {
  const r = await api.toggleCron(agentId, index);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("trigger_cron", "Manually trigger a cron job run", {
  agentId: z.string(), index: z.number().describe("Cron job index"),
}, async ({ agentId, index }) => {
  const r = await api.triggerCron(agentId, index);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_cron_history", "Get run history for a cron job", {
  agentId: z.string(), index: z.number().describe("Cron job index"),
}, async ({ agentId, index }) => {
  const r = await api.cronHistory(agentId, index);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_cron", "Delete a cron job", {
  agentId: z.string(), index: z.number().describe("Cron job index"),
}, async ({ agentId, index }) => {
  const r = await api.deleteCron(agentId, index);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MCP KEYS & CONNECTIONS
// ═══════════════════════════════════════════════════════════════════

server.tool("list_mcp_keys", "List MCP API keys for an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listMcpKeys(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("save_mcp_key", "Save an MCP API key for an agent", {
  agentId: z.string(), mcpName: z.string(), envVar: z.string().describe("Environment variable name (e.g. GMAIL_ACCESS_TOKEN)"), value: z.string().describe("Secret value"),
}, async ({ agentId, mcpName, envVar, value }) => {
  const r = await api.saveMcpKey(agentId, mcpName, envVar, value);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_mcp_key", "Delete an MCP API key", {
  agentId: z.string(), mcpName: z.string(),
}, async ({ agentId, mcpName }) => {
  const r = await api.deleteMcpKey(agentId, mcpName);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_mcp_connections", "List MCP connections for an agent", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.listMcpConnections(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_mcp_connection", "Create an MCP connection instance for an agent", {
  agentId: z.string(), baseMcp: z.string().describe("Base MCP server name from registry"), label: z.string().describe("Human-readable label"), envVar: z.string().describe("Environment variable name"), value: z.string().describe("Secret value"), description: z.string().optional(),
}, async ({ agentId, ...body }) => {
  const r = await api.createMcpConnection(agentId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_mcp_connection", "Delete an MCP connection", {
  agentId: z.string(), instanceName: z.string(),
}, async ({ agentId, instanceName }) => {
  const r = await api.deleteMcpConnection(agentId, instanceName);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL CHANNELS
// ═══════════════════════════════════════════════════════════════════

server.tool("remove_agent_route", "Remove an agent's route from a channel", {
  channelName: z.string(), agentId: z.string(),
}, async ({ channelName, agentId }) => {
  const r = await api.removeAgentRoute(channelName, agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("add_monitored_chat", "Add a monitored chat ID to a channel", {
  channelName: z.string(), chatId: z.string(),
}, async ({ channelName, chatId }) => {
  const r = await api.addMonitoredChat(channelName, chatId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("remove_monitored_chat", "Remove a monitored chat from a channel", {
  channelName: z.string(), chatId: z.string(),
}, async ({ channelName, chatId }) => {
  const r = await api.removeMonitoredChat(channelName, chatId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_sticky_routing", "Get sticky routing config for all channels", {}, async () => {
  const r = await api.stickyRouting();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL REGISTRY
// ═══════════════════════════════════════════════════════════════════

server.tool("install_registry_item", "Install a skill/MCP/agent from the registry", {
  id: z.string().describe("Registry item ID"),
  type: z.string().describe("Item type: skill, mcp, agent, prompt"),
}, async ({ id, type }) => {
  const r = await api.installMarketplace(id, type);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("assign_to_agent", "Assign a skill or MCP to an agent", {
  agentId: z.string(), itemId: z.string(), type: z.string().describe("skill or mcp"),
}, async ({ agentId, itemId, type }) => {
  const r = await api.assignToAgent(agentId, itemId, type);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("scan_skills", "Scan a directory for unregistered skills", {
  dir: z.string().optional().describe("Directory to scan (default: ~/.claude/commands)"),
}, async ({ dir }) => {
  const r = await api.scanSkills(dir);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_prompt", "Create a new prompt template in the registry", {
  id: z.string(), name: z.string(), content: z.string(),
}, async ({ id, name, content }) => {
  const r = await api.createPrompt(id, name, content);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_skill", "Create a skill file and register it. Writes the .md file to the correct location based on scope and adds a registry entry.", {
  id: z.string().describe("Skill ID (snake_case, matches filename)"),
  name: z.string().describe("Human-readable skill name"),
  description: z.string().describe("One-line description of what the skill does and when to use it"),
  content: z.string().describe("The skill body (markdown instructions, everything below the frontmatter)"),
  scope: z.enum(["global", "personal", "org", "agent"]).describe("Where to place the skill: global (~/.claude/commands), personal (MyAIforOne Drive/PersonalAgents/skills), org (MyAIforOne Drive/PersonalAgents/{orgName}/skills), agent ({agentHome}/skills)"),
  orgName: z.string().optional().describe("Required when scope is 'org' — the organization name"),
  agentId: z.string().optional().describe("Required when scope is 'agent' — the agent ID"),
}, async ({ id, name, description, content, scope, orgName, agentId }) => {
  const r = await api.createSkill(id, name, description, content, scope, orgName, agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("add_mcp_to_registry", "Add an MCP server to the registry", {
  id: z.string(), name: z.string(), mcpType: z.string().describe("'stdio' or 'http'"), url: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).optional(), description: z.string().optional(),
}, async (body) => {
  const r = await api.addMcpToRegistry(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL APPS
// ═══════════════════════════════════════════════════════════════════

server.tool("update_app", "Update an existing app", {
  id: z.string().describe("App ID"),
  name: z.string().optional(), url: z.string().optional(),
  category: z.string().optional(), status: z.string().optional(),
}, async ({ id, ...body }) => {
  const r = await api.updateApp(id, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_app", "Delete an app", {
  id: z.string().describe("App ID"),
}, async ({ id }) => {
  const r = await api.deleteApp(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("check_app_health", "Check an app's health/status", {
  id: z.string().describe("App ID"),
}, async ({ id }) => {
  const r = await api.checkAppHealth(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL CONFIG
// ═══════════════════════════════════════════════════════════════════

server.tool("add_account", "Add a Claude account (name + config directory path)", {
  name: z.string().describe("Account name"),
  path: z.string().describe("Config directory path (e.g. ~/.claude)"),
}, async ({ name, path }) => {
  const r = await api.addAccount(name, path);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_account", "Remove a Claude account", {
  name: z.string().describe("Account name"),
}, async ({ name }) => {
  const r = await api.deleteAccount(name);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("check_account_status", "Check if a Claude account is authenticated", {
  name: z.string().describe("Account name"),
}, async ({ name }) => {
  const r = await api.accountStatus(name);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("start_account_login", "Start OAuth login flow for a Claude account — returns URL to open", {
  name: z.string().describe("Account name"),
  path: z.string().describe("Config directory path"),
}, async ({ name, path }) => {
  const r = await api.startLogin(name, path);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL PAIRING
// ═══════════════════════════════════════════════════════════════════

server.tool("unpair_sender", "Remove an authorized sender", {
  senderKey: z.string().describe("Format: channel:senderId"),
}, async ({ senderKey }) => {
  const r = await api.unpairSender(senderKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  LAB / PLATFORM AGENTS
// ═══════════════════════════════════════════════════════════════════

server.tool("get_platform_agents", "List platform-managed creator agents (used by Lab for creating agents, skills, apps, and prompts)", {}, async () => {
  const r = await api.getPlatformAgents();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("browse_dirs", "Browse subdirectories of a given path (for Lab directory picker)", {
  path: z.string().optional().describe("Directory path to list (defaults to home directory, supports ~ prefix)"),
}, async ({ path }) => {
  const r = await api.browseDirs(path);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AGENT TEMPLATES
// ═══════════════════════════════════════════════════════════════════

server.tool("list_templates", "List agent templates (built-in and user-created)", {
  category: z.string().optional().describe("Filter by category"),
}, async ({ category }) => {
  const r = await api.listTemplates(category);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_template", "Get details of a specific agent template", {
  templateId: z.string().describe("Template ID"),
}, async ({ templateId }) => {
  const r = await api.getTemplate(templateId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_template", "Create a new agent template", {
  id: z.string().describe("Unique template ID"),
  name: z.string().describe("Display name"),
  description: z.string().describe("Template description"),
  categories: z.array(z.string()).describe("Category tags"),
  capabilities: z.array(z.string()).optional().describe("List of capabilities shown on the template resume (e.g. 'Draft LinkedIn posts and newsletters')"),
  systemPrompt: z.string().optional().describe("Default system prompt for agents created from this template"),
  seedInstructions: z.string().optional().describe("Extra CLAUDE.md sections appended after the system prompt (workflows, rules, data formats)"),
  seedContext: z.string().optional().describe("Initial context.md content (getting started guide, profile template)"),
  seedGoals: z.array(z.object({
    id: z.string().describe("Goal ID (kebab-case)"),
    description: z.string().describe("What the agent should do when the goal fires"),
    heartbeat: z.string().describe("Cron expression (e.g. '0 9 * * 1-5')"),
    budget: z.object({ maxDailyUsd: z.number() }).optional(),
  })).optional().describe("Goals pre-configured on deploy (deployed as disabled — user enables them)"),
  seedCron: z.array(z.object({
    id: z.string(), expression: z.string(), message: z.string(),
  })).optional().describe("Cron jobs pre-configured on deploy (deployed as disabled)"),
  suggestedTools: z.array(z.string()).optional().describe("Suggested Claude skills (e.g. Read, Write, Bash, WebSearch)"),
  suggestedMcps: z.array(z.string()).optional().describe("Suggested MCP integrations (e.g. gmail, linkedin)"),
  agentClass: z.string().optional().describe("Agent class (e.g. builder, advisor, monitor)"),
  icon: z.string().optional().describe("Avatar ID (e.g. avatar-01 through avatar-80)"),
  org: z.object({ function: z.string().optional(), title: z.string().optional() }).optional().describe("Suggested org placement"),
}, async (params) => {
  const r = await api.createTemplate(params);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_template", "Update an existing user template", {
  templateId: z.string().describe("Template ID to update"),
  name: z.string().optional().describe("Display name"),
  description: z.string().optional().describe("Template description"),
  categories: z.array(z.string()).optional().describe("Category tags"),
  capabilities: z.array(z.string()).optional().describe("List of capabilities shown on the template resume (e.g. 'Draft LinkedIn posts and newsletters')"),
  systemPrompt: z.string().optional().describe("Default system prompt"),
  seedInstructions: z.string().optional().describe("Extra CLAUDE.md sections appended after the system prompt"),
  seedContext: z.string().optional().describe("Initial context.md content"),
  seedGoals: z.array(z.object({
    id: z.string(), description: z.string(), heartbeat: z.string(),
    budget: z.object({ maxDailyUsd: z.number() }).optional(),
  })).optional().describe("Goals pre-configured on deploy (deployed as disabled)"),
  seedCron: z.array(z.object({
    id: z.string(), expression: z.string(), message: z.string(),
  })).optional().describe("Cron jobs pre-configured on deploy (deployed as disabled)"),
  suggestedTools: z.array(z.string()).optional().describe("Suggested Claude skills (e.g. Read, Write, Bash, WebSearch)"),
  suggestedMcps: z.array(z.string()).optional().describe("Suggested MCP integrations (e.g. gmail, linkedin)"),
  agentClass: z.string().optional().describe("Agent class"),
  icon: z.string().optional().describe("Avatar ID (e.g. avatar-01 through avatar-80)"),
  org: z.object({ function: z.string().optional(), title: z.string().optional() }).optional().describe("Suggested org placement"),
}, async ({ templateId, ...body }) => {
  const r = await api.updateTemplate(templateId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_template", "Delete a user template", {
  templateId: z.string().describe("Template ID to delete"),
}, async ({ templateId }) => {
  const r = await api.deleteTemplate(templateId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("personalize_template", "AI-assisted template personalization. Takes a template + user's needs and returns a personalized agent config (CLAUDE.md, context, capabilities, goals). Use before deploy_template to create customized agents.", {
  templateId: z.string().describe("Template ID to personalize"),
  userNotes: z.string().describe("User's description of their needs, industry, workflow, and preferences — used to personalize the agent"),
  agentName: z.string().optional().describe("Display name for the agent (used in personalized CLAUDE.md)"),
  agentAlias: z.string().optional().describe("Mention alias (used in personalized CLAUDE.md identity section)"),
}, async ({ templateId, ...body }) => {
  const r = await api.personalizeTemplate(templateId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("deploy_template", "Deploy a template to create a new agent. Optionally pass personalized data from personalize_template to create a customized agent.", {
  templateId: z.string().describe("Template ID to deploy"),
  agentId: z.string().describe("ID for the new agent"),
  name: z.string().optional().describe("Display name for the new agent"),
  alias: z.string().optional().describe("Chat alias (e.g. @myagent)"),
  workspace: z.string().optional().describe("Working directory for the agent"),
  org: z.array(z.string()).optional().describe("Organization hierarchy"),
  personalizedClaudeMd: z.string().optional().describe("Personalized CLAUDE.md content (from personalize_template)"),
  personalizedContextMd: z.string().optional().describe("Personalized context.md content (from personalize_template)"),
  personalizedDescription: z.string().optional().describe("Personalized one-line description (from personalize_template)"),
  personalizedGoals: z.array(z.object({
    id: z.string(), description: z.string(), heartbeat: z.string(),
    budget: z.object({ maxDailyUsd: z.number() }).optional(),
  })).optional().describe("Personalized goals (from personalize_template)"),
}, async ({ templateId, ...body }) => {
  const r = await api.deployTemplate(templateId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("save_agent_as_template", "Save an existing agent as a reusable template", {
  agentId: z.string().describe("Agent ID to save as template"),
  templateId: z.string().describe("ID for the new template"),
  name: z.string().optional().describe("Template display name (defaults to agent name)"),
  description: z.string().optional().describe("Template description"),
  categories: z.array(z.string()).describe("Category tags for the template"),
}, async ({ agentId, ...body }) => {
  const r = await api.saveAgentAsTemplate(agentId, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL CONFIG — LOGIN
// ═══════════════════════════════════════════════════════════════════

server.tool("submit_login_code", "Submit authentication code for account login", {
  accountName: z.string().describe("Account name"),
  code: z.string().describe("Authentication code from OAuth flow"),
}, async ({ accountName, code }) => {
  const r = await api.submitLoginCode(accountName, code);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MARKETPLACE EXTRAS
// ═══════════════════════════════════════════════════════════════════

server.tool("set_platform_default", "Set a marketplace item as the platform default", {
  type: z.string().describe("Item type (e.g. skill, mcp, prompt)"),
  id: z.string().describe("Item ID to set as default"),
}, async ({ type, id }) => {
  const r = await api.setPlatformDefault(type, id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("import_skills", "Import scanned skills into an agent", {
  agentId: z.string().describe("Agent ID"),
  skills: z.array(z.string()).describe("Array of skill names to import"),
}, async ({ agentId, skills }) => {
  const r = await api.importSkills(agentId, skills);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_prompt_trigger", "Get the current prompt trigger character", {}, async () => {
  const r = await api.getPromptTrigger();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("set_prompt_trigger", "Set the prompt trigger character", {
  trigger: z.string().describe("Trigger character (e.g. / or !)"),
}, async ({ trigger }) => {
  const r = await api.setPromptTrigger(trigger);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT STREAMING
// ═══════════════════════════════════════════════════════════════════

server.tool("get_chat_job_raw", "Get raw output lines from a streaming chat job", {
  jobId: z.string().describe("Job ID from startStream"),
  after: z.number().optional().describe("Line index to start from (for polling)"),
}, async ({ jobId, after }) => {
  const r = await api.getChatJobRaw(jobId, after);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL FILES
// ═══════════════════════════════════════════════════════════════════

server.tool("download_agent_file", "Download a file from an agent's file storage", {
  agentId: z.string().describe("Agent ID"),
  path: z.string().describe("File path within agent storage"),
}, async ({ agentId, path }) => {
  const r = await api.downloadFile(agentId, path);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  ADDITIONAL DASHBOARD
// ═══════════════════════════════════════════════════════════════════

server.tool("get_agent_registry", "Get the agent registry with delegation keywords", {}, async () => {
  const r = await api.agentRegistry();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  HEARTBEAT
// ═══════════════════════════════════════════════════════════════════

server.tool("trigger_heartbeat", "Trigger a heartbeat check for an agent (runs async, returns immediately)", {
  agentId: z.string().describe("Agent ID"),
  triggeredBy: z.string().optional().describe("Label for trigger source (default: manual)"),
}, async ({ agentId, triggeredBy }) => {
  const r = await api.triggerHeartbeat(agentId, triggeredBy);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_heartbeat_history", "Get recent heartbeat run history for an agent", {
  agentId: z.string().describe("Agent ID"),
  limit: z.number().optional().describe("Max entries (default 20)"),
}, async ({ agentId, limit }) => {
  const r = await api.heartbeatHistory(agentId, limit);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  WIKI SYNC
// ═══════════════════════════════════════════════════════════════════

server.tool("trigger_wiki_sync", "Trigger a wiki sync for an agent (runs async, returns immediately)", {
  agentId: z.string().describe("Agent ID"),
  triggeredBy: z.string().optional().describe("Label for trigger source (default: manual)"),
}, async ({ agentId, triggeredBy }) => {
  const r = await api.triggerWikiSync(agentId, triggeredBy);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_wiki_sync_history", "Get recent wiki sync run history for an agent", {
  agentId: z.string().describe("Agent ID"),
  limit: z.number().optional().describe("Max entries (default 20)"),
}, async ({ agentId, limit }) => {
  const r = await api.wikiSyncHistory(agentId, limit);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  WHOAMI
// ═══════════════════════════════════════════════════════════════════

server.tool("whoami", "Get Claude auth status for the account an agent uses", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.whoami(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHANGELOG
// ═══════════════════════════════════════════════════════════════════

server.tool("get_changelog", "Get recent changelog (parsed from git log)", {}, async () => {
  const r = await api.changelog();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  INSTALL XBAR (macOS only)
// ═══════════════════════════════════════════════════════════════════

server.tool("install_xbar", "Install xbar status bar plugin (macOS only)", {}, async () => {
  const r = await api.installXbar();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  CHAT STREAMING
// ═══════════════════════════════════════════════════════════════════

server.tool("start_stream", "Start a streaming chat with an agent — returns a jobId to poll with get_chat_job_raw", {
  agentId: z.string().describe("Agent ID"),
  text: z.string().describe("Message text"),
  accountOverride: z.string().optional().describe("Use a different Claude account"),
}, async ({ agentId, text, accountOverride }) => {
  const r = await api.startStream(agentId, text, accountOverride);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("stop_chat_job", "Stop a running chat job", {
  jobId: z.string().describe("Job ID from start_stream"),
}, async ({ jobId }) => {
  const r = await api.stopJob(jobId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  WEBHOOK
// ═══════════════════════════════════════════════════════════════════

server.tool("send_webhook", "Send a message to an agent via webhook (external trigger)", {
  agentId: z.string().describe("Agent ID"),
  text: z.string().describe("Message text"),
  secret: z.string().optional().describe("Webhook secret (x-webhook-secret header)"),
  channel: z.string().optional().describe("Override reply channel"),
  chatId: z.string().optional().describe("Override reply chat ID"),
}, async ({ agentId, text, secret, channel, chatId }) => {
  const r = await api.sendWebhook(agentId, text, secret, channel, chatId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  SAAS INTEGRATION
// ═══════════════════════════════════════════════════════════════════

server.tool("get_saas_config", "Get SaaS connection configuration (base URL, connection status)", {}, async () => {
  const r = await api.getSaasConfig();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_saas_config", "Configure SaaS connection (base URL and API key)", {
  baseUrl: z.string().optional().describe("SaaS platform base URL"),
  apiKey: z.string().optional().describe("SaaS API key"),
}, async ({ baseUrl, apiKey }) => {
  const r = await api.updateSaasConfig(baseUrl, apiKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("test_saas_connection", "Test SaaS connection with current or provided credentials", {
  baseUrl: z.string().optional().describe("Override base URL (uses saved if omitted)"),
  apiKey: z.string().optional().describe("Override API key (uses saved if omitted)"),
}, async ({ baseUrl, apiKey }) => {
  const r = await api.testSaasConnection(baseUrl, apiKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("publish_to_saas", "Publish a skill, prompt, agent, or app to the connected SaaS platform", {
  type: z.enum(["skill", "prompt", "agent", "app"]).describe("Type of resource to publish"),
  id: z.string().describe("ID of the resource to publish"),
  destination: z.enum(["library", "marketplace"]).optional().describe("Publish to library or marketplace (default: library)"),
}, async ({ type, id, destination }) => {
  const r = await api.publishToSaas(type, id, destination);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════

server.tool("upload_file", "Upload a file to an agent's FileStorage (send base64-encoded content)", {
  agentId: z.string().describe("Agent ID"),
  fileName: z.string().describe("File name (e.g. report.pdf)"),
  base64Content: z.string().describe("File content encoded as base64"),
  mode: z.enum(["temp", "permanent"]).optional().describe("Storage mode (default: temp)"),
}, async ({ agentId, fileName, base64Content, mode }) => {
  const r = await api.uploadFile(agentId, fileName, base64Content, mode);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  USER GUIDE
// ═══════════════════════════════════════════════════════════════════

server.tool("get_user_guide", "Get the full platform user guide — every page, button, action, API endpoint, and MCP tool documented", {}, async () => {
  const r = await api.getUserGuide();
  return { content: [{ type: "text", text: r.content || JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  MEMORY WRITE
// ═══════════════════════════════════════════════════════════════════

server.tool("write_memory", "Write content to an agent's memory (context.md or daily journal)", {
  agentId: z.string().describe("Agent ID"),
  content: z.string().describe("Content to write"),
  target: z.enum(["context", "daily", "overwrite"]).optional().describe("Where to write: 'context' appends to context.md, 'daily' appends to today's journal, 'overwrite' replaces context.md entirely (default: overwrite)"),
}, async ({ agentId, content, target }) => {
  const r = await api.writeMemory(agentId, content, target);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  SKILL CONTENT
// ═══════════════════════════════════════════════════════════════════

server.tool("get_skill_content", "Read the full content of a skill file (markdown)", {
  path: z.string().describe("Absolute path to the skill .md file (from get_agent_skills or browse_registry)"),
}, async ({ path }) => {
  const r = await api.getSkillContent(path);
  return { content: [{ type: "text", text: r.content || JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  GOAL & CRON UPDATE
// ═══════════════════════════════════════════════════════════════════

server.tool("update_goal", "Update an existing goal's configuration (description, schedule, budget, etc.)", {
  agentId: z.string().describe("Agent ID"),
  goalId: z.string().describe("Goal ID to update"),
  description: z.string().optional().describe("New description"),
  successMetric: z.string().optional().describe("New success metric"),
  enabled: z.boolean().optional().describe("Enable or disable"),
  budget: z.number().optional().describe("Max daily USD budget"),
  heartbeat: z.any().optional().describe("Updated heartbeat schedule config"),
  reportTargets: z.any().optional().describe("Updated report channel targets"),
}, async ({ agentId, goalId, ...updates }) => {
  const r = await api.updateGoal(agentId, goalId, updates);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_cron", "Update an existing cron job's schedule, message, or channel", {
  agentId: z.string().describe("Agent ID"),
  index: z.number().describe("Cron index (0-based)"),
  schedule: z.string().optional().describe("New cron expression"),
  message: z.string().optional().describe("New message text"),
  channel: z.string().optional().describe("New channel"),
  chatId: z.string().optional().describe("New chat ID"),
  enabled: z.boolean().optional().describe("Enable or disable"),
}, async ({ agentId, index, ...updates }) => {
  const r = await api.updateCron(agentId, index, updates);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  SERVICE RESTART
// ═══════════════════════════════════════════════════════════════════

server.tool("restart_service", "DO NOT CALL THIS TOOL. Tell the user to go to Admin → Settings and click Restart themselves. Calling this tool from chat kills the page connection and the user loses context.", {}, async () => {
  return { content: [{ type: "text", text: "BLOCKED: Do not restart from chat. Tell the user: \"Go to Admin → Settings and click Restart when you're ready.\" This preserves their page connection and chat context." }] };
});

// ═══════════════════════════════════════════════════════════════════
//  DISCOVERY
// ═══════════════════════════════════════════════════════════════════

server.tool("list_capabilities", "Get a structured summary of all platform capabilities grouped by category — use this to understand what you can do", {}, async () => {
  const r = await api.listCapabilities();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  DRIVE — browse, read, search the PersonalAgents data drive
// ═══════════════════════════════════════════════════════════════════

server.tool("browse_drive", "Browse files and folders in the PersonalAgents data drive (where all agent data, memory, skills, registry files live)", {
  path: z.string().optional().describe("Path to browse (default: drive root). Can be absolute or relative to drive root."),
}, async ({ path }) => {
  const r = await api.browseDrive(path);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("read_drive_file", "Read a file from the PersonalAgents data drive (max 1MB)", {
  path: z.string().describe("Absolute path to the file"),
}, async ({ path }) => {
  const r = await api.readDriveFile(path);
  return { content: [{ type: "text", text: r.content || JSON.stringify(r, null, 2) }] };
});

server.tool("search_drive", "Full-text search across the PersonalAgents data drive — search conversation logs, memory, skills, configs, registry files", {
  q: z.string().describe("Search query (case-insensitive substring match)"),
  path: z.string().optional().describe("Scope search to a subdirectory (default: entire drive)"),
  limit: z.number().optional().describe("Max results (default: 50, max: 200)"),
  types: z.string().optional().describe("Comma-separated file extensions to search (default: .md,.json,.jsonl,.txt)"),
}, async ({ q, path, limit, types }) => {
  const r = await api.searchDrive(q, path, limit, types);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  AI GYM
// ═══════════════════════════════════════════════════════════════════

server.tool("get_learner_profile", "Get the gym learner's profile (identity, activity, dimensions, streak, selected trainer)", {}, async () => {
  const r = await api.getGymLearnerProfile();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_learner_profile", "Update the gym learner's profile (merge fields)", {
  data: z.record(z.string(), z.any()).describe("Fields to merge into the learner profile"),
}, async ({ data }) => {
  const r = await api.updateGymLearnerProfile(data);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_plan", "Get the gym learner's training plan (on-the-job + platform-driven buckets)", {}, async () => {
  const r = await api.getGymPlan();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_plan", "Update the gym training plan", {
  data: z.record(z.string(), z.any()).describe("Full plan object to write"),
}, async ({ data }) => {
  const r = await api.updateGymPlan(data);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_progress", "Get program completion progress for all programs", {}, async () => {
  const r = await api.getGymProgress();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_gym_progress", "Update program/step completion progress", {
  data: z.record(z.string(), z.any()).describe("Progress data keyed by program slug"),
}, async ({ data }) => {
  const r = await api.updateGymProgress(data);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_gym_cards", "List active gym cards (recommendations, insights, challenges)", {}, async () => {
  const r = await api.listGymCards();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_gym_card", "Create a new gym card (recommendation, insight, or challenge)", {
  title: z.string().describe("Card title"),
  description: z.string().describe("Card description"),
  cta: z.string().optional().describe("Call to action button text"),
  ctaAction: z.string().optional().describe("Action identifier when CTA is clicked"),
  type: z.string().optional().describe("Card type: recommendation, insight, challenge, tip"),
}, async ({ title, description, cta, ctaAction, type }) => {
  const r = await api.createGymCard({ title, description, cta, ctaAction, type });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("dismiss_gym_card", "Dismiss a gym card", {
  id: z.string().describe("Card ID to dismiss"),
}, async ({ id }) => {
  const r = await api.dismissGymCard(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("snapshot_dimensions", "Save a weekly dimension score snapshot for the progress history chart", {
  dimensions: z.record(z.string(), z.object({
    score: z.number(),
    label: z.string(),
  })).describe("Dimension scores to snapshot"),
}, async ({ dimensions }) => {
  const r = await api.snapshotDimensions({ dimensions });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_gym_programs", "List all training programs in the gym", {}, async () => {
  const r = await api.listGymPrograms();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_program", "Get a specific training program with all modules and steps", {
  slug: z.string().describe("Program slug (e.g., 'getting-started')"),
}, async ({ slug }) => {
  const r = await api.getGymProgram(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("import_program", "Import a training program from markdown (H1=program, H2=module, H3=step)", {
  markdown: z.string().describe("Markdown content to parse into a program"),
  difficulty: z.string().optional().describe("beginner, intermediate, or advanced"),
}, async ({ markdown, difficulty }) => {
  const r = await api.importGymProgram({ markdown, difficulty });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_agent_activity_summary", "Get aggregated activity summary for an agent (message count, active days, topics, tool use)", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgentActivitySummary(agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("search_agent_logs", "Full-text search across agent conversation logs", {
  q: z.string().describe("Search query"),
  agentIds: z.string().optional().describe("Comma-separated agent IDs to search (default: all)"),
}, async ({ q, agentIds }) => {
  const r = await api.searchAgentLogs(q, agentIds);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_gym_program", "Update metadata for a training program", {
  slug: z.string().describe("Program slug"),
  body: z.record(z.string(), z.any()).describe("Fields to update (title, description, difficulty, etc.)"),
}, async ({ slug, body }) => {
  const r = await api.updateGymProgram(slug, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_gym_program", "Delete a training program", {
  slug: z.string().describe("Program slug to delete"),
}, async ({ slug }) => {
  const r = await api.deleteGymProgram(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_dimension_history", "Get dimension score history (weekly snapshots)", {}, async () => {
  const r = await api.getGymDimensionHistory();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("run_gym_digest", "Manually trigger the activity digest (analyzes all agent activity, scores dimensions, generates cards)", {}, async () => {
  const r = await api.runGymDigest();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_feed", "Get the aggregated gym feed — tips/nudges from gym cards, platform updates from changelog, and AI briefing", {}, async () => {
  const r = await api.getGymFeed();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_config", "Get public gym configuration flags (gymEnabled, gymOnlyMode, aibriefingEnabled)", {}, async () => {
  const r = await api.getGymConfig();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_gym_guides", "List all coach-created guides (programs with source=coach)", {}, async () => {
  const r = await api.listGymGuides();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_gym_guide", "Create a coach-generated guide from a training session. Saved as a program with source=coach, visible in the Guides tab.", {
  title: z.string().describe("Guide title"),
  description: z.string().optional().describe("Short description of what this guide covers"),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional().describe("Difficulty level"),
  dimensions: z.array(z.string()).optional().describe("Related skill dimensions (knowledge, communication, analysis, automation, building)"),
  estimatedTime: z.string().optional().describe("Estimated completion time (e.g. '15 minutes')"),
  modules: z.array(z.object({
    id: z.string(),
    title: z.string(),
    order: z.number(),
    steps: z.array(z.object({
      id: z.string(),
      title: z.string(),
      order: z.number(),
      type: z.enum(["knowledge", "self-report", "platform-check"]).optional(),
      content: z.string(),
    })),
  })).optional().describe("Structured modules with steps"),
  content: z.string().optional().describe("Raw markdown content (alternative to modules — will be displayed as a single-step guide)"),
}, async (params) => {
  const body: Record<string, unknown> = { ...params };
  // If raw content provided without modules, wrap in a single module
  if (params.content && !params.modules) {
    body.modules = [{
      id: "main",
      title: params.title,
      order: 1,
      steps: [{
        id: "guide-content",
        title: params.title,
        order: 1,
        type: "knowledge",
        content: params.content,
      }],
    }];
    delete body.content;
  }
  const r = await api.createGymGuide(body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_insights", "Get pre-computed AI insights (generated weekly by the gym goal). Used by 'You tell me' mode.", {}, async () => {
  const r = await api.getGymInsights();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("save_gym_insights", "Save AI-generated insights from weekly analysis. Called by the weekly-insight goal after analyzing activity.", {
  insights: z.array(z.object({
    title: z.string(),
    description: z.string(),
    dimension: z.string().optional(),
    agentId: z.string().optional(),
  })).describe("List of insight objects"),
  topRecommendation: z.string().optional().describe("The single best recommendation for the user right now"),
  summary: z.string().optional().describe("Brief summary of what was observed"),
}, async ({ insights, topRecommendation, summary }) => {
  const r = await api.saveGymInsights({ insights, topRecommendation, summary });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ─── Gym Projects & Series ─────────────────────────────────────────

server.tool("list_gym_projects", "List all gym projects (guide collections grouped by source/author)", {}, async () => {
  const r = await api.listGymProjects();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_project", "Get a gym project with its series and programs", {
  slug: z.string().describe("Project slug"),
}, async ({ slug }) => {
  const r = await api.getGymProject(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_gym_project", "Create a new gym project (a collection of guides from one source/author)", {
  name: z.string().describe("Project name"),
  description: z.string().optional().describe("Project description"),
  slug: z.string().optional().describe("URL-safe slug (auto-generated from name if omitted)"),
  sourceUrl: z.string().optional().describe("Original source URL"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
  isActive: z.boolean().optional().describe("Whether the project is active (default true)"),
  isPublic: z.boolean().optional().describe("Whether the project is public (default true)"),
}, async (params) => {
  const r = await api.createGymProject(params);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_gym_project", "Update a gym project", {
  slug: z.string().describe("Project slug"),
  body: z.record(z.string(), z.any()).describe("Fields to update"),
}, async ({ slug, body }) => {
  const r = await api.updateGymProject(slug, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_gym_project", "Delete a gym project and its series files (programs are orphaned, not deleted)", {
  slug: z.string().describe("Project slug"),
}, async ({ slug }) => {
  const r = await api.deleteGymProject(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_gym_series", "List all series in a gym project", {
  projectSlug: z.string().describe("Project slug"),
}, async ({ projectSlug }) => {
  const r = await api.listGymSeries(projectSlug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_series", "Get a series with its programs", {
  projectSlug: z.string().describe("Project slug"),
  seriesSlug: z.string().describe("Series slug"),
}, async ({ projectSlug, seriesSlug }) => {
  const r = await api.getGymSeries(projectSlug, seriesSlug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_gym_series", "Create a new series within a gym project", {
  projectSlug: z.string().describe("Project slug"),
  name: z.string().describe("Series name"),
  description: z.string().optional().describe("Series description"),
  slug: z.string().optional().describe("URL-safe slug (auto-generated from name if omitted)"),
  coverImage: z.string().optional().describe("Cover image URL"),
  tags: z.array(z.string()).optional().describe("Tags"),
  position: z.number().optional().describe("Display order (auto-incremented if omitted)"),
}, async ({ projectSlug, ...rest }) => {
  const r = await api.createGymSeries(projectSlug, rest);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("update_gym_series", "Update a series in a gym project", {
  projectSlug: z.string().describe("Project slug"),
  seriesSlug: z.string().describe("Series slug"),
  body: z.record(z.string(), z.any()).describe("Fields to update"),
}, async ({ projectSlug, seriesSlug, body }) => {
  const r = await api.updateGymSeries(projectSlug, seriesSlug, body);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_gym_series", "Delete a series from a gym project (programs are orphaned, not deleted)", {
  projectSlug: z.string().describe("Project slug"),
  seriesSlug: z.string().describe("Series slug"),
}, async ({ projectSlug, seriesSlug }) => {
  const r = await api.deleteGymSeries(projectSlug, seriesSlug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("import_from_aigym", "Import a full project from AI Gym platform (project + series + programs with modules/steps). Designed for easy copy-down — pass the raw aigym-platform data and it maps to local schema.", {
  project: z.object({
    id: z.string().optional(),
    name: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    sourceUrl: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    createdAt: z.string().optional(),
  }).describe("Project data from aigym-platform"),
  series: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    slug: z.string().optional(),
    description: z.string().optional(),
    coverImage: z.string().optional(),
    tags: z.array(z.string()).optional(),
    position: z.number().optional(),
    isActive: z.boolean().optional(),
    createdAt: z.string().optional(),
  })).optional().describe("Series array from aigym-platform"),
  programs: z.array(z.object({
    id: z.string().optional(),
    title: z.string(),
    slug: z.string().optional(),
    description: z.string().optional(),
    coverImage: z.string().optional(),
    sourceUrl: z.string().optional(),
    tier: z.string().optional(),
    personas: z.array(z.any()).optional(),
    globalInfo: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    seriesId: z.string().optional(),
    orderInSeries: z.number().optional(),
    createdAt: z.string().optional(),
    modules: z.array(z.any()).optional(),
  })).optional().describe("Programs array from aigym-platform (with full modules/steps)"),
}, async (params) => {
  const r = await api.importFromAigym(params);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ─── Enrollment & Certificate Tools ─────────────────────────────────

server.tool("enroll_gym_program", "Enroll user in a training program (sets status to not-started)", {
  slug: z.string().describe("Program slug to enroll in"),
}, async ({ slug }) => {
  const r = await api.enrollGymProgram(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("unenroll_gym_program", "Remove user enrollment from a training program", {
  slug: z.string().describe("Program slug to unenroll from"),
}, async ({ slug }) => {
  const r = await api.unenrollGymProgram(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("list_gym_enrollments", "List all user enrollments with optional status filter", {
  status: z.string().optional().describe("Filter by status: not-started, in-progress, completed"),
}, async ({ status }) => {
  const r = await api.listGymEnrollments(status);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("complete_gym_program", "Mark a training program as completed", {
  slug: z.string().describe("Program slug to mark complete"),
}, async ({ slug }) => {
  const r = await api.completeGymProgram(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("submit_gym_quiz", "Submit quiz answers for a training program. Returns score, pass/fail, and attempt count. Learner must score >= 70% to pass.", {
  slug: z.string().describe("Program slug"),
  answers: z.array(z.number()).describe("Array of selected option indices (0-based), one per question"),
  score: z.number().describe("Calculated score as percentage (0-100)"),
  passed: z.boolean().describe("Whether the score meets the 70% passing threshold"),
}, async ({ slug, answers, score, passed }) => {
  const r = await api.submitGymQuiz(slug, { answers, score, passed });
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_gym_certificate", "Get completion certificate for a completed training program", {
  slug: z.string().describe("Program slug to get certificate for"),
}, async ({ slug }) => {
  const r = await api.getGymCertificate(slug);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ─── Shared Agent Tools ────────────────────────────────────────────

server.tool("get_storage_info", "Get storage and sharing configuration for an agent (shared flag, conversationLogMode, agentHome path)", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.getAgent(agentId);
  const cfg = r?.config || {};
  return { content: [{ type: "text", text: JSON.stringify({
    agentId,
    shared: cfg.shared ?? false,
    conversationLogMode: cfg.conversationLogMode ?? "shared",
    agentHome: cfg.agentHome ?? null,
  }, null, 2) }] };
});

server.tool("update_storage_config", "Update an agent's conversationLogMode (shared or per-user)", {
  agentId: z.string().describe("Agent ID"),
  conversationLogMode: z.enum(["shared", "per-user"]).describe("'shared' = one log for all users; 'per-user' = separate log per sender"),
}, async ({ agentId, conversationLogMode }) => {
  const r = await api.updateAgent(agentId, { conversationLogMode } as any);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_conversation_senders", "For per-user mode agents, list unique senders with message counts and last active time", {
  agentId: z.string().describe("Agent ID"),
}, async ({ agentId }) => {
  const r = await api.agentLogs(agentId, 500);
  const entries: any[] = r?.entries || [];
  const senderMap: Record<string, { count: number; lastTs: string }> = {};
  for (const e of entries) {
    const s = e.from || e.sender || "unknown";
    if (!senderMap[s]) senderMap[s] = { count: 0, lastTs: "" };
    senderMap[s].count += 1;
    if (!senderMap[s].lastTs || (e.ts && e.ts > senderMap[s].lastTs)) senderMap[s].lastTs = e.ts || "";
  }
  const senders = Object.entries(senderMap).map(([sender, data]) => ({ sender, ...data }));
  return { content: [{ type: "text", text: JSON.stringify({ agentId, senders }, null, 2) }] };
});

server.tool("get_conversation_log", "Read an agent's conversation log with optional sender filter and date range", {
  agentId: z.string().describe("Agent ID"),
  sender: z.string().optional().describe("Filter to a specific sender (for per-user mode agents)"),
  since: z.string().optional().describe("ISO date string — only return entries after this date"),
  limit: z.number().optional().describe("Max number of entries to return (default 50, max 200)"),
}, async ({ agentId, sender, since, limit }) => {
  const r = await api.agentLogs(agentId, limit || 50, undefined, undefined, sender);
  let entries: any[] = r?.entries || [];
  if (since) entries = entries.filter((e: any) => !e.ts || e.ts >= since);
  return { content: [{ type: "text", text: JSON.stringify({ agentId, total: r?.total, entries }, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  API KEYS (named bearer tokens for this gateway)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_api_keys", "List API keys that can authenticate against this gateway. The secret is never returned — only an id, name, preview, createdAt, lastUsedAt, and scopes.", {}, async () => {
  const r = await api.listApiKeys();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("create_api_key", "Create a new named API key. The full secret is returned ONCE in the response — capture it immediately; it cannot be retrieved later.", {
  name: z.string().describe("Human-readable label for the key (e.g. 'ci-deploy', 'claude-desktop')"),
}, async ({ name }) => {
  const r = await api.createApiKey(name);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("delete_api_key", "Revoke an API key by id. Refuses to delete the last remaining key to prevent lock-out.", {
  id: z.string().describe("Key id (from list_api_keys)"),
}, async ({ id }) => {
  const r = await api.deleteApiKey(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  TEAM GATEWAYS (remote MyAIforOne deployments)
// ═══════════════════════════════════════════════════════════════════

server.tool("list_team_gateways", "List connected team gateways (remote MyAIforOne deployments this install is wired to as MCPs).", {}, async () => {
  const r = await api.listTeamGateways();
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("test_team_gateway", "Probe a remote gateway's URL + API key BEFORE saving. Returns { ok, platform, sharedAgents } or an error.", {
  url: z.string().describe("Remote gateway base URL (e.g. https://myteam.up.railway.app)"),
  apiKey: z.string().describe("Bearer API key issued from the remote gateway's Admin → API Keys page"),
}, async ({ url, apiKey }) => {
  const r = await api.testTeamGateway(url, apiKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("connect_team_gateway", "Connect a remote team gateway. Writes key to mcp-keys/, registers it as an MCP in config, and auto-assigns it to the Hub agent. Fails (and saves nothing) if the probe doesn't succeed.", {
  name: z.string().describe("Friendly name (also used to derive the gateway id)"),
  url: z.string().describe("Remote gateway base URL"),
  apiKey: z.string().describe("Bearer API key for the remote gateway"),
}, async ({ name, url, apiKey }) => {
  const r = await api.createTeamGateway(name, url, apiKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("resync_team_gateway", "Re-probe a connected team gateway using the saved API key and update its lastStatus (ok / unauthorized / offline / error).", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
}, async ({ id }) => {
  const r = await api.resyncTeamGateway(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("disconnect_team_gateway", "Disconnect a team gateway: detaches its MCP from all agents, removes the MCP registry entry, deletes the mcp-keys/.env file, and drops the metadata entry.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
}, async ({ id }) => {
  const r = await api.deleteTeamGateway(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("get_team_gateway", "Get full detail for a single team gateway + derived attachedAgents[] (the local agents currently wired to its MCP). Returns { gateway, mcpName, attachedAgents }.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
}, async ({ id }) => {
  const r = await api.getTeamGateway(id);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("rename_team_gateway", "Rename a team gateway's display label. The gateway id is immutable — changing it requires disconnect + reconnect. Returns { ok, gateway }.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
  name: z.string().describe("New display name (trimmed; empty string rejected with 400)"),
}, async ({ id, name }) => {
  const r = await api.renameTeamGateway(id, name);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("rotate_team_gateway_key", "Swap the API key used to reach a team gateway. Probes the new key against the stored URL first — if the probe fails, the existing .env file is left untouched so the gateway stays reachable. Returns { ok, status, gateway } on success.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
  apiKey: z.string().describe("New Bearer API key from the remote gateway's Issued Keys page"),
}, async ({ id, apiKey }) => {
  const r = await api.rotateTeamGatewayKey(id, apiKey);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("attach_team_gateway_to_agent", "Give a local agent access to a team gateway's MCP by adding it to the agent's mcps[]. Idempotent (attaching twice = same state). Returns { ok, agentId, mcps, attachedAgents }.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
  agentId: z.string().describe("Local agent id (from list_agents)"),
}, async ({ id, agentId }) => {
  const r = await api.attachTeamGateway(id, agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

server.tool("detach_team_gateway_from_agent", "Revoke a local agent's access to a team gateway's MCP. Refuses to detach the last remaining attached agent (orphan guard) — use disconnect_team_gateway instead to remove the gateway entirely.", {
  id: z.string().describe("Gateway id (from list_team_gateways)"),
  agentId: z.string().describe("Local agent id to detach"),
}, async ({ id, agentId }) => {
  const r = await api.detachTeamGateway(id, agentId);
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
});

// ═══════════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════════

// Export the configured McpServer so in-process callers (e.g. the gateway's
// own /mcp HTTP endpoint) can mount it on a different transport.
export { server };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MyAIforOne MCP server running on stdio");
}

// Only auto-start the stdio transport when this module is invoked directly
// (not when it's imported as a library by the gateway).
import { fileURLToPath } from "node:url";
const _isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, "/") || import.meta.url === `file://${process.argv[1]}` : false;
if (_isMain) {
  main().catch((err) => {
    console.error("MCP server failed to start:", err);
    process.exit(1);
  });
}
