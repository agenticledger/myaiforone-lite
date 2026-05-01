import express from "express";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, unlinkSync, chmodSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, dirname, extname, relative, isAbsolute } from "node:path";
import { execSync, spawn as cpSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import { getPersonalAgentsDir, getPersonalRegistryDir, getSharedAgentsDir, isServerMode } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./channels/types.js";
import { executeAgent, executeAgentStreaming } from "./executor.js";
import { getEncryptionSecret } from "./os-keychain.js";
import { encryptAuto, decryptAuto } from "./keystore.js";
import { executeGoal } from "./goals.js";
import type { McpServerConfig } from "./config.js";
import { log } from "./logger.js";
import { isSharedAgentsAllowed } from "./license.js";
import { buildVoiceRegistry, type VoiceRegistry } from "./voice/registry.js";

interface WebUIOptions {
  config: AppConfig;
  baseDir: string;
  dataDir?: string; // where config.json lives (defaults to baseDir)
  port: number;
  webhookSecret?: string;
  onWebhookMessage?: (agentId: string, text: string, channel: string, chatId: string) => Promise<void>;
  driverMap?: Map<string, import("./channels/types.js").ChannelDriver>;
  /**
   * Optional hook invoked just before app.listen() so callers can attach
   * additional routes (e.g. the /mcp Streamable HTTP endpoint) to the same
   * Express app / port.
   */
  attachExtraRoutes?: (app: import("express").Express) => void;
}

// ─── Job Store (event buffer for reconnectable streaming) ────────────
interface StreamJob {
  events: Array<{ idx: number; data: string }>;
  rawLines: string[]; // raw stdout/stderr lines (unparsed)
  rawListeners: Set<(idx: number) => void>;
  done: boolean;
  stopped: boolean;
  createdAt: number;
  listeners: Set<(idx: number) => void>; // notify waiting SSE connections
  abort?: AbortController; // used to kill the child process on Stop
}
const jobStore = new Map<string, StreamJob>();
// Track last-used Claude account per agent (for web UI dropdown switching)
const agentLastAccount = new Map<string, string>();

// Cleanup stale jobs every 60s (keep for 10 min after done)
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [id, job] of jobStore) {
    if (job.done && job.createdAt < cutoff) jobStore.delete(id);
  }
}, 60_000);

