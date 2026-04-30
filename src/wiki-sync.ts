import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as cron from "node-cron";
import type { AppConfig, McpServerConfig } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./channels/types.js";
import { executeAgent } from "./executor.js";
import { log } from "./logger.js";

// ─── Wiki Sync Result ───────────────────────────────────────────────

export interface WikiSyncResult {
  id: string;
  agentId: string;
  triggeredBy: string;  // "manual" | "cron"
  triggeredAt: string;
  completedAt: string;
  durationMs: number;
  summary: string;
  status: "success" | "error";
}

// ─── Scheduled Tasks ────────────────────────────────────────────────

const scheduledTasks: cron.ScheduledTask[] = [];

// ─── Build the sync prompt ──────────────────────────────────────────

function buildWikiSyncPrompt(memoryDir: string): string {
  const contextPath = join(memoryDir, "context.md");
  const learnedPath = join(memoryDir, "learned.md");

  const hasLearned = existsSync(learnedPath);
  const hasContext = existsSync(contextPath);

  if (!hasLearned) {
    return `[WIKI SYNC]\nNo learned.md file found — nothing to sync. Wiki sync complete.\n[END WIKI SYNC]`;
  }

  return `[WIKI SYNC]
You are performing a scheduled wiki sync. Your job:

1. Read \`${learnedPath}\` — this contains facts the agent learned from conversations
2. Read \`${contextPath}\` — this is the curated knowledge base
3. For each entry in learned.md:
   - If it's a NEW fact not in context.md → add it to the appropriate section in context.md
   - If it CONTRADICTS something in context.md → update context.md with the correction, adding a note like "(Updated [date] — corrected per [source])"
   - If it's ALREADY in context.md → skip it
4. After merging, clear the processed entries from learned.md (leave any that you couldn't verify or that need human review, with a note explaining why)
5. Summarize what you merged, what you skipped, and what needs human review

Be conservative — only merge facts you're confident about. Flag anything uncertain for human review.
[END WIKI SYNC]`;
}

// ─── Execute Wiki Sync ──────────────────────────────────────────────

export async function executeWikiSync(
  agentId: string,
  agent: AppConfig["agents"][string],
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeAccounts?: Record<string, string>,
  globalDefaults?: { skills?: string[]; mcps?: string[]; prompts?: string[]; promptTrigger?: string },
  triggeredBy: string = "manual",
): Promise<WikiSyncResult> {
  const memoryDir = resolve(baseDir, agent.memoryDir.replace(/^~/, process.env.HOME || ""));

  const prompt = buildWikiSyncPrompt(memoryDir);

  const syntheticMsg: InboundMessage = {
    id: `wiki-sync-${agentId}-${Date.now()}`,
    channel: "wiki-sync",
    chatId: `wiki-sync-${agentId}`,
    chatType: "group",
    sender: "wiki-sync-runner",
    senderName: "WikiSync",
    text: prompt,
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: true,
    raw: { type: "wiki-sync", agentId },
  };

  const route: ResolvedRoute = {
    agentId,
    agentConfig: agent,
    route: agent.routes[0],
  };

  const startTime = Date.now();
  const triggeredAt = new Date(startTime).toISOString();
  let status: WikiSyncResult["status"] = "success";
  let summary = "";

  try {
    const response = await executeAgent(route, syntheticMsg, baseDir, mcpRegistry, claudeAccounts, globalDefaults);
    summary = response;
  } catch (err) {
    status = "error";
    summary = String(err);
    log.error(`Wiki sync failed for ${agentId}: ${err}`);
  }

  const endTime = Date.now();
  const result: WikiSyncResult = {
    id: `ws-${agentId}-${startTime}`,
    agentId,
    triggeredBy,
    triggeredAt,
    completedAt: new Date(endTime).toISOString(),
    durationMs: endTime - startTime,
    summary,
    status,
  };

  // Persist result
  saveWikiSyncResult(agent, baseDir, result);

  log.info(`Wiki sync completed: ${agentId} (${result.durationMs}ms, ${status})`);
  return result;
}

// ─── Persistence ────────────────────────────────────────────────────

function saveWikiSyncResult(agent: AppConfig["agents"][string], baseDir: string, result: WikiSyncResult): void {
  const agentHome = agent.agentHome || resolve(baseDir, agent.memoryDir, "..");
  const dir = join(agentHome.replace(/^~/, process.env.HOME || ""), "wiki-sync");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const today = new Date().toISOString().split("T")[0];
  const logFile = join(dir, `log-${today}.jsonl`);
  appendFileSync(logFile, JSON.stringify(result) + "\n");
}

export function getWikiSyncHistory(agentHome: string, limit: number = 20): WikiSyncResult[] {
  const dir = join(agentHome.replace(/^~/, process.env.HOME || ""), "wiki-sync");
  if (!existsSync(dir)) return [];

  const results: WikiSyncResult[] = [];
  try {
    const files = require("fs").readdirSync(dir)
      .filter((f: string) => f.startsWith("log-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();

    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf-8").split("\n").filter(Boolean);
      for (const line of lines.reverse()) {
        try { results.push(JSON.parse(line)); } catch { /* skip */ }
        if (results.length >= limit) return results;
      }
    }
  } catch { /* ignore */ }
  return results;
}

// ─── Startup / Shutdown ─────────────────────────────────────────────

export function startWikiSync(
  config: AppConfig,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
): void {
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (!agent.wiki || !agent.wikiSync?.enabled) continue;

    const schedule = agent.wikiSync.schedule;
    if (!cron.validate(schedule)) {
      log.warn(`Invalid wikiSync cron for ${agentId}: "${schedule}"`);
      continue;
    }

    const task = cron.schedule(schedule, async () => {
      log.info(`Wiki sync triggered: ${agentId}`);
      try {
        await executeWikiSync(
          agentId, agent, baseDir,
          mcpRegistry,
          config.service?.claudeAccounts,
          { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger },
          "cron",
        );
      } catch (err) {
        log.error(`Wiki sync cron error for ${agentId}: ${err}`);
      }
    });

    scheduledTasks.push(task);
    log.info(`Wiki sync scheduled: ${agentId} → "${schedule}"`);
  }
}

export function stopWikiSync(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.length = 0;
}
