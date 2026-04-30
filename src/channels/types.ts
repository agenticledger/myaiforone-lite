export interface InboundMessage {
  id: string;
  channel: string;
  chatId: string;
  chatType: "dm" | "group";
  sender: string;
  senderName?: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
  isGroup: boolean;
  groupName?: string;
  participants?: string[];
  replyTo?: {
    id: string;
    text: string;
    sender?: string;
  };
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
  raw: unknown;
}

export interface OutboundMessage {
  text: string;
  chatId: string;
  replyToId?: string;
  attachments?: Array<{
    path: string;
    mimeType?: string;
  }>;
}

export interface ChannelDriver {
  readonly channelId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  send(msg: OutboundMessage): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
  sendFile?(chatId: string, filePath: string, caption?: string): Promise<void>;
}

// ─── ResolvedRoute (moved from router.ts for Lite) ──────────────────
import type { AgentConfig, RouteConfig } from "../config.js";

export interface ResolvedRoute {
  agentId: string;
  agentConfig: AgentConfig;
  route: RouteConfig;
}

// ─── Shared utilities ────────────────────────────────────────────────

export function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
