import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";
let logFilePath: string | null = null;

export function configureLogger(level: LogLevel, filePath?: string): void {
  currentLevel = level;
  if (filePath) {
    logFilePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }
}

function write(level: LogLevel, msg: string, ...args: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const line = args.length > 0 ? `${prefix} ${msg} ${args.map(a => JSON.stringify(a)).join(" ")}` : `${prefix} ${msg}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + "\n");
    } catch {
      // silently ignore file write errors
    }
  }
}

export const log = {
  debug: (msg: string, ...args: unknown[]) => write("debug", msg, ...args),
  info: (msg: string, ...args: unknown[]) => write("info", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => write("warn", msg, ...args),
  error: (msg: string, ...args: unknown[]) => write("error", msg, ...args),
};
