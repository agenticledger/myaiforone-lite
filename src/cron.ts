import cron from "node-cron";
import type { AppConfig, CronJobConfig } from "./config.js";
import { log } from "./logger.js";

interface CronHandler {
  (agentId: string, message: string, channel: string, chatId: string): Promise<void>;
}

const activeTasks: cron.ScheduledTask[] = [];

export function startCronJobs(config: AppConfig, handler: CronHandler): void {
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (!agent.cron?.length) continue;

    for (const job of agent.cron) {
      if (job.enabled === false) continue;

      if (!cron.validate(job.schedule)) {
        log.error(`Invalid cron schedule for ${agentId}: "${job.schedule}"`);
        continue;
      }

      const task = cron.schedule(job.schedule, async () => {
        log.info(`Cron fired for ${agentId}: "${job.message.slice(0, 60)}"`);
        try {
          await handler(agentId, job.message, job.channel, job.chatId);
        } catch (err) {
          log.error(`Cron job failed for ${agentId}: ${err}`);
        }
      });

      activeTasks.push(task);
      log.info(`Cron scheduled for ${agentId}: "${job.schedule}" → "${job.message.slice(0, 60)}"`);
    }
  }
}

export function stopCronJobs(): void {
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
}
