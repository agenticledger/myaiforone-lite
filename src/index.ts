import { resolve, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { configureLogger, log } from "./logger.js";
import { executeAgent, setAppConfig, initEncryptionSecret } from "./executor.js";
import { getEncryptionSecret } from "./os-keychain.js";
import { migrateAllPlaintextKeys } from "./keystore.js";
import { startWebUI } from "./web-ui.js";
import { attachMcpHttp } from "./mcp-http.js";
import { startCronJobs, stopCronJobs } from "./cron.js";
import { startGoals, stopGoals } from "./goals.js";
import { startWikiSync, stopWikiSync } from "./wiki-sync.js";
import { verifyLicense } from "./license.js";
import type { ChannelDriver, InboundMessage } from "./channels/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Strip Windows \\?\ long-path prefix — it breaks child process spawning
// (Claude CLI can't launch MCP servers when paths carry this prefix).
function stripLongPathPrefix(s: string): string {
  return s.startsWith("\\\\?\\") ? s.slice(4) : s;
}
if (process.env.TAURI_RESOURCE_DIR) {
  process.env.TAURI_RESOURCE_DIR = stripLongPathPrefix(process.env.TAURI_RESOURCE_DIR);
}
if (process.env.MYAGENT_DATA_DIR) {
  process.env.MYAGENT_DATA_DIR = stripLongPathPrefix(process.env.MYAGENT_DATA_DIR);
}

// In Tauri/pkg builds, __dirname points to a read-only snapshot path.
// Use TAURI_RESOURCE_DIR instead so reads find bundled resources (agents, registry, etc.)
const baseDir = process.env.TAURI_RESOURCE_DIR || resolve(__dirname, "..");

// dataDir: where config.json lives. Resolved in priority order:
// 1. MYAGENT_DATA_DIR env var (set by CLI spawn or user override)
// 2. %APPDATA%\MyAIforOneGateway on Windows, ~/.myaiforone on Mac/Linux
// 3. Legacy: Desktop/MyAIforOne Platform (previous location, kept for migration)
// 4. baseDir/package root (dev/cloned-repo fallback)
// 5. Primary dir bootstrapped with defaults (first-run / fresh install)
function resolveDataDir(): string {
  if (process.env.MYAGENT_DATA_DIR) return process.env.MYAGENT_DATA_DIR;
  const home = homedir();
  const isWin = process.platform === "win32";
  const appData = isWin ? (process.env.APPDATA || join(home, "AppData", "Roaming")) : home;
  const primary = isWin ? join(appData, "MyAIforOneGateway") : join(home, ".myaiforone");
  if (existsSync(join(primary, "config.json"))) return primary;
  // Legacy Desktop location — kept for backward compat
  const legacy = join(home, "Desktop", "MyAIforOne Platform");
  if (existsSync(join(legacy, "config.json"))) return legacy;
  // Dev/repo fallback — config.json at package root (cloned repo)
  if (existsSync(join(baseDir, "config.json"))) return baseDir;
  // First-run: no config found anywhere — use primary dir (will be bootstrapped)
  return primary;
}

/** Write a minimal default config on first run so the server can start and the UI shows setup. */
function bootstrapConfigIfMissing(configPath: string): void {
  if (existsSync(configPath)) return;
  const dir = resolve(configPath, "..");
  mkdirSync(dir, { recursive: true });
  // In Tauri builds, agents/ is a bundled resource (read-only on macOS).
  // CLAUDE.md and skills live there. But memoryDir must be writable (sessions,
  // logs, etc.) — so it goes in the data dir alongside config.json.
  const agentRes = process.env.TAURI_RESOURCE_DIR
    ? join(process.env.TAURI_RESOURCE_DIR, "agents")
    : join(baseDir, "agents");
  const agentData = join(dir, "agents", "hub-lite");
  mkdirSync(agentData, { recursive: true });
  const defaultConfig = {
    service: {
      logLevel: "info",
      edition: "lite",
      webUI: { enabled: true, port: 4889 },
      voiceModeEnabled: false,
      labEnabled: false,
      licenseKey: "",
      auth: { enabled: false },
    },
    channels: {},
    agents: {
      "hub-lite": {
        name: "Hub",
        description: "Browse and install agents from the MyAIforOne registry. Ask me to find agents for any task.",
        agentHome: join(agentRes, "hub-lite"),
        claudeMd: join(agentRes, "hub-lite", "CLAUDE.md"),
        memoryDir: agentData,
        mentionAliases: ["@hub", "@store", "@install"],
        workspace: homedir(),
        allowedTools: ["Read", "Glob", "Grep", "Bash", "WebFetch"],
        mcps: ["myaiforone-lite"],
        agentSkills: ["install-agent"],
        persistent: true,
        streaming: true,
        autoCommit: false,
        autoCommitBranch: "",
        routes: [],
        avatar: "avatar-12",
      },
      ...(() => {
        const creatorMeta: Record<string, { name: string; desc: string; alias: string[]; avatar: string }> = {
          "agentcreator":  { name: "Agent Creator",  desc: "Creates new AI agents through conversation",   alias: ["@agentcreator"],  avatar: "avatar-70" },
          "skillcreator":  { name: "Skill Creator",  desc: "Creates reusable skills through conversation", alias: ["@skillcreator"],  avatar: "avatar-71" },
          "appcreator":    { name: "App Creator",    desc: "Builds web applications through conversation", alias: ["@appcreator"],    avatar: "avatar-72" },
          "promptcreator": { name: "Prompt Creator", desc: "Creates reusable prompt templates",            alias: ["@promptcreator"], avatar: "avatar-73" },
        };
        const creators: Record<string, any> = {};
        for (const [id, meta] of Object.entries(creatorMeta)) {
          const creatorData = join(dir, "agents", id);
          mkdirSync(creatorData, { recursive: true });
          creators[id] = {
            name: meta.name,
            description: meta.desc,
            agentHome: join(agentRes, id),
            claudeMd: join(agentRes, id, "CLAUDE.md"),
            memoryDir: creatorData,
            mentionAliases: meta.alias,
            workspace: homedir(),
            allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
            mcps: ["myaiforone-lite"],
            persistent: true,
            streaming: true,
            autoCommit: false,
            autoCommitBranch: "",
            routes: [],
            agentClass: "platform",
            avatar: meta.avatar,
          };
        }
        return creators;
      })(),
    },
    mcps: {
      "myaiforone-lite": {
        type: "stdio",
        command: "node",
        args: [process.env.TAURI_RESOURCE_DIR
          ? join(process.env.TAURI_RESOURCE_DIR, "mcp-lite.cjs")
          : join(baseDir, "server", "mcp-server-lite", "dist", "index.js")],
      },
      "aigym-finance": {
        type: "http",
        url: "https://finance.aigym.studio/mcp",
      },
      "myaiforone-registry": {
        type: "http",
        url: "https://myaiforone.com/mcp/registry",
      },
    },
    defaultAgent: "hub-lite",
    defaultSkills: [],
    defaultMcps: ["myaiforone-lite", "aigym-finance", "myaiforone-registry"],
    defaultPrompts: [],
    promptTrigger: "!",
  };
  writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
  console.log(`[bootstrap] Created default config at ${configPath}`);
}

/** Create the Drive folder structure so it exists before the user creates any agents. */
function ensureDriveFolders(): void {
  const driveRoot = resolve(homedir(), "Desktop", "MyAIforOne Drive Lite");
  console.log(`[drive] Creating Drive at: ${driveRoot}`);
  for (const sub of ["PersonalAgents", "PersonalRegistry"]) {
    const p = join(driveRoot, sub);
    mkdirSync(p, { recursive: true });
    console.log(`[drive] Ensured: ${p}`);
  }
}

const dataDir = resolveDataDir();

async function main(): Promise<void> {
  const configPath = resolve(dataDir, "config.json");

  bootstrapConfigIfMissing(configPath);

  // Migrate: if hub-lite memoryDir is in the resource dir (read-only on macOS),
  // move it to the writable data dir. This fixes configs from v0.2.2 and earlier.
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const hub = raw.agents?.["hub-lite"];
    if (hub?.memoryDir && process.env.TAURI_RESOURCE_DIR && hub.memoryDir.includes(process.env.TAURI_RESOURCE_DIR)) {
      const newMemDir = join(dataDir, "agents", "hub-lite");
      mkdirSync(newMemDir, { recursive: true });
      hub.memoryDir = newMemDir;
      writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
      console.log(`[migrate] Moved hub-lite memoryDir to writable data dir: ${newMemDir}`);
    }
  } catch { /* ignore migration errors */ }

  // Migrate: ensure myaiforone-lite MCP is registered in config.json
  // Older bootstraps wrote mcps:{} — the MCP must be in the file for visibility.
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    let changed = false;
    if (!raw.mcps) raw.mcps = {};
    if (!raw.mcps["myaiforone-lite"]) {
      const mcpScript = process.env.TAURI_RESOURCE_DIR
        ? join(process.env.TAURI_RESOURCE_DIR, "mcp-lite.cjs")
        : join(baseDir, "server", "mcp-server-lite", "dist", "index.js");
      raw.mcps["myaiforone-lite"] = { type: "stdio", command: "node", args: [mcpScript] };
      changed = true;
      console.log(`[migrate] Added myaiforone-lite MCP to config`);
    }
    if (!raw.defaultMcps) raw.defaultMcps = [];
    if (!raw.defaultMcps.includes("myaiforone-lite")) {
      raw.defaultMcps.push("myaiforone-lite");
      changed = true;
      console.log(`[migrate] Added myaiforone-lite to defaultMcps`);
    }
    if (!raw.mcps["aigym-finance"]) {
      raw.mcps["aigym-finance"] = { type: "http", url: "https://finance.aigym.studio/mcp" };
      changed = true;
      console.log(`[migrate] Added aigym-finance MCP to config`);
    }
    if (!raw.defaultMcps.includes("aigym-finance")) {
      raw.defaultMcps.push("aigym-finance");
      changed = true;
      console.log(`[migrate] Added aigym-finance to defaultMcps`);
    }
    if (!raw.mcps["myaiforone-registry"]) {
      raw.mcps["myaiforone-registry"] = { type: "http", url: "https://myaiforone.com/mcp/registry" };
      changed = true;
      console.log(`[migrate] Added myaiforone-registry MCP to config`);
    }
    if (!raw.defaultMcps.includes("myaiforone-registry")) {
      raw.defaultMcps.push("myaiforone-registry");
      changed = true;
      console.log(`[migrate] Added myaiforone-registry to defaultMcps`);
    }
    if (changed) writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
  } catch { /* ignore migration errors */ }

  // Migrate: ensure Lab creator agents are registered in config.json
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    let changed = false;
    if (!raw.agents) raw.agents = {};
    const agentRes = process.env.TAURI_RESOURCE_DIR
      ? join(process.env.TAURI_RESOURCE_DIR, "agents")
      : join(baseDir, "agents");
    const creatorDefs: Record<string, { name: string; desc: string; alias: string[]; avatar: string }> = {
      "agentcreator":  { name: "Agent Creator",  desc: "Creates new AI agents through conversation",   alias: ["@agentcreator"],  avatar: "avatar-70" },
      "skillcreator":  { name: "Skill Creator",  desc: "Creates reusable skills through conversation", alias: ["@skillcreator"],  avatar: "avatar-71" },
      "appcreator":    { name: "App Creator",    desc: "Builds web applications through conversation", alias: ["@appcreator"],    avatar: "avatar-72" },
      "promptcreator": { name: "Prompt Creator", desc: "Creates reusable prompt templates",            alias: ["@promptcreator"], avatar: "avatar-73" },
    };
    for (const [id, meta] of Object.entries(creatorDefs)) {
      if (!raw.agents[id]) {
        const creatorData = join(dataDir, "agents", id);
        mkdirSync(creatorData, { recursive: true });
        raw.agents[id] = {
          name: meta.name,
          description: meta.desc,
          agentHome: join(agentRes, id),
          claudeMd: join(agentRes, id, "CLAUDE.md"),
          memoryDir: creatorData,
          mentionAliases: meta.alias,
          workspace: homedir(),
          allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
          mcps: ["myaiforone-lite"],
          persistent: true,
          streaming: true,
          autoCommit: false,
          autoCommitBranch: "",
          routes: [],
          agentClass: "platform",
          avatar: meta.avatar,
        };
        changed = true;
        console.log(`[migrate] Added Lab creator agent: ${id}`);
      }
    }
    if (changed) writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
  } catch { /* ignore migration errors */ }

  ensureDriveFolders();
  const config = loadConfig(configPath);
  setAppConfig(config);

  configureLogger(config.service.logLevel, config.service.logFile);

  // Initialize encryption — resolves keychain secret before any MCP keys are loaded
  initEncryptionSecret();

  // Auto-migrate plaintext keys to encrypted on first run
  try {
    const secret = getEncryptionSecret();
    const migrated = migrateAllPlaintextKeys(dataDir, secret);
    if (migrated > 0) {
      console.log(`[Keystore] Auto-encrypted ${migrated} plaintext key files`);
    }
  } catch (err) {
    console.warn("[Keystore] Auto-migration skipped:", err);
  }

  log.info("MyAIforOne Lite starting...");

  // ─── License verification (non-blocking — UI always starts) ────────
  const license = await verifyLicense(config.service.licenseKey, config.service.licenseUrl);
  if (config.service.licenseKey && !license.valid) {
    log.warn(`License invalid: ${license.error || "expired or revoked"}. Agents will be blocked until a valid license is entered in Admin → Settings.`);
  }

  const driverMap = new Map<string, ChannelDriver>();

  // ─── Web UI + MCP HTTP ─────────────────────────────────────────────
  const webUI = config.service.webUI;
  let cronMessageHandler: (agentId: string, message: string, channel: string, chatId: string) => Promise<void>;

  if (webUI?.enabled) {
    const webUIPort = process.env.PORT ? Number(process.env.PORT) : (webUI.port || 8080);
    startWebUI({
      config,
      baseDir,
      dataDir,
      port: webUIPort,
      webhookSecret: webUI.webhookSecret,
      driverMap,
      onWebhookMessage: async (agentId, text, channel, chatId) => {
        if (cronMessageHandler) await cronMessageHandler(agentId, text, channel, chatId);
      },
      attachExtraRoutes: (app) => {
        attachMcpHttp(app, { config, baseDir, port: webUIPort });
      },
    });
  }

  // ─── Cron jobs ─────────────────────────────────────────────────────
  cronMessageHandler = async (agentId: string, message: string, channel: string, chatId: string) => {
    const agent = config.agents[agentId];
    if (!agent) return;

    // Build a synthetic inbound message for the executor
    const syntheticMsg: InboundMessage = {
      id: `cron-${Date.now()}`,
      channel,
      chatId,
      chatType: "group",
      sender: "cron",
      senderName: "Scheduled Task",
      text: message,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: true,
      raw: { type: "cron" },
    };

    const route = { agentId, agentConfig: agent, route: agent.routes[0] };
    const response = await executeAgent(route, syntheticMsg, baseDir, config.mcps, config.service.claudeAccounts, { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger });
    log.info(`Cron ${agentId} completed: ${response.slice(0, 120)}`);
  };

  startCronJobs(config, cronMessageHandler);

  // ─── Autonomous Goals ──────────────────────────────────────────────
  startGoals(config, driverMap, baseDir, config.mcps);

  // ─── Wiki Sync ─────────────────────────────────────────────────────
  startWikiSync(config, baseDir, config.mcps);

  const agentCount = Object.keys(config.agents).length;
  log.info(
    `MyAIforOne Lite running — ${agentCount} agent(s), web-UI only (no channel drivers)`
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    stopCronJobs();
    stopGoals();
    stopWikiSync();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
