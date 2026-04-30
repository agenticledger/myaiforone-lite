import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
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
const baseDir = resolve(__dirname, "..");

// dataDir: where config.json lives. Resolved in priority order:
// 1. MYAGENT_DATA_DIR env var (set by CLI spawn or user override)
// 2. %APPDATA%\MyAIforOneGateway on Windows, ~/.myaiforone on Mac/Linux
// 3. Legacy: Desktop/MyAIforOne Platform (previous location, kept for migration)
// 4. baseDir/package root (dev/cloned-repo fallback)
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
  return baseDir;
}
const dataDir = resolveDataDir();

async function main(): Promise<void> {
  const configPath = resolve(dataDir, "config.json");

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
