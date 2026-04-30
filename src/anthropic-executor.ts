/**
 * Anthropic executor — uses the Anthropic Messages API directly.
 *
 * Used on server deployments (Railway) where the `claude` CLI is not available,
 * or when explicitly selected via executor format: "anthropic:claude-sonnet-4-6",
 * "anthropic:claude-haiku-4-5-20251001", etc.
 *
 * Default model: claude-sonnet-4-6
 */

import { log } from "./logger.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const API_VERSION = "2023-06-01"; // Stable API version — works with all models

// ─── Options ────────────────────────────────────────────────────
export interface AnthropicOptions {
  model?: string;         // "claude-sonnet-4-5-20250514", "claude-haiku-3-5-20241022", etc.
  apiKey: string;
  systemPrompt: string;
  message: string;
  timeout?: number;       // default: 300000 (5 min)
  temperature?: number;   // default: 0.7
  maxTokens?: number;     // default: 8192
}

// ─── Response types ─────────────────────────────────────────────
interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string } | { type: string; [key: string]: any }>;
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicError {
  type: "error";
  error: { type: string; message: string };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  content_block?: { type: string; text?: string };
  message?: AnthropicResponse;
  usage?: { output_tokens: number };
}

// ─── Execute (non-streaming) ────────────────────────────────────
export async function executeAnthropic(opts: AnthropicOptions): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;
  const timeout = opts.timeout || 300_000;

  log.info(`[Anthropic] Executing ${model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.systemPrompt,
        messages: [
          { role: "user", content: opts.message },
        ],
        temperature: opts.temperature ?? 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`[Anthropic] Error ${res.status}: ${errText}`);
      try {
        const errJson = JSON.parse(errText) as AnthropicError;
        throw new Error(`Anthropic API error ${res.status}: ${errJson.error?.message || errText}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Anthropic")) throw e;
        throw new Error(`Anthropic API error ${res.status}: ${errText}`);
      }
    }

    const data = await res.json() as AnthropicResponse;

    // Extract text blocks from the response
    const response = data.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    if (data.usage) {
      log.debug(`[Anthropic] ${model} usage: ${data.usage.input_tokens}+${data.usage.output_tokens} tokens`);
    }

    log.info(`[Anthropic] Response from ${model}: ${response.slice(0, 200)}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Stream ─────────────────────────────────────────────────────
export async function* streamAnthropic(opts: AnthropicOptions): AsyncGenerator<string> {
  const model = opts.model || DEFAULT_MODEL;
  const timeout = opts.timeout || 300_000;

  log.info(`[Anthropic] Streaming ${model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.systemPrompt,
        messages: [
          { role: "user", content: opts.message },
        ],
        temperature: opts.temperature ?? 0.7,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const event = JSON.parse(jsonStr) as AnthropicStreamEvent;
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield event.delta.text;
          }
        } catch { /* skip unparseable lines */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Health check ───────────────────────────────────────────────
export async function checkAnthropicHealth(
  apiKey: string,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  // Anthropic doesn't have a /models endpoint, so we send a minimal request
  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Anthropic: Invalid API key" };
    }

    if (!res.ok) {
      const errText = await res.text();
      try {
        const errJson = JSON.parse(errText) as AnthropicError;
        return { ok: false, error: `Anthropic: ${errJson.error?.message || errText}` };
      } catch {
        return { ok: false, error: `Anthropic: API returned ${res.status}` };
      }
    }

    // Success — key is valid
    return {
      ok: true,
      models: [
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-5-20250929",
      ],
    };
  } catch (err) {
    return { ok: false, error: `Anthropic: ${err}` };
  }
}
