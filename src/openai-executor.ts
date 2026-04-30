/**
 * OpenAI-compatible executor — handles OpenAI, xAI (Grok), Groq, Together, Mistral, Venice,
 * and any other provider that implements the OpenAI Chat Completions API.
 *
 * Executor format: "openai:gpt-4o", "grok:grok-3", "groq:llama-3.3-70b-versatile",
 *                  "together:meta-llama/Llama-3.3-70B-Instruct", "mistral:mistral-large-latest",
 *                  "venice:llama-3.3-70b"
 */

import { log } from "./logger.js";

// ─── Provider registry ─────────────────────────────────────────
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  keyField: string; // field name in providerKeys, e.g., "openai"
  modelsEndpoint?: string; // path to list models (default: /models)
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyField: "openai",
  },
  grok: {
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    keyField: "xai",
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyField: "groq",
  },
  together: {
    name: "Together",
    baseUrl: "https://api.together.xyz/v1",
    keyField: "together",
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyField: "mistral",
  },
  venice: {
    name: "Venice",
    baseUrl: "https://api.venice.ai/api/v1",
    keyField: "venice",
  },
};

// ─── Options ────────────────────────────────────────────────────
export interface OpenAICompatOptions {
  provider: string;       // "openai", "grok", "groq", "together", "mistral"
  model: string;          // "gpt-4o", "grok-3", "llama-3.3-70b-versatile", etc.
  apiKey: string;
  systemPrompt: string;
  message: string;
  baseUrl?: string;       // override provider default
  timeout?: number;       // default: 300000 (5 min)
  temperature?: number;   // default: 0.7
  maxTokens?: number;     // default: 4096
}

// ─── Response types ─────────────────────────────────────────────
interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; type: string; code?: string };
}

interface ChatCompletionChunk {
  choices: Array<{
    delta: { content?: string; role?: string };
    finish_reason: string | null;
  }>;
}

// ─── Execute (non-streaming) ────────────────────────────────────
export async function executeOpenAICompat(opts: OpenAICompatOptions): Promise<string> {
  const providerConfig = PROVIDERS[opts.provider];
  const baseUrl = opts.baseUrl || providerConfig?.baseUrl;
  if (!baseUrl) throw new Error(`Unknown provider: ${opts.provider}`);

  const timeout = opts.timeout || 300_000;
  const providerName = providerConfig?.name || opts.provider;

  log.info(`[${providerName}] Executing ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.message },
        ],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`[${providerName}] Error ${res.status}: ${errText}`);

      // Parse structured error if possible
      try {
        const errJson = JSON.parse(errText);
        const errMsg = errJson.error?.message || errJson.message || errText;
        throw new Error(`${providerName} API error ${res.status}: ${errMsg}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith(providerName)) throw e;
        throw new Error(`${providerName} API error ${res.status}: ${errText}`);
      }
    }

    const data = await res.json() as ChatCompletionResponse;

    if (data.error) {
      throw new Error(`${providerName} error: ${data.error.message}`);
    }

    const response = data.choices?.[0]?.message?.content || "";

    if (data.usage) {
      log.debug(`[${providerName}] ${opts.model} usage: ${data.usage.prompt_tokens}+${data.usage.completion_tokens} tokens`);
    }

    log.info(`[${providerName}] Response from ${opts.model}: ${response.slice(0, 200)}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Stream ─────────────────────────────────────────────────────
export async function* streamOpenAICompat(opts: OpenAICompatOptions): AsyncGenerator<string> {
  const providerConfig = PROVIDERS[opts.provider];
  const baseUrl = opts.baseUrl || providerConfig?.baseUrl;
  if (!baseUrl) throw new Error(`Unknown provider: ${opts.provider}`);

  const timeout = opts.timeout || 300_000;
  const providerName = providerConfig?.name || opts.provider;

  log.info(`[${providerName}] Streaming ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.message },
        ],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${providerName} API error ${res.status}: ${errText}`);
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
      buffer = lines.pop() || ""; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6);
        try {
          const chunk = JSON.parse(jsonStr) as ChatCompletionChunk;
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch { /* skip unparseable lines */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Health check ───────────────────────────────────────────────
export async function checkOpenAICompatHealth(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  const providerConfig = PROVIDERS[provider];
  const url = baseUrl || providerConfig?.baseUrl;
  if (!url) return { ok: false, error: `Unknown provider: ${provider}` };

  const providerName = providerConfig?.name || provider;

  try {
    const res = await fetch(`${url}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `${providerName}: Invalid API key` };
    }

    if (!res.ok) {
      return { ok: false, error: `${providerName}: API returned ${res.status}` };
    }

    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = data.data?.map(m => m.id) || [];
    return { ok: true, models: models.slice(0, 20) };
  } catch (err) {
    return { ok: false, error: `${providerName}: ${err}` };
  }
}

/**
 * Resolve provider prefix to config.
 * Returns null if the prefix is not an OpenAI-compatible provider.
 */
export function resolveProvider(prefix: string): ProviderConfig | null {
  return PROVIDERS[prefix] || null;
}
