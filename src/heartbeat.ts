import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig, McpServerConfig } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./channels/types.js";
import { executeAgent } from "./executor.js";
import { log } from "./logger.js";

export interface HeartbeatResult {
  id: string;
  agentId: string;
  triggeredBy: string;  // "manual" | "cron" | "goal"
  triggeredAt: string;
  completedAt: string;
  durationMs: number;
  summary: string;
  status: "success" | "error" | "timeout";
}

// ─── Helpers ─────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

// ─── Task loading (inlined from executor.ts) ─────────────────────────

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
  }>;
}

function loadTasksFromAgent(agentHome: string, agentId: string): TaskData {
  const p = join(agentHome, "tasks.json");
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { /* ignore */ }
  }
  return { agentId, projects: [{ id: "general", name: "General", color: "#6b7280" }], tasks: [] };
}

// ─── Heartbeat prompt builder ────────────────────────────────────────

export function buildHeartbeatPrompt(agentHome: string, agentId: string): string {
  const data = loadTasksFromAgent(agentHome, agentId);
  const activeStatuses = ["proposed", "approved", "in_progress", "review"];
  const active = data.tasks.filter(t => activeStatuses.includes(t.status));

  // Sort by priority: high > medium > low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  active.sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

  // Check for custom heartbeat.md — use it if present, else default
  const heartbeatMdPath = join(agentHome, "heartbeat.md");
  let customInstructions = "";
  if (existsSync(heartbeatMdPath)) {
    try {
      const raw = readFileSync(heartbeatMdPath, "utf-8");
      // Strip YAML frontmatter if present
      customInstructions = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
    } catch { /* ignore */ }
  }

  const lines: string[] = [
    "[HEARTBEAT]",
  ];

  if (customInstructions) {
    lines.push(customInstructions);
  } else {
    lines.push("You are being activated for a heartbeat check. Review your assigned tasks and work on the highest priority one.");
  }

  lines.push("");
  lines.push("Active Tasks:");

  if (active.length > 0) {
    for (const t of active) {
      lines.push(`- ${t.id}: ${t.title} (${t.status}, ${t.priority} priority)`);
    }
  } else {
    lines.push("(none)");
  }

  if (!customInstructions) {
    lines.push("");
    lines.push("Instructions:");
    lines.push("1. Pick the highest priority task");
    lines.push("2. Work on it");
    lines.push('3. Use /task done <taskId> "what you did" when complete');
    lines.push("4. Report a brief summary");
    lines.push("");
    lines.push("If no tasks are assigned, report that you have no pending work.");
  }

  lines.push("[/HEARTBEAT]");

  return lines.join("\n");
}

// ─── Save / Load heartbeat history ───────────────────────────────────

export function saveHeartbeatResult(agentHome: string, result: HeartbeatResult): void {
  const dir = join(agentHome, "heartbeats");
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, `log-${todayKey()}.jsonl`);
  try {
    appendFileSync(logFile, JSON.stringify(result) + "\n");
  } catch { /* ignore */ }
}

export function loadHeartbeatHistory(agentHome: string, limit: number = 20): HeartbeatResult[] {
  const dir = join(agentHome, "heartbeats");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => f.startsWith("log-") && f.endsWith(".jsonl"))
    .sort()
    .reverse();

  const results: HeartbeatResult[] = [];

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          results.push(JSON.parse(line) as HeartbeatResult);
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable files */ }
  }

  // Sort by triggeredAt descending
  results.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));

  return results.slice(0, limit);
}

// ─── Execute a heartbeat ─────────────────────────────────────────────

export async function executeHeartbeat(
  agentId: string,
  agent: AppConfig["agents"][string],
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeAccounts?: Record<string, string>,
  globalDefaults?: { skills?: string[]; mcps?: string[]; prompts?: string[]; promptTrigger?: string },
  triggeredBy: string = "manual",
): Promise<HeartbeatResult> {
  const agentHome = agent.agentHome || resolve(baseDir, agent.memoryDir, "..");

  // Build heartbeat prompt
  const prompt = buildHeartbeatPrompt(agentHome, agentId);

  // Build synthetic message
  const syntheticMsg: InboundMessage = {
    id: `heartbeat-${agentId}-${Date.now()}`,
    channel: "heartbeat",
    chatId: `heartbeat-${agentId}`,
    chatType: "group",
    sender: "heartbeat-runner",
    senderName: "Heartbeat",
    text: prompt,
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: true,
    raw: { type: "heartbeat", agentId },
  };

  const route: ResolvedRoute = {
    agentId,
    agentConfig: agent,
    route: agent.routes[0],
  };

  const startTime = Date.now();
  const triggeredAt = new Date(startTime).toISOString();
  let status: HeartbeatResult["status"] = "success";
  let summary = "";

  try {
    const response = await executeAgent(route, syntheticMsg, baseDir, mcpRegistry, claudeAccounts, globalDefaults);
    summary = response;
  } catch (err) {
    status = "error";
    summary = String(err);
    log.error(`Heartbeat execution failed for ${agentId}: ${err}`);
  }

  const endTime = Date.now();
  const completedAt = new Date(endTime).toISOString();
  const durationMs = endTime - startTime;

  const result: HeartbeatResult = {
    id: `hb-${agentId}-${startTime}`,
    agentId,
    triggeredBy,
    triggeredAt,
    completedAt,
    durationMs,
    summary,
    status,
  };

  // Persist
  saveHeartbeatResult(agentHome, result);

  log.info(`Heartbeat completed: ${agentId} (${durationMs}ms, ${status})`);
  return result;
}