export function startWebUI(opts: WebUIOptions): void {
  const app = express();
  app.use(express.json());

  const configFilePath = () => join(opts.dataDir || opts.baseDir, "config.json");

  // ─── Serve static assets (SVGs, images, etc.) from public/ ─────
  const publicDir = join(opts.baseDir, "public");
  app.use(express.static(publicDir, {
    maxAge: "1h",
    index: false,
    extensions: ["svg", "png", "ico", "jpg", "jpeg", "gif", "webp", "js", "css"],
  }));

  // Helper: serve an HTML page from public/ using readFileSync + res.send
  // Bypasses Express 5 send module's realpath resolution which fails on
  // macOS npx cache symlinked paths. HTML files are small enough that
  // readFileSync has no meaningful performance impact.
  const servePage = (res: any, filename: string, fallback: string | null = null) => {
    const filePath = join(publicDir, filename);
    if (existsSync(filePath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      try {
        let content = readFileSync(filePath, "utf8");
        // Inject Work/AI Gym nav toggle on pages with a topbar (skip home2, gym, mini, docs)
        const skipToggle = ["home2.html", "gym.html", "mini.html", "mcp-docs.html", "api-docs.html"];
        if (!skipToggle.includes(filename) && content.includes('class="topbar"')) {
          content = content.replace("</body>", '<script src="/nav-toggle.js"></script></body>');
        }
        res.type("html").send(content);
      } catch {
        if (!res.headersSent) {
          if (fallback) res.redirect(fallback);
          else res.status(404).send(`${filename} not found.`);
        }
      }
    } else if (fallback) {
      res.redirect(fallback);
    } else {
      res.status(404).send(`${filename} not found.`);
    }
  };

  // ─── Serve pages from public/ ─────────────────────────────────────
  const serverMode = isServerMode();
  const serveHome = (_req: any, res: any) => servePage(res, "home2.html", "/org");
  app.get("/", (_req: any, res: any) => servePage(res, "index.html"));
  app.get("/ui", (_req, res) => servePage(res, "index.html"));

  // ─── Auth System — API Keys ──────────────────────────────────────────
  // Auth is only active when service.auth.enabled is true (default: false).
  // When disabled, all API routes are open — personal gateway behavior unchanged.
  //
  // v1: API keys with "*" scope (full access). Scoped keys are a future enhancement.
  // Legacy auth.tokens[] still work for backcompat; they're auto-migrated to apiKeys
  // on first successful match so existing deployments keep working.

  function getAuthConfig() {
    return (opts.config.service as any).auth as { enabled?: boolean; tokens?: string[]; webPassword?: string } | undefined;
  }

  function getApiKeys(): import("./config.js").ApiKey[] {
    return ((opts.config.service as any).apiKeys as import("./config.js").ApiKey[]) || [];
  }

  // Generate a new API key secret — prefixed for recognizability.
  function generateApiKeySecret(): string {
    return "mai41team_" + randomBytes(32).toString("hex");
  }

  // Short opaque id used to reference a key in URLs (never the secret itself).
  function generateApiKeyId(): string {
    return "key_" + randomBytes(6).toString("hex");
  }

  // Show only the first 14 + last 4 chars of the key in list responses
  function previewKey(key: string): string {
    if (!key || key.length < 20) return key;
    return `${key.slice(0, 14)}...${key.slice(-4)}`;
  }

  // Persist the current in-memory config to disk.
  function saveConfigToDisk(): void {
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.apiKeys = (opts.config.service as any).apiKeys || [];
      rawConfig.service.teamGateways = (opts.config.service as any).teamGateways || [];
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      log.warn(`Failed to persist config changes: ${err}`);
    }
  }

  // Match a bearer token against apiKeys[] (preferred) or legacy auth.tokens[].
  // Returns the matching ApiKey record if any, else null.
  function matchToken(token: string | null): import("./config.js").ApiKey | null {
    if (!token) return null;
    const keys = getApiKeys();
    for (const k of keys) {
      if (k.key === token) return k;
    }
    // Legacy fallback: auth.tokens[] (pre-apiKeys installations)
    const authCfg = getAuthConfig();
    if (authCfg?.tokens?.includes(token)) {
      // Synthesize a virtual ApiKey record so callers still get a reference
      return { id: "legacy", name: "Legacy Token", key: token, createdAt: new Date(0).toISOString(), scopes: ["*"] };
    }
    return null;
  }

  function authMiddleware(req: any, res: any, next: any) {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return next(); // auth disabled — open access (default)
    // Skip auth for login and status endpoints themselves
    if (req.path === "/auth/login" || req.path === "/auth/status") return next();
    // Check Bearer token in Authorization header
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const matched = matchToken(token);
    if (matched) {
      // Stamp lastUsedAt on real API keys (skip the synthesized legacy record)
      if (matched.id !== "legacy") {
        matched.lastUsedAt = new Date().toISOString();
      }
      (req as any).apiKey = matched;
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Apply auth middleware to all /api/* routes
  app.use("/api", authMiddleware);

  // Role-based access: "read" keys can only GET (browse). Blocked from mutations + chat.
  // Paths that read-only keys ARE allowed: GET on any endpoint, plus auth endpoints.
  function requireFullAccess(req: any, res: any, next: any) {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return next(); // auth disabled — no restrictions
    const apiKey = (req as any).apiKey as import("./config.js").ApiKey | undefined;
    if (!apiKey) return next(); // no key (handled by authMiddleware already)
    if ((apiKey.role || "full") === "read") {
      return res.status(403).json({ error: "Read-only access — this action requires a full-access key" });
    }
    return next();
  }

  // Apply write protection: POST/PUT/PATCH/DELETE on /api/* require full role,
  // except auth endpoints (login, status) which are always open.
  app.use("/api", (req: any, res: any, next: any) => {
    // Allow all GET/HEAD/OPTIONS requests (browsing)
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // Allow auth endpoints (login needs POST)
    if (req.path.startsWith("/auth/")) return next();
    // Everything else requires full access
    return requireFullAccess(req, res, next);
  });

  // POST /api/auth/login — accepts password, returns a Bearer API key
  app.post("/api/auth/login", (req, res) => {
    const authCfg = getAuthConfig();
    if (!authCfg?.enabled) return res.json({ ok: true, token: null, authEnabled: false, role: "full" });
    const { password } = req.body as any;
    if (!authCfg.webPassword || password !== authCfg.webPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }
    // Prefer the first apiKey; fall back to legacy auth.tokens[0]
    const keys = getApiKeys();
    const firstKey = keys[0];
    const token = firstKey?.key || authCfg.tokens?.[0];
    if (!token) return res.status(500).json({ error: "No API key configured" });
    return res.json({ ok: true, token, role: firstKey?.role || "full" });
  });

  // GET /api/auth/status — returns auth state (used by web UI on page load)
  app.get("/api/auth/status", (req, res) => {
    const authCfg = getAuthConfig();
    const authEnabled = !!(authCfg?.enabled);
    if (!authEnabled) return res.json({ authEnabled: false, authenticated: true, role: "full" });
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const matched = matchToken(token);
    if (!matched) return res.json({ authEnabled: true, authenticated: false });
    return res.json({ authEnabled: true, authenticated: true, role: matched.role || "full", email: matched.email || null });
  });

  // Guard: /api/auth/keys/* is the issuance surface — meaningful only when this
  // install is acting as a shared gateway. Mirror the UI gating on the backend
  // so a curl-wielding client can't sidestep the toggle.
  function requireSharedAgents(_req: any, res: any, next: any) {
    // Server mode (Railway/container) is always a shared gateway.
    const enabled = isServerMode() || !!((opts.config.service as any).sharedAgentsEnabled);
    if (!enabled) {
      return res.status(403).json({ error: "Shared Agents feature is disabled" });
    }
    next();
  }
  // ─── API: Open folder in Finder / Explorer ─────────────────────────
  app.post("/api/open-folder", (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath || typeof filePath !== "string") return res.status(400).json({ error: "path required" });
    const resolved = resolve(filePath.replace(/^~/, homedir()));
    try {
      const target = existsSync(resolved) && statSync(resolved).isDirectory() ? resolved : dirname(resolved);
      if (!existsSync(target)) return res.status(404).json({ error: "path not found" });
      if (process.platform === "darwin") execSync(`open "${target}"`);
      else if (process.platform === "win32") execSync(`explorer "${target}"`);
      else execSync(`xdg-open "${target}"`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/whoami/:agentId", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    const home = homedir();
    const accountName = agent?.claudeAccount || "default";
    let resolvedPath = "";
    if (agent?.claudeAccount && opts.config.service.claudeAccounts?.[agent.claudeAccount]) {
      resolvedPath = opts.config.service.claudeAccounts[agent.claudeAccount].replace(/^~/, home);
    } else {
      // Default account — try "main" first, then ~/.claude
      const mainPath = opts.config.service.claudeAccounts?.["main"];
      resolvedPath = mainPath ? mainPath.replace(/^~/, home) : join(home, ".claude");
    }
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && k !== "CLAUDECODE" && k !== "CLAUDE_CODE_ENTRYPOINT" && k !== "CLAUDE_CONFIG_DIR") env[k] = v;
      }
      // Only set CLAUDE_CONFIG_DIR for non-default accounts — setting it to ~/.claude breaks auth status
      if (agent?.claudeAccount && opts.config.service.claudeAccounts?.[agent.claudeAccount]) {
        env.CLAUDE_CONFIG_DIR = resolvedPath;
      }
      let raw = "";
      try { raw = execSync("claude auth status 2>&1", { env, timeout: 10_000 }).toString().trim(); } catch (e: any) {
        // execSync throws on non-zero exit — but claude auth status outputs JSON to stderr on failure
        raw = e.stdout?.toString().trim() || e.stderr?.toString().trim() || "";
      }
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
      log.info(`[whoami] ${agentId} → account=${accountName} email=${parsed.email || "unknown"} plan=${parsed.subscriptionType || "unknown"}`);
      res.json({ accountName, configDir: resolvedPath, checkedAt: new Date().toISOString(), ...parsed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Service settings (read/write top-level service fields) ──
  app.get("/api/config/service", (_req, res) => {
    const s = opts.config.service || {};
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const deploy = raw.deployment || {};
    // Deployment mode: "server" on Railway/container, "local" otherwise.
    const deploymentMode = isServerMode() ? "server" : "local";
    // On server mode, sharedAgentsEnabled is always true by definition — the
    // server IS a shared gateway regardless of what config.json says.
    const sharedAgentsEnabled = deploymentMode === "server"
      ? true
      : (s as any).sharedAgentsEnabled ?? false;
    res.json({
      deploymentMode,
      personalAgentsDir: (s as any).personalAgentsDir || "~/Desktop/MyAIforOne Drive Lite/PersonalAgents",
      personalRegistryDir: (s as any).personalRegistryDir || "~/Desktop/MyAIforOne Drive Lite/PersonalRegistry",
      webUIPort: (s as any).webUI?.port || 4889,
      webUIEnabled: (s as any).webUI?.enabled ?? true,
      webhookSecret: (s as any).webUI?.webhookSecret ? "(set)" : null,
      logLevel: (s as any).logLevel || "info",
      logFile: (s as any).logFile || null,
      pairingCode: (s as any).pairingCode ? "(set)" : null,
      deployment: {
        provider: deploy.provider || "railway",
        deployToken: deploy.deployToken ? "••••••••" : "",
        githubOrg: deploy.githubOrg || "",
        githubToken: deploy.githubToken ? "••••••••" : "",
      },
      defaultClaudeAccount: (s as any).defaultClaudeAccount || null,
      multiModelEnabled: (s as any).multiModelEnabled ?? false,
      platformDefaultExecutor: (s as any).platformDefaultExecutor || "claude",
      ollamaBaseUrl: (s as any).ollamaBaseUrl || "http://localhost:11434",
      providerKeys: Object.fromEntries(
        Object.entries((s as any).providerKeys || {}).map(([k, v]) => [k, v ? "••••••••" : ""])
      ),
      gymEnabled: (s as any).gymEnabled ?? false,
      aibriefingEnabled: (s as any).aibriefingEnabled ?? false,
      gymOnlyMode: (s as any).gymOnlyMode ?? false,
      sharedAgentsEnabled,
      voiceModeEnabled: (s as any).voiceModeEnabled ?? false,
      platformDefaultVoice: (s as any).platformDefaultVoice || "browser",
      voiceAutoPlay: (s as any).voiceAutoPlay ?? false,
      voiceMaxChars: (s as any).voiceMaxChars ?? 2000,
      licenseKey: (s as any).licenseKey ? `${(s as any).licenseKey.slice(0, 20)}...` : "",
      licenseUrl: (s as any).licenseUrl || "https://ai41license.agenticledger.ai",
    });
  });

  // ─── API: First-run onboarding — save Anthropic API key ─────────────
  // Called by the onboarding wizard on first launch.
  // Stores the key as service.anthropicApiKey in config.json and sets it
  // as the ANTHROPIC_API_KEY environment variable for the current process
  // so the executor picks it up immediately (no restart needed).
  app.post("/api/config/anthropic-key", (req, res) => {
    try {
      const { key } = req.body as { key?: string };
      if (!key || !key.startsWith("sk-ant-")) {
        return res.status(400).json({ error: "Invalid Anthropic API key — must start with sk-ant-" });
      }
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.anthropicApiKey = key;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
      // Also update in-memory config and process env so it takes effect immediately
      (opts.config.service as any).anthropicApiKey = key;
      process.env.ANTHROPIC_API_KEY = key;
      log.info("[Onboarding] Anthropic API key saved");
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Upgrade Lite → Pro ──────────────────────────────────────
  // Called by the hub-lite agent or the "Upgrade to Full" sidebar link.
  // Changes service.edition to "pro", removes the agent cap, and swaps
  // the lite MCP server path for the full one in config.json.
  app.post("/api/upgrade", (req, res) => {
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      const currentEdition = rawConfig.service?.edition || "lite";
      if (currentEdition === "pro") {
        return res.status(400).json({ success: false, error: "Already on Pro edition" });
      }

      const { licenseKey } = req.body as { licenseKey?: string };

      if (!rawConfig.service) rawConfig.service = {};
      rawConfig.service.edition = "pro";
      rawConfig.service.maxAgents = 0; // unlimited

      // Swap lite MCP → full MCP if present
      if (rawConfig.mcps && rawConfig.mcps["myaiforone-lite"]) {
        const liteMcp = rawConfig.mcps["myaiforone-lite"];
        if (liteMcp.args && Array.isArray(liteMcp.args)) {
          liteMcp.args = liteMcp.args.map((arg: string) =>
            arg.replace(/server\/mcp-server-lite\/dist\/index\.js/, "server/mcp-server/dist/index.js")
          );
        }
        rawConfig.mcps["myaiforone-local"] = liteMcp;
        delete rawConfig.mcps["myaiforone-lite"];
      }

      if (licenseKey) rawConfig.service.licenseKey = licenseKey;

      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
      log.info("[Upgrade] Edition upgraded to Pro");
      return res.json({ success: true, edition: "pro", message: "Upgraded to Pro. Restart the app to apply all changes." });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // Proxy for Ollama API (avoids CORS when browser fetches model list)
  // ─── API: Voice Mode (TTS + STT) ─────────────────────────────────────
  // See docs/voice-mode-plan.md

  const voiceRegistry: VoiceRegistry = buildVoiceRegistry(opts.config);

  // Snapshot of current voice config + provider/voice catalog for UI rendering.
  app.get("/api/voice-config", (_req, res) => {
    res.json(voiceRegistry.snapshot());
  });

  // Voices for a specific provider (or for the agent's resolved provider).
  app.get("/api/voices", (req, res) => {
    const providerId = (req.query.provider as string | undefined) || undefined;
    const agentId = (req.query.agentId as string | undefined) || undefined;
    if (providerId) {
      const p = voiceRegistry.get(providerId);
      if (!p) return res.status(404).json({ error: `Unknown provider: ${providerId}` });
      return res.json({ provider: p.id, name: p.name, serverSide: p.serverSide, configured: p.isConfigured(), voices: p.listVoices() });
    }
    const { provider, voiceId } = voiceRegistry.resolve(agentId);
    res.json({
      provider: provider.id,
      name: provider.name,
      serverSide: provider.serverSide,
      configured: provider.isConfigured(),
      effectiveVoiceId: voiceId || provider.defaultVoice(),
      voices: provider.listVoices(),
    });
  });

  // Synthesize speech for an agent's reply.
  // Body: { text: string, agentId?: string, providerOverride?: string }
  // Returns: audio/mpeg bytes, OR { clientSide: true, provider: "browser" } when the
  // resolved provider is the browser provider (client should use Web Speech API).
  app.post("/api/tts", async (req, res) => {
    try {
      if (!(opts.config.service as any).voiceModeEnabled) {
        return res.status(403).json({ error: "Voice mode is disabled" });
      }
      const { text, agentId, providerOverride, voiceOverride } = req.body as {
        text?: string; agentId?: string; providerOverride?: string; voiceOverride?: string;
      };
      if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

      // Truncate to platform max
      const maxChars = (opts.config.service as any).voiceMaxChars ?? 2000;
      const input = text.length > maxChars ? text.slice(0, maxChars) : text;

      // Resolve provider/voice. providerOverride wins if supplied.
      let provider, voiceId;
      if (providerOverride) {
        const p = voiceRegistry.get(providerOverride);
        if (!p) return res.status(400).json({ error: `Unknown provider: ${providerOverride}` });
        provider = p;
        voiceId = voiceOverride;
      } else {
        const resolved = voiceRegistry.resolve(agentId);
        provider = resolved.provider;
        voiceId = voiceOverride || resolved.voiceId;
      }

      if (!provider.serverSide) {
        // Browser provider — tell client to handle via Web Speech API.
        return res.json({ clientSide: true, provider: provider.id, voiceId: voiceId || provider.defaultVoice(), text: input });
      }

      if (!provider.isConfigured()) {
        return res.status(503).json({ error: `${provider.name} is not configured (missing API key)` });
      }

      const result = await provider.tts(input, { voiceId });
      res.setHeader("Content-Type", result.format === "mp3" ? "audio/mpeg" : "audio/wav");
      res.setHeader("X-Voice-Provider", provider.id);
      res.setHeader("X-Voice-Voice-Id", voiceId || provider.defaultVoice());
      res.setHeader("X-Voice-Characters", String(result.characters));
      res.send(result.audio);
    } catch (e: any) {
      log.error(`/api/tts failed: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "TTS failed" });
    }
  });

  // Transcribe audio.
  // Request: POST raw audio bytes with Content-Type: audio/<format>
  //   Optional query: ?providerOverride=grok&language=en&agentId=<id>
  // Returns: { text, language?, durationSeconds? }
  app.post(
    "/api/stt",
    express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }),
    async (req, res) => {
      try {
        if (!(opts.config.service as any).voiceModeEnabled) {
          return res.status(403).json({ error: "Voice mode is disabled" });
        }
        const audio = req.body as Buffer;
        if (!audio || !Buffer.isBuffer(audio) || audio.length === 0) {
          return res.status(400).json({ error: "audio body is required (POST raw bytes with Content-Type: audio/*)" });
        }

        const providerOverride = (req.query.providerOverride as string | undefined) || undefined;
        const agentId = (req.query.agentId as string | undefined) || undefined;
        const language = (req.query.language as string | undefined) || undefined;
        const mimeType = (req.headers["content-type"] as string | undefined) || "audio/webm";

        let provider;
        if (providerOverride) {
          const p = voiceRegistry.get(providerOverride);
          if (!p) return res.status(400).json({ error: `Unknown provider: ${providerOverride}` });
          provider = p;
        } else {
          provider = voiceRegistry.resolve(agentId).provider;
        }

        if (!provider.serverSide) {
          return res.status(400).json({ error: "Browser provider is client-side; perform STT in the browser via Web Speech API" });
        }

        if (!provider.isConfigured()) {
          return res.status(503).json({ error: `${provider.name} is not configured (missing API key)` });
        }

        const result = await provider.stt(audio, { language, mimeType });
        res.json({ text: result.text, language: result.language, durationSeconds: result.durationSeconds, provider: provider.id });
      } catch (e: any) {
        log.error(`/api/stt failed: ${e?.message || e}`);
        res.status(500).json({ error: e?.message || "STT failed" });
      }
    }
  );

  // ─── MCP registry sync helper ───────────────────────────────────
  // Ensures an MCP entry in config.json is also in PersonalRegistry/mcps.json.
  // Call this whenever an MCP is added to config.json from any code path.
  function syncMcpToRegistry(id: string, mcpEntry: any, meta?: { name?: string; description?: string; category?: string; provider?: string }) {
    const registryPath = join(getPersonalRegistryDir(opts.config), "mcps.json");
    let registryData: any = { mcps: [] };
    try { registryData = JSON.parse(readFileSync(registryPath, "utf-8")); } catch { /* fresh */ }
    if (!Array.isArray(registryData.mcps)) registryData.mcps = [];

    // Skip if already in personal registry (platform mcps.json is read-only)
    if (registryData.mcps.some((m: any) => m.id === id)) return;

    registryData.mcps.push({
      id,
      name: meta?.name || id,
      provider: meta?.provider || "me",
      description: meta?.description || "",
      category: meta?.category || "personal",
      verified: false,
      source: "local",
      tags: [meta?.category?.toLowerCase() || "personal"],
      requiredKeys: [],
      fetch: mcpEntry.type === "http"
        ? { type: "http", url: mcpEntry.url }
        : { type: "stdio", command: mcpEntry.command, args: mcpEntry.args || [] },
    });
    writeFileSync(registryPath, JSON.stringify(registryData, null, 2));
    log.info(`[Registry Sync] Auto-added MCP "${id}" to registry`);
  }

  // ─── Apps helpers ────────────────────────────────────────────────
  const appsRegistryPath = () => join(getPersonalRegistryDir(opts.config), "apps.json");
  function readApps(): any[] {
    const p = appsRegistryPath();
    if (!existsSync(p)) return [];
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return []; }
  }
  function writeApps(list: any[]) {
    writeFileSync(appsRegistryPath(), JSON.stringify(list, null, 2));
  }
  function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // ─── API: Dashboard ───────────────────────────────────────────────
  let _dashboardCache: { data: any; ts: number } | null = null;
  const DASHBOARD_CACHE_MS = 10_000; // cache for 10 seconds

  app.get("/api/dashboard", (_req, res) => {
    const now = Date.now();
    if (_dashboardCache && (now - _dashboardCache.ts) < DASHBOARD_CACHE_MS) {
      return res.json({ ..._dashboardCache.data, uptime: process.uptime() });
    }

    const agents = Object.entries(opts.config.agents)
      .map(([id, agent]) => {
      const memoryDir = agent.memoryDir ? resolve(opts.baseDir, agent.memoryDir) : join(getPersonalAgentsDir(), id, "memory");
      const logPath = join(memoryDir, "conversation_log.jsonl");

      let messageCount = 0;
      let lastMessage = "never";
      let sessionActive = false;

      if (existsSync(logPath)) {
        try {
          const stat = statSync(logPath);
          if (stat.size > 0) {
            // Read only the last 16KB to get the last line instead of the entire file
            const fd = openSync(logPath, "r");
            const readSize = Math.min(stat.size, 16384);
            const buf = Buffer.alloc(readSize);
            readSync(fd, buf, 0, readSize, stat.size - readSize);
            closeSync(fd);
            const chunk = buf.toString("utf-8");
            const lines = chunk.trim().split("\n").filter(Boolean);
            if (lines.length > 0) {
              const last = JSON.parse(lines[lines.length - 1]);
              lastMessage = last.ts;
            }
            // Estimate line count from file size (avg ~200 bytes/line)
            messageCount = Math.max(1, Math.round(stat.size / 200));
          }
        } catch { /* ignore */ }
      }

      try {
        const files = readdirSync(memoryDir);
        sessionActive = files.some(f => f.startsWith("session") && f.endsWith(".json"));
      } catch { /* ignore */ }

      // Resolve agentHome
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : agent.memoryDir ? resolve(opts.baseDir, agent.memoryDir, "..") : join(getPersonalAgentsDir(), id);

      // Task counts
      let taskCounts: Record<string, number> = { proposed: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
      const tasksPath = join(agentHome, "tasks.json");
      if (existsSync(tasksPath)) {
        try {
          const tasksData = JSON.parse(readFileSync(tasksPath, "utf-8"));
          for (const t of tasksData.tasks || []) {
            if (taskCounts.hasOwnProperty(t.status)) taskCounts[t.status]++;
          }
        } catch { /* ignore */ }
      }

      return {
        id,
        name: agent.name,
        description: agent.description,
        persistent: agent.persistent ?? false,
        perSenderSessions: agent.perSenderSessions ?? false,
        mcps: agent.mcps || [],
        skills: agent.skills || [],
        agentSkills: agent.agentSkills || [],
        aliases: agent.mentionAliases || [],
        routes: (agent.routes || []).map(r => `${r.channel}:${r.match.value}`),
        messageCount,
        lastMessage,
        sessionActive,
        workspace: agent.workspace,
        streaming: agent.streaming ?? false,
        advancedMemory: agent.advancedMemory ?? true,
        autonomousCapable: agent.autonomousCapable ?? true,
        autoCommit: agent.autoCommit ?? false,
        timeout: agent.timeout ?? 14400000,
        tools: agent.allowedTools,
        org: agent.org || [],
        cron: agent.cron || [],
        goals: agent.goals || [],
        activeGoals: (agent.goals || []).filter(g => g.enabled).length,
        activeCron: (agent.cron || []).filter((c: any) => c.enabled !== false).length,
        agentHome,
        claudeAccount: agent.claudeAccount || null,
        agentClass: agent.agentClass || (agent.platformAgent ? "platform" : "standard"),
        taskCounts,
        subAgents: agent.subAgents || null,
        avatar: (agent as any).avatar || null,
        boardEnabled: agent.boardEnabled || false,
        boardLayout: agent.boardLayout || null,
        executor: agent.executor || null,
        wiki: agent.wiki || false,
        wikiSync: agent.wikiSync || null,
        shared: (agent as any).shared || false,
        conversationLogMode: (agent as any).conversationLogMode || "shared",
      };
    });

    const channels = Object.entries(opts.config.channels)
      .filter(([, c]) => c.enabled)
      .map(([id]) => id);

    // Find default group agent: explicit config > first with subAgents > hub
    const defaultGroupAgent = (opts.config as any).defaultAgent
      || (opts.config.service as any).defaultGroupAgent
      || Object.entries(opts.config.agents).find(([, a]) => a.subAgents)?.[0]
      || (opts.config.agents["hub"] ? "hub" : null);

    const result = {
      status: "running",
      uptime: process.uptime(),
      channels,
      agents,
      mcpCount: Object.keys(opts.config.mcps || {}).length,
      claudeAccounts: Object.keys(opts.config.service.claudeAccounts || {}),
      defaultGroupAgent,
    };

    _dashboardCache = { data: result, ts: Date.now() };
    res.json(result);
  });

  // ─── Legacy dashboard redirect ────────────────────────────────────
  app.get("/dashboard-legacy", (_req, res) => {
    res.redirect("/ui");
  });

  // ─── API: Agent list (for marketplace assign modal) ───────────────
  app.get("/api/agents", (req, res) => {
    const agents = Object.entries(opts.config.agents)
      .map(([id, agent]) => ({
        id,
        name: agent.name || id,
        skills: agent.skills || [],
        agentClass: agent.agentClass || (agent.platformAgent ? "platform" : "standard"),
        shared: (agent as any).shared ?? false,
        conversationLogMode: (agent as any).conversationLogMode ?? "shared",
      }));
    res.json({ agents });
  });

  // ─── API: Agent detail ────────────────────────────────────────────
  app.get("/api/agents/:id", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const memoryDir = resolve(opts.baseDir, agent.memoryDir);
    const logPath = join(memoryDir, "conversation_log.jsonl");

    let recentMessages: any[] = [];
    if (existsSync(logPath)) {
      try {
        const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
        recentMessages = lines.slice(-50).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
      } catch { /* ignore */ }
    }

    res.json({
      id: req.params.id,
      config: {
        name: agent.name,
        description: agent.description,
        persistent: agent.persistent,
        perSenderSessions: agent.perSenderSessions,
        mcps: agent.mcps,
        skills: agent.skills,
        aliases: agent.mentionAliases,
        workspace: agent.workspace,
        tools: agent.allowedTools,
        shared: (agent as any).shared ?? false,
        conversationLogMode: (agent as any).conversationLogMode ?? "shared",
        agentHome: agent.agentHome,
      },
      recentMessages,
    });
  });

  // ─── API: Agent instructions (CLAUDE.md) ─────────────────────────
  app.get("/api/agents/:id/instructions", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;

    // Find CLAUDE.md path
    let claudeMdPath: string;
    if (agent.claudeMd) {
      claudeMdPath = resolveTilde(agent.claudeMd);
    } else {
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      claudeMdPath = join(agentHome, "CLAUDE.md");
    }

    let instructions = "";
    if (existsSync(claudeMdPath)) {
      try {
        instructions = readFileSync(claudeMdPath, "utf-8");
      } catch { /* ignore */ }
    }

    // Also read heartbeat.md if present
    const agentHome2 = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const heartbeatMdPath = join(agentHome2, "heartbeat.md");
    let heartbeatInstructions = "";
    if (existsSync(heartbeatMdPath)) {
      try {
        heartbeatInstructions = readFileSync(heartbeatMdPath, "utf-8");
      } catch { /* ignore */ }
    }

    res.json({ instructions, heartbeatInstructions, path: claudeMdPath });
  });

  // ─── API: Chat with agent ─────────────────────────────────────────
  app.post("/api/chat/:agentId", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, accountOverride, senderId: senderIdBody } = req.body as { text?: string; accountOverride?: string; senderId?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    const effectiveAgent = accountOverride
      ? { ...agent, claudeAccount: accountOverride }
      : agent;

    log.info(`[WebUI Chat] ${agentId} <- web: ${text.slice(0, 80)}${accountOverride ? ` (account: ${accountOverride})` : ''}`);

    const syntheticMsg: InboundMessage = {
      id: `web-${Date.now()}`,
      channel: "web",
      chatId: "web-ui",
      chatType: "dm",
      sender: senderIdBody || "web-user",
      senderName: "Web UI",
      text,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: false,
      raw: { type: "web-ui" },
    };

    const route: ResolvedRoute = {
      agentId,
      agentConfig: effectiveAgent,
      route: effectiveAgent.routes[0],
    };

    try {
      // If agent has streaming enabled, use streaming executor but collect full response
      if (agent.streaming) {
        let fullResponse = "";
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, undefined, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger })) {
          if (event.type === "text") fullResponse += event.data;
          else if (event.type === "done" && event.data && !fullResponse) fullResponse = event.data;
          else if (event.type === "error") {
            res.status(500).json({ error: event.data });
            return;
          }
        }
        log.info(`[WebUI Chat] ${agentId} -> web: ${fullResponse.slice(0, 80)}`);
        res.json({ ok: true, response: fullResponse });
      } else {
        const response = await executeAgent(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger });
        log.info(`[WebUI Chat] ${agentId} -> web: ${response.slice(0, 80)}`);
        res.json({ ok: true, response });
      }
    } catch (err) {
      log.error(`[WebUI Chat] ${agentId} error: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Chat with agent (reconnectable streaming) ──────────────
  // POST starts a job, returns jobId. GET streams events with reconnect support.

  app.post("/api/chat/:agentId/stream", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, accountOverride, senderId: senderIdStream } = req.body as { text?: string; accountOverride?: string; senderId?: string };
    if (!text?.trim()) return res.status(400).json({ error: "Missing 'text' in body" });

    // If this tab has a targetAgentId, route to that agent instead
    let routeAgentId = agentId;
    if (senderIdStream) {
      const tabData = readSessionTabs(agentId);
      const tab = tabData.tabs.find((t: any) => t.id === senderIdStream);
      if (tab?.targetAgentId && opts.config.agents[tab.targetAgentId]) {
        routeAgentId = tab.targetAgentId;
        log.info(`[WebUI Stream] Tab "${senderIdStream}" has targetAgentId="${routeAgentId}" — routing there instead of "${agentId}"`);
      }
    }
    const routeAgent = opts.config.agents[routeAgentId];

    // Apply account override from web UI dropdown.
    // Track last-used account per agent so we only force a new session on the
    // actual transition, not on every subsequent message with the same override.
    const effectiveAccount = accountOverride || routeAgent.claudeAccount || "";
    const lastAccount = agentLastAccount.get(routeAgentId) || (routeAgent.claudeAccount || "");
    const accountChanged = effectiveAccount !== lastAccount;
    if (effectiveAccount) agentLastAccount.set(routeAgentId, effectiveAccount);

    const effectiveAgent = accountOverride
      ? { ...routeAgent, claudeAccount: accountOverride, ...(accountChanged ? { forceNewSession: true } : {}) }
      : routeAgent;

    log.info(`[WebUI Stream] ${routeAgentId} <- web: ${text.slice(0, 80)}${accountOverride ? ` (account: ${accountOverride})` : ''}`);

    // Create job
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortCtrl = new AbortController();
    const job: StreamJob = { events: [], rawLines: [], rawListeners: new Set(), done: false, stopped: false, createdAt: Date.now(), listeners: new Set(), abort: abortCtrl };
    jobStore.set(jobId, job);

    const pushEvent = (data: string) => {
      const idx = job.events.length;
      job.events.push({ idx, data });
      for (const cb of job.listeners) cb(idx);
    };

    // Return jobId immediately so frontend can connect to stream
    res.json({ jobId });

    // Run agent in background
    const syntheticMsg: InboundMessage = {
      id: `web-${Date.now()}`,
      channel: "web",
      chatId: "web-ui",
      chatType: "dm",
      sender: senderIdStream || "web-user",
      senderName: "Web UI",
      text,
      timestamp: Date.now(),
      isFromMe: false,
      isGroup: false,
      raw: { type: "web-ui" },
    };

    const route: ResolvedRoute = {
      agentId: routeAgentId,
      agentConfig: effectiveAgent,
      route: effectiveAgent.routes[0],
    };

    const pushRawLine = (line: string) => {
      const idx = job.rawLines.length;
      job.rawLines.push(line);
      for (const cb of job.rawListeners) cb(idx);
    };

    (async () => {
      // Heartbeat every 30s so frontend knows the agent is still alive
      const heartbeat = setInterval(() => {
        if (!job.done && !job.stopped) {
          pushEvent(JSON.stringify({ type: "heartbeat" }));
        } else {
          clearInterval(heartbeat);
        }
      }, 30_000);
      try {
        for await (const event of executeAgentStreaming(route, syntheticMsg, opts.baseDir, opts.config.mcps, opts.config.service.claudeAccounts, pushRawLine, { skills: opts.config.defaultSkills, mcps: opts.config.defaultMcps, prompts: opts.config.defaultPrompts, promptTrigger: opts.config.promptTrigger }, abortCtrl.signal)) {
          if (job.stopped) break;
          pushEvent(JSON.stringify(event));
        }
      } catch (err) {
        if (!job.stopped) pushEvent(JSON.stringify({ type: "error", data: String(err) }));
      } finally {
        clearInterval(heartbeat);
        if (!job.done) {
          pushEvent("[DONE]");
          job.done = true;
        }
      }
    })();
  });

  // GET: Stream events for a job, supports reconnect via ?after=N
  app.get("/api/chat/jobs/:jobId/stream", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      log.warn(`[SSE] Job not found: ${req.params.jobId}`);
      return res.status(404).json({ error: "Job not found" });
    }

    const after = parseInt(req.query.after as string) || 0;
    const connId = `sse-${Date.now().toString(36)}`;
    log.debug(`[SSE:${connId}] Connected to job ${req.params.jobId} after=${after} events=${job.events.length} done=${job.done}`);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    let closed = false;
    req.on("close", () => {
      closed = true;
      log.debug(`[SSE:${connId}] Client disconnected (req close event)`);
    });

    // Send any buffered events the client missed
    let cursor = after;
    for (let i = after; i < job.events.length; i++) {
      if (closed) {
        log.debug(`[SSE:${connId}] Client closed during buffer replay at event ${i}`);
        return;
      }
      res.write(`id: ${job.events[i].idx}\ndata: ${job.events[i].data}\n\n`);
      cursor = i + 1;
    }
    if (cursor > after) {
      log.debug(`[SSE:${connId}] Replayed ${cursor - after} buffered events`);
    }

    // If job already done and we've sent everything, close
    if (job.done && cursor >= job.events.length) {
      log.debug(`[SSE:${connId}] Job already done, closing after replay`);
      res.end();
      return;
    }

    // Otherwise listen for new events (5s keepalive prevents browser background throttling)
    let keepaliveCount = 0;
    const keepalive = setInterval(() => {
      if (closed) { clearInterval(keepalive); return; }
      try {
        res.write(`: keepalive\n\n`);
        keepaliveCount++;
      } catch (err) {
        log.debug(`[SSE:${connId}] Keepalive write failed after ${keepaliveCount} keepalives: ${err}`);
        closed = true;
      }
    }, 5_000);

    const onEvent = (idx: number) => {
      if (closed) {
        log.debug(`[SSE:${connId}] Event ${idx} arrived but client already closed`);
        cleanup();
        return;
      }
      const evt = job.events[idx];
      if (!evt) return;
      try {
        res.write(`id: ${evt.idx}\ndata: ${evt.data}\n\n`);
        if (evt.data === "[DONE]") {
          log.debug(`[SSE:${connId}] [DONE] sent, closing. Total events: ${idx + 1}, keepalives: ${keepaliveCount}`);
          cleanup();
          res.end();
        }
      } catch (err) {
        log.debug(`[SSE:${connId}] Event write failed at idx ${idx}: ${err}`);
        closed = true;
        cleanup();
      }
    };

    const cleanup = () => {
      clearInterval(keepalive);
      job.listeners.delete(onEvent);
    };

    job.listeners.add(onEvent);
    req.on("close", cleanup);
  });

  // ─── API: Stop a streaming job ────────────────────────────────────
  app.post("/api/chat/jobs/:jobId/stop", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.done) return res.json({ ok: true, already: true });

    job.stopped = true;
    job.done = true;

    // Kill the underlying claude -p child process
    if (job.abort) job.abort.abort();

    // Push a stopped event then [DONE] so connected SSE clients finalize
    const pushEvent = (data: string) => {
      const idx = job.events.length;
      job.events.push({ idx, data });
      for (const cb of job.listeners) cb(idx);
    };
    pushEvent(JSON.stringify({ type: "stopped", data: "Stopped by user" }));
    pushEvent("[DONE]");

    log.info(`[WebUI] Job ${req.params.jobId} stopped by user`);
    res.json({ ok: true });
  });

  // ─── API: Recover lost exchange after service restart ───────────────
  // Browser POSTs the user message + streamed response back when it detects
  // a 404 (job not found = service restarted before log was written).
  app.post("/api/agents/:agentId/recover", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { userText, response, ts } = req.body as { userText?: string; response?: string; ts?: string };
    if (!userText?.trim() && !response?.trim()) {
      return res.status(400).json({ error: "Must provide userText or response" });
    }

    const memoryDir = resolve(opts.baseDir, agent.memoryDir);
    const logPath = join(memoryDir, "conversation_log.jsonl");
    try {
      mkdirSync(memoryDir, { recursive: true });
      const entry = {
        ts: ts || new Date().toISOString(),
        from: "web-user",
        text: userText || "",
        response: (response || "").slice(0, 2000),
        agentId,
        channel: "web",
        recovered: true,
      };
      appendFileSync(logPath, JSON.stringify(entry) + "\n");
      log.info(`[WebUI] Recovered exchange for ${agentId} (${(response || "").length} chars)`);
      res.json({ ok: true });
    } catch (err) {
      log.warn(`[WebUI] Failed to write recovery log: ${err}`);
      res.status(500).json({ error: "Failed to write recovery log" });
    }
  });

  // ─── API: Marketplace ──────────────────────────────────────────────

  // scan-skills must be BEFORE the :type catch-all to avoid being matched as type="scan-skills"
  app.get("/api/marketplace/scan-skills", (req, res) => {
    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const scanDir = req.query.dir
      ? resolveTilde(req.query.dir as string)
      : join(home, ".claude", "commands");

    if (!existsSync(scanDir)) {
      return res.status(404).json({ error: `Directory not found: ${scanDir}` });
    }

    const registryPath = join(opts.baseDir, "registry", "skills.json");
    const existingIds = new Set<string>();
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      for (const s of (data.skills || [])) existingIds.add(s.id);
    } catch { /* registry may not exist yet */ }

    let files: any[] = [];
    try {
      const mdFiles = readdirSync(scanDir).filter((f: string) => f.endsWith(".md"));
      for (const file of mdFiles) {
        const id = file.replace(".md", "");
        if (existingIds.has(id)) continue;
        const filePath = join(scanDir, file);
        const content = readFileSync(filePath, "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let name = id.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        let description = "";
        if (fmMatch) {
          for (const line of fmMatch[1].split("\n")) {
            const [k, ...rest] = line.split(":");
            if (k?.trim() === "name") name = rest.join(":").trim();
            if (k?.trim() === "description") description = rest.join(":").trim();
          }
        }
        files.push({ id, filename: file, path: filePath, name, description });
      }
    } catch (err) {
      return res.status(500).json({ error: `Failed to scan directory: ${err}` });
    }

    res.json({ dir: scanDir, files });
  });

  app.get("/api/marketplace/:type", (req, res) => {
    const { type } = req.params;
    if (!["mcps", "skills", "agents", "prompts", "apps"].includes(type)) {
      return res.status(400).json({ error: "type must be mcps, skills, agents, prompts, or apps" });
    }

    // Apps: PersonalRegistry/apps.json (user's own) + registry/platform-apps.json (committed platform apps)
    if (type === "apps") {
      const personalAppsPath = join(getPersonalRegistryDir(opts.config), "apps.json");
      const platformAppsPath = join(opts.baseDir, "registry", "platform-apps.json");
      try {
        const personalApps: any[] = existsSync(personalAppsPath)
          ? JSON.parse(readFileSync(personalAppsPath, "utf-8")) as any[]
          : [];
        const platformApps: any[] = existsSync(platformAppsPath)
          ? JSON.parse(readFileSync(platformAppsPath, "utf-8")) as any[]
          : [];
        const allApps = [...platformApps, ...personalApps];
        const items = allApps.map((app: any) => {
          const agentId = app.agentDeveloper || null;
          const agentAlias = agentId && opts.config.agents[agentId]
            ? (opts.config.agents[agentId] as any).mentionAliases?.[0] || `@${agentId}`
            : agentId ? `@${agentId}` : null;
          return {
            ...app,
            provider: app.provider || "me",
            installed: true,
            assignedTo: agentId ? [agentId] : [],
            agentAlias,
          };
        });
        return res.json({ items });
      } catch {
        return res.status(500).json({ error: "Failed to read apps registry" });
      }
    }

    // Platform items from registry/{type}.json (committed), personal from PersonalRegistry/{type}.json (outside repo)
    const registryPath = join(opts.baseDir, "registry", `${type}.json`);
    const personalRegistryPath = join(getPersonalRegistryDir(opts.config), `${type}.json`);
    const source = (req.query.source as string) || "";

    let platformEntries: any[] = [];
    let personalEntries: any[] = [];
    try {
      if (existsSync(registryPath)) {
        const data = JSON.parse(readFileSync(registryPath, "utf-8"));
        platformEntries = data[type] || [];
      }
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }
    try {
      if (existsSync(personalRegistryPath)) {
        const personalData = JSON.parse(readFileSync(personalRegistryPath, "utf-8"));
        personalEntries = personalData[type] || [];
      }
    } catch { /* ignore missing personal file */ }

    // source=personal → only personal registry items (Library)
    // source=platform → only platform registry items (Marketplace)
    // no source → merged (backward compat)
    let entries: any[];
    const personalIds = new Set(personalEntries.map((e: any) => e.id));
    if (source === "personal") {
      entries = personalEntries;
    } else if (source === "platform") {
      entries = platformEntries;
    } else {
      entries = [...platformEntries.filter((e: any) => !personalIds.has(e.id)), ...personalEntries];
    }

    if (entries.length === 0 && !existsSync(registryPath) && !existsSync(personalRegistryPath)) {
      return res.json({ items: [] });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const personalSkillsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
    const personalPromptsDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "prompts");
    const claudeCommandsDir = join(home, ".claude", "commands");

    const items = entries.map((entry: any) => {
      let installed = false;
      const assignedTo: string[] = [];

      if (type === "skills") {
        const id = entry.id;
        const isPlatformSkill = entry.source === "agenticledger/platform";
        const localPathExists = entry.localPath && existsSync(join(opts.baseDir, entry.localPath));
        installed = isPlatformSkill
          ? localPathExists
          : existsSync(join(personalSkillsDir, `${id}.md`))
            || existsSync(join(claudeCommandsDir, `${id}.md`))
            || !!localPathExists;
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).skills?.includes(id)) assignedTo.push(agentId);
        }
      } else if (type === "prompts") {
        const id = entry.id;
        const isPlatformPrompt = entry.source === "agenticledger/platform";
        const localPathExists = entry.localPath && existsSync(join(opts.baseDir, entry.localPath));
        installed = isPlatformPrompt
          ? localPathExists
          : existsSync(join(personalPromptsDir, `${id}.md`)) || !!localPathExists;
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).prompts?.includes(id)) assignedTo.push(agentId);
        }
      } else if (type === "mcps") {
        installed = personalIds.has(entry.id) || !!(opts.config.mcps as any)?.[entry.id];
        for (const [agentId, agent] of Object.entries(opts.config.agents)) {
          if ((agent as any).mcps?.includes(entry.id)) assignedTo.push(agentId);
        }
      } else if (type === "agents") {
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let drafts: string[] = [];
        try {
          drafts = JSON.parse(readFileSync(draftsPath, "utf-8")).drafts.map((d: any) => d.id);
        } catch { /* ignore */ }
        installed = existsSync(join(opts.baseDir, "agents", entry.id))
          || drafts.includes(entry.id)
          || !!opts.config.agents[entry.id];
      }

      let isPlatformDefault = false;
      if (type === "skills") {
        isPlatformDefault = !!(opts.config.defaultSkills?.includes(entry.id));
      } else if (type === "mcps") {
        isPlatformDefault = !!(opts.config.defaultMcps?.includes(entry.id));
      } else if (type === "prompts") {
        isPlatformDefault = !!(opts.config.defaultPrompts?.includes(entry.id));
      }

      return { ...entry, provider: entry.provider || "AgenticLedger", installed, assignedTo, isPlatformDefault };
    });

    res.json({ items });
  });

  app.post("/api/marketplace/install", (req, res) => {
    const { type, id } = req.body as { type?: string; id?: string };
    if (!type || !id) return res.status(400).json({ error: "Missing type or id" });

    const registryPath = join(opts.baseDir, "registry", `${type}s.json`);
    if (!existsSync(registryPath)) return res.status(404).json({ error: "Registry not found" });

    let entry: any;
    try {
      const data = JSON.parse(readFileSync(registryPath, "utf-8"));
      const key = type === "mcp" ? "mcps" : type === "skill" ? "skills" : type === "prompt" ? "prompts" : "agents";
      entry = (data[key] || []).find((e: any) => e.id === id);
    } catch {
      return res.status(500).json({ error: "Failed to read registry" });
    }
    if (!entry) return res.status(404).json({ error: `${type} "${id}" not found in registry` });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;

    try {
      if (type === "skill") {
        const destDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "skills");
        mkdirSync(destDir, { recursive: true });
        const srcPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        const destPath = join(destDir, `${id}.md`);
        if (!existsSync(srcPath)) return res.status(500).json({ error: `Source file not found: ${entry.localPath}` });
        copyFileSync(srcPath, destPath);
        log.info(`[Marketplace] Installed skill ${id} → ${destPath}`);

      } else if (type === "prompt") {
        const destDir = join(resolveTilde(getPersonalAgentsDir(opts.config)), "prompts");
        mkdirSync(destDir, { recursive: true });
        const srcPath = isAbsolute(entry.localPath) ? entry.localPath : join(opts.baseDir, entry.localPath);
        const destPath = join(destDir, `${id}.md`);
        if (!existsSync(srcPath)) return res.status(500).json({ error: `Source file not found: ${entry.localPath}` });
        copyFileSync(srcPath, destPath);
        log.info(`[Marketplace] Installed prompt ${id} → ${destPath}`);

      } else if (type === "mcp") {
        const configPath = configFilePath();
        const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        if (!rawConfig.mcps) rawConfig.mcps = {};

        if (entry.fetch?.type === "http") {
          rawConfig.mcps[id] = { type: "http", url: entry.fetch.url, headers: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!(opts.config as any).mcps) (opts.config as any).mcps = {};
          (opts.config as any).mcps[id] = { type: "http", url: entry.fetch.url, headers: {} };
          log.info(`[Marketplace] Installed MCP ${id} (http)`);

        } else if (entry.fetch?.type === "npm") {
          execSync(`npm install ${entry.fetch.package}`, { cwd: opts.baseDir, timeout: 30_000 });
          rawConfig.mcps[id] = { type: "stdio", command: "npx", args: entry.fetch.args || ["-y", entry.fetch.package], env: {} };
          writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
          if (!(opts.config as any).mcps) (opts.config as any).mcps = {};
          (opts.config as any).mcps[id] = rawConfig.mcps[id];
          log.info(`[Marketplace] Installed MCP ${id} (npm: ${entry.fetch.package})`);
        }

      } else if (type === "agent") {
        const srcDir = join(opts.baseDir, entry.localPath);
        const destDir = join(opts.baseDir, "agents", id);
        if (existsSync(srcDir)) {
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(srcDir)) {
            copyFileSync(join(srcDir, file), join(destDir, file));
          }
        } else {
          mkdirSync(join(destDir, "memory"), { recursive: true });
          writeFileSync(join(destDir, "CLAUDE.md"), `# ${entry.name}\n\n${entry.description}\n`);
          writeFileSync(join(destDir, "agent.json"), JSON.stringify({ id, name: entry.name, draft: true, version: "1.0.0", created: new Date().toISOString() }, null, 2));
        }
        const draftsPath = join(opts.baseDir, "registry", "installed-drafts.json");
        let draftsData: { drafts: any[] } = { drafts: [] };
        try { draftsData = JSON.parse(readFileSync(draftsPath, "utf-8")); } catch { /* fresh */ }
        if (!draftsData.drafts.find((d: any) => d.id === id)) {
          draftsData.drafts.push({ id, name: entry.name, installedAt: new Date().toISOString() });
          writeFileSync(draftsPath, JSON.stringify(draftsData, null, 2));
        }
        log.info(`[Marketplace] Installed agent template ${id} → draft`);
      }

      const requiresKeys = type === "mcp" && (entry.requiredKeys?.length > 0);
      res.json({ ok: true, item: { ...entry, installed: true }, requiresKeys });

    } catch (err) {
      log.error(`[Marketplace] Install failed for ${type}/${id}: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/marketplace/assign", (req, res) => {
    const { type, id, agentIds } = req.body as { type?: string; id?: string; agentIds?: string[] };
    if (!type || !id || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: "Missing type, id, or agentIds" });
    }

    const configPath = configFilePath();
    let rawConfig: any;
    try {
      rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return res.status(500).json({ error: "Failed to read config.json" });
    }

    const missingKeys: string[] = [];

    for (const agentId of agentIds) {
      if (!rawConfig.agents[agentId]) continue;

      if (type === "skill") {
        if (!rawConfig.agents[agentId].skills) rawConfig.agents[agentId].skills = [];
        if (!rawConfig.agents[agentId].skills.includes(id)) {
          rawConfig.agents[agentId].skills.push(id);
        }
        if (!(opts.config.agents[agentId] as any).skills) (opts.config.agents[agentId] as any).skills = [];
        if (!(opts.config.agents[agentId] as any).skills.includes(id)) {
          (opts.config.agents[agentId] as any).skills.push(id);
        }

      } else if (type === "prompt") {
        if (!rawConfig.agents[agentId].prompts) rawConfig.agents[agentId].prompts = [];
        if (!rawConfig.agents[agentId].prompts.includes(id)) {
          rawConfig.agents[agentId].prompts.push(id);
        }
        if (!(opts.config.agents[agentId] as any).prompts) (opts.config.agents[agentId] as any).prompts = [];
        if (!(opts.config.agents[agentId] as any).prompts.includes(id)) {
          (opts.config.agents[agentId] as any).prompts.push(id);
        }

      } else if (type === "mcp") {
        if (!rawConfig.agents[agentId].mcps) rawConfig.agents[agentId].mcps = [];
        if (!rawConfig.agents[agentId].mcps.includes(id)) {
          rawConfig.agents[agentId].mcps.push(id);
        }
        if (!(opts.config.agents[agentId] as any).mcps) (opts.config.agents[agentId] as any).mcps = [];
        if (!(opts.config.agents[agentId] as any).mcps.includes(id)) {
          (opts.config.agents[agentId] as any).mcps.push(id);
        }
        const home = homedir();
        const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
        const agentCfg = opts.config.agents[agentId] as any;
        const agentHome = agentCfg.agentHome
          ? resolveTilde(agentCfg.agentHome)
          : join(resolveTilde(agentCfg.memoryDir || ""), "..");
        const keyFile = join(agentHome, "mcp-keys", `${id}.env`);
        if (!existsSync(keyFile)) {
          missingKeys.push(agentId);
          mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
          writeFileSync(keyFile, "");
        }
      }
    }

    try {
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));
    } catch (err) {
      return res.status(500).json({ error: `Failed to write config: ${err}` });
    }

    log.info(`[Marketplace] Assigned ${type}/${id} to agents: ${agentIds.join(", ")}`);
    res.json({ ok: true, assigned: agentIds, missingKeys });
  });

  // (scan-skills route moved above :type catch-all — see line ~1000)

  // ─── API: Raw log stream for a job (tail -f style) ──────────────
  app.get("/api/chat/jobs/:jobId/raw", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const after = parseInt(req.query.after as string) || 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    let closed = false;
    req.on("close", () => { closed = true; });

    // Send buffered raw lines
    for (let i = after; i < job.rawLines.length; i++) {
      if (closed) return;
      res.write(`data: ${job.rawLines[i]}\n\n`);
    }

    if (job.done && after >= job.rawLines.length) {
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    const keepalive = setInterval(() => {
      if (closed) { clearInterval(keepalive); return; }
      try { res.write(`: keepalive\n\n`); } catch { closed = true; }
    }, 5_000);

    const onRaw = (idx: number) => {
      if (closed) { cleanup(); return; }
      try {
        res.write(`data: ${job.rawLines[idx]}\n\n`);
      } catch { closed = true; cleanup(); }
    };

    const cleanup = () => {
      clearInterval(keepalive);
      job.rawListeners.delete(onRaw);
    };

    job.rawListeners.add(onRaw);
    req.on("close", cleanup);

    // If job finishes while connected, send done and close
    const checkDone = () => {
      if (job.done && !closed) {
        closed = true;
        try { res.write(`data: [DONE]\n\n`); } catch {}
        cleanup();
        try { res.end(); } catch {}
      }
    };
    // Piggyback on the regular event listener to detect done
    const onEvent = () => { if (job.done) checkDone(); };
    job.listeners.add(onEvent);
    req.on("close", () => job.listeners.delete(onEvent));
  });

  // ─── API: Upload file ────────────────────────────────────────────
  // Accepts multipart form data with file + mode (temp/permanent)
  app.post("/api/upload/:agentId", async (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    // Parse raw body as multipart — Express 5 doesn't have built-in multipart
    // We'll use a simple approach: read chunks from the request
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);

    // Extract boundary from content-type
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: "Missing multipart boundary" });

    const boundary = boundaryMatch[1];
    const parts = body.toString("binary").split(`--${boundary}`).filter(p => p.includes("Content-Disposition"));

    let fileName = "";
    let fileData: Buffer | null = null;
    let mode = "temp";

    for (const part of parts) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd < 0) continue;
      const header = part.slice(0, headerEnd);
      const content = part.slice(headerEnd + 4).replace(/\r\n$/, "");

      if (header.includes('name="mode"')) {
        mode = content.trim();
      } else if (header.includes('name="file"')) {
        const fnMatch = header.match(/filename="([^"]+)"/);
        fileName = fnMatch ? fnMatch[1] : `upload-${Date.now()}`;
        fileData = Buffer.from(content, "binary");
      }
    }

    if (!fileData || !fileName) return res.status(400).json({ error: "No file in request" });

    // Save to agent's own folder
    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const storageDir = join(agentHome, "FileStorage", mode === "permanent" ? "Permanent" : "Temp");
    mkdirSync(storageDir, { recursive: true });

    const savePath = join(storageDir, fileName);
    writeFileSync(savePath, fileData);

    log.info(`[Upload] ${agentId}: ${fileName} (${fileData.length} bytes, ${mode}) → ${savePath}`);

    res.json({
      ok: true,
      path: savePath,
      fileName,
      size: fileData.length,
      mode,
    });
  });

  // ─── API: Upload file (JSON/base64 — for MCP / programmatic use) ─
  app.post("/api/upload/:agentId/json", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { fileName, base64Content, mode = "temp" } = req.body as any;
    if (!fileName || !base64Content) return res.status(400).json({ error: "fileName and base64Content required" });

    const fileData = Buffer.from(base64Content, "base64");
    const agentHome = agent.agentHome || resolve(opts.baseDir, agent.memoryDir, "..");
    const storageDir = join(agentHome, "FileStorage", mode === "permanent" ? "Permanent" : "Temp");
    mkdirSync(storageDir, { recursive: true });

    const savePath = join(storageDir, fileName);
    writeFileSync(savePath, fileData);

    log.info(`[Upload/JSON] ${agentId}: ${fileName} (${fileData.length} bytes, ${mode}) → ${savePath}`);

    res.json({ ok: true, path: savePath, fileName, size: fileData.length, mode });
  });

  // ─── API: List agent files ──────────────────────────────────────
  app.get("/api/agents/:agentId/files", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const workspace = agent.workspace ? resolveTilde(agent.workspace) : agentHome;

    // Scan FileStorage dirs + workspace root for downloadable files
    const files: Array<{ name: string; path: string; size: number; modified: string; source: string }> = [];

    const scanDir = (dir: string, source: string, recursive = false, rootDir?: string) => {
      if (!existsSync(dir)) return;
      const root = rootDir || dir;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = join(dir, entry.name);
          if (entry.isFile()) {
            try {
              const stat = statSync(fullPath);
              const rel = fullPath.slice(root.length + 1); // relative path within storage folder
              files.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                modified: stat.mtime.toISOString(),
                source,
                ...(rel !== entry.name ? { folder: rel.slice(0, rel.length - entry.name.length - 1) } : {}),
              });
            } catch { /* skip */ }
          } else if (entry.isDirectory() && recursive) {
            scanDir(fullPath, source, true, root);
          }
        }
      } catch { /* skip */ }
    };

    // FileStorage (always scan)
    scanDir(join(agentHome, "FileStorage", "Temp"), "temp", true);
    scanDir(join(agentHome, "FileStorage", "Permanent"), "permanent", true);

    // Sort by modified descending
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    res.json({ ok: true, files });
  });

  // ─── API: Download agent file ─────────────────────────────────
  app.get("/api/agents/:agentId/download", (req, res) => {
    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const rawFilePath = req.query.path as string;
    if (!rawFilePath) return res.status(400).json({ error: "Missing 'path' query parameter" });

    // Security: resolve and validate the path is within allowed directories
    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const workspace = agent.workspace ? resolveTilde(agent.workspace) : agentHome;

    // Resolve relative paths (e.g., "FileStorage/Temp/file.csv") against agent home
    const filePath = rawFilePath.startsWith("/") || rawFilePath.startsWith("~")
      ? rawFilePath
      : join(agentHome, rawFilePath);

    const resolvedPath = resolve(resolveTilde(filePath));
    const resolvedAgentHome = resolve(agentHome);
    const resolvedWorkspace = resolve(workspace);

    // Must be within agent home, workspace, or any agent's home (for cross-agent file access)
    let isAllowed = resolvedPath.startsWith(resolvedAgentHome) ||
                    resolvedPath.startsWith(resolvedWorkspace);
    if (!isAllowed) {
      // Check if file is within any other agent's home directory
      for (const [, otherAgent] of Object.entries(opts.config.agents)) {
        const otherHome = otherAgent.agentHome ? resolve(resolveTilde(otherAgent.agentHome)) : "";
        if (otherHome && resolvedPath.startsWith(otherHome)) {
          isAllowed = true;
          break;
        }
      }
    }
    if (!isAllowed) {
      return res.status(403).json({ error: "File path outside allowed directories" });
    }

    if (!existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
      const stat = statSync(resolvedPath);
      if (!stat.isFile()) return res.status(400).json({ error: "Not a file" });
    } catch {
      return res.status(404).json({ error: "Cannot access file" });
    }

    const fileName = basename(resolvedPath);
    const ext = extname(fileName).toLowerCase();

    // Content type mapping
    const contentTypes: Record<string, string> = {
      ".csv": "text/csv",
      ".json": "application/json",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".html": "text/html",
      ".zip": "application/zip",
    };

    const isInline = req.query.inline === "true";
    res.setHeader("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${fileName}"`);
    res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");

    log.info(`[Download] ${agentId}: ${fileName} from ${resolvedPath}`);
    try {
      const content = readFileSync(resolvedPath);
      res.send(content);
    } catch {
      if (!res.headersSent) res.status(404).json({ error: "File send failed" });
    }
  });

  // ─── API: Create agent ──────────────────────────────────────────
  app.post("/api/agents", async (req, res) => {
    const { agentId, name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass, executor, wiki, wikiSync, shared, conversationLogMode, avatar, boardEnabled, boardLayout } = req.body as {
      agentId?: string; name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; autoCommitBranch?: string; timeout?: number;
      skills?: string[]; agentSkills?: string[]; prompts?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention?: boolean; allowFrom?: string[] }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string; enabled?: boolean }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
      subAgents?: string[] | "*";
      heartbeatInstructions?: string;
      heartbeatCron?: string;
      heartbeatEnabled?: boolean;
      agentClass?: "standard" | "platform" | "builder" | "board";
      executor?: string;
      wiki?: boolean;
      wikiSync?: { enabled?: boolean; schedule?: string };
      shared?: boolean;
      conversationLogMode?: "shared" | "per-user";
      avatar?: string;
      boardEnabled?: boolean;
      boardLayout?: "small" | "medium" | "large";
    };

    if (!agentId || !name || !alias) {
      return res.status(400).json({ error: "Missing required fields: agentId, name, alias" });
    }

    // Validate agentId format
    if (!/^[a-z0-9-]+$/.test(agentId)) {
      return res.status(400).json({ error: "agentId must be lowercase alphanumeric with hyphens" });
    }

    // Check for duplicate
    if (opts.config.agents[agentId]) {
      return res.status(409).json({ error: `Agent "${agentId}" already exists` });
    }

    // Check alias uniqueness
    const allAliases = Object.values(opts.config.agents).flatMap(a => a.mentionAliases || []);
    const normalAlias = alias.startsWith("@") ? alias : `@${alias}`;
    if (allAliases.includes(normalAlias)) {
      return res.status(409).json({ error: `Alias "${normalAlias}" is already in use` });
    }

    try {
      // Create agent directory — shared agents go under SharedAgents/<org>/<agentId> or SharedAgents/<agentId>
      const orgName = org?.[0]?.organization;
      const baseDir = shared ? getSharedAgentsDir(opts.config) : getPersonalAgentsDir();
      const agentHome = orgName ? join(baseDir, orgName, agentId) : join(baseDir, agentId);
      const memoryDir = join(agentHome, "memory");
      mkdirSync(memoryDir, { recursive: true });
      mkdirSync(join(agentHome, "mcp-keys"), { recursive: true });
      mkdirSync(join(agentHome, "skills"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Temp"), { recursive: true });
      mkdirSync(join(agentHome, "FileStorage", "Permanent"), { recursive: true });

      // Write tasks.json
      const tasksJson = {
        agentId,
        projects: [{ id: "general", name: "General", color: "#6b7280" }],
        tasks: [],
      };
      writeFileSync(join(agentHome, "tasks.json"), JSON.stringify(tasksJson, null, 2));

      // Write CLAUDE.md
      const claudeMd = instructions
        ? instructions
        : `# ${name}\n\n${description || "General-purpose agent."}\n\n## Identity\n- Mention alias: ${normalAlias}\n- Respond when mentioned with ${normalAlias}\n\n## Guidelines\n- Keep responses concise — you're replying to phone messages\n- If a task requires multiple steps, summarize what you did\n- If you need clarification, ask\n`;
      writeFileSync(join(agentHome, "CLAUDE.md"), claudeMd);

      // Write heartbeat.md if provided
      if (heartbeatInstructions) {
        writeFileSync(join(agentHome, "heartbeat.md"), heartbeatInstructions);
      }

      // Write context.md
      writeFileSync(join(memoryDir, "context.md"), `# ${name} Context\n\nCreated ${new Date().toISOString().split("T")[0]}.\n`);

      // Build config entry — use ~ prefix for portability in config.json
      const cfgBaseDir = shared ? getSharedAgentsDir(opts.config) : getPersonalAgentsDir();
      const cfgBaseDirTilde = cfgBaseDir.startsWith(homedir()) ? cfgBaseDir.replace(homedir(), "~") : cfgBaseDir;
      const cfgAgentPath = orgName ? `${cfgBaseDirTilde}/${orgName}/${agentId}` : `${cfgBaseDirTilde}/${agentId}`;
      const agentConfig: any = {
        name,
        description: description || `Agent ${name}`,
        agentHome: cfgAgentPath,
        workspace: workspace || "~",
        claudeMd: `${cfgAgentPath}/CLAUDE.md`,
        memoryDir: `${cfgAgentPath}/memory`,
        persistent: persistent ?? true,
        streaming: streaming ?? true,
        advancedMemory: advancedMemory ?? true,
        autonomousCapable: autonomousCapable ?? true,
        mentionAliases: [normalAlias],
        autoCommit: autoCommit ?? false,
        allowedTools: tools || ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
        timeout: timeout || 14400000,
        agentClass: agentClass || "standard",
      };

      if (mcps && mcps.length > 0) agentConfig.mcps = mcps;
      if (skills && skills.length > 0) agentConfig.skills = skills;
      if (agentSkills && agentSkills.length > 0) agentConfig.agentSkills = agentSkills;
      if (prompts && prompts.length > 0) agentConfig.prompts = prompts;
      if (claudeAccount) agentConfig.claudeAccount = claudeAccount;
      if (autoCommitBranch) agentConfig.autoCommitBranch = autoCommitBranch;
      if (subAgents) agentConfig.subAgents = subAgents;
      if (org && org.length > 0) agentConfig.org = org;
      if (cron && cron.length > 0) agentConfig.cron = cron;
      if (goals && goals.length > 0) agentConfig.goals = goals;
      if (executor) agentConfig.executor = executor;
      if (wiki) agentConfig.wiki = true;
      if (wikiSync) agentConfig.wikiSync = { enabled: !!wikiSync.enabled, schedule: wikiSync.schedule || "0 0 * * *" };
      if (shared) agentConfig.shared = true;
      if (conversationLogMode) agentConfig.conversationLogMode = conversationLogMode;
      // Board config — board class agents are auto board-enabled
      if (boardEnabled || agentClass === "board") agentConfig.boardEnabled = true;
      if (boardLayout) agentConfig.boardLayout = boardLayout;

      // Avatar — use provided, or auto-assign a random unused one
      const usedAvatars = new Set(Object.values(opts.config.agents).map((a: any) => a.avatar).filter(Boolean));
      if (avatar) {
        agentConfig.avatar = avatar;
      } else {
        const allAvatarIds = Array.from({ length: 80 }, (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`);
        const unused = allAvatarIds.filter(id => !usedAvatars.has(id));
        if (unused.length > 0) {
          agentConfig.avatar = unused[Math.floor(Math.random() * unused.length)];
        }
      }

      // Build routes
      agentConfig.routes = (routes || []).map(r => ({
        channel: r.channel,
        match: {
          type: r.channel === "slack" ? "channel_id" : "chat_id",
          value: r.chatId,
        },
        permissions: {
          allowFrom: r.allowFrom || ["*"],
          requireMention: r.requireMention ?? true,
        },
      }));

      // If no routes provided, add a default web route so agent is always reachable from Web UI
      if (agentConfig.routes.length === 0) {
        agentConfig.routes.push({
          channel: "web",
          match: { type: "channel_id", value: "web-ui" },
          permissions: { allowFrom: ["*"], requireMention: false },
        });
        log.info(`Agent ${agentId} created with default web route (no explicit routes provided)`);
      }

      // Update config.json
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      rawConfig.agents[agentId] = agentConfig;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent creation failed: ${buildErr}`);
      }

      // Update in-memory config
      const resolveTildeHere = (p: string) => p.startsWith("~") ? p.replace("~", homedir()) : p;
      agentConfig.workspace = resolveTildeHere(agentConfig.workspace);
      agentConfig.claudeMd = resolveTildeHere(agentConfig.claudeMd);
      agentConfig.memoryDir = resolveTildeHere(agentConfig.memoryDir);
      agentConfig.timeout = 120_000;
      opts.config.agents[agentId] = agentConfig;

      log.info(`Agent created via Web UI: ${agentId} (${normalAlias})`);
      res.json({ ok: true, agentId, alias: normalAlias, home: agentHome });
    } catch (err) {
      log.error(`Failed to create agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Update agent ──────────────────────────────────────────
  app.put("/api/agents/:id", async (req, res) => {
    const agentId = req.params.id;
    if (!opts.config.agents[agentId]) {
      return res.status(404).json({ error: `Agent "${agentId}" not found` });
    }

    const { name, description, alias, workspace, persistent, streaming, advancedMemory, autonomousCapable, autoCommit, autoCommitBranch, timeout, skills, agentSkills, prompts, tools, mcps, routes, org, cron, goals, instructions, claudeAccount, subAgents, heartbeatInstructions, heartbeatCron, heartbeatEnabled, agentClass, executor, wiki, wikiSync, conversationLogMode, avatar, boardEnabled, boardLayout } = req.body as {
      name?: string; description?: string; alias?: string;
      workspace?: string; persistent?: boolean; streaming?: boolean; advancedMemory?: boolean;
      autonomousCapable?: boolean; autoCommit?: boolean; autoCommitBranch?: string; timeout?: number;
      skills?: string[]; agentSkills?: string[]; prompts?: string[];
      tools?: string[]; mcps?: string[];
      routes?: Array<{ channel: string; chatId: string; requireMention?: boolean; allowFrom?: string[] }>;
      org?: Array<{ organization: string; function: string; title: string; reportsTo?: string }>;
      cron?: Array<{ schedule: string; message: string; channel: string; chatId: string; enabled?: boolean }>;
      goals?: Array<{ id: string; enabled: boolean; description: string; successCriteria?: string; instructions?: string; heartbeat: string; budget?: { maxDailyUsd: number }; reportTo?: string }>;
      instructions?: string;
      claudeAccount?: string;
      subAgents?: string[] | "*";
      heartbeatInstructions?: string;
      heartbeatCron?: string;
      heartbeatEnabled?: boolean;
      agentClass?: "standard" | "platform" | "builder" | "board";
      executor?: string;
      wiki?: boolean;
      wikiSync?: { enabled?: boolean; schedule?: string };
      conversationLogMode?: "shared" | "per-user";
      avatar?: string;
      boardEnabled?: boolean;
      boardLayout?: "small" | "medium" | "large";
    };

    if (!name || !alias) {
      return res.status(400).json({ error: "Missing required fields: name, alias" });
    }

    // Check alias uniqueness (excluding this agent)
    const allAliases = Object.entries(opts.config.agents)
      .filter(([id]) => id !== agentId)
      .flatMap(([, a]) => a.mentionAliases || []);
    const normalAlias = alias.startsWith("@") ? alias : `@${alias}`;
    if (allAliases.includes(normalAlias)) {
      return res.status(409).json({ error: `Alias "${normalAlias}" is already in use` });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const existing = rawConfig.agents[agentId];

      // Update fields
      existing.name = name;
      existing.description = description || existing.description;
      existing.mentionAliases = [normalAlias];
      if (workspace !== undefined) existing.workspace = workspace;
      if (persistent !== undefined) existing.persistent = persistent;
      if (streaming !== undefined) existing.streaming = streaming;
      if (advancedMemory !== undefined) existing.advancedMemory = advancedMemory;
      if (autonomousCapable !== undefined) existing.autonomousCapable = autonomousCapable;
      if (autoCommit !== undefined) existing.autoCommit = autoCommit;
      if (timeout !== undefined) existing.timeout = timeout;
      if (skills !== undefined) existing.skills = skills.length > 0 ? skills : undefined;
      if (agentSkills !== undefined) existing.agentSkills = agentSkills.length > 0 ? agentSkills : undefined;
      if (tools) existing.allowedTools = tools;
      if (mcps !== undefined) existing.mcps = mcps.length > 0 ? mcps : undefined;
      if (claudeAccount !== undefined) existing.claudeAccount = claudeAccount || undefined;
      if (autoCommitBranch !== undefined) existing.autoCommitBranch = autoCommitBranch || undefined;
      if (prompts !== undefined) existing.prompts = prompts.length > 0 ? prompts : undefined;
      if (subAgents !== undefined) existing.subAgents = subAgents;
      if (agentClass !== undefined) existing.agentClass = agentClass;
      if (executor !== undefined) existing.executor = executor || undefined;
      if (org !== undefined) existing.org = org;
      if (cron !== undefined) existing.cron = cron;
      if (goals !== undefined) existing.goals = goals;
      if (wiki !== undefined) existing.wiki = wiki;
      if (wikiSync !== undefined) existing.wikiSync = wikiSync ? { enabled: !!wikiSync.enabled, schedule: wikiSync.schedule || "0 0 * * *" } : undefined;
      if (conversationLogMode !== undefined) existing.conversationLogMode = conversationLogMode;
      if (avatar !== undefined) existing.avatar = avatar || undefined;
      if (boardEnabled !== undefined) existing.boardEnabled = boardEnabled || undefined;
      if (boardLayout !== undefined) existing.boardLayout = boardLayout || undefined;
      // Board class agents are always board-enabled
      if (agentClass === "board") existing.boardEnabled = true;
      // Note: `shared` and `agentHome` cannot be changed after creation to prevent orphaning data.

      // Build routes if provided
      if (routes !== undefined) {
        existing.routes = routes.map(r => ({
          channel: r.channel,
          match: {
            type: r.channel === "slack" ? "channel_id" : "chat_id",
            value: r.chatId,
          },
          permissions: {
            allowFrom: r.allowFrom || ["*"],
            requireMention: r.requireMention ?? true,
          },
        }));
      }

      // Detect agentHome change — update path references in agent files
      const home0 = homedir();
      const rt0 = (p: string) => p.startsWith("~") ? p.replace("~", home0) : p;
      const oldHome = opts.config.agents[agentId]?.agentHome
        ? rt0(opts.config.agents[agentId].agentHome)
        : null;
      const newHome = existing.agentHome ? rt0(existing.agentHome) : null;
      if (oldHome && newHome && oldHome !== newHome) {
        // Update path references in CLAUDE.md and context.md
        for (const relFile of ["CLAUDE.md", "memory/context.md"]) {
          const filePath = join(newHome, relFile);
          if (existsSync(filePath)) {
            try {
              let content = readFileSync(filePath, "utf-8");
              // Replace both tilde and expanded forms of the old path
              const oldHomeTilde = oldHome.replace(home0, "~");
              if (content.includes(oldHome) || content.includes(oldHomeTilde)) {
                const newHomeTilde = newHome.replace(home0, "~");
                content = content.split(oldHome).join(newHome);
                content = content.split(oldHomeTilde).join(newHomeTilde);
                writeFileSync(filePath, content);
                log.info(`Updated path references in ${relFile} for ${agentId}: ${oldHomeTilde} → ${newHomeTilde}`);
              }
            } catch { /* ignore read/write errors */ }
          }
        }
      }

      rawConfig.agents[agentId] = existing;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Write CLAUDE.md if instructions provided
      if (instructions !== undefined) {
        const home2 = homedir();
        const resolveTilde2 = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
        let claudeMdPath: string;
        if (existing.claudeMd) {
          claudeMdPath = resolveTilde2(existing.claudeMd);
        } else if (existing.agentHome) {
          claudeMdPath = join(resolveTilde2(existing.agentHome), "CLAUDE.md");
        } else if (existing.memoryDir) {
          claudeMdPath = join(resolve(resolveTilde2(existing.memoryDir), ".."), "CLAUDE.md");
        } else {
          claudeMdPath = join(getPersonalAgentsDir(), agentId, "CLAUDE.md");
        }
        try {
          writeFileSync(claudeMdPath, instructions);
          log.info(`Updated CLAUDE.md for ${agentId} at ${claudeMdPath}`);
        } catch (writeErr) {
          log.warn(`Failed to write CLAUDE.md for ${agentId}: ${writeErr}`);
        }
      }

      // Write heartbeat.md if provided
      if (heartbeatInstructions !== undefined) {
        const home3 = homedir();
        const resolveTilde3 = (p: string) => p.startsWith("~") ? p.replace("~", home3) : p;
        const agentHome3 = existing.agentHome
          ? resolveTilde3(existing.agentHome)
          : existing.memoryDir
            ? resolve(resolveTilde3(existing.memoryDir), "..")
            : join(getPersonalAgentsDir(), agentId);
        const hbPath = join(agentHome3, "heartbeat.md");
        try {
          if (heartbeatInstructions) {
            writeFileSync(hbPath, heartbeatInstructions);
            log.info(`Updated heartbeat.md for ${agentId}`);
          } else {
            // Empty string = remove heartbeat.md
            if (existsSync(hbPath)) {
              unlinkSync(hbPath);
              log.info(`Removed heartbeat.md for ${agentId}`);
            }
          }
        } catch (writeErr) {
          log.warn(`Failed to write heartbeat.md for ${agentId}: ${writeErr}`);
        }
      }

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent update failed: ${buildErr}`);
      }

      // Update in-memory config
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const memAgent = { ...existing };
      memAgent.workspace = resolveTilde(memAgent.workspace || "~");
      if (memAgent.claudeMd) memAgent.claudeMd = resolveTilde(memAgent.claudeMd);
      if (memAgent.memoryDir) memAgent.memoryDir = resolveTilde(memAgent.memoryDir);
      memAgent.timeout = 120_000;
      opts.config.agents[agentId] = memAgent;

      log.info(`Agent updated via Web UI: ${agentId}`);
      res.json({ ok: true, agentId });
    } catch (err) {
      log.error(`Failed to update agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Delete agent ──────────────────────────────────────────
  app.delete("/api/agents/:id", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    // Require confirmation alias in the request body
    const { confirmAlias } = (req.body || {}) as { confirmAlias?: string };
    const agentAlias = agent.mentionAliases?.[0] || agentId;
    if (!confirmAlias || confirmAlias !== agentAlias) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirmAlias": "${agentAlias}" } to confirm deletion.`,
        requiredAlias: agentAlias,
      });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      if (!rawConfig.agents[agentId]) {
        return res.status(404).json({ error: `Agent "${agentId}" not in config.json` });
      }

      // Resolve agentHome for directory cleanup
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentEntry = rawConfig.agents[agentId];
      let agentHome: string | null = null;
      if (agentEntry.agentHome) {
        agentHome = resolveTilde(agentEntry.agentHome);
      } else if (agentEntry.memoryDir) {
        agentHome = resolve(resolveTilde(agentEntry.memoryDir), "..");
      }

      // Remove from config.json
      delete rawConfig.agents[agentId];
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Remove from in-memory config
      delete opts.config.agents[agentId];

      // Remove agentHome directory
      let dirRemoved = false;
      if (agentHome && existsSync(agentHome)) {
        const { rmSync } = await import("node:fs");
        rmSync(agentHome, { recursive: true, force: true });
        dirRemoved = true;
        log.info(`Removed agent home directory: ${agentHome}`);
      }

      // Rebuild
      try {
        execSync("npm run build", { cwd: opts.baseDir, timeout: 30_000 });
      } catch (buildErr) {
        log.warn(`Build after agent delete failed: ${buildErr}`);
      }

      log.info(`Agent deleted via Web UI: ${agentId} (alias: ${agentAlias}, dir removed: ${dirRemoved})`);
      res.json({ ok: true, agentId, alias: agentAlias, directoryRemoved: dirRemoved, agentHome });
    } catch (err) {
      log.error(`Failed to delete agent: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Available MCPs ──────────────────────────────────────────
  app.get("/api/mcps", (_req, res) => {
    const mcps = Object.keys(opts.config.mcps || {});
    res.json({ mcps });
  });

  // ─── API: MCP catalog (for connect UI) ─────────────────────────────
  app.get("/api/mcp-catalog", (_req, res) => {
    const catalogPath = join(opts.baseDir, "mcp-catalog.json");
    if (!existsSync(catalogPath)) return res.json({ mcps: {} });
    try {
      const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
      res.json({ mcps: catalog.mcps || {} });
    } catch {
      res.json({ mcps: {} });
    }
  });

  // ─── API: Agent MCP keys — list configured (names only, not values) ──
  app.get("/api/agents/:id/mcp-keys", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const keysDir = join(agentHome, "mcp-keys");

    const configured: Record<string, string[]> = {};
    if (existsSync(keysDir)) {
      try {
        const files = readdirSync(keysDir);
        for (const file of files) {
          if (!file.endsWith(".env")) continue;
          const mcpName = file.replace(".env", "");
          try {
            const content = readFileSync(join(keysDir, file), "utf-8");
            const keys = content.split("\n")
              .filter(l => l.includes("=") && !l.startsWith("#"))
              .map(l => l.split("=")[0].trim());
            configured[mcpName] = keys;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    res.json({ configured });
  });

  // ─── API: Agent MCP keys — save a key ─────────────────────────────
  app.post("/api/agents/:id/mcp-keys", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { mcpName, envVar, value } = req.body as { mcpName?: string; envVar?: string; value?: string };
    if (!mcpName || !envVar || !value) {
      return res.status(400).json({ error: "Missing mcpName, envVar, or value" });
    }

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const keysDir = join(agentHome, "mcp-keys");
    mkdirSync(keysDir, { recursive: true });

    const envFile = join(keysDir, `${mcpName}.env`);
    const encFile = envFile + ".enc";

    // Read existing content — decrypt if encrypted, skip stubs
    let lines: string[] = [];
    if (existsSync(encFile)) {
      try {
        const secret = getEncryptionSecret();
        const data = readFileSync(encFile);
        const content = decryptAuto(data, secret);
        lines = content.split("\n");
      } catch { /* start fresh */ }
    } else if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf-8");
      if (!content.includes("# Encrypted")) {
        lines = content.split("\n");
      }
    }

    const idx = lines.findIndex(l => l.startsWith(`${envVar}=`));
    if (idx >= 0) {
      lines[idx] = `${envVar}=${value}`;
    } else {
      lines.push(`${envVar}=${value}`);
    }
    const plaintext = lines.filter(l => l.trim()).join("\n") + "\n";

    // Encrypt on write — never store plaintext
    try {
      const secret = getEncryptionSecret();
      const encrypted = encryptAuto(plaintext, secret);
      writeFileSync(encFile, encrypted);
      writeFileSync(envFile, `# Encrypted — see ${mcpName}.env.enc\n`);
    } catch {
      // Fallback to plaintext if encryption fails (e.g., no keychain)
      writeFileSync(envFile, plaintext);
    }

    log.info(`[MCP Keys] Saved ${envVar} for ${req.params.id} → ${mcpName}.env`);
    res.json({ ok: true, mcpName, envVar });
  });

  // ─── API: Agent MCP keys — delete a key ───────────────────────────
  app.delete("/api/agents/:id/mcp-keys/:mcpName", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const envFile = join(agentHome, "mcp-keys", `${req.params.mcpName}.env`);
    const encFile = envFile + ".enc";

    if (existsSync(encFile)) unlinkSync(encFile);
    if (existsSync(envFile)) unlinkSync(envFile);
    log.info(`[MCP Keys] Deleted ${req.params.mcpName} key files for ${req.params.id}`);
    res.json({ ok: true });
  });

  // ─── API: Named MCP connections (multi-account) ─────────────────
  // Creates a named instance of an MCP (e.g., "gmail-work") pointing to the same server
  // but with different credentials. Also stores label metadata for agent context.

  app.post("/api/agents/:id/mcp-connections", async (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { baseMcp, label, envVar, value, description } = req.body as {
      baseMcp?: string; label?: string; envVar?: string; value?: string; description?: string;
    };
    if (!baseMcp || !label || !envVar || !value) {
      return res.status(400).json({ error: "Missing baseMcp, label, envVar, or value" });
    }

    // Generate instance name from base + label: "gmail" + "Work" → "gmail-work"
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const instanceName = `${baseMcp}-${slug}`;

    // Check if the base MCP exists in registry
    const mcpRegistry = opts.config.mcps || {};
    const baseMcpConfig = mcpRegistry[baseMcp];
    if (!baseMcpConfig) {
      return res.status(400).json({ error: `Base MCP "${baseMcp}" not found in registry` });
    }

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Ensure the base MCP is in the agent's mcps array (don't add named instance)
      if (!rawConfig.agents[agentId].mcps) rawConfig.agents[agentId].mcps = [];
      if (!rawConfig.agents[agentId].mcps.includes(baseMcp)) {
        rawConfig.agents[agentId].mcps.push(baseMcp);
      }

      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Save the key to agent's mcp-keys
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      const keysDir = join(agentHome, "mcp-keys");
      mkdirSync(keysDir, { recursive: true });
      const connPlaintext = `${envVar}=${value}\n`;
      try {
        const secret = getEncryptionSecret();
        const encrypted = encryptAuto(connPlaintext, secret);
        writeFileSync(join(keysDir, `${instanceName}.env.enc`), encrypted);
        writeFileSync(join(keysDir, `${instanceName}.env`), `# Encrypted — see ${instanceName}.env.enc\n`);
      } catch {
        writeFileSync(join(keysDir, `${instanceName}.env`), connPlaintext);
      }

      // Save metadata (label + description) for agent context injection
      const accountsPath = join(agentHome, "mcp-accounts.json");
      let accounts: Record<string, { label: string; baseMcp: string; description?: string }> = {};
      if (existsSync(accountsPath)) {
        try { accounts = JSON.parse(readFileSync(accountsPath, "utf-8")); } catch { /* ignore */ }
      }
      accounts[instanceName] = { label, baseMcp, description };
      writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));

      // Update in-memory config — sync from what was written to disk
      if (opts.config.mcps) opts.config.mcps[instanceName] = { ...baseMcpConfig };
      const savedAgent = rawConfig.agents[agentId];
      opts.config.agents[agentId].mcps = savedAgent.mcps;

      log.info(`[MCP Connect] Created ${instanceName} for ${agentId} (base: ${baseMcp}, label: ${label})`);
      res.json({ ok: true, instanceName, label, baseMcp });
    } catch (err) {
      log.error(`Failed to create MCP connection: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // List named connections for an agent
  app.get("/api/agents/:id/mcp-connections", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home = homedir();
    const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
    const agentHome = agent.agentHome
      ? resolveTilde(agent.agentHome)
      : resolve(opts.baseDir, agent.memoryDir, "..");
    const accountsPath = join(agentHome, "mcp-accounts.json");

    let accounts: Record<string, any> = {};
    if (existsSync(accountsPath)) {
      try { accounts = JSON.parse(readFileSync(accountsPath, "utf-8")); } catch { /* ignore */ }
    }
    res.json({ connections: accounts });
  });

  // Delete a named connection
  app.delete("/api/agents/:id/mcp-connections/:instanceName", (req, res) => {
    const agentId = req.params.id;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const instanceName = req.params.instanceName;

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      // Remove from mcps registry
      delete rawConfig.mcps[instanceName];

      // Remove from agent's mcps array
      if (rawConfig.agents[agentId].mcps) {
        rawConfig.agents[agentId].mcps = rawConfig.agents[agentId].mcps.filter((m: string) => m !== instanceName);
      }

      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Remove key file
      const home = homedir();
      const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
      const agentHome = agent.agentHome
        ? resolveTilde(agent.agentHome)
        : resolve(opts.baseDir, agent.memoryDir, "..");
      const envFile = join(agentHome, "mcp-keys", `${instanceName}.env`);
      if (existsSync(envFile)) {
        unlinkSync(envFile);
      }

      // Remove from accounts metadata
      const accountsPath = join(agentHome, "mcp-accounts.json");
      if (existsSync(accountsPath)) {
        try {
          const accounts = JSON.parse(readFileSync(accountsPath, "utf-8"));
          delete accounts[instanceName];
          writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
        } catch { /* ignore */ }
      }

      // Update in-memory
      if (opts.config.mcps) delete opts.config.mcps[instanceName];
      if (agent.mcps) {
        agent.mcps = agent.mcps.filter((m: string) => m !== instanceName);
      }

      log.info(`[MCP Connect] Deleted ${instanceName} from ${agentId}`);
      res.json({ ok: true });
    } catch (err) {
      log.error(`Failed to delete MCP connection: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Trigger goal now ──────────────────────────────────────────
  app.post("/api/agents/:id/goals/:goalId/trigger", async (req, res) => {
    const agentId = req.params.id;
    const goalId = req.params.goalId;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const goal = agent.goals?.find((g: any) => g.id === goalId);
    if (!goal) return res.status(404).json({ error: `Goal "${goalId}" not found` });

    log.info(`[Goal Trigger] Manual trigger: ${agentId}/${goalId}`);

    // Respond immediately — execution happens async
    res.json({ ok: true, message: `Goal "${goalId}" triggered. Running in background...` });

    // Execute in background
    try {
      const driverMap = opts.driverMap || new Map();
      const result = await executeGoal(
        agentId, agent, goal, opts.baseDir, driverMap,
        opts.config.mcps, opts.config.service.claudeAccounts,
      );
      log.info(`[Goal Trigger] Completed: ${agentId}/${goalId} — ${result.status}`);
    } catch (err) {
      log.error(`[Goal Trigger] Failed: ${agentId}/${goalId} — ${err}`);
    }
  });

  // ─── API: Toggle goal enabled/paused ────────────────────────────────
  app.post("/api/agents/:id/goals/:goalId/toggle", (req, res) => {
    const agentId = req.params.id;
    const goalId = req.params.goalId;

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const goal = agent.goals?.find((g: any) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: `Goal "${goalId}" not found` });

      goal.enabled = !goal.enabled;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memGoal = opts.config.agents[agentId]?.goals?.find((g: any) => g.id === goalId);
      if (memGoal) memGoal.enabled = goal.enabled;

      log.info(`[Goal Toggle] ${agentId}/${goalId} → ${goal.enabled ? 'enabled' : 'paused'}`);
      res.json({ ok: true, goalId, enabled: goal.enabled });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Toggle schedule enabled/paused ──────────────────────────
  app.post("/api/agents/:id/cron/:index/toggle", (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);

    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

      const job = agent.cron[index];
      job.enabled = job.enabled === false ? true : false;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      if (opts.config.agents[agentId]?.cron?.[index]) {
        opts.config.agents[agentId].cron[index].enabled = job.enabled;
      }

      log.info(`[Cron Toggle] ${agentId}/cron[${index}] → ${job.enabled ? 'enabled' : 'paused'}`);
      res.json({ ok: true, index, enabled: job.enabled });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Trigger schedule now ────────────────────────────────────
  app.post("/api/agents/:id/cron/:index/trigger", async (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

    const job = agent.cron[index];
    log.info(`[Cron Trigger] Manual trigger: ${agentId}/cron[${index}] — "${job.message.slice(0, 60)}"`);

    res.json({ ok: true, message: `Schedule triggered. Running in background...` });

    // Execute via webhook handler
    if (opts.onWebhookMessage) {
      try {
        await opts.onWebhookMessage(agentId, job.message, job.channel, job.chatId);
        log.info(`[Cron Trigger] Completed: ${agentId}/cron[${index}]`);
      } catch (err) {
        log.error(`[Cron Trigger] Failed: ${agentId}/cron[${index}] — ${err}`);
      }
    }
  });

  // ─── API: All automations (goals + crons across all agents) ────────
  app.get("/api/automations", (_req, res) => {
    const goals: any[] = [];
    const crons: any[] = [];
    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;

    for (const [agentId, agent] of Object.entries(opts.config.agents)) {
      for (const g of (agent.goals || [])) {
        goals.push({ ...g, agentId, agentName: agent.name });
      }
      for (let i = 0; i < (agent.cron || []).length; i++) {
        const c = agent.cron![i];
        crons.push({ ...c, index: i, agentId, agentName: agent.name });
      }
    }
    res.json({ goals, crons });
  });

  // ─── API: Goal run history ────────────────────────────────────────
  app.get("/api/agents/:id/goals/:goalId/history", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
    const agentHome = agent.agentHome ? rt(agent.agentHome) : resolve(opts.baseDir, agent.memoryDir, "..");
    const goalsDir = join(agentHome, "goals");
    const entries: any[] = [];

    if (existsSync(goalsDir)) {
      try {
        const files = readdirSync(goalsDir).filter(f => f.startsWith("log-") && f.endsWith(".jsonl")).sort().reverse();
        for (const file of files.slice(0, 7)) { // last 7 days
          try {
            const content = readFileSync(join(goalsDir, file), "utf-8");
            for (const line of content.trim().split("\n")) {
              try {
                const entry = JSON.parse(line);
                if (entry.goalId === req.params.goalId) entries.push(entry);
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    res.json({ history: entries });
  });

  // ─── API: Cron run history (from conversation logs) ───────────────
  app.get("/api/agents/:id/cron/:index/history", (req, res) => {
    const agent = opts.config.agents[req.params.id];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const index = parseInt(req.params.index);
    const cronJob = agent.cron?.[index];
    if (!cronJob) return res.status(404).json({ error: "Schedule not found" });

    const home2 = process.env.HOME || process.env.USERPROFILE || "";
    const rt = (p: string) => p.startsWith("~") ? p.replace("~", home2) : p;
    const memDir = rt(agent.memoryDir);
    const logPath = join(memDir, "conversation_log.jsonl");
    const entries: any[] = [];

    if (existsSync(logPath)) {
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n").slice(-200);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            // Match cron entries by channel and message content
            if ((entry.channel === "cron" || entry.channel === "webhook") &&
                entry.text && cronJob.message && entry.text.includes(cronJob.message.slice(0, 30))) {
              entries.push(entry);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    res.json({ history: entries.slice(0, 20) });
  });

  // ─── API: Delete goal ─────────────────────────────────────────────
  app.delete("/api/agents/:id/goals/:goalId", (req, res) => {
    const agentId = req.params.id;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const idx = (agent.goals || []).findIndex((g: any) => g.id === req.params.goalId);
      if (idx < 0) return res.status(404).json({ error: "Goal not found" });

      agent.goals.splice(idx, 1);
      if (agent.goals.length === 0) delete agent.goals;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.goals) {
        memAgent.goals = memAgent.goals.filter((g: any) => g.id !== req.params.goalId);
      }

      log.info(`[Goal Delete] ${agentId}/${req.params.goalId}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Delete cron ─────────────────────────────────────────────
  app.delete("/api/agents/:id/cron/:index", (req, res) => {
    const agentId = req.params.id;
    const index = parseInt(req.params.index);
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: "Schedule not found" });

      agent.cron.splice(index, 1);
      if (agent.cron.length === 0) delete agent.cron;
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.cron) {
        memAgent.cron.splice(index, 1);
      }

      log.info(`[Cron Delete] ${agentId}/cron[${index}]`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Create goal for agent ───────────────────────────────────
  app.post("/api/agents/:id/goals", (req, res) => {
    const agentId = req.params.id;
    const goal = req.body as any;
    if (!goal?.id || !goal?.description || !goal?.heartbeat) {
      return res.status(400).json({ error: "Missing id, description, or heartbeat" });
    }
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      if (!agent.goals) agent.goals = [];
      if (agent.goals.some((g: any) => g.id === goal.id)) {
        return res.status(409).json({ error: `Goal "${goal.id}" already exists` });
      }
      agent.goals.push(goal);
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (!memAgent.goals) memAgent.goals = [];
      memAgent.goals.push(goal);

      log.info(`[Goal Create] ${agentId}/${goal.id}`);
      res.json({ ok: true, goalId: goal.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── API: Create cron for agent ───────────────────────────────────
  app.post("/api/agents/:id/cron", (req, res) => {
    const agentId = req.params.id;
    const cronJob = req.body as any;
    if (!cronJob?.schedule || !cronJob?.message || !cronJob?.channel || !cronJob?.chatId) {
      return res.status(400).json({ error: "Missing schedule, message, channel, or chatId" });
    }
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      if (!agent.cron) agent.cron = [];
      agent.cron.push(cronJob);
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (!memAgent.cron) memAgent.cron = [];
      memAgent.cron.push(cronJob);

      log.info(`[Cron Create] ${agentId} — "${cronJob.schedule}"`);
      res.json({ ok: true, index: agent.cron.length - 1 });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ─── Webhook endpoint ─────────────────────────────────────────────
  app.post("/webhook/:agentId", async (req, res) => {
    if (opts.webhookSecret) {
      const provided = req.headers["x-webhook-secret"] || req.query.secret;
      if (provided !== opts.webhookSecret) {
        return res.status(401).json({ error: "Invalid webhook secret" });
      }
    }

    const { agentId } = req.params;
    const agent = opts.config.agents[agentId];
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found` });

    const { text, channel, chatId } = req.body as { text?: string; channel?: string; chatId?: string };
    if (!text) return res.status(400).json({ error: "Missing 'text' in body" });

    const route = agent.routes[0];
    const replyChannel = channel || route.channel;
    const replyChatId = chatId || String(route.match.value);

    if (opts.onWebhookMessage) {
      try {
        await opts.onWebhookMessage(agentId, text, replyChannel, replyChatId);
        res.json({ ok: true, agentId, channel: replyChannel, chatId: replyChatId });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    } else {
      res.status(501).json({ error: "Webhook handler not configured" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  NEW API ENDPOINTS — Sessions, Model, Cost, Pairing, Logs, Memory, Skills
  // ═══════════════════════════════════════════════════════════════════

  const home = homedir();
  const tilde = (p: string) => p?.startsWith("~") ? p.replace("~", home) : p;

  // Helper: resolve agent memoryDir
  function agentMemDir(agentId: string): string | null {
    const agent = opts.config.agents[agentId];
    if (!agent) return null;
    return tilde(agent.memoryDir || join(agent.agentHome || "", "memory"));
  }

  // ─── API: Sessions ──────────────────────────────────────────────────

  // GET /api/agents/:agentId/sessions — list all sessions for an agent
  app.get("/api/agents/:agentId/sessions", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    if (!existsSync(memDir)) return res.json({ sessions: [] });
    try {
      const files = readdirSync(memDir).filter(f => f.startsWith("session") && f.endsWith(".json"));
      const sessions = files.map(f => {
        try {
          const data = JSON.parse(readFileSync(join(memDir, f), "utf-8"));
          const senderMatch = f.match(/^session-(.+)\.json$/);
          return {
            senderId: senderMatch ? senderMatch[1] : "default",
            sessionId: data.sessionId,
            createdAt: data.createdAt,
            messageCount: data.messageCount || 0,
            file: f,
          };
        } catch { return null; }
      }).filter(Boolean);
      res.json({ sessions });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agents/:agentId/sessions/reset — reset session (optionally for a sender)
  app.post("/api/agents/:agentId/sessions/reset", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { senderId } = req.body as { senderId?: string };
    const fileName = senderId ? `session-${senderId}.json` : "session.json";
    const sessionPath = join(memDir, fileName);
    if (!existsSync(sessionPath)) return res.json({ ok: true, message: "No session to reset" });
    try {
      const state = JSON.parse(readFileSync(sessionPath, "utf-8"));
      unlinkSync(sessionPath);
      res.json({ ok: true, previousMessages: state.messageCount || 0 });
    } catch (e: any) {
      try { unlinkSync(sessionPath); } catch { /* ignore */ }
      res.json({ ok: true, message: "Session file removed" });
    }
  });

  // DELETE /api/agents/:agentId/sessions/:senderId — delete a specific session
  app.delete("/api/agents/:agentId/sessions/:senderId", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const fileName = req.params.senderId === "default" ? "session.json" : `session-${req.params.senderId}.json`;
    const sessionPath = join(memDir, fileName);
    if (!existsSync(sessionPath)) return res.status(404).json({ error: "Session not found" });
    try { unlinkSync(sessionPath); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Named Session Tabs (server-side persistence) ─────────────────────

  function sessionTabsPath(agentId: string): string | null {
    const memDir = agentMemDir(agentId);
    if (!memDir) return null;
    return join(memDir, "session-tabs.json");
  }

  function readSessionTabs(agentId: string): { tabs: any[] } {
    const p = sessionTabsPath(agentId);
    if (!p || !existsSync(p)) return { tabs: [] };
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return { tabs: [] }; }
  }

  function writeSessionTabs(agentId: string, data: { tabs: any[] }): void {
    const p = sessionTabsPath(agentId);
    if (!p) return;
    const memDir = agentMemDir(agentId)!;
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2));
  }

  // GET /api/agents/:agentId/session-tabs — list all named sessions with last activity
  app.get("/api/agents/:agentId/session-tabs", (req, res) => {
    if (!agentMemDir(req.params.agentId)) return res.status(404).json({ error: "Agent not found" });
    const data = readSessionTabs(req.params.agentId);
    const memDir = agentMemDir(req.params.agentId)!;
    const logPath = join(memDir, "conversation_log.jsonl");
    // Enrich each tab with lastMessageAt + lastPreview from JSONL
    if (existsSync(logPath)) {
      try {
        const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
        const lastByTab: Record<string, { ts: string; preview: string }> = {};
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.from && (!lastByTab[e.from] || e.ts > lastByTab[e.from].ts)) {
              lastByTab[e.from] = { ts: e.ts, preview: (e.text || "").slice(0, 60) };
            }
          } catch { /* skip malformed */ }
        }
        data.tabs = data.tabs.map((t: any) => ({
          ...t,
          lastMessageAt: lastByTab[t.id]?.ts || t.createdAt,
          lastPreview: lastByTab[t.id]?.preview || "",
        }));
      } catch { /* ignore, return tabs without enrichment */ }
    }
    // Sort newest first
    data.tabs.sort((a: any, b: any) => (b.lastMessageAt || b.createdAt) > (a.lastMessageAt || a.createdAt) ? 1 : -1);
    res.json({ tabs: data.tabs });
  });

  // POST /api/agents/:agentId/session-tabs — register/upsert a tab
  app.post("/api/agents/:agentId/session-tabs", (req, res) => {
    const { agentId } = req.params;
    if (!agentMemDir(agentId)) return res.status(404).json({ error: "Agent not found" });
    const { tabId, label, targetAgentId } = req.body as { tabId?: string; label?: string; targetAgentId?: string };
    if (!tabId) return res.status(400).json({ error: "tabId required" });
    // Validate targetAgentId if provided
    if (targetAgentId && !opts.config.agents[targetAgentId]) {
      return res.status(400).json({ error: `targetAgentId "${targetAgentId}" not found` });
    }
    const data = readSessionTabs(agentId);
    const idx = data.tabs.findIndex((t: any) => t.id === tabId);
    if (idx >= 0) {
      if (label) data.tabs[idx].label = label;
      if (targetAgentId !== undefined) data.tabs[idx].targetAgentId = targetAgentId || null;
      data.tabs[idx].updatedAt = new Date().toISOString();
    } else {
      data.tabs.push({ id: tabId, label: label || `Session ${data.tabs.length + 1}`, ...(targetAgentId ? { targetAgentId } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    writeSessionTabs(agentId, data);
    res.json({ ok: true, tab: data.tabs.find((t: any) => t.id === tabId) });
  });

  // PUT /api/agents/:agentId/session-tabs/:tabId — rename a tab
  app.put("/api/agents/:agentId/session-tabs/:tabId", (req, res) => {
    const { agentId, tabId } = req.params;
    if (!agentMemDir(agentId)) return res.status(404).json({ error: "Agent not found" });
    const { label } = req.body as { label?: string };
    if (!label?.trim()) return res.status(400).json({ error: "label required" });
    const data = readSessionTabs(agentId);
    const tab = data.tabs.find((t: any) => t.id === tabId);
    if (!tab) return res.status(404).json({ error: "Tab not found" });
    tab.label = label.trim();
    tab.updatedAt = new Date().toISOString();
    writeSessionTabs(agentId, data);
    res.json({ ok: true, tab });
  });

  // DELETE /api/agents/:agentId/session-tabs/:tabId — permanently delete a tab + its session
  app.delete("/api/agents/:agentId/session-tabs/:tabId", (req, res) => {
    const { agentId, tabId } = req.params;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const data = readSessionTabs(agentId);
    data.tabs = data.tabs.filter((t: any) => t.id !== tabId);
    writeSessionTabs(agentId, data);
    // Also clear the Claude session file so if re-opened it starts fresh
    const sessionFile = join(memDir, `session-${tabId}.json`);
    if (existsSync(sessionFile)) { try { unlinkSync(sessionFile); } catch { /* ignore */ } }
    res.json({ ok: true });
  });

  // GET /api/agents/:agentId/session-tabs/:tabId/history — replay chat from JSONL
  app.get("/api/agents/:agentId/session-tabs/:tabId/history", (req, res) => {
    const { agentId, tabId } = req.params;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const logPath = join(memDir, "conversation_log.jsonl");
    if (!existsSync(logPath)) return res.json({ messages: [] });
    try {
      const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
      const messages: any[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.from !== tabId) continue;
          if (e.text) messages.push({ role: "user", text: e.text, time: e.ts });
          if (e.response) messages.push({ role: "agent", text: e.response, time: e.ts });
        } catch { /* skip malformed */ }
      }
      res.json({ messages });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── API: Model Overrides ───────────────────────────────────────────

  // GET /api/agents/:agentId/model — get current model override
  app.get("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const p = join(memDir, "model-override.json");
    if (!existsSync(p)) return res.json({ model: null, isOverride: false });
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      res.json({ model: data.model || null, isOverride: true });
    } catch { res.json({ model: null, isOverride: false }); }
  });

  // PUT /api/agents/:agentId/model — set model override
  app.put("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { model } = req.body as { model?: string };
    if (!model?.trim()) return res.status(400).json({ error: "model required" });
    const aliases: Record<string, string> = {
      opus: "claude-opus-4-7", sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5-20251001", "opus-4": "claude-opus-4-7",
      "opus-4.7": "claude-opus-4-7", "opus-4.6": "claude-opus-4-6", "sonnet-4": "claude-sonnet-4-6",
    };
    const resolved = aliases[model.trim().toLowerCase()] || model.trim();
    writeFileSync(join(memDir, "model-override.json"), JSON.stringify({ model: resolved }));
    res.json({ ok: true, model: resolved });
  });

  // DELETE /api/agents/:agentId/model — clear model override
  app.delete("/api/agents/:agentId/model", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const p = join(memDir, "model-override.json");
    if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
    res.json({ ok: true });
  });

  // ─── API: Cost Tracking ─────────────────────────────────────────────

  // GET /api/agents/:agentId/cost?period=today|week|all — cost summary
  app.get("/api/agents/:agentId/cost", (req, res) => {
    const agentId = req.params.agentId;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const agentCfg = opts.config.agents[agentId];
    const isPerUser = (agentCfg as any)?.conversationLogMode === "per-user";
    // For per-user mode, aggregate all per-user log files
    const logFiles = isPerUser
      ? (existsSync(memDir) ? readdirSync(memDir).filter(f => f.startsWith("conversation_log_") && f.endsWith(".jsonl")).map(f => join(memDir, f)) : [])
      : [join(memDir, "conversation_log.jsonl")];
    const anyExists = logFiles.some(f => existsSync(f));
    if (!anyExists) return res.json({ today: 0, week: 0, allTime: 0, totalMessages: 0, entries: [] });
    try {
      const entries = logFiles.flatMap(logPath => {
        if (!existsSync(logPath)) return [];
        return readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      });
      const sum = (arr: any[]) => arr.reduce((s: number, e: any) => s + (e.cost || 0), 0);
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const todayEntries = entries.filter((e: any) => e.ts?.startsWith(today));
      const weekEntries = entries.filter((e: any) => e.ts >= weekAgo);

      // Optional: return per-day breakdown
      const byDay: Record<string, { cost: number; messages: number }> = {};
      for (const e of entries) {
        const day = e.ts?.slice(0, 10);
        if (!day) continue;
        if (!byDay[day]) byDay[day] = { cost: 0, messages: 0 };
        byDay[day].cost += e.cost || 0;
        byDay[day].messages += 1;
      }

      res.json({
        today: sum(todayEntries),
        week: sum(weekEntries),
        allTime: sum(entries),
        totalMessages: entries.length,
        byDay,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/cost/all — cost summary across ALL agents
  // ─── API: Conversation Logs ─────────────────────────────────────────

  // GET /api/agents/:agentId/logs?limit=50&offset=0&search=keyword&sender=<senderId>
  // When conversationLogMode is "per-user", aggregates all per-user log files unless ?sender= is specified.
  app.get("/api/agents/:agentId/logs", (req, res) => {
    const agentId = req.params.agentId;
    const memDir = agentMemDir(agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const agentCfg = opts.config.agents[agentId];
    const isPerUser = (agentCfg as any)?.conversationLogMode === "per-user";
    const senderFilter = req.query.sender as string | undefined;

    const readLog = (path: string): any[] => {
      if (!existsSync(path)) return [];
      try {
        return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    };

    let entries: any[];
    if (isPerUser) {
      // Collect all per-user log files, or just the specified sender's file
      if (senderFilter) {
        const sanitized = senderFilter.replace(/[^a-zA-Z0-9_-]/g, "_");
        entries = readLog(join(memDir, `conversation_log_${sanitized}.jsonl`));
      } else {
        // Aggregate all per-user log files
        const files = existsSync(memDir)
          ? readdirSync(memDir).filter(f => f.startsWith("conversation_log_") && f.endsWith(".jsonl"))
          : [];
        entries = files.flatMap(f => readLog(join(memDir, f)));
        // Sort by timestamp after aggregation
        entries.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      }
    } else {
      entries = readLog(join(memDir, "conversation_log.jsonl"));
    }

    // Search filter
    const search = req.query.search as string;
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter((e: any) =>
        (e.text || "").toLowerCase().includes(q) ||
        (e.response || "").toLowerCase().includes(q)
      );
    }

    const total = entries.length;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // Return newest first
    entries.reverse();
    entries = entries.slice(offset, offset + limit);

    res.json({ entries, total, limit, offset, perUserMode: isPerUser });
  });

  // ─── API: Memory Management ─────────────────────────────────────────

  // GET /api/agents/:agentId/memory?limit=20 — list memory entries (context.md + daily files)
  app.get("/api/agents/:agentId/memory", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const entries: any[] = [];

    // context.md
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) {
      try {
        const content = readFileSync(ctxPath, "utf-8");
        entries.push({ type: "context", file: "context.md", size: content.length, preview: content.slice(0, 500) });
      } catch { /* skip */ }
    }

    // Daily memory files
    const dailyDir = join(memDir, "daily");
    if (existsSync(dailyDir)) {
      try {
        const files = readdirSync(dailyDir).filter(f => f.endsWith(".md")).sort().reverse();
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        for (const f of files.slice(0, limit)) {
          try {
            const content = readFileSync(join(dailyDir, f), "utf-8");
            entries.push({ type: "daily", file: f, size: content.length, preview: content.slice(0, 500) });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Memory index (if advanced memory is enabled)
    const indexPath = join(memDir, "memory-index.json");
    if (existsSync(indexPath)) {
      try {
        const idx = JSON.parse(readFileSync(indexPath, "utf-8"));
        entries.push({ type: "index", file: "memory-index.json", chunks: Array.isArray(idx) ? idx.length : (idx.chunks?.length || 0) });
      } catch { /* skip */ }
    }

    res.json({ entries });
  });

  // POST /api/agents/:agentId/memory/search — search memory (simple keyword)
  app.post("/api/agents/:agentId/memory/search", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { query } = req.body as { query?: string };
    if (!query?.trim()) return res.status(400).json({ error: "query required" });
    const q = query.toLowerCase();
    const results: any[] = [];

    // Search context.md
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) {
      const content = readFileSync(ctxPath, "utf-8");
      if (content.toLowerCase().includes(q)) {
        results.push({ file: "context.md", type: "context", snippet: extractSnippet(content, q) });
      }
    }

    // Search daily files
    const dailyDir = join(memDir, "daily");
    if (existsSync(dailyDir)) {
      for (const f of readdirSync(dailyDir).filter(f => f.endsWith(".md")).sort().reverse()) {
        const content = readFileSync(join(dailyDir, f), "utf-8");
        if (content.toLowerCase().includes(q)) {
          results.push({ file: `daily/${f}`, type: "daily", snippet: extractSnippet(content, q) });
        }
        if (results.length >= 20) break;
      }
    }

    res.json({ results, query });
  });

  // DELETE /api/agents/:agentId/memory/context — clear context.md
  app.delete("/api/agents/:agentId/memory/context", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const ctxPath = join(memDir, "context.md");
    if (existsSync(ctxPath)) writeFileSync(ctxPath, "");
    res.json({ ok: true });
  });

  // ─── API: Memory Write ─────────────────────────────────────────────
  app.post("/api/agents/:agentId/memory/write", (req, res) => {
    const memDir = agentMemDir(req.params.agentId);
    if (!memDir) return res.status(404).json({ error: "Agent not found" });
    const { target, content } = req.body as any;
    if (!content) return res.status(400).json({ error: "content is required" });

    try {
      if (target === "context") {
        const ctxPath = join(memDir, "context.md");
        const existing = existsSync(ctxPath) ? readFileSync(ctxPath, "utf-8") : "";
        writeFileSync(ctxPath, existing ? existing + "\n" + content : content);
        res.json({ ok: true, file: "context.md", action: "appended" });
      } else if (target === "daily") {
        const dailyDir = join(memDir, "daily");
        mkdirSync(dailyDir, { recursive: true });
        const today = new Date().toISOString().slice(0, 10);
        const dailyPath = join(dailyDir, `${today}.md`);
        const existing = existsSync(dailyPath) ? readFileSync(dailyPath, "utf-8") : "";
        writeFileSync(dailyPath, existing ? existing + "\n" + content : content);
        res.json({ ok: true, file: `daily/${today}.md`, action: "appended" });
      } else {
        // Default: overwrite context.md entirely
        const ctxPath = join(memDir, "context.md");
        writeFileSync(ctxPath, content);
        res.json({ ok: true, file: "context.md", action: "overwritten" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Skill Content Read ──────────────────────────────────────
  app.get("/api/skills/content", (req, res) => {
    const skillPath = req.query.path as string;
    if (!skillPath) return res.status(400).json({ error: "path query param required" });
    const resolved = tilde(skillPath);
    if (!existsSync(resolved)) return res.status(404).json({ error: "Skill file not found" });
    try {
      const content = readFileSync(resolved, "utf-8");
      res.json({ ok: true, path: resolved, content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Update Goal ─────────────────────────────────────────────
  app.put("/api/agents/:id/goals/:goalId", (req, res) => {
    const { id: agentId, goalId } = req.params;
    const updates = req.body as any;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      const idx = (agent.goals || []).findIndex((g: any) => g.id === goalId);
      if (idx < 0) return res.status(404).json({ error: `Goal "${goalId}" not found` });

      // Merge updates into existing goal
      agent.goals[idx] = { ...agent.goals[idx], ...updates, id: goalId };
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.goals?.[idx]) memAgent.goals[idx] = agent.goals[idx];

      log.info(`[Goal Update] ${agentId}/${goalId}`);
      res.json({ ok: true, goal: agent.goals[idx] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Update Cron ─────────────────────────────────────────────
  app.put("/api/agents/:id/cron/:index", (req, res) => {
    const { id: agentId } = req.params;
    const index = parseInt(req.params.index, 10);
    const updates = req.body as any;
    try {
      const configPath = configFilePath();
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      const agent = rawConfig.agents[agentId];
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (!agent.cron?.[index]) return res.status(404).json({ error: `Cron index ${index} not found` });

      // Merge updates into existing cron
      agent.cron[index] = { ...agent.cron[index], ...updates };
      writeFileSync(configPath, JSON.stringify(rawConfig, null, 2));

      // Update in-memory
      const memAgent = opts.config.agents[agentId];
      if (memAgent?.cron?.[index]) memAgent.cron[index] = agent.cron[index];

      log.info(`[Cron Update] ${agentId} index ${index}`);
      res.json({ ok: true, index, cron: agent.cron[index] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── API: Skills ────────────────────────────────────────────────────

  // GET /api/agents/:agentId/skills — list all skills available to an agent
  app.get("/api/agents/:agentId/skills", (req, res) => {
    const agent = opts.config.agents[req.params.agentId];
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const memDir = tilde(agent.memoryDir || join(agent.agentHome || "", "memory"));
    const claudeDir = join(home, ".claude", "commands");
    const personalDir = join(tilde(getPersonalAgentsDir(opts.config)), "skills");
    const agentSkillsDir = join(memDir, "..", "skills");
    const orgNames = (agent.org || []).map((o: any) => o.organization).filter(Boolean);

    const skills: any[] = [];

    // Shared skills (explicitly configured)
    for (const name of (agent.skills || [])) {
      const personalPath = join(personalDir, `${name}.md`);
      const claudePath = join(claudeDir, `${name}.md`);
      const filePath = existsSync(personalPath) ? personalPath : existsSync(claudePath) ? claudePath : null;
      if (filePath) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          const scriptsMatch = content.match(/scripts:\s*(.+)/);
          skills.push({
            name, level: "shared", path: filePath,
            description: descMatch?.[1]?.trim() || "",
            scripts: scriptsMatch?.[1]?.trim() || null,
          });
        } catch { skills.push({ name, level: "shared", path: filePath, description: "" }); }
      }
    }

    // Org-scoped skills (auto-discovered)
    for (const org of orgNames) {
      const orgDir = join(tilde(getPersonalAgentsDir(opts.config)), org, "skills");
      if (!existsSync(orgDir)) continue;
      for (const f of readdirSync(orgDir).filter((f: string) => f.endsWith(".md"))) {
        const name = f.replace(".md", "");
        const filePath = join(orgDir, f);
        try {
          const content = readFileSync(filePath, "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          const scriptsMatch = content.match(/scripts:\s*(.+)/);
          skills.push({
            name, level: "org", org, path: filePath,
            description: descMatch?.[1]?.trim() || "",
            scripts: scriptsMatch?.[1]?.trim() || null,
          });
        } catch { skills.push({ name, level: "org", org, path: filePath, description: "" }); }
      }
    }

    // Agent-specific skills
    for (const name of (agent.agentSkills || [])) {
      const filePath = join(agentSkillsDir, `${name}.md`);
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, "utf-8");
        const descMatch = content.match(/description:\s*(.+)/);
        const scriptsMatch = content.match(/scripts:\s*(.+)/);
        skills.push({
          name, level: "agent", path: filePath,
          description: descMatch?.[1]?.trim() || "",
          scripts: scriptsMatch?.[1]?.trim() || null,
        });
      } catch { skills.push({ name, level: "agent", path: filePath, description: "" }); }
    }

    res.json({ skills });
  });

  // GET /api/skills/org/:orgName — list all skills in an org
  // ─── Helper: extract snippet around keyword ─────────────────────────
  function extractSnippet(text: string, keyword: string, radius: number = 100): string {
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx === -1) return text.slice(0, 200);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + keyword.length + radius);
    return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
  }

  // ─── Health check ─────────────────────────────────────────────────
  // ─── API: Capabilities (Discovery) ────────────────────────────────
  app.get("/api/capabilities", (_req, res) => {
    res.json({
      platform: "MyAIforOne",
      version: "1.0.0",
      features: {
        sharedAgents: isSharedAgentsAllowed(opts.config),
        gym: !!(opts.config.service as any).gymEnabled,
      },
      categories: {
        agents: {
          description: "Create, configure, and manage AI agents",
          actions: ["list_agents", "get_agent", "get_agent_instructions", "create_agent", "update_agent", "delete_agent", "recover_agent", "get_agent_registry"]
        },
        chat: {
          description: "Send messages and manage conversations with agents",
          actions: ["send_message", "delegate_message", "start_stream", "get_chat_job_raw", "stop_chat_job"]
        },
        sessions: {
          description: "Manage agent conversation sessions",
          actions: ["list_sessions", "reset_session", "delete_session"]
        },
        tasks: {
          description: "Task management across agents",
          actions: ["list_tasks", "create_task", "update_task", "delete_task", "get_all_tasks", "get_task_stats", "create_project"]
        },
        goals: {
          description: "Autonomous goal tracking with scheduled execution",
          actions: ["create_goal", "update_goal", "toggle_goal", "trigger_goal", "delete_goal", "get_goal_history"]
        },
        cron: {
          description: "Scheduled message triggers",
          actions: ["create_cron", "update_cron", "toggle_cron", "trigger_cron", "delete_cron", "get_cron_history"]
        },
        automations: {
          description: "View all goals and crons across agents",
          actions: ["list_automations"]
        },
        skills: {
          description: "Manage reusable instruction sets for agents",
          actions: ["get_agent_skills", "get_org_skills", "create_skill", "get_skill_content"]
        },
        mcps: {
          description: "MCP server registry and connections",
          actions: ["list_mcps", "get_mcp_catalog", "list_mcp_keys", "save_mcp_key", "delete_mcp_key", "list_mcp_connections", "create_mcp_connection", "delete_mcp_connection"]
        },
        marketplace: {
          description: "Browse, install, and assign skills/prompts/agents/MCPs",
          actions: ["browse_registry", "install_registry_item", "assign_to_agent", "set_platform_default", "scan_skills", "import_skills", "create_prompt", "create_skill", "add_mcp_to_registry", "get_prompt_trigger", "set_prompt_trigger"]
        },
        channels: {
          description: "Configure messaging channels and agent routing",
          actions: ["list_channels", "update_channel", "add_agent_route", "remove_agent_route", "add_monitored_chat", "remove_monitored_chat", "get_sticky_routing"]
        },
        memory: {
          description: "Read, search, write, and clear agent memory",
          actions: ["get_agent_memory", "search_memory", "write_memory", "clear_memory_context"]
        },
        files: {
          description: "File storage per agent",
          actions: ["list_agent_files", "download_agent_file", "upload_file"]
        },
        apps: {
          description: "Registered web applications",
          actions: ["list_apps", "create_app", "update_app", "delete_app", "check_app_health"]
        },
        cost: {
          description: "Usage cost tracking",
          actions: ["get_agent_cost", "get_all_costs"]
        },
        model: {
          description: "Override Claude model per agent",
          actions: ["get_model", "set_model", "clear_model"]
        },
        activity: {
          description: "Activity feeds and conversation logs",
          actions: ["get_activity", "get_agent_logs"]
        },
        accounts: {
          description: "Claude account management and authentication",
          actions: ["list_accounts", "add_account", "delete_account", "check_account_status", "start_account_login", "submit_login_code", "whoami"]
        },
        config: {
          description: "Service configuration and deployment",
          actions: ["get_service_config", "update_service_config", "restart_service"]
        },
        saas: {
          description: "SaaS publishing integration",
          actions: ["get_saas_config", "update_saas_config", "test_saas_connection", "publish_to_saas"]
        },
        pairing: {
          description: "Authorized sender management",
          actions: ["list_paired_senders", "pair_sender", "unpair_sender"]
        },
        heartbeat: {
          description: "Agent health checks",
          actions: ["trigger_heartbeat", "get_heartbeat_history"]
        },
        templates: {
          description: "Agent templates — browse, deploy, and save agent blueprints",
          actions: ["list_templates", "deploy_template", "save_agent_as_template"]
        },
        platform: {
          description: "Platform-level tools",
          actions: ["health_check", "get_dashboard", "get_changelog", "get_user_guide", "list_capabilities", "get_platform_agents", "browse_dirs", "install_xbar", "send_webhook"]
        }
      }
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // ─── License info ────────────────────────────────────────────────
  app.get("/api/license", async (_req, res) => {
    try {
      const { getLicense } = await import("./license.js");
      const license = getLicense();
      res.json(license || { valid: true });
    } catch {
      res.json({ valid: true });
    }
  });

  // Dry-run: verify a key against the license server WITHOUT saving it to
  // config or touching the cached license. Used by the Admin UI's "Verify
  // Only" button so admins can test a key before saving.
  app.post("/api/license/check", async (req, res) => {
    try {
      const { licenseKey } = req.body || {};
      if (!licenseKey || typeof licenseKey !== "string") {
        res.status(400).json({ valid: false, error: "licenseKey required" });
        return;
      }
      const { checkLicenseNoCache } = await import("./license.js");
      const licenseUrl = (opts.config.service as any).licenseUrl;
      const result = await checkLicenseNoCache(licenseKey, licenseUrl);
      res.json(result);
    } catch (err) {
      res.status(500).json({ valid: false, error: String(err) });
    }
  });

  // ─── Startup: sync config.json MCPs → registry ───────────────────
  try {
    const cfgMcps = (opts.config as any).mcps || {};
    for (const [id, entry] of Object.entries(cfgMcps)) {
      syncMcpToRegistry(id, entry as any, { name: id, category: "personal" });
    }
  } catch (err) {
    log.warn(`[Registry Sync] MCP startup sync failed: ${err}`);
  }

  // ─── Startup: sync disk skills → PersonalRegistry ───────────────────────
  try {
    // Personal skills go to PersonalRegistry/skills.json (outside repo)
    const skillRegistryPath = join(getPersonalRegistryDir(opts.config), "skills.json");
    mkdirSync(dirname(skillRegistryPath), { recursive: true });
    let skillRegistry: any = { skills: [] };
    try { skillRegistry = JSON.parse(readFileSync(skillRegistryPath, "utf-8")); } catch { /* fresh */ }
    if (!Array.isArray(skillRegistry.skills)) skillRegistry.skills = [];
    // Also include ids already in the platform registry so we don't re-add platform skills as personal
    const platformRegistryPath = join(opts.baseDir, "registry", "skills.json");
    const platformIds = new Set<string>();
    try {
      const pd = JSON.parse(readFileSync(platformRegistryPath, "utf-8"));
      (pd.skills || []).forEach((s: any) => platformIds.add(s.id));
    } catch { /* ignore */ }
    const existingSkillIds = new Set([...skillRegistry.skills.map((s: any) => s.id), ...platformIds]);
    let added = 0;

    // Scan: ~/.claude/commands, personalAgents/skills, org skills dirs
    const skillDirs: Array<{ dir: string; source: string; provider: string }> = [
      { dir: join(homedir(), ".claude", "commands"), source: "global", provider: "AgenticLedger" },
      { dir: join(tilde(getPersonalAgentsDir(opts.config)), "skills"), source: "personal", provider: "me" },
    ];
    // Add org skill dirs
    const orgNames = new Set<string>();
    for (const agent of Object.values(opts.config.agents)) {
      for (const o of (agent.org || [])) {
        if (o.organization) orgNames.add(o.organization);
      }
    }
    for (const org of orgNames) {
      skillDirs.push({ dir: join(tilde(getPersonalAgentsDir(opts.config)), org, "skills"), source: "org", provider: "me" });
    }

    for (const { dir, source, provider } of skillDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f: string) => f.endsWith(".md"))) {
        const id = file.replace(".md", "");
        if (existingSkillIds.has(id)) continue;
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          const descMatch = content.match(/description:\s*(.+)/);
          skillRegistry.skills.push({
            id, name: id.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider, description: descMatch?.[1]?.trim() || "",
            category: source, verified: false, source: "local",
            tags: [source], localPath: join(dir, file),
          });
          existingSkillIds.add(id);
          added++;
        } catch { /* skip unreadable */ }
      }
    }
    if (added > 0) {
      writeFileSync(skillRegistryPath, JSON.stringify(skillRegistry, null, 2));
      log.info(`[Registry Sync] Auto-added ${added} skills to registry`);
    }
  } catch (err) {
    log.warn(`[Registry Sync] Skill startup sync failed: ${err}`);
  }

  // Let callers attach extra routes (e.g. /mcp Streamable HTTP) to the same
  // Express app before the global error handler + listen.
  if (opts.attachExtraRoutes) {
    try {
      opts.attachExtraRoutes(app);
    } catch (err: any) {
      log.warn(`[Web UI] attachExtraRoutes failed: ${err?.message || err}`);
    }
  }

  // Global error handler — catch unhandled Express errors instead of
  // dumping raw stack traces to the browser
  app.use((err: any, _req: any, res: any, _next: any) => {
    log.warn(`[Web UI] Unhandled error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || "Internal server error" });
    }
  });

  // Hook for extra routes (e.g. /mcp) — runs after all core /api/* routes
  // are registered but before listen(), so callers can attach sibling
  // endpoints on the same port.
  if (opts.attachExtraRoutes) {
    try {
      opts.attachExtraRoutes(app);
    } catch (err) {
      log.warn(`attachExtraRoutes failed: ${err}`);
    }
  }

  app.listen(opts.port, () => {
    log.info(`MyAIforOne Lite running on http://localhost:${opts.port}`);
  });
}
