import { readFileSync } from "node:fs";
import type { InboundMessage } from "../channels/types.js";

interface ConversationEntry {
  ts: string;
  from: string;
  text: string;
  response: string;
}

export function formatMessage(
  msg: InboundMessage,
  memoryContextPath?: string,
  conversationLogPath?: string,
  historyLimit = 5,
): string {
  const parts: string[] = [];

  // 1. Memory context
  if (memoryContextPath) {
    try {
      const context = readFileSync(memoryContextPath, "utf-8").trim();
      if (context) {
        parts.push(`[Agent Memory]\n${context}\n[/Agent Memory]`);
      }
    } catch {
      // no memory file yet, that's fine
    }
  }

  // 2. Conversation history
  if (conversationLogPath) {
    try {
      const raw = readFileSync(conversationLogPath, "utf-8").trim();
      if (raw) {
        const lines = raw.split("\n").filter(Boolean);
        const recent = lines.slice(-historyLimit);
        const entries: string[] = [];

        for (const line of recent) {
          try {
            const entry = JSON.parse(line) as ConversationEntry;
            entries.push(`  ${entry.from}: ${entry.text}`);
            entries.push(`  Agent: ${entry.response}`);
          } catch {
            // skip malformed lines
          }
        }

        if (entries.length > 0) {
          parts.push(
            `[Conversation History - last ${recent.length} exchanges]\n${entries.join("\n")}\n[/Conversation History]`
          );
        }
      }
    } catch {
      // no log file yet
    }
  }

  // 3. The message itself
  const ts = new Date(msg.timestamp).toISOString();
  const sender = msg.senderName || msg.sender;

  let header: string;
  if (msg.isGroup && msg.groupName) {
    header = `[${msg.channel} group '${msg.groupName}' from ${sender} at ${ts}]`;
  } else if (msg.isGroup) {
    header = `[${msg.channel} group from ${sender} at ${ts}]`;
  } else {
    header = `[${msg.channel} DM from ${sender} at ${ts}]`;
  }

  let body = msg.text;

  // Reply context
  if (msg.replyTo) {
    const replySender = msg.replyTo.sender || "unknown";
    body += `\n\n[Replying to ${replySender}]\n${msg.replyTo.text}\n[/Replying]`;
  }

  // Attachment note
  if (msg.attachments?.length) {
    body += `\n\n[${msg.attachments.length} image(s) attached — visible in this message. Save them to the appropriate episode folder and reference in the episode JSON.]`;
  }

  parts.push(`${header}\n${body}\n[/${msg.channel}]`);

  return parts.join("\n\n");
}
