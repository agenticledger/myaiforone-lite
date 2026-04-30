/**
 * Google Gemini executor — uses the Gemini REST API (generativelanguage.googleapis.com).
 *
 * Executor format: "gemini:gemini-2.5-flash", "gemini:gemini-2.5-pro", etc.
 *
 * Gemini's API differs from OpenAI's:
 *   - Auth via API key in query string (not Bearer token)
 *   - Different request/response schema (contents[], not messages[])
 *   - Streaming uses SSE with different event shape
 */

import { log } from "./logger.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// ─── Options ────────────────────────────────────────────────────
export interface GeminiOptions {
  model: string;          // "gemini-2.5-flash", "gemini-2.5-pro", etc.
  apiKey: string;
  systemPrompt: string;
  message: string;
  timeout?: number;       // default: 300000 (5 min)
  temperature?: number;   // default: 0.7
  maxTokens?: number;     // default: 4096
}

// ─── Response types ─────────────────────────────────────────────
interface GeminiResponse {
  candidates?: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: { code: number; message: string; status: string };
}

// ─── Execute (non-streaming) ────────────────────────────────────
export async function executeGemini(opts: GeminiOptions): Promise<string> {
  const timeout = opts.timeout || 300_000;

  log.info(`[Gemini] Executing ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${GEMINI_BASE_URL}/models/${opts.model}:generateContent?key=${opts.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: opts.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: opts.message }],
          },
        ],
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 4096,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`[Gemini] Error ${res.status}: ${errText}`);
      try {
        const errJson = JSON.parse(errText);
        throw new Error(`Gemini API error ${res.status}: ${errJson.error?.message || errText}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Gemini")) throw e;
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
      }
    }

    const data = await res.json() as GeminiResponse;

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const response = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      .join("") || "";

    if (data.usageMetadata) {
      log.debug(`[Gemini] ${opts.model} usage: ${data.usageMetadata.promptTokenCount}+${data.usageMetadata.candidatesTokenCount} tokens`);
    }

    log.info(`[Gemini] Response from ${opts.model}: ${response.slice(0, 200)}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Stream ─────────────────────────────────────────────────────
export async function* streamGemini(opts: GeminiOptions): AsyncGenerator<string> {
  const timeout = opts.timeout || 300_000;

  log.info(`[Gemini] Streaming ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${GEMINI_BASE_URL}/models/${opts.model}:streamGenerateContent?key=${opts.apiKey}&alt=sse`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: opts.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: opts.message }],
          },
        ],
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 4096,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
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
        try {
          const chunk = JSON.parse(jsonStr) as GeminiResponse;
          const text = chunk.candidates?.[0]?.content?.parts
            ?.map(p => p.text)
            .join("");
          if (text) {
            yield text;
          }
        } catch { /* skip unparseable lines */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Health check ───────────────────────────────────────────────
export async function checkGeminiHealth(
  apiKey: string,
  model?: string,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  try {
    const res = await fetch(
      `${GEMINI_BASE_URL}/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (res.status === 400 || res.status === 403) {
      return { ok: false, error: "Gemini: Invalid API key" };
    }

    if (!res.ok) {
      return { ok: false, error: `Gemini: API returned ${res.status}` };
    }

    const data = await res.json() as { models?: Array<{ name: string; displayName: string }> };
    const models = data.models
      ?.map(m => m.name.replace("models/", ""))
      .filter(m => m.startsWith("gemini")) || [];

    if (model && !models.some(m => m === model || m.startsWith(model))) {
      return { ok: false, error: `Model "${model}" not found. Available: ${models.slice(0, 10).join(", ")}` };
    }

    return { ok: true, models: models.slice(0, 20) };
  } catch (err) {
    return { ok: false, error: `Gemini: ${err}` };
  }
}
