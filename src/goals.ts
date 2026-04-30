import cron from "node-cron";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig, GoalConfig, McpServerConfig } from "./config.js";
import type { InboundMessage } from "./channels/types.js";
import type { ResolvedRoute } from "./channels/types.js";
import type { ChannelDriver } from "./channels/types.js";
import { executeAgent } from "./executor.js";
import { log } from "./logger.js";

// ─── Budget tracking ─────────────────────────────────────────────────

export interface BudgetState {
  spent: number;
  limit: number;
  executions: number;
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

export function budgetPath(agentHome: string, date?: string): string {
  const goalsDir = join(agentHome, "goals");
  return join(goalsDir, `budget-${date || todayKey()}.json`);
}

export function readBudget(agentHome: string, dailyLimit: number): BudgetState {
  const path = budgetPath(agentHome);
  if (!existsSync(path)) {
    return { spent: 0, limit: dailyLimit, executions: 0 };
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as BudgetState;
    // Always use the configured limit (in case it changed)
    data.limit = dailyLimit;
    return data;
  } catch {
    return { spent: 0, limit: dailyLimit, executions: 0 };
  }
}

export function writeBudget(agentHome: string, budget: BudgetState): void {
  const goalsDir = join(agentHome, "goals");
  mkdirSync(goalsDir, { recursive: true });
  const path = budgetPath(agentHome);
  writeFileSync(path, JSON.stringify(budget, null, 2));
}

export function isBudgetExhausted(budget: BudgetState): boolean {
  return budget.spent >= budget.limit;
}

// ─── Goal log ────────────────────────────────────────────────────────

function goalLogPath(agentHome: string): string {
  const goalsDir = join(agentHome, "goals");
  return join(goalsDir, `log-${todayKey()}.jsonl`);
}

function logGoalExecution(
  agentHome: string,
  goalId: string,
  status: "executed" | "skipped-budget" | "error",
  details?: Record<string, unknown>,
): void {
  const goalsDir = join(agentHome, "goals");
  mkdirSync(goalsDir, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    goalId,
    status,
    ...details,
  };
  try {
    appendFileSync(goalLogPath(agentHome), JSON.stringify(entry) + "\n");
  } catch { /* ignore */ }
}

// ─── Goal prompt builder ─────────────────────────────────────────────

export function buildGoalPrompt(goal: GoalConfig, budgetRemaining: number, budgetLimit: number): string {
  const lines: string[] = [
    `[AUTONOMOUS GOAL: ${goal.id}]`,
    `Description: ${goal.description}`,
  ];
  if (goal.successCriteria) lines.push(`Success Criteria: ${goal.successCriteria}`);
  if (goal.instructions) lines.push(`Instructions: ${goal.instructions}`);
  lines.push(`Budget remaining today: $${budgetRemaining.toFixed(2)} of $${budgetLimit.toFixed(2)}`);
  lines.push(`[/AUTONOMOUS GOAL]`);
  lines.push("");
  lines.push("Evaluate this goal. Take action if needed. Report what you did or found.");
  return lines.join("\n");
}

// ─── Execute a single goal (used by cron and trigger endpoint) ───────

export async function executeGoal(
  agentId: string,
  agent: AppConfig["agents"][string],
  goal: GoalConfig,
  baseDir: string,
  driverMap: Map<string, ChannelDriver>,
  mcpRegistry?: Record<string, McpServerConfig>,
  claudeAccounts?: Record<string, string>,
  globalDefaults?: { skills?: string[]; mcps?: string[]; prompts?: string[]; promptTrigger?: string },
): Promise<{ status: string; response: string }> {
  const agentHome = agent.agentHome || resolve(baseDir, agent.memoryDir, "..");

  // Check budget
  const dailyLimit = goal.budget?.maxDailyUsd ?? Infinity;
  const budget = readBudget(agentHome, dailyLimit);

  if (dailyLimit !== Infinity && isBudgetExhausted(budget)) {
    logGoalExecution(agentHome, goal.id, "skipped-budget", {
      spent: budget.spent,
      limit: budget.limit,
    });
    return { status: "skipped-budget", response: `Budget exhausted ($${budget.spent.toFixed(2)}/$${budget.limit.toFixed(2)})` };
  }

  // Build the goal prompt
  const budgetRemaining = dailyLimit === Infinity
    ? Infinity
    : Math.max(0, dailyLimit - budget.spent);
  const prompt = buildGoalPrompt(goal, budgetRemaining, dailyLimit);

  // Build synthetic message
  const syntheticMsg: InboundMessage = {
    id: `goal-${goal.id}-${Date.now()}`,
    channel: "goals",
    chatId: `goal-${goal.id}`,
    chatType: "group",
    sender: "goals-runner",
    senderName: "Autonomous Goal",
    text: prompt,
    timestamp: Date.now(),
    isFromMe: false,
    isGroup: true,
    raw: { type: "goal", goalId: goal.id },
  };

  const route: ResolvedRoute = {
    agentId,
    agentConfig: agent,
    route: agent.routes[0],
  };

  // Execute the agent
  const response = await executeAgent(route, syntheticMsg, baseDir, mcpRegistry, claudeAccounts, globalDefaults);

  // Track cost
  let cost = 0;
  try {
    const parsed = JSON.parse(response);
    if (parsed.total_cost_usd) cost = parsed.total_cost_usd;
  } catch { /* not JSON */ }

  // Update budget
  if (dailyLimit !== Infinity) {
    budget.spent += cost;
    budget.executions += 1;
    writeBudget(agentHome, budget);
  }

  // Log execution
  logGoalExecution(agentHome, goal.id, "executed", {
    cost,
    responseLength: response.length,
    response,
  });

  // Send report to channel(s) if configured
  if (goal.reportTo) {
    const targets = Array.isArray(goal.reportTo) ? goal.reportTo : [goal.reportTo];
    for (const target of targets) {
      const [channelName, ...chatIdParts] = target.split(":");
      const chatId = chatIdParts.join(":");
      const driver = driverMap.get(channelName);
      if (driver && chatId) {
        try {
          const report = `[Goal: ${goal.id}]\n${response}`;
          await driver.send({ text: report, chatId });
        } catch (err) {
          log.error(`Failed to send goal report for ${agentId}/${goal.id} to ${target}: ${err}`);
        }
      }
    }
  }

  log.info(`Goal completed: ${agentId}/${goal.id} (${response.length} chars)`);
  return { status: "executed", response };
}

// ─── Goals runner ────────────────────────────────────────────────────

const activeTasks: cron.ScheduledTask[] = [];

export function startGoals(
  config: AppConfig,
  driverMap: Map<string, ChannelDriver>,
  baseDir: string,
  mcpRegistry?: Record<string, McpServerConfig>,
): void {
  for (const [agentId, agent] of Object.entries(config.agents)) {
    // Only agents that are autonomous-capable with enabled goals
    if (agent.autonomousCapable === false) continue;
    if (!agent.goals?.length) continue;

    const agentHome = agent.agentHome || resolve(baseDir, agent.memoryDir, "..");

    for (const goal of agent.goals) {
      if (!goal.enabled) continue;

      if (!cron.validate(goal.heartbeat)) {
        log.error(`Invalid goal heartbeat for ${agentId}/${goal.id}: "${goal.heartbeat}"`);
        continue;
      }

      const task = cron.schedule(goal.heartbeat, async () => {
        log.info(`Goal heartbeat fired: ${agentId}/${goal.id}`);
        try {
          await executeGoal(agentId, agent, goal, baseDir, driverMap, mcpRegistry, config.service.claudeAccounts, { skills: config.defaultSkills, mcps: config.defaultMcps, prompts: config.defaultPrompts, promptTrigger: config.promptTrigger });
        } catch (err) {
          log.error(`Goal execution failed for ${agentId}/${goal.id}: ${err}`);
          logGoalExecution(agentHome, goal.id, "error", { error: String(err) });
        }
      });

      activeTasks.push(task);
      log.info(`Goal scheduled: ${agentId}/${goal.id} — "${goal.heartbeat}" — ${(goal.description || "").slice(0, 60)}`);
    }
  }
}

export function stopGoals(): void {
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
}
