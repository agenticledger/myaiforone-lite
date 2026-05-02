import { spawn, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { McpServerConfig, McpServerHttp } from "./config.js";
import { getPersonalAgentsDir, isServerMode } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./channels/types.js";
import { formatMessage } from "./utils/message-formatter.js";
import { createMemoryManager, type MemoryManager } from "./memory/index.js";
import { loadMcpKeysWithDecryption } from "./keystore.js";
import { getEncryptionSecret as kcGetSecret } from "./os-keychain.js";
import { buildAgentRegistry, buildGroupAgentPrompt } from "./agent-registry.js";
import { log } from "./logger.js";
import { checkLicenseForExecution } from "./license.js";

// Module-level config reference for group agent registry
import type { AppConfig } from "./config.js";
let _appConfig: AppConfig | null = null;
export function setAppConfig(config: AppConfig): void { _appConfig = config; }

// Resolve the claude executable.
// Windows: npm shims (.cmd/.ps1) can't be spawned without shell:true.
// Instead, find the actual cli.js or native .exe and run it directly.
// macOS/Linux: use `which claude` as before — unchanged behavior.
let _CLAUDE_CLI_JS: string | null = null;
let _CLAUDE_NEEDS_SHELL = false; // true when we fell back to a .cmd shim on Windows

function resolveClaudeBin(): string {
  if (process.platform === "win32") {
    // Strategy 1: npm root -g → @anthropic-ai/claude-code/cli.js (older Node.js-based installs)
    try {
      const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      const cliPath = resolve(npmRoot, "@anthropic-ai", "claude-code", "cli.js");
      if (existsSync(cliPath)) {
        _CLAUDE_CLI_JS = cliPath;
        return process.execPath; // node.exe
      }
    } catch { /* fall through */ }
    // Strategy 2: locate claude.cmd, derive cli.js from its directory
    try {
      const cmdPath = execSync("where.exe claude.cmd", { encoding: "utf8" })
        .trim().split("\n")[0].trim();
      if (cmdPath) {
        const cliPath = resolve(cmdPath, "..", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
        if (existsSync(cliPath)) {
          _CLAUDE_CLI_JS = cliPath;
          return process.execPath;
        }
      }
    } catch { /* fall through */ }
    // Strategy 3: Claude Code 2.x ships a native .exe — find it directly
    try {
      const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      const exePath = resolve(npmRoot, "@anthropic-ai", "claude-code", "bin", "claude.exe");
      if (existsSync(exePath)) return exePath;
    } catch { /* fall through */ }
    // Strategy 3b: derive .exe path from claude.cmd location
    try {
      const cmdPath = execSync("where.exe claude.cmd", { encoding: "utf8" })
        .trim().split("\n")[0].trim();
      if (cmdPath) {
        const exePath = resolve(cmdPath, "..", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
        if (existsSync(exePath)) return exePath;
      }
    } catch { /* fall through */ }
    // Strategy 4 (fallback): use claude.cmd with shell:true — degrades gracefully
    try {
      const cmdPath = execSync("where.exe claude.cmd", { encoding: "utf8" })
        .trim().split("\n")[0].trim();
      if (cmdPath && existsSync(cmdPath)) {
        _CLAUDE_NEEDS_SHELL = true;
        return cmdPath;
      }
    } catch { /* fall through */ }
  }
  // macOS / Linux — use which claude
  try {
    const cmd = process.platform === "win32" ? "where.exe claude" : "which claude";
    const result = execSync(cmd, { encoding: "utf8" }).trim().split("\n")[0].trim();
    return result || "claude";
  } catch {
    return "claude";
  }
}
const CLAUDE_BIN = resolveClaudeBin();
log.info(`Claude binary: ${CLAUDE_BIN}${_CLAUDE_CLI_JS ? ` (via ${_CLAUDE_CLI_JS})` : ""}${_CLAUDE_NEEDS_SHELL ? " (shell mode)" : ""}`);

// Windows CreateProcessW has a hard 32,767-char command-line limit.
// When the system prompt is too long, write it to a temp CLAUDE.md and
// pass the directory via --add-dir instead of --system-prompt.
const WIN_CMD_LIMIT = 28000;
function buildSystemPromptArgs(
  systemPrompt: string,
  agentId: string
): { args: string[]; cleanup: (() => void) | null } {
  if (process.platform === "win32" && systemPrompt.length > WIN_CMD_LIMIT) {
    const tmpDir = join(tmpdir(), "myaiforone-system-prompts", `${agentId}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "CLAUDE.md"), systemPrompt, "utf-8");
    return {
      args: ["--add-dir", tmpDir],
      cleanup: () => {
        try { unlinkSync(join(tmpDir, "CLAUDE.md")); } catch { /* ignore */ }
        try { rmdirSync(tmpDir); } catch { /* ignore */ }
      },
    };
  }
  return { args: ["--system-prompt", systemPrompt], cleanup: null };
}

// Cache memory managers per agent to avoid re-creating on every message
const memoryManagers = new Map<string, MemoryManager>();

async function getMemoryManager(agentId: string, memoryDir: string): Promise<MemoryManager> {
  if (memoryManagers.has(agentId)) return memoryManagers.get(agentId)!;
  const mgr = await createMemoryManager(memoryDir);
  memoryManagers.set(agentId, mgr);
  return mgr;
}

// ─── Types ───────────────────────────────────────────────────────────

interface ContentBlock {
  type: "text" | "image";
  text?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface SessionState {
  sessionId: string;
  createdAt: string;
  messageCount: number;
}

interface ClaudeJsonResult {
  type: string;
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
}

// ─── Intercepted commands ────────────────────────────────────────────

const RESET_PATTERN = /^\s*\/opreset\b/i;
const COMPACT_PATTERN = /^\s*\/opcompact\b/i;
const RELOGIN_PATTERN = /^\s*\/relogin(?:\s+(\S+))?\s*$/i;
const PARALLEL_PATTERN = /^\s*\/parallel\s*\n/i;
const TASK_PATTERN = /^\s*\/task\b/i;
const MODEL_PATTERN = /^\s*\/model(?:\s+(\S+))?\s*$/i;
const COST_PATTERN = /^\s*\/cost\b/i;

// ─── Task helpers ─────────────────────────────────────────────────

interface TaskHistoryEntry {
  ts: string;
  action: string;
  by: string;
  from?: string;
  to?: string;
  note?: string;
}

interface TaskData {
  agentId: string;
  projects: Array<{ id: string; name: string; color: string }>;
  tasks: Array<{
    id: string; title: string; description: string; project: string;
    priority: string; status: string; owner: string; assignedBy: string;
    assignmentType: string; dueDate: string | null; context: string;
    result: string; createdAt: string; updatedAt: string;
    source?: string;
    assignedTo?: string;
    history?: TaskHistoryEntry[];
  }>;
}

function loadTasksFromAgent(agentHome: string, agentId: string): TaskData {
  const p = join(agentHome, "tasks.json");
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { /* ignore */ }
  }
  return { agentId, projects: [{ id: "general", name: "General", color: "#6b7280" }], tasks: [] };
}

function saveTasksToAgent(agentHome: string, data: TaskData): void {
  const p = join(agentHome, "tasks.json");
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}

function buildTaskContextBlock(agentHome: string, agentId: string): string {
  const data = loadTasksFromAgent(agentHome, agentId);
  const active = (data.tasks || []).filter(t => ["proposed", "approved", "in_progress", "review"].includes(t.status));
  if (active.length === 0) return "";

  const lines = ["\n[Active Tasks]"];
  for (const t of active) {
    let line = `- ${t.id}: ${t.title} (${t.status}, ${t.priority} priority`;
    if (t.dueDate) line += `, due ${t.dueDate}`;
    if (t.source) line += `, source: ${t.source}`;
    if (t.assignedTo && t.assignedTo !== agentId) line += `, assigned to: ${t.assignedTo}`;
    line += ")";
    lines.push(line);
  }
  lines.push("[/Active Tasks]\n");
  return lines.join("\n");
}

function handleTaskCommand(
  text: string,
  agentId: string,
  agentConfig: any,
  allAgents: Record<string, any>,
): string | null {
  if (!TASK_PATTERN.test(text)) return null;

  const home = homedir();
  const resolveTilde = (p: string) => p.startsWith("~") ? p.replace("~", home) : p;
  const agentHome = agentConfig.agentHome ? resolveTilde(agentConfig.agentHome) : resolve(agentConfig.memoryDir, "..");

  const parts = text.trim().split(/\s+/);
  const subCommand = parts[1]?.toLowerCase();

  // /task list
  if (subCommand === "list") {
    const data = loadTasksFromAgent(agentHome, agentId);
    if (data.tasks.length === 0) return "No tasks found.";

    const byStatus: Record<string, string[]> = {};
    for (const t of data.tasks) {
      if (!byStatus[t.status]) byStatus[t.status] = [];
      byStatus[t.status].push(`  - [${t.priority}] ${t.title} (${t.id})${t.dueDate ? ` due ${t.dueDate}` : ""}`);
    }

    const lines = ["**Tasks:**"];
    for (const [status, items] of Object.entries(byStatus)) {
      lines.push(`\n**${status.toUpperCase()}:**`);
      lines.push(...items);
    }
    return lines.join("\n");
  }

  // /task add @target title --priority high --project general
  if (subCommand === "add") {
    const rest = parts.slice(2);
    if (rest.length === 0) return "Usage: /task add @target Task title --priority high --project general";

    let targetAlias = rest[0];
    let titleParts: string[] = [];
    let priority = "medium";
    let project = "general";

    // Parse flags
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--priority" && rest[i + 1]) {
        priority = rest[++i];
      } else if (rest[i] === "--project" && rest[i + 1]) {
        project = rest[++i];
      } else {
        titleParts.push(rest[i]);
      }
    }

    const title = titleParts.join(" ");
    if (!title) return "Missing task title.";

    // Resolve target agent
    let targetId: string | null = null;
    let targetConfig: any = null;
    const normalTarget = targetAlias.startsWith("@") ? targetAlias : `@${targetAlias}`;
    for (const [id, ag] of Object.entries(allAgents)) {
      const aliases = ag.mentionAliases || [];
      if (aliases.includes(normalTarget) || id === targetAlias) {
        targetId = id;
        targetConfig = ag;
        break;
      }
    }

    if (!targetId || !targetConfig) return `Agent "${targetAlias}" not found.`;

    const targetHome = targetConfig.agentHome ? resolveTilde(targetConfig.agentHome) : resolve(targetConfig.memoryDir, "..");
    const data = loadTasksFromAgent(targetHome, targetId);

    // Determine hierarchy
    const assignerAlias = agentConfig.mentionAliases?.[0] || agentId;
    let assignmentType = "proposal";
    let status = "proposed";

    // Check if assigner is a superior
    if (targetConfig.org) {
      for (const orgEntry of targetConfig.org) {
        if (orgEntry.reportsTo) {
          const reportsToNorm = orgEntry.reportsTo.startsWith("@") ? orgEntry.reportsTo : `@${orgEntry.reportsTo}`;
          const assignerAliases = agentConfig.mentionAliases || [];
          if (assignerAliases.includes(reportsToNorm) || agentId === orgEntry.reportsTo) {
            assignmentType = "direct";
            status = "approved";
            break;
          }
        }
      }
    }

    const now = new Date().toISOString();
    const task = {
      id: `${targetId}_${Date.now()}`,
      title,
      description: "",
      project,
      priority,
      status,
      owner: targetConfig.mentionAliases?.[0] || targetId,
      assignedBy: assignerAlias,
      assignmentType,
      dueDate: null,
      context: "",
      result: "",
      createdAt: now,
      updatedAt: now,
    };

    data.tasks.push(task);
    saveTasksToAgent(targetHome, data);
    return `Task created for ${targetAlias}: "${title}" [${status}/${assignmentType}, ${priority} priority]`;
  }

  // /task done taskId "result note"
  if (subCommand === "done") {
    const taskId = parts[2];
    if (!taskId) return "Usage: /task done <taskId> \"result note\"";

    const resultNote = text.replace(/^\s*\/task\s+done\s+\S+\s*/, "").replace(/^["']|["']$/g, "").trim();

    const data = loadTasksFromAgent(agentHome, agentId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return `Task "${taskId}" not found.`;

    task.status = "done";
    task.result = resultNote || task.result;
    task.updatedAt = new Date().toISOString();
    saveTasksToAgent(agentHome, data);
    return `Task ${taskId} marked as done.${resultNote ? ` Result: ${resultNote}` : ""}`;
  }

  return "Unknown /task subcommand. Use: /task list, /task add @target title, /task done taskId \"note\"";
}

/**
 * Check if the message is an intercepted command.
 * Returns a response string if handled, or null to continue normal execution.
 */
function handleInterceptedCommand(
  text: string,
  agentId: string,
  memoryDir: string,
  senderId?: string,
): string | null {
  const sessionPath = join(memoryDir, sessionFileName(senderId));

  // ── /opreset ──
  if (RESET_PATTERN.test(text)) {
    if (existsSync(sessionPath)) {
      try {
        const state = JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionState;
        unlinkSync(sessionPath);
        log.info(`Session reset for ${agentId} (was ${state.sessionId}, ${state.messageCount} messages)`);
        return `Session reset. Had ${state.messageCount} messages. Next message starts a fresh conversation.\n\nTip: Use /opcompact before /opreset to save important context.`;
      } catch {
        unlinkSync(sessionPath);
        return `Session reset. Next message starts fresh.`;
      }
    }
    return `No active session to reset. Next message will start a new one.`;
  }

  // ── /model ──
  const modelMatch = MODEL_PATTERN.exec(text);
  if (modelMatch) {
    const arg = modelMatch[1]?.toLowerCase();
    if (!arg || arg === "show" || arg === "current") {
      const current = loadModelOverride(memoryDir);
      return current
        ? `Current model override: **${current}**\n\nUse \`/model default\` to reset.`
        : `No model override set. Using agent default.\n\nOptions: \`/model opus\` (4.7), \`/model sonnet\`, \`/model haiku\`, \`/model opus-4.6\`, or any full model ID.`;
    }
    if (arg === "default" || arg === "reset") {
      clearModelOverride(memoryDir);
      return `Model override cleared. Using agent default.`;
    }
    const resolved = MODEL_ALIASES[arg] || arg;
    saveModelOverride(memoryDir, resolved);
    return `Model set to **${resolved}**.\n\nThis applies to all future messages until you use \`/model default\`.`;
  }

  // ── /cost ──
  if (COST_PATTERN.test(text)) {
    const logPath = join(memoryDir, "conversation_log.jsonl");
    if (!existsSync(logPath)) return "No conversation history yet — no cost data.";
    try {
      const entries = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const sum = (arr: any[]) => arr.reduce((s, e) => s + (e.cost || 0), 0);
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const todayEntries = entries.filter((e: any) => e.ts?.startsWith(today));
      const weekEntries = entries.filter((e: any) => e.ts >= weekAgo);
      const totalCost = sum(entries);
      const todayCost = sum(todayEntries);
      const weekCost = sum(weekEntries);
      if (totalCost === 0) return `No cost data recorded yet.\n\n(Cost tracking applies to new messages going forward.)`;
      return `**Cost Summary**\n\nToday: $${todayCost.toFixed(4)}\nLast 7 days: $${weekCost.toFixed(4)}\nAll time: $${totalCost.toFixed(4)}\n\nTotal messages: ${entries.length}`;
    } catch {
      return "Could not read cost data.";
    }
  }

  return null;
}

// ─── Model override helpers ──────────────────────────────────────────

const MODEL_ALIASES: Record<string, string> = {
  opus:       "claude-opus-4-7",
  sonnet:     "claude-sonnet-4-6",
  haiku:      "claude-haiku-4-5-20251001",
  "opus-4":   "claude-opus-4-7",
  "opus-4.7": "claude-opus-4-7",
  "opus-4.6": "claude-opus-4-6",
  "sonnet-4": "claude-sonnet-4-6",
};

function loadModelOverride(memoryDir: string): string | null {
  const p = join(memoryDir, "model-override.json");
  if (!existsSync(p)) return null;
  try { return (JSON.parse(readFileSync(p, "utf-8")) as any).model || null; } catch { return null; }
}

function saveModelOverride(memoryDir: string, model: string): void {
  writeFileSync(join(memoryDir, "model-override.json"), JSON.stringify({ model }));
}

function clearModelOverride(memoryDir: string): void {
  const p = join(memoryDir, "model-override.json");
  if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
}

// ─── Re-login handler ───────────────────────────────────────────────

export function handleRelogin(accountName: string, configDir?: string): string {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir;

    // Try `claude auth status` first to check current state
    let statusOutput = "";
    try {
      statusOutput = execSync("claude auth status 2>&1", { env, timeout: 10_000 }).toString().trim();
    } catch {
      // auth status may fail if not logged in — that's fine
    }

    // Try to get a login URL via `claude auth login`
    let loginOutput = "";
    try {
      loginOutput = execSync("claude auth login 2>&1", { env, timeout: 15_000 }).toString().trim();
    } catch (err: any) {
      loginOutput = err?.stdout?.toString() || err?.stderr?.toString() || String(err);
    }

    // Look for a URL in the output
    const urlMatch = loginOutput.match(/https?:\/\/\S+/);
    if (urlMatch) {
      log.info(`Re-login URL generated for account "${accountName}": ${urlMatch[0]}`);
      return `Re-login needed for account "${accountName}".\n\nOpen this URL in your browser:\n${urlMatch[0]}`;
    }

    // If already logged in or no URL found
    if (statusOutput.toLowerCase().includes("logged in") || statusOutput.toLowerCase().includes("authenticated")) {
      return `Account "${accountName}" appears to be already logged in.\n\nStatus: ${statusOutput}`;
    }

    return `Re-login for account "${accountName}": Could not obtain a login URL.\n\nAuth status: ${statusOutput || "unknown"}\nLogin output: ${loginOutput || "empty"}`;
  } catch (err) {
    log.error(`Re-login failed for account "${accountName}": ${err}`);
    return `Re-login failed for account "${accountName}": ${err}`;
  }
}

// ─── Parallel executor ──────────────────────────────────────────────

interface ParallelTask {
  prompt: string;
  index: number;
}

function parseParallelTasks(text: string): ParallelTask[] {
  const lines = text.split("\n").slice(1); // skip the /parallel line
  const tasks: ParallelTask[] = [];
  let index = 0;
  for (const line of lines) {
    const trimmed = line.replace(/^[-*•]\s*/, "").trim();
    if (trimmed) {
      tasks.push({ prompt: trimmed, index: index++ });
    }
  }
  return tasks;
}

async function executeParallel(
  tasks: ParallelTask[],
  agentConfig: any,
  workspace: string,
  systemPrompt: string,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeConfigDir?: string,
): Promise<string> {
  const home = homedir();

  log.info(`[Parallel] Spawning ${tasks.length} workers...`);

  // Pre-build system prompt args once (shared across all workers)
  const sharedSpArgs = buildSystemPromptArgs(systemPrompt, agentConfig.id || "parallel");

  // Build shared args (no session — each worker is independent)
  const buildArgs = (taskPrompt: string): string[] => {
    const args = ["-p", "-", ...sharedSpArgs.args, "--output-format", "text", "--add-dir", workspace];

    // Tools
    const allowedTools = [...(agentConfig.allowedTools || [])];
    if (agentConfig.mcps?.length) {
      for (const mcpName of agentConfig.mcps) allowedTools.push(`mcp__${mcpName}__*`);
    }
    if (allowedTools.length > 0) args.push("--allowedTools", allowedTools.join(","));

    // MCPs
    if (agentConfig.mcps?.length && mcpRegistry) {
      const memoryDir = agentConfig.memoryDir?.startsWith("~")
        ? agentConfig.memoryDir.replace("~", home) : agentConfig.memoryDir;
      const mcpConfigPath = buildMcpConfigFile(`parallel-${Date.now()}`, agentConfig.mcps, mcpRegistry, baseDir, memoryDir);
      args.push("--mcp-config", mcpConfigPath);
    }

    // Use bypassPermissions when agent has MCPs (headless can't approve MCP tool prompts)
    args.push("--permission-mode", agentConfig.mcps?.length ? "bypassPermissions" : "acceptEdits");
    return args;
  };

  const timeout = agentConfig.timeout ?? 14_400_000;

  // Spawn all workers in parallel
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const args = buildArgs(task.prompt);
      log.info(`[Parallel] Worker ${task.index + 1}: "${task.prompt.slice(0, 60)}..."`);
      try {
        const result = await spawnClaude(args, workspace, timeout, task.prompt, claudeConfigDir);
        log.info(`[Parallel] Worker ${task.index + 1}: done`);
        return { index: task.index, prompt: task.prompt, result: result.trim() };
      } catch (err) {
        log.warn(`[Parallel] Worker ${task.index + 1}: failed — ${err}`);
        return { index: task.index, prompt: task.prompt, result: `Error: ${err}` };
      }
    })
  );

  if (sharedSpArgs.cleanup) sharedSpArgs.cleanup();

  // Format results
  const lines = [`**${tasks.length} parallel tasks completed:**\n`];
  for (const r of results) {
    if (r.status === "fulfilled") {
      const { index, prompt, result } = r.value;
      lines.push(`### Task ${index + 1}: ${prompt}`);
      lines.push(result);
      lines.push("");
    } else {
      lines.push(`### Task: Failed`);
      lines.push(`Error: ${r.reason}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Skill index builder ─────────────────────────────────────────────

function findRegistrySkill(name: string, baseDir: string): string | null {
  const registryRoot = join(baseDir, "registry", "skills");
  if (!existsSync(registryRoot)) return null;
  // Check root first, then each subdirectory
  const direct = join(registryRoot, `${name}.md`);
  if (existsSync(direct)) return direct;
  try {
    for (const entry of readdirSync(registryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(registryRoot, entry.name, `${name}.md`);
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* ignore */ }
  return null;
}

function buildSkillIndex(
  sharedSkillNames: string[],
  agentSkillNames: string[],
  agentMemoryDir: string,
  orgNames?: string[],
  baseDir?: string,
): string {
  const home = homedir();
  const claudeDir = join(home, ".claude", "commands");
  const personalDir = join(getPersonalAgentsDir(), "skills");
  const agentSkillsDir = join(agentMemoryDir, "..", "skills");

  // Helper: extract scripts dir from frontmatter if present
  const getScriptsDir = (content: string, mdPath: string): string => {
    const m = content.match(/scripts:\s*(.+)/);
    if (!m) return "";
    const rel = m[1].trim().replace(/\/$/, "");
    const dir = join(mdPath, "..", rel);
    return existsSync(dir) ? ` · scripts: \`${dir}\`` : "";
  };

  const lines: string[] = [
    "\n## Available Skills",
    "You have skills available as markdown files. When a task matches a skill, use the Read tool to read it from the path shown, then follow its instructions.\n",
    "| Skill | Description | Path |",
    "|-------|-------------|------|",
  ];

  // Shared skills — check 4 locations in order: personalAgents/skills > ~/.claude/commands > registry/skills
  for (const name of sharedSkillNames) {
    let filePath = "";
    const personalPath = join(personalDir, `${name}.md`);
    const claudePath = join(claudeDir, `${name}.md`);
    if (existsSync(personalPath)) {
      filePath = personalPath;
    } else if (existsSync(claudePath)) {
      filePath = claudePath;
    } else if (baseDir) {
      filePath = findRegistrySkill(name, baseDir) || "";
    }

    if (!filePath) {
      log.warn(`Shared skill not found: ${name}`);
      continue;
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      const descMatch = content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : "No description";
      lines.push(`| ${name} | ${desc} | \`${filePath}\`${getScriptsDir(content, filePath)} |`);
    } catch {
      lines.push(`| ${name} | (could not read) | \`${filePath}\` |`);
    }
  }

  // Org-scoped skills — auto-discovered from personalAgents/[OrgName]/skills/
  if (orgNames?.length) {
    const seen = new Set<string>();
    for (const orgName of orgNames) {
      const orgSkillsDir = join(getPersonalAgentsDir(), orgName, "skills");
      if (!existsSync(orgSkillsDir)) continue;
      try {
        const mdFiles = readdirSync(orgSkillsDir).filter((f: string) => f.endsWith(".md"));
        for (const file of mdFiles) {
          const name = file.replace(".md", "");
          if (seen.has(name)) continue;
          seen.add(name);
          const filePath = join(orgSkillsDir, file);
          try {
            const content = readFileSync(filePath, "utf-8");
            const descMatch = content.match(/description:\s*(.+)/);
            const desc = descMatch ? descMatch[1].trim() : "No description";
            lines.push(`| ${name} ◆ | ${desc} | \`${filePath}\`${getScriptsDir(content, filePath)} |`);
          } catch {
            lines.push(`| ${name} ◆ | (could not read) | \`${filePath}\` |`);
          }
        }
      } catch { /* org skills dir not readable */ }
    }
  }

  // Agent-specific skills from agent/skills/
  for (const name of agentSkillNames) {
    const filePath = join(agentSkillsDir, `${name}.md`);
    if (!existsSync(filePath)) {
      log.warn(`Agent skill not found: ${filePath}`);
      continue;
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      const descMatch = content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : "No description";
      lines.push(`| ${name} ★ | ${desc} | \`${filePath}\`${getScriptsDir(content, filePath)} |`);
    } catch {
      lines.push(`| ${name} ★ | (could not read) | \`${filePath}\` |`);
    }
  }

  if (lines.length <= 4) return "";

  lines.push("");
  lines.push("Skills marked with ★ are specific to this agent. Skills marked with ◆ are shared across your org. To use a skill: Read the file at the path shown, then follow its instructions.");
  return lines.join("\n");
}

// ─── Prompt template helpers ─────────────────────────────────────────

function getPromptsDir(): string {
  const home = homedir();
  const personalDir = join(getPersonalAgentsDir(), "prompts");
  return personalDir;
}

function findPromptFile(name: string, baseDir: string): string | null {
  const personalDir = getPromptsDir();
  const registryDir = join(baseDir, "registry", "prompts", "platform");

  const candidates = [
    join(personalDir, `${name}.md`),
    join(registryDir, `${name}.md`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function buildPromptIndex(promptNames: string[], baseDir: string, trigger: string): string {
  const lines: string[] = [
    `\n## Available Prompt Templates`,
    `You have prompt templates available. When a user message starts with \`${trigger}name\`, load the matching template and apply its instructions to frame your response.\n`,
    "| Trigger | Description | Path |",
    "|---------|-------------|------|",
  ];

  for (const name of promptNames) {
    const filePath = findPromptFile(name, baseDir);
    if (!filePath) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      const descMatch = content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1].trim() : "No description";
      lines.push(`| \`${trigger}${name}\` | ${desc} | \`${filePath}\` |`);
    } catch {
      lines.push(`| \`${trigger}${name}\` | (could not read) | \`${filePath}\` |`);
    }
  }

  if (lines.length <= 4) return "";
  lines.push("");
  return lines.join("\n");
}

function resolvePromptTrigger(msg: string, effectivePrompts: string[], baseDir: string, trigger: string): { promptContent: string; userText: string } | null {
  if (!msg.startsWith(trigger) || !effectivePrompts.length) return null;
  const after = msg.slice(trigger.length);
  const spaceIdx = after.indexOf(" ");
  const promptName = spaceIdx === -1 ? after : after.slice(0, spaceIdx);
  const userText = spaceIdx === -1 ? "" : after.slice(spaceIdx + 1).trim();

  if (!effectivePrompts.includes(promptName)) return null;
  const filePath = findPromptFile(promptName, baseDir);
  if (!filePath) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    // Strip frontmatter
    const body = content.replace(/^---[\s\S]*?---\s*/m, "").trim();
    return { promptContent: body, userText };
  } catch {
    return null;
  }
}

// ─── MCP key loader ──────────────────────────────────────────────────
// Dual-level: agent-specific keys override shared keys.
// Supports encrypted .env.enc files (decrypted with keychain-managed secret).

let _encryptionSecret: string | undefined;

/**
 * Initialize the encryption secret from OS keychain (or env var fallback).
 * Called once at startup before any MCP keys are loaded.
 */
export function initEncryptionSecret(): void {
  try {
    _encryptionSecret = kcGetSecret();
  } catch (err) {
    // Fallback to env var if keychain module fails (e.g., in CI)
    _encryptionSecret = process.env.MYAGENT_MASTER_PASSWORD || undefined;
  }
}

function loadMcpKeys(baseDir: string, mcpName: string, agentMemoryDir?: string): Record<string, string> {
  // MCP keys are user data, not bundled resources — use dataDir (MYAGENT_DATA_DIR) when available
  const dataRoot = process.env.MYAGENT_DATA_DIR || baseDir;
  const sharedDir = join(dataRoot, "data", "mcp-keys");
  return loadMcpKeysWithDecryption(sharedDir, agentMemoryDir || null, mcpName, _encryptionSecret);
}

// ─── MCP config builder ─────────────────────────────────────────────

function buildMcpConfigFile(
  agentId: string,
  mcpNames: string[],
  mcpRegistry: Record<string, McpServerConfig>,
  baseDir: string,
  agentMemoryDir?: string,
): string {
  const home = homedir();
  const mcpServers: Record<string, any> = {};

  // Discover named connection key files for auto-expansion
  // e.g., gmail-agenticledger.env, gmail-bst.env under the agent's mcp-keys/
  function discoverNamedConnections(baseMcpName: string): string[] {
    const connections: string[] = [];
    if (!agentMemoryDir) return connections;
    const keysDir = join(agentMemoryDir, "..", "mcp-keys");
    try {
      const files = readdirSync(keysDir);
      for (const f of files) {
        if (f.startsWith(baseMcpName + "-") && f.endsWith(".env")) {
          const instanceName = f.replace(".env", "");
          connections.push(instanceName);
        }
      }
    } catch { /* dir doesn't exist */ }
    return connections;
  }

  for (const name of mcpNames) {
    const def = mcpRegistry[name];
    if (!def) continue;

    if (def.type === "stdio") {
      const args = (def.args || []).map((a) =>
        a.startsWith("~") ? a.replace("~", home) : a,
      );

      // Merge env: config.json values < .env file values (file overrides)
      const configEnv = { ...(def.env || {}) };
      const fileEnv = loadMcpKeys(baseDir, name, agentMemoryDir);

      // Remove empty-string values from config (they're just templates)
      const mergedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(configEnv)) {
        if (v) mergedEnv[k] = v;
      }
      // File keys override config keys
      Object.assign(mergedEnv, fileEnv);

      // For myaiforone-local, always use the real running port so the MCP
      // subprocess can reach the gateway (PORT may differ from 4889)
      if (name === "myaiforone-local") {
        mergedEnv["MYAGENT_API_URL"] = `http://localhost:${process.env.PORT || 4889}`;
      }

      mcpServers[name] = {
        command: def.command,
        args,
        env: mergedEnv,
      };
    } else {
      const httpDef = def as McpServerHttp;

      // For HTTP MCPs, check if headers have ${VAR} references and resolve from .env
      const headers = { ...(httpDef.headers || {}) };
      const fileEnv = loadMcpKeys(baseDir, name, agentMemoryDir);
      for (const [hk, hv] of Object.entries(headers)) {
        if (typeof hv === "string" && hv.includes("${")) {
          headers[hk] = hv.replace(/\$\{(\w+)\}/g, (_, varName) => {
            return fileEnv[varName] || process.env[varName] || "";
          });
        }
      }

      // Auto-expand named connections: create additional MCP server entries
      // e.g., gmail-agenticledger, gmail-bst each get their own server entry
      // using the same URL but with their specific Bearer token
      const namedConns = discoverNamedConnections(name);

      // Only create the base entry if there are no named connections
      // (otherwise the base has no token and just fails)
      if (namedConns.length === 0) {
        mcpServers[name] = {
          type: def.type,
          url: httpDef.url,
          headers,
        };
      }
      for (const instanceName of namedConns) {
        const instanceEnv = loadMcpKeys(baseDir, instanceName, agentMemoryDir);
        // Use the first key value directly as the Bearer token
        const tokenValue = Object.values(instanceEnv)[0] || "";
        mcpServers[instanceName] = {
          type: def.type,
          url: httpDef.url,
          headers: tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {},
        };
      }
    }
  }

  // Use OS temp dir — baseDir may be a read-only pkg snapshot in Tauri builds
  const tmpDir = join(tmpdir(), "myaiforone-mcp-configs");
  mkdirSync(tmpDir, { recursive: true });

  const filePath = join(tmpDir, `${agentId}-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify({ mcpServers }, null, 2));

  return filePath;
}

// ─── Session management ──────────────────────────────────────────────

function sessionFileName(senderId?: string): string {
  // Feature 3: Per-sender sessions use sender-specific files
  return senderId ? `session-${senderId}.json` : "session.json";
}

function loadSession(memoryDir: string, senderId?: string): SessionState | null {
  const sessionPath = join(memoryDir, sessionFileName(senderId));
  if (!existsSync(sessionPath)) return null;
  try {
    return JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionState;
  } catch {
    return null;
  }
}

function saveSession(memoryDir: string, state: SessionState, senderId?: string): void {
  const sessionPath = join(memoryDir, sessionFileName(senderId));
  writeFileSync(sessionPath, JSON.stringify(state, null, 2));
}

// ─── Main executor ──────────────────────────────────────────────────

export async function executeAgent(
  route: ResolvedRoute,
  msg: InboundMessage,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeAccounts?: Record<string, string>,
  globalDefaults?: { skills?: string[]; mcps?: string[]; prompts?: string[]; promptTrigger?: string },
): Promise<string> {
  // License gate — block execution if license is invalid
  const licenseBlock = checkLicenseForExecution();
  if (licenseBlock) return licenseBlock;

  const { agentId, agentConfig } = route;
  const effectiveSkills = [...new Set([...(agentConfig.skills || []), ...(globalDefaults?.skills || [])])];
  const effectiveMcps = [...new Set([...(agentConfig.mcps || []), ...(globalDefaults?.mcps || [])])];
  const effectivePrompts = [...new Set([...(agentConfig.prompts || []), ...(globalDefaults?.prompts || [])])];
  const _home = homedir();
  const expandTilde = (p: string) => p.startsWith("~") ? p.replace("~", _home) : p;
  const workspace = resolve(expandTilde(agentConfig.workspace));
  const claudeMdPath = resolve(baseDir, expandTilde(agentConfig.claudeMd));
  const memoryDir = resolve(baseDir, expandTilde(agentConfig.memoryDir));
  const contextPath = join(memoryDir, "context.md");
  const learnedPath = join(memoryDir, "learned.md");
  // Per-user conversation log: when conversationLogMode is "per-user", each sender gets their own log file.
  const _logSenderId = (agentConfig as any).conversationLogMode === "per-user"
    ? (msg.sender || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")
    : null;
  const logPath = _logSenderId
    ? join(memoryDir, `conversation_log_${_logSenderId}.jsonl`)
    : join(memoryDir, "conversation_log.jsonl");
  const isPersistent = agentConfig.persistent ?? false;
  const perSender = agentConfig.perSenderSessions ?? false;
  // Auto-isolate web UI session tabs — senderId is "tab-{id}" (UI), "htab-{id}" (home), or "ctab-{id}" (coach)
  const isWebTab = typeof msg.sender === "string" && /^[hc]?tab-/.test(msg.sender);
  const senderSessionKey = (isPersistent && (perSender || isWebTab)) ? msg.sender : undefined;
  const useAdvancedMemory = agentConfig.advancedMemory ?? false;
  const useWiki = agentConfig.wiki ?? false;

  // ── Resolve Claude account config dir ──
  const home = homedir();
  let claudeConfigDir: string | undefined;
  const effectiveAccount = agentConfig.claudeAccount || (claudeAccounts as any)?._defaultAccount;
  if (effectiveAccount && claudeAccounts) {
    const dir = claudeAccounts[effectiveAccount];
    if (dir) claudeConfigDir = dir.startsWith("~") ? dir.replace("~", home) : dir;
  }

  // ── Check for /relogin command ──
  const reloginMatch = RELOGIN_PATTERN.exec(msg.text);
  if (reloginMatch) {
    const accountName = reloginMatch[1] || effectiveAccount || "default";
    let reloginDir: string | undefined;
    if (claudeAccounts && claudeAccounts[accountName]) {
      const d = claudeAccounts[accountName];
      reloginDir = d.startsWith("~") ? d.replace("~", home) : d;
    }
    return handleRelogin(accountName, reloginDir);
  }

  // ── Check for /parallel command ──
  if (PARALLEL_PATTERN.test(msg.text)) {
    const tasks = parseParallelTasks(msg.text);
    if (tasks.length === 0) return "No tasks found. Format:\n/parallel\n- task 1\n- task 2\n- task 3";

    // Load system prompt for workers
    let workerPrompt: string;
    try {
      workerPrompt = readFileSync(resolve(baseDir, expandTilde(agentConfig.claudeMd)), "utf-8");
    } catch {
      workerPrompt = `You are ${agentConfig.name}. ${agentConfig.description}`;
    }

    const result = await executeParallel(
      tasks, agentConfig, workspace, workerPrompt, baseDir, mcpRegistry, claudeConfigDir
    );

    // Log the parallel execution
    try {
      appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(), from: msg.sender, text: msg.text,
        response: result.slice(0, 2000), agentId, channel: msg.channel,
        parallel: tasks.length,
      }) + "\n");
    } catch { /* ignore */ }

    return result;
  }

  // ── Check for /task command ──
  if (TASK_PATTERN.test(msg.text)) {
    // Load all agents from config.json for cross-agent task operations
    let allAgents: Record<string, any> = {};
    try {
      const configPath = join(baseDir, "config.json");
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      // Resolve tilde in paths for all agents
      for (const [aid, ag] of Object.entries(rawConfig.agents) as any[]) {
        if (ag.agentHome) ag.agentHome = ag.agentHome.startsWith("~") ? ag.agentHome.replace("~", home) : ag.agentHome;
        if (ag.memoryDir) ag.memoryDir = ag.memoryDir.startsWith("~") ? ag.memoryDir.replace("~", home) : ag.memoryDir;
      }
      allAgents = rawConfig.agents;
    } catch { /* fallback to just current agent */ }

    const taskResp = handleTaskCommand(msg.text, agentId, agentConfig, allAgents);
    if (taskResp !== null) {
      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: taskResp, agentId, channel: msg.channel,
        }) + "\n");
      } catch { /* ignore */ }
      return taskResp;
    }
  }

  // ── Check for intercepted commands ──
  const intercepted = handleInterceptedCommand(msg.text, agentId, memoryDir, senderSessionKey);
  if (intercepted !== null) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        from: msg.sender,
        text: msg.text,
        response: intercepted,
        agentId,
        channel: msg.channel,
      };
      appendFileSync(logPath, JSON.stringify(entry) + "\n");
    } catch { /* ignore */ }
    return intercepted;
  }

  // ── Advanced memory: search for relevant context ──
  let memoryContext = "";
  let memoryMgr: MemoryManager | null = null;
  if (useAdvancedMemory) {
    try {
      memoryMgr = await getMemoryManager(agentId, memoryDir);
      // Search for memories relevant to the user's message
      const searchResults = await memoryMgr.searchFormatted(msg.text, 5);
      if (searchResults) memoryContext += searchResults + "\n\n";
      // Load today + yesterday daily logs
      const daily = memoryMgr.loadDailyContext();
      if (daily) memoryContext += daily + "\n\n";
    } catch (err) {
      log.warn(`Advanced memory search failed for ${agentId}: ${err}`);
    }
  }

  // ── Load system prompt ──
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    log.error(`Failed to read CLAUDE.md for ${agentId}: ${err}`);
    return `Error: Could not load agent configuration for ${agentId}.`;
  }

  // ── Workspace boundary rule ──
  // Agents must never write outside their designated directories.
  const agentHome = agentConfig.agentHome ? resolve(baseDir, expandTilde(agentConfig.agentHome)) : null;
  const boundaryDirs = [workspace, memoryDir, agentHome].filter(Boolean);
  systemPrompt += `\n\n## CRITICAL: Workspace Boundary Rule
You must NEVER create, edit, write, or delete files outside the following directories:
${boundaryDirs.map(d => `- ${d}`).join("\n")}

This is a hard rule. Do not modify files in the MyAIforOne platform installation directory, npm cache, or any other system directory. If a task requires writing to a location outside these directories, ask the user for permission first and explain why.\n`;

  // ── Prepend soul.md for gym agents (trainer personality layer) ──
  if (agentConfig.agentClass === "gym") {
    try {
      const profilePath = join(memoryDir, "learner-profile.json");
      if (existsSync(profilePath)) {
        const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
        const trainer = profile.selectedTrainer;
        if (trainer) {
          const soulPath = join(memoryDir, "..", "souls", `${trainer}.md`);
          if (existsSync(soulPath)) {
            const soul = readFileSync(soulPath, "utf-8");
            systemPrompt = soul + "\n\n" + systemPrompt;
            log.info(`Gym agent: loaded soul.md for trainer "${trainer}"`);
          }
        }
      }
    } catch (err) {
      log.warn(`Failed to load gym soul.md: ${err}`);
    }
  }

  // ── Append memory context to system prompt for persistent sessions ──
  // (In persistent mode, context.md is injected into the system prompt
  // so the agent has standing context even after a session reset)
  if (isPersistent && existsSync(contextPath)) {
    try {
      const context = readFileSync(contextPath, "utf-8").trim();
      if (context) {
        systemPrompt += `\n\n## Agent Memory\n${context}\n`;
      }
    } catch { /* ignore */ }
  }

  // ── Append skill index if configured ──
  const agentOrgNames = (agentConfig.org || []).map((o: any) => o.organization).filter(Boolean);
  const hasOrgSkills = agentOrgNames.some((org: string) => existsSync(join(getPersonalAgentsDir(), org, "skills")));
  const hasSkills = effectiveSkills.length > 0 || (agentConfig.agentSkills?.length || 0) > 0 || hasOrgSkills;
  if (hasSkills) {
    systemPrompt += buildSkillIndex(effectiveSkills, agentConfig.agentSkills || [], memoryDir, agentOrgNames, baseDir);
  }

  // ── Append prompt template index if configured ──
  if (effectivePrompts.length > 0) {
    const trigger = globalDefaults?.promptTrigger || "!";
    systemPrompt += buildPromptIndex(effectivePrompts, baseDir, trigger);
  }

  // ── Append MCP account mapping (multi-account) ──
  {
    const agentHome = agentConfig.agentHome || resolve(memoryDir, "..");
    const resolvedHome = agentHome.startsWith("~") ? agentHome.replace("~", home) : agentHome;
    const accountsPath = join(resolvedHome, "mcp-accounts.json");
    if (existsSync(accountsPath)) {
      try {
        const accounts = JSON.parse(readFileSync(accountsPath, "utf-8")) as Record<string, { label: string; baseMcp: string; description?: string }>;
        if (Object.keys(accounts).length > 0) {
          const lines = ["\n\n## MCP Account Mapping", "You have multiple accounts connected for some services. Use the correct MCP instance based on which account the user is asking about.\n"];
          lines.push("| MCP Instance | Label | Service | Description |");
          lines.push("|---|---|---|---|");
          for (const [name, info] of Object.entries(accounts)) {
            lines.push(`| ${name} | ${info.label} | ${info.baseMcp} | ${info.description || ""} |`);
          }
          lines.push("\nWhen the user asks about a specific account (e.g., \"check my work email\"), use the matching MCP instance. If unclear, check all connected accounts.");
          systemPrompt += lines.join("\n");
        }
      } catch { /* ignore */ }
    }
  }

  // ── Append group agent delegation (sub-agents) ──
  if (agentConfig.subAgents && _appConfig) {
    const registry = buildAgentRegistry(_appConfig, agentConfig.subAgents);
    if (registry.length > 0) {
      systemPrompt += buildGroupAgentPrompt(registry, msg.text);
    }
  }

  // ── Append active tasks context ──
  {
    const agentHomeForTasks = agentConfig.agentHome || resolve(memoryDir, "..");
    const taskBlock = buildTaskContextBlock(agentHomeForTasks, agentId);
    if (taskBlock) systemPrompt += taskBlock;
  }

  // ── Append advanced memory context ──
  if (useAdvancedMemory && memoryContext) {
    systemPrompt += `\n\n${memoryContext}`;
  }

  // ── Auto-compaction check for advanced memory agents ──
  if (useAdvancedMemory && isPersistent && memoryMgr) {
    // Read current session to get message count
    const currentSession = loadSession(memoryDir, senderSessionKey);
    if (currentSession) {
      const compactionPrompt = memoryMgr.getCompactionPrompt(currentSession.messageCount);
      if (compactionPrompt) {
        systemPrompt += `\n\n${compactionPrompt}`;
      }
    }
  }

  // ── Append compact/reset instructions for persistent agents ──
  if (isPersistent) {
    systemPrompt += `\n\n## Session Commands
- When the user sends \`/opcompact\` followed by instructions, save the specified information to \`${contextPath}\` using the Write tool. This context survives session resets. Preserve any existing content that is still relevant — append or merge, don't overwrite blindly.
- \`/opreset\` is handled automatically by the gateway (you won't see it).
`;
  }

  // ── Wiki learning mode ──
  if (useWiki) {
    systemPrompt += `\n\n## Wiki Learning Mode
After each conversation exchange, evaluate whether you learned any NEW facts, corrections, or important insights from this interaction. If you did, append them to \`${learnedPath}\` using the Write tool (read the file first and append — do not overwrite).

Format for each entry:
\`\`\`
### [YYYY-MM-DD] — [Brief topic]
- Fact or correction learned
- Source: [who said it / where it came from]
\`\`\`

Rules:
- Only save genuinely NEW information not already in \`${contextPath}\` or \`${learnedPath}\`
- Include the source (who told you, which conversation)
- Do NOT save opinions, small talk, or ephemeral info
- When the user says "update context from learned", read \`${learnedPath}\`, cross-check against \`${contextPath}\`, merge verified facts into context.md, and note what was merged
`;
  }

  // ── Resolve prompt template trigger ──
  const promptTrigger = globalDefaults?.promptTrigger || "!";
  let promptInjection = "";
  let msgText = msg.text;
  if (effectivePrompts.length > 0 && msg.text.startsWith(promptTrigger)) {
    const resolved = resolvePromptTrigger(msg.text, effectivePrompts, baseDir, promptTrigger);
    if (resolved) {
      promptInjection = `[PROMPT TEMPLATE ACTIVE]\n${resolved.promptContent}\n[END PROMPT TEMPLATE]\n\n`;
      msgText = resolved.userText || msg.text.slice(promptTrigger.length + (msg.text.slice(promptTrigger.length).indexOf(" ") + 1 || 0));
      log.debug(`[${agentId}] Prompt template injected`);
    }
  }
  const effectiveMsg = msgText !== msg.text ? { ...msg, text: msgText } : msg;

  // ── Format message ──
  // For persistent sessions: skip conversation history injection (Claude manages its own)
  // Still inject memory context for non-persistent sessions
  let formattedMessage: string;
  if (isPersistent) {
    formattedMessage = promptInjection + formatMessage(effectiveMsg);
  } else {
    formattedMessage = promptInjection + formatMessage(
      effectiveMsg,
      existsSync(contextPath) ? contextPath : undefined,
      existsSync(logPath) ? logPath : undefined,
    );
  }

  // ── Build stdin payload ──
  const hasImages = msg.attachments && msg.attachments.length > 0;
  let stdinPayload: string;

  if (hasImages) {
    const contentBlocks: ContentBlock[] = [
      { type: "text", text: formattedMessage },
    ];

    for (const att of msg.attachments!) {
      try {
        const imgBuffer = readFileSync(att.path);
        const mimeType = att.mimeType || guessMimeType(att.path);
        if (imgBuffer.length > 10_000_000) {
          log.warn(`Skipping oversized image: ${att.path} (${imgBuffer.length} bytes)`);
          continue;
        }
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: imgBuffer.toString("base64"),
          },
        });
        log.debug(`Attached image: ${att.path} (${mimeType}, ${imgBuffer.length} bytes)`);
      } catch (err) {
        log.warn(`Failed to read attachment ${att.path}: ${err}`);
      }
    }

    stdinPayload = JSON.stringify([{ role: "user", content: contentBlocks }]);
    log.debug(`Executing ${agentId} with ${contentBlocks.length - 1} image(s): ${formattedMessage.slice(0, 200)}`);
  } else {
    stdinPayload = formattedMessage;
    log.debug(`Executing ${agentId}: ${formattedMessage.slice(0, 200)}`);
  }

  // ── Build claude -p args ──
  const args: string[] = ["-p", "-"];

  // Model override (from /model command)
  const modelOverride = loadModelOverride(memoryDir);
  if (modelOverride) args.push("--model", modelOverride);

  // Session management for persistent agents
  let session: SessionState | null = null;
  let spCleanup: (() => void) | null = null;
  if (isPersistent) {
    session = loadSession(memoryDir, senderSessionKey);
    if (session) {
      // Resume existing session
      args.push("--resume", session.sessionId);
      log.info(`Resuming session ${session.sessionId} for ${agentId} (msg #${session.messageCount + 1})`);
    } else {
      // First message: create new session
      const newId = randomUUID();
      session = { sessionId: newId, createdAt: new Date().toISOString(), messageCount: 0 };
      args.push("--session-id", newId);
      const spArgs = buildSystemPromptArgs(systemPrompt, agentId);
      args.push(...spArgs.args);
      spCleanup = spArgs.cleanup;
      log.info(`Starting new session ${newId} for ${agentId}`);
    }

    // Use JSON output to get structured metadata
    args.push("--output-format", "json");
  } else {
    // Non-persistent: always pass system prompt, text output
    const spArgs = buildSystemPromptArgs(systemPrompt, agentId);
    args.push(...spArgs.args);
    spCleanup = spArgs.cleanup;
    args.push("--output-format", "text");
  }

  // Workspace
  args.push("--add-dir", workspace);

  // Skills directory (so agent can Read skill files)
  if (hasSkills) {
    const home = homedir();
    const claudeSkillsDir = join(home, ".claude", "commands");
    const personalSkillsDir = join(getPersonalAgentsDir(), "skills");
    const agentSkillsDir = join(memoryDir, "..", "skills");

    if (existsSync(claudeSkillsDir) && effectiveSkills.length) {
      args.push("--add-dir", claudeSkillsDir);
    }
    if (existsSync(personalSkillsDir) && effectiveSkills.length) {
      args.push("--add-dir", personalSkillsDir);
    }
    if (existsSync(agentSkillsDir) && agentConfig.agentSkills?.length) {
      args.push("--add-dir", agentSkillsDir);
    }
    // Org-scoped skills dirs
    for (const orgName of agentOrgNames) {
      const orgSkillsDir = join(getPersonalAgentsDir(), orgName, "skills");
      if (existsSync(orgSkillsDir)) args.push("--add-dir", orgSkillsDir);
    }
  }

  // Allowed tools — include MCP tool patterns
  const allowedTools = [...agentConfig.allowedTools];
  if (effectiveMcps.length > 0) {
    for (const mcpName of effectiveMcps) {
      allowedTools.push(`mcp__${mcpName}__*`);
    }
  }
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // MCP servers
  let mcpConfigPath: string | null = null;
  if (effectiveMcps.length > 0 && mcpRegistry) {
    mcpConfigPath = buildMcpConfigFile(agentId, effectiveMcps, mcpRegistry, baseDir, memoryDir);
    args.push("--mcp-config", mcpConfigPath);
    log.debug(`MCP config for ${agentId}: ${mcpConfigPath} (servers: ${effectiveMcps.join(", ")})`);
  }

  // Permission mode: bypassPermissions when agent has MCPs (headless can't approve tool prompts)
  if (isPersistent) {
    args.push("--permission-mode", effectiveMcps.length ? "bypassPermissions" : "acceptEdits");
  }

  // ── Multi-model dispatch ──
  const multiModelEnabled = _appConfig?.service?.multiModelEnabled ?? false;
  const effectiveExecutor = agentConfig.executor
    || (multiModelEnabled ? (_appConfig?.service?.platformDefaultExecutor || "claude") : "claude");

  if (multiModelEnabled && effectiveExecutor !== "claude" && effectiveExecutor.includes(":")) {
    const [prefix, ...rest] = effectiveExecutor.split(":");
    const modelName = rest.join(":");

    // Helper to log + memory for alternative model responses
    const logAltResponse = (response: string) => {
      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: response.slice(0, 2000), agentId, channel: msg.channel, executor: effectiveExecutor,
        }) + "\n");
      } catch { /* ignore */ }
      if (useAdvancedMemory && memoryMgr) {
        memoryMgr.indexExchange(msg.text, response, msg.sender).catch(() => {});
      }
    };

    try {
      let altResponse: string;

      if (prefix === "ollama") {
        const { executeOllama } = await import("./ollama-executor.js");
        altResponse = await executeOllama({
          model: modelName, systemPrompt, message: formattedMessage,
          baseUrl: _appConfig?.service?.ollamaBaseUrl || "http://localhost:11434",
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else if (prefix === "anthropic") {
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys.anthropic;
        if (!apiKey) return "Error: No Anthropic API key configured. Add it in Admin → Settings → Provider Keys.";
        const { executeAnthropic } = await import("./anthropic-executor.js");
        altResponse = await executeAnthropic({
          model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else if (prefix === "gemini") {
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys.google;
        if (!apiKey) return "Error: No Google API key configured. Add it in Admin → Settings → Provider Keys.";
        const { executeGemini } = await import("./gemini-executor.js");
        altResponse = await executeGemini({
          model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else {
        // OpenAI-compatible providers (openai, grok, groq, together, mistral)
        const { resolveProvider, executeOpenAICompat } = await import("./openai-executor.js");
        const provider = resolveProvider(prefix);
        if (!provider) return `Error: Unknown model provider "${prefix}". Supported: ollama, anthropic, openai, grok, groq, together, mistral, gemini.`;
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys[provider.keyField];
        if (!apiKey) return `Error: No API key configured for ${provider.name}. Add it in Admin → Settings → Provider Keys.`;
        altResponse = await executeOpenAICompat({
          provider: prefix, model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      }

      logAltResponse(altResponse);
      return altResponse;
    } catch (err) {
      log.error(`[${prefix}] Agent ${agentId} execution failed: ${err}`);
      return `Sorry, I ran into an error with ${effectiveExecutor}: ${err instanceof Error ? err.message : err}`;
    }
  }

  // ── Server mode fallback: use Anthropic API when CLI is unavailable ──
  if (isServerMode()) {
    const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
    const anthropicKey = providerKeys.anthropic;
    if (!anthropicKey) {
      return "Error: No Anthropic API key configured. On server mode, add your API key in Admin → Settings → Provider Keys → Anthropic / Claude.";
    }
    try {
      const { executeAnthropic } = await import("./anthropic-executor.js");
      const apiResponse = await executeAnthropic({
        apiKey: anthropicKey,
        systemPrompt,
        message: formattedMessage,
        timeout: agentConfig.timeout ?? 300_000,
      });
      // Log + memory
      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: apiResponse.slice(0, 2000), agentId, channel: msg.channel, executor: "anthropic-api",
        }) + "\n");
      } catch { /* ignore */ }
      if (useAdvancedMemory && memoryMgr) {
        memoryMgr.indexExchange(msg.text, apiResponse, msg.sender).catch(() => {});
      }
      return apiResponse;
    } catch (err) {
      log.error(`[Anthropic] Server-mode fallback failed for ${agentId}: ${err}`);
      return `Sorry, I ran into an error with the Anthropic API: ${err instanceof Error ? err.message : err}`;
    }
  }

  // ── Spawn claude (local mode only) ──
  const timeout = agentConfig.timeout ?? 14_400_000;
  let rawOutput: string;

  try {
    rawOutput = await spawnClaude(args, workspace, timeout, stdinPayload, claudeConfigDir);
  } catch (err: any) {
    const errStr = String(err);
    // Detect stale session — retry with a fresh session
    if (session && isPersistent && (errStr.includes("No conversation found") || errStr.includes("exited with code 1"))) {
      log.warn(`Stale session for ${agentId} (${session.sessionId}) — retrying with fresh session`);
      try { unlinkSync(join(memoryDir, senderSessionKey ? `session-${senderSessionKey}.json` : "session.json")); } catch { /* ignore */ }
      const newId = randomUUID();
      session = { sessionId: newId, createdAt: new Date().toISOString(), messageCount: 0 };
      const retryArgs = args.filter(a => a !== "--resume" && a !== session!.sessionId)
        .filter((a, i, arr) => !(a === "--resume" && i + 1 < arr.length));
      // Remove old --resume and its value, add --session-id + --system-prompt
      const cleanArgs: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--resume") { i++; continue; } // skip --resume and its value
        cleanArgs.push(args[i]);
      }
      const retrySpArgs = buildSystemPromptArgs(systemPrompt, agentId);
      cleanArgs.push("--session-id", newId, ...retrySpArgs.args);
      try {
        rawOutput = await spawnClaude(cleanArgs, workspace, timeout, stdinPayload, claudeConfigDir);
        saveSession(memoryDir, session, senderSessionKey);
        log.info(`Fresh session ${newId} created for ${agentId}`);
      } catch (retryErr) {
        log.error(`Agent ${agentId} execution failed on retry: ${retryErr}`);
        if (retrySpArgs.cleanup) retrySpArgs.cleanup();
        return `Sorry, I ran into an error processing that request.`;
      }
      if (retrySpArgs.cleanup) retrySpArgs.cleanup();
    } else {
      log.error(`Agent ${agentId} execution failed: ${err}`);
      return `Sorry, I ran into an error processing that request.`;
    }
  } finally {
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch { /* ignore */ }
    }
    if (spCleanup) spCleanup();
  }

  // ── Parse response ──
  let response: string;
  let costUsd: number | undefined;
  if (isPersistent) {
    // Parse JSON output
    try {
      const result = JSON.parse(rawOutput) as ClaudeJsonResult;
      response = result.result;
      costUsd = result.total_cost_usd;
      log.debug(`Session ${result.session_id}: cost=$${result.total_cost_usd.toFixed(4)}, duration=${result.duration_ms}ms`);

      // Update session state
      if (session) {
        session.messageCount += 1;
        saveSession(memoryDir, session, senderSessionKey);
      }
    } catch (err) {
      // Fallback: treat as plain text if JSON parse fails
      log.warn(`Failed to parse JSON output for ${agentId}, using raw: ${err}`);
      response = rawOutput.trim();
      if (session) {
        session.messageCount += 1;
        saveSession(memoryDir, session, senderSessionKey);
      }
    }
  } else {
    response = rawOutput.trim();
  }

  // Auto-commit if enabled
  if (agentConfig.autoCommit) {
    await autoCommit(workspace, agentId, response, agentConfig.autoCommitBranch);
  }

  // Log to conversation history (audit trail)
  try {
    const entry = {
      ts: new Date().toISOString(),
      from: msg.sender,
      text: msg.text,
      response: response.slice(0, 2000),
      agentId,
      channel: msg.channel,
      ...(session ? { sessionId: session.sessionId, messageNum: session.messageCount } : {}),
      ...(costUsd !== undefined ? { cost: costUsd } : {}),
    };
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    log.warn(`Failed to write conversation log: ${err}`);
  }

  // ── Advanced memory: index this exchange ──
  if (useAdvancedMemory && memoryMgr) {
    try {
      await memoryMgr.indexExchange(msg.text, response, msg.senderName || msg.sender);
    } catch (err) {
      log.warn(`Failed to index exchange for ${agentId}: ${err}`);
    }
  }

  return response;
}

// ─── Claude process spawner ──────────────────────────────────────────

function spawnClaude(args: string[], cwd: string, timeout: number, stdinData?: string, claudeConfigDir?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Remove env vars that trigger Claude Code nesting detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    if (claudeConfigDir) env.CLAUDE_CONFIG_DIR = claudeConfigDir;

    const spawnArgs = _CLAUDE_CLI_JS ? [_CLAUDE_CLI_JS, ...args] : args;
    const proc = spawn(CLAUDE_BIN, spawnArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
      ..._CLAUDE_NEEDS_SHELL && { shell: true },
    });

    if (stdinData && proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        log.warn(`claude -p exited with code ${code} stderr: ${stderr.slice(0, 500)} stdout: ${stdout.slice(0, 500)}`);
        const errLower = stderr.toLowerCase();
        const isAuth = errLower.includes("not authenticated") || errLower.includes("please log in") ||
          errLower.includes("unauthorized") || errLower.includes("expired") ||
          errLower.includes("auth") || errLower.includes("login required");
        if (isAuth) {
          reject(new Error(`Claude account session has expired. Go to /settings to re-authorize.`));
        } else {
          reject(new Error(`claude -p exited with code ${code}`));
        }
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Streaming executor ──────────────────────────────────────────────

export interface StreamEvent {
  type: "status" | "text" | "done" | "error" | "tool";
  data: string;
  tool?: { name: string; input?: any };
}

/**
 * Execute agent with streaming — yields events as Claude processes.
 * Used by Web UI (SSE) and phone channels (status messages).
 */
export async function* executeAgentStreaming(
  route: ResolvedRoute,
  msg: InboundMessage,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeAccounts?: Record<string, string>,
  onRawLine?: (line: string) => void,
  globalDefaults?: { skills?: string[]; mcps?: string[]; prompts?: string[]; promptTrigger?: string },
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // License gate — block execution if license is invalid
  const licenseBlock = checkLicenseForExecution();
  if (licenseBlock) {
    yield { type: "error", data: licenseBlock };
    return;
  }

  const { agentId, agentConfig } = route;
  const effectiveSkills = [...new Set([...(agentConfig.skills || []), ...(globalDefaults?.skills || [])])];
  const effectiveMcps = [...new Set([...(agentConfig.mcps || []), ...(globalDefaults?.mcps || [])])];
  const effectivePrompts = [...new Set([...(agentConfig.prompts || []), ...(globalDefaults?.prompts || [])])];
  const _home = homedir();
  const expandTilde = (p: string) => p.startsWith("~") ? p.replace("~", _home) : p;
  const workspace = resolve(expandTilde(agentConfig.workspace));
  const claudeMdPath = resolve(baseDir, expandTilde(agentConfig.claudeMd));
  const memoryDir = resolve(baseDir, expandTilde(agentConfig.memoryDir));
  const contextPath = join(memoryDir, "context.md");
  const learnedPath = join(memoryDir, "learned.md");
  // Per-user conversation log: when conversationLogMode is "per-user", each sender gets their own log file.
  const _logSenderId = (agentConfig as any).conversationLogMode === "per-user"
    ? (msg.sender || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")
    : null;
  const logPath = _logSenderId
    ? join(memoryDir, `conversation_log_${_logSenderId}.jsonl`)
    : join(memoryDir, "conversation_log.jsonl");
  const isPersistent = agentConfig.persistent ?? false;
  const perSender = agentConfig.perSenderSessions ?? false;
  // Auto-isolate web UI session tabs — senderId is "tab-{id}" (UI), "htab-{id}" (home), or "ctab-{id}" (coach)
  const isWebTab = typeof msg.sender === "string" && /^[hc]?tab-/.test(msg.sender);
  const senderSessionKey = (isPersistent && (perSender || isWebTab)) ? msg.sender : undefined;
  const useAdvancedMemory = agentConfig.advancedMemory ?? false;
  const useWiki = agentConfig.wiki ?? false;

  // ── Resolve Claude account config dir ──
  const home = homedir();
  let claudeConfigDir: string | undefined;
  const effectiveAccount = agentConfig.claudeAccount || (claudeAccounts as any)?._defaultAccount;
  if (effectiveAccount && claudeAccounts) {
    const dir = claudeAccounts[effectiveAccount];
    if (dir) claudeConfigDir = dir.startsWith("~") ? dir.replace("~", home) : dir;
  }

  // ── Check for /relogin command ──
  const reloginMatch = RELOGIN_PATTERN.exec(msg.text);
  if (reloginMatch) {
    const accountName = reloginMatch[1] || effectiveAccount || "default";
    let reloginDir: string | undefined;
    if (claudeAccounts && claudeAccounts[accountName]) {
      const d = claudeAccounts[accountName];
      reloginDir = d.startsWith("~") ? d.replace("~", home) : d;
    }
    const reloginResult = handleRelogin(accountName, reloginDir);
    yield { type: "text", data: reloginResult };
    yield { type: "done", data: reloginResult };
    return;
  }

  // ── Check for /parallel command ──
  if (PARALLEL_PATTERN.test(msg.text)) {
    const tasks = parseParallelTasks(msg.text);
    if (tasks.length === 0) {
      yield { type: "text", data: "No tasks found. Format:\n/parallel\n- task 1\n- task 2" };
      yield { type: "done", data: "" };
      return;
    }

    yield { type: "status", data: `Spawning ${tasks.length} parallel workers...` };

    let workerPrompt: string;
    try {
      workerPrompt = readFileSync(resolve(baseDir, expandTilde(agentConfig.claudeMd)), "utf-8");
    } catch {
      workerPrompt = `You are ${agentConfig.name}. ${agentConfig.description}`;
    }

    const result = await executeParallel(
      tasks, agentConfig, workspace, workerPrompt, baseDir, mcpRegistry, claudeConfigDir
    );

    try {
      appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(), from: msg.sender, text: msg.text,
        response: result.slice(0, 2000), agentId, channel: msg.channel,
        parallel: tasks.length,
      }) + "\n");
    } catch { /* ignore */ }

    yield { type: "text", data: result };
    yield { type: "done", data: result };
    return;
  }

  // ── Check for /task command ──
  if (TASK_PATTERN.test(msg.text)) {
    let allAgents: Record<string, any> = {};
    try {
      const configPath = join(baseDir, "config.json");
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      for (const [aid, ag] of Object.entries(rawConfig.agents) as any[]) {
        if (ag.agentHome) ag.agentHome = ag.agentHome.startsWith("~") ? ag.agentHome.replace("~", home) : ag.agentHome;
        if (ag.memoryDir) ag.memoryDir = ag.memoryDir.startsWith("~") ? ag.memoryDir.replace("~", home) : ag.memoryDir;
      }
      allAgents = rawConfig.agents;
    } catch { /* fallback */ }

    const taskResp = handleTaskCommand(msg.text, agentId, agentConfig, allAgents);
    if (taskResp !== null) {
      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: taskResp, agentId, channel: msg.channel,
        }) + "\n");
      } catch { /* ignore */ }
      yield { type: "text", data: taskResp };
      yield { type: "done", data: taskResp };
      return;
    }
  }

  // Check intercepted commands
  const intercepted = handleInterceptedCommand(msg.text, agentId, memoryDir, senderSessionKey);
  if (intercepted !== null) {
    try {
      appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(), from: msg.sender, text: msg.text,
        response: intercepted, agentId, channel: msg.channel,
      }) + "\n");
    } catch { /* ignore */ }
    yield { type: "text", data: intercepted };
    yield { type: "done", data: intercepted };
    return;
  }

  // Advanced memory: search for relevant context
  let memoryContext = "";
  let memoryMgr: MemoryManager | null = null;
  if (useAdvancedMemory) {
    try {
      memoryMgr = await getMemoryManager(agentId, memoryDir);
      const searchResults = await memoryMgr.searchFormatted(msg.text, 5);
      if (searchResults) memoryContext += searchResults + "\n\n";
      const daily = memoryMgr.loadDailyContext();
      if (daily) memoryContext += daily + "\n\n";
    } catch (err) {
      log.warn(`Advanced memory search failed for ${agentId}: ${err}`);
    }
  }

  // Load system prompt
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    yield { type: "error", data: `Could not load agent configuration for ${agentId}.` };
    return;
  }

  // ── Workspace boundary rule ──
  const streamAgentHome = agentConfig.agentHome ? resolve(baseDir, expandTilde(agentConfig.agentHome)) : null;
  const streamBoundaryDirs = [workspace, memoryDir, streamAgentHome].filter(Boolean);
  systemPrompt += `\n\n## CRITICAL: Workspace Boundary Rule
You must NEVER create, edit, write, or delete files outside the following directories:
${streamBoundaryDirs.map(d => `- ${d}`).join("\n")}

This is a hard rule. Do not modify files in the MyAIforOne platform installation directory, npm cache, or any other system directory. If a task requires writing to a location outside these directories, ask the user for permission first and explain why.\n`;

  // Prepend soul.md for gym agents (trainer personality layer)
  if (agentConfig.agentClass === "gym") {
    try {
      const profilePath = join(memoryDir, "learner-profile.json");
      if (existsSync(profilePath)) {
        const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
        const trainer = profile.selectedTrainer;
        if (trainer) {
          const soulPath = join(memoryDir, "..", "souls", `${trainer}.md`);
          if (existsSync(soulPath)) {
            const soul = readFileSync(soulPath, "utf-8");
            systemPrompt = soul + "\n\n" + systemPrompt;
            log.info(`Gym agent: loaded soul.md for trainer "${trainer}"`);
          }
        }
      }
    } catch (err) {
      log.warn(`Failed to load gym soul.md: ${err}`);
    }
  }

  if (isPersistent && existsSync(contextPath)) {
    try {
      const context = readFileSync(contextPath, "utf-8").trim();
      if (context) systemPrompt += `\n\n## Agent Memory\n${context}\n`;
    } catch { /* ignore */ }
  }

  const streamOrgNames = (agentConfig.org || []).map((o: any) => o.organization).filter(Boolean);
  const streamHasOrgSkills = streamOrgNames.some((org: string) => existsSync(join(getPersonalAgentsDir(), org, "skills")));
  const hasSkills = effectiveSkills.length > 0 || (agentConfig.agentSkills?.length || 0) > 0 || streamHasOrgSkills;
  if (hasSkills) {
    systemPrompt += buildSkillIndex(effectiveSkills, agentConfig.agentSkills || [], memoryDir, streamOrgNames, baseDir);
  }

  // ── Append prompt template index if configured ──
  if (effectivePrompts.length > 0) {
    const trigger = globalDefaults?.promptTrigger || "!";
    systemPrompt += buildPromptIndex(effectivePrompts, baseDir, trigger);
  }

  // ── Append MCP account mapping (multi-account) ──
  {
    const agentHome = agentConfig.agentHome || resolve(memoryDir, "..");
    const resolvedHome = agentHome.startsWith("~") ? agentHome.replace("~", home) : agentHome;
    const accountsPath = join(resolvedHome, "mcp-accounts.json");
    if (existsSync(accountsPath)) {
      try {
        const accounts = JSON.parse(readFileSync(accountsPath, "utf-8")) as Record<string, { label: string; baseMcp: string; description?: string }>;
        if (Object.keys(accounts).length > 0) {
          const lines = ["\n\n## MCP Account Mapping", "You have multiple accounts connected for some services. Use the correct MCP instance based on which account the user is asking about.\n"];
          lines.push("| MCP Instance | Label | Service | Description |");
          lines.push("|---|---|---|---|");
          for (const [name, info] of Object.entries(accounts)) {
            lines.push(`| ${name} | ${info.label} | ${info.baseMcp} | ${info.description || ""} |`);
          }
          lines.push("\nWhen the user asks about a specific account (e.g., \"check my work email\"), use the matching MCP instance. If unclear, check all connected accounts.");
          systemPrompt += lines.join("\n");
        }
      } catch { /* ignore */ }
    }
  }

  // ── Append group agent delegation (sub-agents) ──
  if (agentConfig.subAgents && _appConfig) {
    const registry = buildAgentRegistry(_appConfig, agentConfig.subAgents);
    if (registry.length > 0) {
      systemPrompt += buildGroupAgentPrompt(registry, msg.text);
    }
  }

  // ── Append active tasks context ──
  {
    const agentHomeForTasks = agentConfig.agentHome || resolve(memoryDir, "..");
    const taskBlock = buildTaskContextBlock(agentHomeForTasks, agentId);
    if (taskBlock) systemPrompt += taskBlock;
  }

  if (useAdvancedMemory && memoryContext) {
    systemPrompt += `\n\n${memoryContext}`;
  }

  if (useAdvancedMemory && isPersistent && memoryMgr) {
    const currentSession = loadSession(memoryDir, senderSessionKey);
    if (currentSession) {
      const compactionPrompt = memoryMgr.getCompactionPrompt(currentSession.messageCount);
      if (compactionPrompt) systemPrompt += `\n\n${compactionPrompt}`;
    }
  }

  if (isPersistent) {
    systemPrompt += `\n\n## Session Commands\n- When the user sends \`/opcompact\` followed by instructions, save the specified information to \`${contextPath}\` using the Write tool.\n- \`/opreset\` is handled automatically by the gateway.\n`;
  }

  // ── Wiki learning mode ──
  if (useWiki) {
    systemPrompt += `\n\n## Wiki Learning Mode\nAfter each conversation exchange, evaluate whether you learned any NEW facts, corrections, or important insights. If you did, append them to \`${learnedPath}\` using the Write tool (read first, then append — do not overwrite).\n\nFormat: \`### [YYYY-MM-DD] — [Brief topic]\` followed by bullet points with facts and source.\n\nRules:\n- Only save genuinely NEW information not already in \`${contextPath}\` or \`${learnedPath}\`\n- Include the source (who said it)\n- Do NOT save opinions, small talk, or ephemeral info\n- When user says "update context from learned", merge verified facts from \`${learnedPath}\` into \`${contextPath}\`\n`;
  }

  // ── Resolve prompt template trigger ──
  const promptTriggerStr = globalDefaults?.promptTrigger || "!";
  let promptInjectionStr = "";
  let streamMsgText = msg.text;
  if (effectivePrompts.length > 0 && msg.text.startsWith(promptTriggerStr)) {
    const resolved = resolvePromptTrigger(msg.text, effectivePrompts, baseDir, promptTriggerStr);
    if (resolved) {
      promptInjectionStr = `[PROMPT TEMPLATE ACTIVE]\n${resolved.promptContent}\n[END PROMPT TEMPLATE]\n\n`;
      streamMsgText = resolved.userText || msg.text.slice(promptTriggerStr.length + (msg.text.slice(promptTriggerStr.length).indexOf(" ") + 1 || 0));
    }
  }
  const effectiveStreamMsg = streamMsgText !== msg.text ? { ...msg, text: streamMsgText } : msg;

  let formattedMessage: string;
  if (isPersistent) {
    formattedMessage = promptInjectionStr + formatMessage(effectiveStreamMsg);
  } else {
    formattedMessage = promptInjectionStr + formatMessage(
      effectiveStreamMsg,
      existsSync(contextPath) ? contextPath : undefined,
      existsSync(logPath) ? logPath : undefined,
    );
  }

  const hasImages = msg.attachments && msg.attachments.length > 0;
  let stdinPayload: string;
  if (hasImages) {
    const contentBlocks: ContentBlock[] = [{ type: "text", text: formattedMessage }];
    for (const att of msg.attachments!) {
      try {
        const imgBuffer = readFileSync(att.path);
        const mimeType = att.mimeType || guessMimeType(att.path);
        if (imgBuffer.length > 10_000_000) continue;
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: mimeType, data: imgBuffer.toString("base64") } });
      } catch { /* skip */ }
    }
    stdinPayload = JSON.stringify([{ role: "user", content: contentBlocks }]);
  } else {
    stdinPayload = formattedMessage;
  }

  // Build args with stream-json output
  const args: string[] = ["-p", "-"];

  // Model override (from /model command)
  const modelOverride = loadModelOverride(memoryDir);
  if (modelOverride) args.push("--model", modelOverride);

  let session: SessionState | null = null;
  let spCleanup: (() => void) | null = null;
  const forceNewSession = (agentConfig as any).forceNewSession ?? false;
  if (isPersistent) {
    session = forceNewSession ? null : loadSession(memoryDir, senderSessionKey);
    if (session) {
      args.push("--resume", session.sessionId);
    } else {
      const newId = randomUUID();
      session = { sessionId: newId, createdAt: new Date().toISOString(), messageCount: 0 };
      args.push("--session-id", newId);
      const spArgs = buildSystemPromptArgs(systemPrompt, agentId);
      args.push(...spArgs.args);
      spCleanup = spArgs.cleanup;
    }
  } else {
    const spArgs = buildSystemPromptArgs(systemPrompt, agentId);
    args.push(...spArgs.args);
    spCleanup = spArgs.cleanup;
  }

  // Key difference: stream-json output (requires --verbose)
  // --include-partial-messages enables token-level streaming (content_block_delta events)
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  args.push("--add-dir", workspace);

  if (effectiveSkills.length > 0 || streamHasOrgSkills) {
    const skillsDir = join(homedir(), ".claude", "commands");
    if (existsSync(skillsDir) && effectiveSkills.length) args.push("--add-dir", skillsDir);
    // Org-scoped skills dirs
    for (const orgName of streamOrgNames) {
      const orgSkillsDir = join(getPersonalAgentsDir(), orgName, "skills");
      if (existsSync(orgSkillsDir)) args.push("--add-dir", orgSkillsDir);
    }
  }

  const allowedTools = [...agentConfig.allowedTools];
  if (effectiveMcps.length > 0) {
    for (const mcpName of effectiveMcps) allowedTools.push(`mcp__${mcpName}__*`);
  }
  if (allowedTools.length > 0) args.push("--allowedTools", allowedTools.join(","));

  let mcpConfigPath: string | null = null;
  if (effectiveMcps.length > 0 && mcpRegistry) {
    mcpConfigPath = buildMcpConfigFile(agentId, effectiveMcps, mcpRegistry, baseDir, memoryDir);
    args.push("--mcp-config", mcpConfigPath);
  }

  if (isPersistent) args.push("--permission-mode", effectiveMcps.length ? "bypassPermissions" : "acceptEdits");

  const timeout = agentConfig.timeout ?? 14_400_000;

  // ── Multi-model dispatch (streaming) ──
  const multiModelEnabled = _appConfig?.service?.multiModelEnabled ?? false;
  const effectiveExecutor = agentConfig.executor
    || (multiModelEnabled ? (_appConfig?.service?.platformDefaultExecutor || "claude") : "claude");

  if (multiModelEnabled && effectiveExecutor !== "claude" && effectiveExecutor.includes(":")) {
    const [prefix, ...rest] = effectiveExecutor.split(":");
    const modelName = rest.join(":");

    try {
      let streamGen: AsyncGenerator<string>;

      if (prefix === "ollama") {
        const { streamOllama } = await import("./ollama-executor.js");
        streamGen = streamOllama({
          model: modelName, systemPrompt, message: formattedMessage,
          baseUrl: _appConfig?.service?.ollamaBaseUrl || "http://localhost:11434",
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else if (prefix === "anthropic") {
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys.anthropic;
        if (!apiKey) { yield { type: "error", data: "No Anthropic API key configured. Add it in Admin → Settings → Provider Keys." } as StreamEvent; return; }
        const { streamAnthropic } = await import("./anthropic-executor.js");
        streamGen = streamAnthropic({
          model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else if (prefix === "gemini") {
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys.google;
        if (!apiKey) { yield { type: "error", data: "No Google API key configured." } as StreamEvent; return; }
        const { streamGemini } = await import("./gemini-executor.js");
        streamGen = streamGemini({
          model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      } else {
        const { resolveProvider, streamOpenAICompat } = await import("./openai-executor.js");
        const provider = resolveProvider(prefix);
        if (!provider) { yield { type: "error", data: `Unknown provider "${prefix}".` } as StreamEvent; return; }
        const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
        const apiKey = providerKeys[provider.keyField];
        if (!apiKey) { yield { type: "error", data: `No API key for ${provider.name}.` } as StreamEvent; return; }
        streamGen = streamOpenAICompat({
          provider: prefix, model: modelName, apiKey, systemPrompt, message: formattedMessage,
          timeout: agentConfig.timeout ?? 300_000,
        });
      }

      let fullResponse = "";
      for await (const chunk of streamGen) {
        fullResponse += chunk;
        yield { type: "text", data: chunk } as StreamEvent;
      }
      yield { type: "done", data: fullResponse } as StreamEvent;

      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: fullResponse.slice(0, 2000), agentId, channel: msg.channel, executor: effectiveExecutor,
        }) + "\n");
      } catch { /* ignore */ }

      if (useAdvancedMemory && memoryMgr) {
        memoryMgr.indexExchange(msg.text, fullResponse, msg.sender).catch(() => {});
      }

      return;
    } catch (err) {
      log.error(`[${prefix}] Streaming failed for ${agentId}: ${err}`);
      yield { type: "error", data: `Error with ${effectiveExecutor}: ${err instanceof Error ? err.message : err}` } as StreamEvent;
      return;
    }
  }

  // ── Server mode fallback: stream via Anthropic API when CLI is unavailable ──
  if (isServerMode()) {
    const providerKeys = (_appConfig?.service as any)?.providerKeys || {};
    const anthropicKey = providerKeys.anthropic;
    if (!anthropicKey) {
      yield { type: "error", data: "No Anthropic API key configured. On server mode, add your API key in Admin → Settings → Provider Keys → Anthropic / Claude." } as StreamEvent;
      return;
    }
    try {
      const { streamAnthropic } = await import("./anthropic-executor.js");
      yield { type: "status", data: "Starting..." } as StreamEvent;
      let fullResponse = "";
      for await (const chunk of streamAnthropic({
        apiKey: anthropicKey, systemPrompt, message: formattedMessage,
        timeout: agentConfig.timeout ?? 300_000,
      })) {
        fullResponse += chunk;
        yield { type: "text", data: chunk } as StreamEvent;
      }
      yield { type: "done", data: fullResponse } as StreamEvent;
      try {
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(), from: msg.sender, text: msg.text,
          response: fullResponse.slice(0, 2000), agentId, channel: msg.channel, executor: "anthropic-api",
        }) + "\n");
      } catch { /* ignore */ }
      if (useAdvancedMemory && memoryMgr) {
        memoryMgr.indexExchange(msg.text, fullResponse, msg.sender).catch(() => {});
      }
      return;
    } catch (err) {
      log.error(`[Anthropic] Server-mode streaming fallback failed for ${agentId}: ${err}`);
      yield { type: "error", data: `Anthropic API error: ${err instanceof Error ? err.message : err}` } as StreamEvent;
      return;
    }
  }

  // Spawn claude and stream output (local mode only)
  yield { type: "status", data: "Starting..." };

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  if (claudeConfigDir) env.CLAUDE_CONFIG_DIR = claudeConfigDir;

  const spawnArgs = _CLAUDE_CLI_JS ? [_CLAUDE_CLI_JS, ...args] : args;
  const spawnStartTime = Date.now();
  const proc = spawn(CLAUDE_BIN, spawnArgs, { cwd: workspace, stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true, ..._CLAUDE_NEEDS_SHELL && { shell: true } });

  if (stdinPayload && proc.stdin) {
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  }

  // Kill the child process if the abort signal fires (e.g. user clicked Stop)
  if (signal) {
    if (signal.aborted) { proc.kill("SIGTERM"); }
    else { signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true }); }
  }

  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
  }, timeout);

  let fullResponse = "";
  let buffer = "";
  let lastCostUsd: number | undefined;

  // Process stream-json output line by line
  // With --include-partial-messages, events come wrapped as:
  //   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
  let streamedText = false; // track if we got token-level deltas
  const pendingToolNames = new Set<string>(); // track tools already emitted from content_block_start
  const processLine = function*(line: string): Generator<StreamEvent> {
    if (!line.trim()) return;
    try {
      let event = JSON.parse(line);

      // Unwrap stream_event wrapper from --include-partial-messages
      if (event.type === "stream_event" && event.event) {
        event = event.event;
      }

      // Token-level streaming via content_block_delta
      if (event.type === "content_block_delta") {
        const text = event.delta?.text;
        if (text) {
          fullResponse += text;
          streamedText = true;
          yield { type: "text", data: text } as StreamEvent;
        }
      } else if (event.type === "content_block_start") {
        if (event.content_block?.type === "tool_use") {
          const toolName = event.content_block.name || "tool";
          const toolId = event.content_block.id || "";
          pendingToolNames.add(toolId);
          yield { type: "tool", data: `Using ${toolName}...`, tool: { name: toolName, input: {} } } as StreamEvent;
        }
      } else if (event.type === "assistant" && event.message?.content) {
        // Full assistant message — extract tool details with complete input
        for (const block of event.message.content) {
          if (block.type === "text" && block.text && !streamedText) {
            fullResponse += block.text;
            yield { type: "text", data: block.text } as StreamEvent;
          } else if (block.type === "tool_use" && block.name && pendingToolNames.has(block.id)) {
            // Re-emit tool event with full input (replaces the empty-input one from content_block_start)
            pendingToolNames.delete(block.id);
            yield { type: "tool", data: `Using ${block.name}...`, tool: { name: block.name, input: block.input || {} } } as StreamEvent;
          }
        }
        // Reset for next turn (after tool use)
        streamedText = false;
      } else if (event.type === "tool_use") {
        const toolName = event.tool_name || event.name || "tool";
        const toolInput = event.input || event.tool_input;
        yield { type: "tool", data: `Using ${toolName}...`, tool: { name: toolName, input: toolInput } } as StreamEvent;
      } else if (event.type === "tool_result") {
        yield { type: "status", data: "Processing result..." } as StreamEvent;
      } else if (event.type === "result") {
        // Final result event
        if (event.result && !fullResponse) {
          fullResponse = event.result;
          yield { type: "text", data: event.result } as StreamEvent;
        }
        if (typeof event.total_cost_usd === "number") lastCostUsd = event.total_cost_usd;
        if (event.session_id && session) {
          session.messageCount += 1;
          saveSession(memoryDir, session, senderSessionKey);
        }
      }
    } catch {
      // Not JSON — might be partial line, ignore
    }
  };

  // Real-time streaming: process stdout lines as they arrive using an async queue
  const eventQueue: Array<StreamEvent | { type: "__done"; code: number | null }> = [];
  let queueResolve: (() => void) | null = null;

  function pushEvent(event: StreamEvent | { type: "__done"; code: number | null }) {
    eventQueue.push(event);
    if (queueResolve) {
      queueResolve();
      queueResolve = null;
    }
  }

  function waitForEvent(): Promise<void> {
    if (eventQueue.length > 0) return Promise.resolve();
    return new Promise(r => { queueResolve = r; });
  }

  // Buffer partial lines from stdout
  let lineBuffer = "";
  let rawStdout = "";
  proc.stdout.on("data", (data: Buffer) => {
    const chunk = data.toString();
    rawStdout += chunk;
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || ""; // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      if (onRawLine) onRawLine(line);
      for (const event of processLine(line)) {
        pushEvent(event);
      }
    }
  });

  // Also capture stderr as raw lines
  let stderrBuf = "";
  proc.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    stderrBuf += text;
    for (const line of text.split("\n")) {
      if (line.trim() && onRawLine) onRawLine(`[stderr] ${line}`);
    }
  });

  proc.on("close", (code) => {
    clearTimeout(timer);
    // Process any remaining buffer
    if (lineBuffer.trim()) {
      for (const event of processLine(lineBuffer)) {
        pushEvent(event);
      }
    }
    pushEvent({ type: "__done", code });
  });

  proc.on("error", () => {
    clearTimeout(timer);
    pushEvent({ type: "__done", code: 1 });
  });

  // Consume events as they arrive — this yields in real-time
  let done = false;
  let exitCode: number | null = 0;
  while (!done) {
    await waitForEvent();
    while (eventQueue.length > 0) {
      const event = eventQueue.shift()!;
      if (event.type === "__done") {
        exitCode = (event as any).code;
        done = true;
        break;
      }
      yield event as StreamEvent;
    }
  }

  // Clean up MCP config and temp system prompt dir
  if (mcpConfigPath) {
    try { unlinkSync(mcpConfigPath); } catch { /* ignore */ }
  }
  if (spCleanup) spCleanup();

  if (exitCode !== 0 && !fullResponse) {
    const elapsedMs = Date.now() - spawnStartTime;
    log.error(`Agent ${agentId} exited with code ${exitCode} after ${elapsedMs}ms. stderr: ${stderrBuf.slice(0, 1000)} stdout: ${rawStdout.slice(0, 500)}`);
    const accountName = agentConfig.claudeAccount || "default";
    const combinedErr = stderrBuf.toLowerCase();
    const isAuthError = combinedErr.includes("not authenticated") ||
      combinedErr.includes("please log in") ||
      combinedErr.includes("unauthorized") ||
      combinedErr.includes("invalid api key") ||
      combinedErr.includes("expired") ||
      combinedErr.includes("auth") ||
      combinedErr.includes("login required");

    // Stale session: explicit "no conversation found" OR empty-stderr exit that ran
    // long enough to have actually connected (>2s). Instant failures (<2s) with empty
    // stderr are spawn/binary issues, not stale sessions — don't mask them.
    const isStaleSession = combinedErr.includes("no conversation found") ||
      (isPersistent && session && elapsedMs > 2000 && (stderrBuf.trim() === "" || stderrBuf.includes("exited with code 1")));

    if (isStaleSession && session) {
      // Stale session — clear it so next message creates a fresh one
      log.warn(`Stale session for ${agentId} (${session.sessionId}) — clearing for next retry`);
      try { unlinkSync(join(memoryDir, senderSessionKey ? `session-${senderSessionKey}.json` : "session.json")); } catch { /* ignore */ }
      yield { type: "error", data: "Session expired — please send your message again." };
      return;
    }

    // Instant failure with empty stderr — likely a spawn/binary resolution issue
    if (elapsedMs < 2000 && stderrBuf.trim() === "") {
      log.error(`Agent ${agentId} process died instantly (${elapsedMs}ms) with no output — possible spawn failure. CLAUDE_BIN=${CLAUDE_BIN}`);
      yield { type: "error", data: "Agent failed to start — the Claude binary may not be installed or accessible. Check server logs for details." };
      return;
    }

    if (isAuthError) {
      yield { type: "error", data: `Account "${accountName}" session has expired. Go to /settings to re-authorize this account.` };
    } else {
      yield { type: "error", data: "Agent execution failed." };
    }
    return;
  }

  // Auto-commit
  if (agentConfig.autoCommit) {
    await autoCommit(workspace, agentId, fullResponse, agentConfig.autoCommitBranch);
  }

  // Log
  try {
    appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(), from: msg.sender, text: msg.text,
      response: fullResponse.slice(0, 2000), agentId, channel: msg.channel,
      ...(session ? { sessionId: session.sessionId, messageNum: session.messageCount } : {}),
      ...(lastCostUsd !== undefined ? { cost: lastCostUsd } : {}),
    }) + "\n");
  } catch { /* ignore */ }

  // Advanced memory: index this exchange
  if (useAdvancedMemory && memoryMgr && fullResponse) {
    try {
      await memoryMgr.indexExchange(msg.text, fullResponse, msg.senderName || msg.sender);
    } catch (err) {
      log.warn(`Failed to index exchange for ${agentId}: ${err}`);
    }
  }

  yield { type: "done", data: fullResponse };
}

// ─── Auto-commit ─────────────────────────────────────────────────────

async function autoCommit(
  workspace: string,
  agentId: string,
  response: string,
  branch: string,
): Promise<void> {
  try {
    const status = await runGit(workspace, ["status", "--porcelain"]);
    if (!status.trim()) return;

    const summary = response.split("\n")[0].slice(0, 72);
    await runGit(workspace, ["add", "-A"]);
    await runGit(workspace, ["commit", "-m", `Agent(${agentId}): ${summary}`]);
    await runGit(workspace, ["push", "origin", branch]);
    log.info(`Auto-committed and pushed for ${agentId}`);
  } catch (err) {
    log.warn(`Auto-commit failed for ${agentId}: ${err}`);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
  };
  return map[ext || ""] || "image/png";
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`git ${args[0]} failed (code ${code})`));
      else resolve(stdout);
    });
    proc.on("error", reject);
  });
}
