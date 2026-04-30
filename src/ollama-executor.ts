import { log } from "./logger.js";

export interface OllamaOptions {
  model: string;         // e.g., "gemma2", "llama3.1"
  systemPrompt: string;
  message: string;
  baseUrl?: string;      // default: "http://localhost:11434"
  timeout?: number;      // default: 300000 (5 min)
}

export async function executeOllama(opts: OllamaOptions): Promise<string> {
  const baseUrl = opts.baseUrl || "http://localhost:11434";
  const timeout = opts.timeout || 300_000;

  log.info(`[Ollama] Executing ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.message },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`[Ollama] Error ${res.status}: ${errText}`);
      throw new Error(`Ollama API error ${res.status}: ${errText}`);
    }

    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    const response = data.message?.content || "";
    log.info(`[Ollama] Response from ${opts.model}: ${response.slice(0, 200)}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamOllama(opts: OllamaOptions): AsyncGenerator<string> {
  const baseUrl = opts.baseUrl || "http://localhost:11434";
  const timeout = opts.timeout || 300_000;

  log.info(`[Ollama] Streaming ${opts.model}: ${opts.message.slice(0, 200)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.message },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch { /* skip unparseable lines */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if Ollama is running and the model is available
 */
export async function checkOllamaHealth(baseUrl?: string, model?: string): Promise<{ ok: boolean; error?: string }> {
  const url = baseUrl || "http://localhost:11434";
  try {
    const res = await fetch(`${url}/api/tags`);
    if (!res.ok) return { ok: false, error: `Ollama not responding (${res.status})` };
    if (model) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = data.models?.map(m => m.name.replace(/:latest$/, "")) || [];
      if (!models.some(m => m === model || m.startsWith(model + ":"))) {
        return { ok: false, error: `Model "${model}" not found. Available: ${models.join(", ")}` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Ollama not running at ${url}: ${err}` };
  }
}
