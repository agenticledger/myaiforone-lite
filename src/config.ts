import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LogLevel } from "./logger.js";

// Package root — used to remap stale platform agent paths after npx cache clears
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

/**
 * True when running as a remote server (Railway / container) vs a local install.
 * MYAGENT_DATA_DIR alone is NOT sufficient — the npm CLI also sets it for local
 * installs (pointing to ~/.myaiforone). We require an explicit MYAGENT_SERVER_MODE
 * flag, or the presence of Railway-specific env vars, to confirm server mode.
 */
export function isServerMode(): boolean {
  if (process.env.MYAGENT_SERVER_MODE === "true" || process.env.MYAGENT_SERVER_MODE === "1") return true;
  // Railway always sets RAILWAY_ENVIRONMENT
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  return false;
}

export interface RouteMatch {
  type: "chat_id" | "chat_guid" | "chat_identifier" | "channel_id" | "jid";
  value: string | number;
}

export interface RoutePermissions {
  allowFrom: string[];
  requireMention: boolean;
}

export interface RouteConfig {
  channel: string;
  match: RouteMatch;
  permissions: RoutePermissions;
}

// ─── MCP Server definitions ──────────────────────────────────────────

export interface McpServerStdio {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerHttp {
  type: "http" | "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

// ─── Cron job config ─────────────────────────────────────────────────

export interface CronJobConfig {
  schedule: string;       // cron expression (e.g., "0 9 * * *")
  message: string;        // message to send to the agent
  channel: string;        // which channel to reply on
  chatId: string;         // which chat to reply in
  enabled?: boolean;      // default true — set false to pause
}

// ─── Goals config ───────────────────────────────────────────────────

export interface GoalConfig {
  id: string;
  enabled: boolean;
  description: string;
  successCriteria?: string;
  instructions?: string;
  heartbeat: string;       // cron expression
  budget?: { maxDailyUsd: number };
  reportTo?: string | string[];  // "channel:chatId" or array of them e.g. ["telegram:-5112439418", "slack:C0ALHTDD6JF"]
}

// ─── Agent config ────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  agentHome?: string;    // agent's own folder (memory, skills, keys, storage)
  workspace: string;     // project/codebase the agent works on
  claudeMd: string;
  memoryDir: string;
  skills?: string[];        // shared skills from ~/.claude/commands/
  agentSkills?: string[];   // agent-specific skills from agent's skills/ folder
  mcps?: string[];
  prompts?: string[];       // prompt templates available to this agent
  persistent?: boolean;
  perSenderSessions?: boolean;
  streaming?: boolean;
  advancedMemory?: boolean;
  org?: Array<{
    organization: string;
    function: string;
    title: string;
    reportsTo?: string;
  }>;
  autonomousCapable?: boolean;
  autoCommit: boolean;
  autoCommitBranch: string;
  allowedTools: string[];
  claudeAccount?: string;  // which account this agent uses (key from service.claudeAccounts)
  mentionAliases?: string[];
  routes: RouteConfig[];
  timeout?: number;
  cron?: CronJobConfig[];
  goals?: GoalConfig[];
  wiki?: boolean;                     // Enable wiki learning — agent saves learned facts to learned.md
  wikiSync?: {
    enabled: boolean;
    schedule: string;                 // cron expression (e.g., "0 0 * * *" = daily midnight)
  };
  subAgents?: string[] | "*";  // Group agent: list of agent IDs to delegate to, or "*" for all
  platformAgent?: boolean;     // DEPRECATED — use agentClass instead
  agentClass?: "standard" | "platform" | "builder" | "gym" | "board";  // standard (default), platform (Lab creators), builder (app developer agents), gym (AI Gym agents), board (board-only widget agents)
  executor?: string;  // "claude" (default) or "ollama:modelname" (e.g., "ollama:gemma2")
  voice?: string;     // override platform default voice — provider id or "provider:voiceId" (e.g., "grok:Eve"). Empty/undef = use platform default
  shared?: boolean;   // true = shared agent (multi-user); agentHome lives under SharedAgents/ root
  conversationLogMode?: "shared" | "per-user";  // "shared" (default) = one log for all users; "per-user" = separate log per sender
  avatar?: string;           // avatar identifier (e.g., "avatar-01" or emoji)
  boardEnabled?: boolean;    // opt-in: allow this agent's output to appear on boards
  boardLayout?: "small" | "medium" | "large";  // default widget size when added to a board
  deployedFrom?: string;     // template ID this agent was deployed from
}

export interface ChannelConfig {
  enabled: boolean;
  driver: string;
  config: Record<string, unknown>;
}

// ─── Web UI config ───────────────────────────────────────────────────

export interface WebUIConfig {
  enabled: boolean;
  port: number;
  webhookSecret?: string;
}

export interface ServiceConfig {
  logLevel: LogLevel;
  logFile?: string;
  pairingCode?: string;
  personalAgentsDir?: string;   // Override path to PersonalAgents dir (default: ~/Desktop/MyAIforOne Drive/PersonalAgents)
  personalRegistryDir?: string; // Override path to PersonalRegistry dir (default: ~/Desktop/MyAIforOne Drive/PersonalRegistry)
  sharedAgentsDir?: string;     // Override path to SharedAgents dir (default: ~/Desktop/MyAIforOne Drive/SharedAgents)
  webUI?: WebUIConfig;
  claudeAccounts?: Record<string, string>;  // name → config dir path, e.g. {"main": "~/.claude"}
  defaultClaudeAccount?: string;    // account name to use when agent has no claudeAccount set (e.g. "main")
  multiModelEnabled?: boolean;      // false = claude only, true = enables alternative models
  platformDefaultExecutor?: string; // "claude" (default) or "ollama:gemma2" etc.
  ollamaBaseUrl?: string;           // default: "http://localhost:11434"
  providerKeys?: Record<string, string>; // provider API keys: { openai: "sk-...", xai: "xai-...", google: "AIza...", groq: "gsk_...", together: "...", mistral: "...", elevenlabs: "..." }
  // ─── Voice Mode (Phase 1: Web UI TTS + STT) ───
  voiceModeEnabled?: boolean;        // false (default) = voice features hidden; true = enables TTS/STT in Web UI
  platformDefaultVoice?: string;     // provider id or "provider:voiceId" — e.g., "browser", "grok", "grok:Ara". Default: "browser"
  voiceAutoPlay?: boolean;           // false (default) = user clicks Play; true = agent replies auto-play
  voiceMaxChars?: number;            // truncate TTS input to this many chars (default: 2000)
  gymEnabled?: boolean;                   // false = gym hidden, true = gym active
  aibriefingEnabled?: boolean;            // false = no AI briefing feed, true = weekly AI news via web search
  gymOnlyMode?: boolean;
  sharedAgentsEnabled?: boolean;          // false (default) = shared agents feature hidden; true = enabled (also requires license feature "sharedAgents")
  auth?: {
    enabled?: boolean;                    // false (default) — personal gateway is open; true = API key required for all /api/* requests
    tokens?: string[];                    // LEGACY: bearer tokens that grant API access (migrated to apiKeys on first boot)
    webPassword?: string;                 // password for web UI login (POST /api/auth/login)
  };
  apiKeys?: ApiKey[];                     // Named API keys for programmatic access (preferred over legacy auth.tokens)
  teamGateways?: TeamGateway[];           // Connected remote gateways (this local install reaches out to them via MCP)
  licenseKey?: string;                    // MyAIforOne license key (validated against ai41license.agenticledger.ai)
  licenseUrl?: string;                    // Override license server URL (default: https://ai41license.agenticledger.ai)
}

// ─── API keys ────────────────────────────────────────────────────────
// Named credentials that grant programmatic access to the gateway's /api/*
// and /mcp endpoints. Each key carries a role ("full" or "read") that controls
// what the holder can do. Full = admin/operator, Read = browse + view only.
export interface ApiKey {
  id: string;              // short opaque id, e.g. "key_abc123"
  name: string;            // human label, e.g. "Ore's MacBook", "Initial Bootstrap"
  key: string;             // the secret — prefixed "mai41team_..." for recognizability
  createdAt: string;       // ISO datetime
  lastUsedAt?: string;     // ISO datetime (updated by auth middleware on successful match)
  scopes: string[];        // ["*"] = full access; future: ["agents:read"] etc.
  email?: string;          // user identity — ties this key to a person
  role?: "full" | "read";  // "full" = admin/write access, "read" = browse only (default: "full")
}

// ─── Team Gateways ───────────────────────────────────────────────────
// Connections to remote (shared) MyAIforOne gateways. Each connected gateway
// becomes available as an MCP that local agents can call.
export interface TeamGateway {
  id: string;                                              // slug derived from name
  name: string;                                            // user display name
  url: string;                                             // gateway URL (no trailing slash)
  addedAt: string;                                         // ISO datetime
  lastStatus?: "ok" | "offline" | "unauthorized" | "error"; // result of last connection test
  lastStatusAt?: string;                                   // ISO datetime of last status check
  lastStatusMessage?: string;                              // human-readable detail when not "ok"
}

export interface AppConfig {
  service: ServiceConfig;
  channels: Record<string, ChannelConfig>;
  agents: Record<string, AgentConfig>;
  mcps?: Record<string, McpServerConfig>;
  defaultAgent: string | null;
  defaultSkills?: string[];   // skills given to every agent automatically
  defaultMcps?: string[];     // MCPs given to every agent automatically
  defaultPrompts?: string[];  // prompt templates given to every agent automatically
  promptTrigger?: string;     // character used to invoke prompt templates (default: "!")
  saas?: {
    baseUrl: string;
    apiKey: string;
  };
}

export function loadConfig(configPath: string): AppConfig {
  const fullPath = resolve(configPath);
  const raw = readFileSync(fullPath, "utf-8");
  const config = JSON.parse(raw) as AppConfig;

  // Ensure required top-level keys exist (default to empty — app can start for setup)
  if (!config.agents) config.agents = {};
  if (!config.channels) config.channels = {};

  // Remap stale MCP server command paths (e.g. myaiforone-local after cache clear)
  // Also normalize relative ./mcps/ paths to absolute (safe for launchd/Task Scheduler)
  if (config.mcps) {
    for (const [name, mcp] of Object.entries(config.mcps)) {
      if ((mcp as any).type === "stdio" && Array.isArray((mcp as any).args)) {
        const args: string[] = (mcp as any).args;
        const mcpMarker = /server[/\\]mcp-server[/\\]/;
        const remapped = args.map(arg => {
          // Remap stale absolute paths from old npx cache
          if (mcpMarker.test(arg) && !existsSync(arg)) {
            const m = arg.match(mcpMarker);
            if (m) {
              const candidate = join(packageRoot, arg.slice(m.index));
              if (existsSync(candidate)) {
                console.warn(`[config] Remapped stale MCP arg for "${name}" to current package`);
                return candidate;
              }
            }
          }
          // Normalize relative ./mcps/ paths to absolute
          if (/^\.?\/?(mcps[\\/])/.test(arg)) {
            const abs = join(packageRoot, arg.replace(/^\.\//, ""));
            return abs;
          }
          return arg;
        });
        (mcp as any).args = remapped;
      }
    }
  }

  // Normalize each agent's paths and ensure routes is always an array
  const agentIds = Object.keys(config.agents);
  for (const id of agentIds) {
    const agent = config.agents[id];
    // Routes are optional — agents without channel routes are still reachable via web UI
    if (!agent.routes) agent.routes = [];
    // Default optional string/array fields so downstream code never hits undefined
    if (!agent.description) agent.description = agent.name || id;
    if (!agent.mcps) agent.mcps = [];
    if (!agent.org) agent.org = [];
    if (!agent.workspace) {
      throw new Error(`Agent "${id}" must have a workspace path`);
    }
    if (!agent.claudeMd) {
      throw new Error(`Agent "${id}" must have a claudeMd path`);
    }

    // Resolve ~ in paths (works on macOS and Windows)
    const home = homedir();
    const resolveTilde = (p: string) =>
      p.startsWith("~") ? p.replace("~", home) : p;
    agent.workspace = resolveTilde(agent.workspace);
    if (agent.agentHome) {
      agent.agentHome = resolveTilde(agent.agentHome);
      // Auto-derive claudeMd and memoryDir from agentHome only if not explicitly set
      if (!agent.claudeMd) {
        agent.claudeMd = join(agent.agentHome, "CLAUDE.md");
      }
      if (!agent.memoryDir) {
        agent.memoryDir = join(agent.agentHome, "memory");
      }
    }
    agent.claudeMd = resolveTilde(agent.claudeMd);
    agent.memoryDir = resolveTilde(agent.memoryDir);
    // Derive agentHome from memoryDir if not set
    if (!agent.agentHome) {
      agent.agentHome = resolve(resolveTilde(agent.memoryDir), "..");
    }

    // Remap stale platform agent paths — if workspace/claudeMd point to a
    // non-existent path (e.g. old npx cache hash), re-anchor to current packageRoot.
    // This prevents crashes after cache clears without requiring a re-run of setup.
    if (agent.agentClass === "platform") {
      const platformMarker = /agents[/\\]platform[/\\]/;
      if (!existsSync(agent.claudeMd)) {
        const m = agent.claudeMd.match(platformMarker);
        if (m) {
          const relative = agent.claudeMd.slice(m.index);
          const candidate = join(packageRoot, relative);
          if (existsSync(candidate)) {
            console.warn(`[config] Remapped stale claudeMd for "${id}" to current package`);
            agent.claudeMd = candidate;
          }
        }
      }
      if (!existsSync(agent.workspace)) {
        agent.workspace = packageRoot;
        console.warn(`[config] Remapped stale workspace for "${id}" to current package`);
      }
    }

    // Validate MCP references — warn and strip missing MCPs instead of crashing
    if (agent.mcps && agent.mcps.length > 0) {
      if (!config.mcps || Object.keys(config.mcps).length === 0) {
        console.warn(`[config] Agent "${id}" references MCPs but no "mcps" registry is defined — stripping MCP list`);
        agent.mcps = [];
      } else {
        const valid: string[] = [];
        for (const mcpName of agent.mcps) {
          if (config.mcps[mcpName]) {
            valid.push(mcpName);
          } else {
            console.warn(`[config] Agent "${id}" references MCP "${mcpName}" which is not defined in config.mcps — skipping`);
          }
        }
        agent.mcps = valid;
      }
    }

    // Set defaults
    agent.autoCommit = agent.autoCommit ?? false;
    agent.autoCommitBranch = agent.autoCommitBranch ?? "main";
    agent.allowedTools = agent.allowedTools ?? ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
    agent.timeout = agent.timeout ?? 14_400_000;
  }

  // Validate MCP definitions — skip comment keys and entries with no type
  if (config.mcps) {
    for (const [mcpId, mcp] of Object.entries(config.mcps)) {
      // Skip JSON comment keys (e.g., "_comment_platform_mcps") and non-object values
      if (mcpId.startsWith("_") || !mcp || typeof mcp !== "object" || !mcp.type) {
        delete config.mcps[mcpId];
        continue;
      }
      if (mcp.type === "stdio") {
        if (!mcp.command) throw new Error(`MCP "${mcpId}" (stdio) must have a "command" field`);
      } else if (mcp.type === "http" || mcp.type === "sse" || mcp.type === "streamable-http") {
        if (!(mcp as McpServerHttp).url) throw new Error(`MCP "${mcpId}" (${mcp.type}) must have a "url" field`);
      } else {
        console.warn(`[config] MCP "${mcpId}" has unknown type "${(mcp as any).type}" — skipping`);
        delete config.mcps[mcpId];
      }
    }
  }

  // ─── Auto-inject bundled MCPs (ships with the repo under mcps/) ──────
  // Ensures existing users who update via git pull get new bundled MCPs
  // without manually editing config.json.  Only injects if not already present.
  const bundledMcps: Record<string, McpServerStdio> = {
    aiforone_computeruse: {
      type: "stdio",
      command: "node",
      args: [`${packageRoot}/mcps/aiforone_computeruse/server.js`],
    },
  };
  if (!config.mcps) config.mcps = {};
  for (const [id, def] of Object.entries(bundledMcps)) {
    if (!config.mcps[id]) {
      config.mcps[id] = def;
      console.log(`[config] Auto-registered bundled MCP: ${id}`);
    }
  }
  // Ensure bundled MCPs are in defaultMcps so every agent gets them
  if (!config.defaultMcps) config.defaultMcps = [];
  for (const id of Object.keys(bundledMcps)) {
    if (!config.defaultMcps.includes(id)) {
      config.defaultMcps.push(id);
      console.log(`[config] Auto-added bundled MCP to defaultMcps: ${id}`);
    }
  }
  // Validate defaultMcps — strip entries that don't exist in the registry
  config.defaultMcps = config.defaultMcps.filter(id => {
    if (!config.mcps![id]) {
      console.warn(`[config] defaultMcps references "${id}" which is not in mcps registry — skipping`);
      return false;
    }
    return true;
  });

  // Defaults
  config.service = config.service ?? { logLevel: "info" };
  config.service.logLevel = config.service.logLevel ?? "info";
  config.defaultAgent = config.defaultAgent ?? null;

  // ─── Migration: legacy auth.tokens[] → apiKeys[] ──────────────────
  // If this install has auth.tokens set but no apiKeys yet, synthesize an
  // apiKey entry for each legacy token so the new UI shows something useful.
  // The legacy tokens continue to work (matched by matchToken() fallback),
  // but now they have metadata.
  {
    const svc = config.service as any;
    const legacyTokens: string[] = Array.isArray(svc.auth?.tokens) ? svc.auth.tokens : [];
    const apiKeys = Array.isArray(svc.apiKeys) ? svc.apiKeys : [];
    if (legacyTokens.length > 0 && apiKeys.length === 0) {
      const now = new Date().toISOString();
      svc.apiKeys = legacyTokens.map((t: string, i: number) => ({
        id: i === 0 ? "key_legacy" : `key_legacy_${i}`,
        name: i === 0 ? "Legacy Token" : `Legacy Token ${i + 1}`,
        key: t,
        createdAt: now,
        scopes: ["*"],
      }));
      console.log(`[config] Migrated ${legacyTokens.length} legacy auth.tokens → apiKeys`);
    }
    if (!svc.apiKeys) svc.apiKeys = [];
    if (!svc.teamGateways) svc.teamGateways = [];
  }

  const home = homedir();
  // Drive root — MYAGENT_DATA_DIR override takes priority (Railway/Linux containers)
  const driveRoot = process.env.MYAGENT_DATA_DIR
    ? resolve(process.env.MYAGENT_DATA_DIR)
    : resolve(home, "Desktop", "MyAIforOne Drive Lite");

  // Resolve personalAgentsDir (expand ~)
  if (config.service.personalAgentsDir) {
    config.service.personalAgentsDir = config.service.personalAgentsDir.startsWith("~")
      ? config.service.personalAgentsDir.replace("~", home)
      : config.service.personalAgentsDir;
  }
  _personalAgentsDir = config.service.personalAgentsDir || resolve(driveRoot, "PersonalAgents");

  // Resolve personalRegistryDir (expand ~)
  if (config.service.personalRegistryDir) {
    config.service.personalRegistryDir = config.service.personalRegistryDir.startsWith("~")
      ? config.service.personalRegistryDir.replace("~", home)
      : config.service.personalRegistryDir;
  }
  _personalRegistryDir = config.service.personalRegistryDir || resolve(driveRoot, "PersonalRegistry");

  // Inject default account hint into claudeAccounts map so executor can pick it up
  if (config.service.defaultClaudeAccount && config.service.claudeAccounts) {
    (config.service.claudeAccounts as any)._defaultAccount = config.service.defaultClaudeAccount;
  }

  return config;
}

/** Resolved PersonalAgents directory — set during config loading, used by executor and keystore */
let _personalAgentsDir: string | null = null;
/** Resolved PersonalRegistry directory — set during config loading, used by web-ui */
let _personalRegistryDir: string | null = null;

/** Resolve the PersonalAgents directory from config, falling back to ~/Desktop/MyAIforOne Drive/PersonalAgents */
function _driveRoot(): string {
  return process.env.MYAGENT_DATA_DIR
    ? resolve(process.env.MYAGENT_DATA_DIR)
    : resolve(homedir(), "Desktop", "MyAIforOne Drive Lite");
}

export function getPersonalAgentsDir(config?: AppConfig): string {
  if (_personalAgentsDir) return _personalAgentsDir;
  const driveRoot = _driveRoot();
  if (config) return config.service.personalAgentsDir || resolve(driveRoot, "PersonalAgents");
  return resolve(driveRoot, "PersonalAgents");
}

/** Resolve the PersonalRegistry directory from config, falling back to ~/Desktop/MyAIforOne Drive/PersonalRegistry */
export function getPersonalRegistryDir(config?: AppConfig): string {
  if (_personalRegistryDir) return _personalRegistryDir;
  const driveRoot = _driveRoot();
  if (config) return config.service.personalRegistryDir || resolve(driveRoot, "PersonalRegistry");
  return resolve(driveRoot, "PersonalRegistry");
}

/**
 * Resolve the SharedAgents directory.
 * Defaults to ~/Desktop/MyAIforOne Drive/SharedAgents (sibling of PersonalAgents).
 * Can be overridden via service.sharedAgentsDir in config.
 */
export function getSharedAgentsDir(config?: AppConfig): string {
  const driveRoot = _driveRoot();
  if (config) return (config.service as any).sharedAgentsDir || resolve(driveRoot, "SharedAgents");
  return resolve(driveRoot, "SharedAgents");
}
