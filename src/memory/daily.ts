/**
 * Daily memory — append-only daily log files.
 * After each exchange, a summary is appended to memory/daily/YYYY-MM-DD.md.
 * At session start, today + yesterday are loaded for continuity.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

function dateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function timeStr(date: Date): string {
  return date.toTimeString().split(" ")[0].slice(0, 5);
}

export function getDailyDir(memoryDir: string): string {
  const dir = join(memoryDir, "daily");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Append an exchange summary to today's daily log.
 */
export function appendDailyEntry(
  memoryDir: string,
  sender: string,
  userMessage: string,
  agentResponse: string,
): void {
  const dir = getDailyDir(memoryDir);
  const today = dateStr(new Date());
  const time = timeStr(new Date());
  const filePath = join(dir, `${today}.md`);

  // Truncate long messages for the daily log
  const userSnippet = userMessage.slice(0, 200).replace(/\n/g, " ");
  const agentSnippet = agentResponse.slice(0, 300).replace(/\n/g, " ");

  const entry = `\n### ${time}\n- **User:** ${userSnippet}\n- **Agent:** ${agentSnippet}\n`;

  // Add header if new file
  if (!existsSync(filePath)) {
    appendFileSync(filePath, `# Daily Log — ${today}\n`);
  }

  appendFileSync(filePath, entry);
}

/**
 * Load today's and yesterday's daily logs for context injection.
 */
export function loadRecentDaily(memoryDir: string): string {
  const dir = getDailyDir(memoryDir);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const files = [
    { date: dateStr(yesterday), label: "Yesterday" },
    { date: dateStr(today), label: "Today" },
  ];

  const parts: string[] = [];

  for (const { date, label } of files) {
    const filePath = join(dir, `${date}.md`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content) {
          parts.push(`[${label}'s Activity — ${date}]\n${content}\n[/${label}]`);
        }
      } catch { /* ignore */ }
    }
  }

  return parts.join("\n\n");
}

/**
 * Get all daily file paths for indexing.
 */
export function listDailyFiles(memoryDir: string): Array<{ path: string; date: string }> {
  const dir = getDailyDir(memoryDir);

  try {
    return readdirSync(dir)
      .filter((f: string) => f.endsWith(".md"))
      .map((f: string) => ({
        path: join(dir, f),
        date: f.replace(".md", ""),
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
