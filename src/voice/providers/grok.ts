/**
 * Grok (xAI) voice provider.
 *
 * Endpoints:
 *   - TTS: POST https://api.x.ai/v1/tts            (JSON body, returns audio/mpeg)
 *   - STT: POST https://api.x.ai/v1/stt            (multipart form, returns JSON)
 *
 * Auth: `Authorization: Bearer <XAI_API_KEY>`. Key is read from
 * `service.providerKeys.xai` in config.json.
 *
 * Pricing (April 2026): TTS $4.20 / 1M chars, STT $0.10/hr batch.
 */

import type { VoiceProvider, Voice, TtsOptions, TtsResult, SttOptions, SttResult } from "../types.js";

const TTS_URL = "https://api.x.ai/v1/tts";
const STT_URL = "https://api.x.ai/v1/stt";
const STT_MODEL = "grok-stt";

const GROK_VOICES: Voice[] = [
  { id: "ara",  name: "Ara",  description: "Warm, friendly",         language: "en", gender: "female"  },
  { id: "eve",  name: "Eve",  description: "Energetic, upbeat",      language: "en", gender: "female"  },
  { id: "leo",  name: "Leo",  description: "Authoritative, strong",  language: "en", gender: "male"    },
  { id: "rex",  name: "Rex",  description: "Confident, clear",       language: "en", gender: "male"    },
  { id: "sal",  name: "Sal",  description: "Smooth, balanced",       language: "en", gender: "neutral" },
];

const DEFAULT_VOICE = "ara";

export interface GrokProviderOptions {
  /** Function returning the current xAI API key (read fresh each call so config changes take effect). */
  getApiKey: () => string | undefined;
}

export function createGrokProvider(opts: GrokProviderOptions): VoiceProvider {
  return {
    id: "grok",
    name: "Grok (xAI)",
    serverSide: true,

    listVoices() {
      return GROK_VOICES;
    },

    defaultVoice() {
      return DEFAULT_VOICE;
    },

    isConfigured() {
      return Boolean(opts.getApiKey());
    },

    async tts(text: string, options?: TtsOptions): Promise<TtsResult> {
      const key = opts.getApiKey();
      if (!key) throw new Error("Grok TTS unavailable: xAI API key not configured");
      if (!text || !text.trim()) throw new Error("Grok TTS: text is required");

      // xAI hard-limits at 15k chars; trim defensively (caller may also truncate).
      const MAX = 15000;
      const input = text.length > MAX ? text.slice(0, MAX) : text;

      // Voice id may be capitalized in user input (e.g. "Ara") — normalize to lowercase.
      const voiceId = (options?.voiceId || DEFAULT_VOICE).toLowerCase();

      const body = {
        text: input,
        voice_id: voiceId,
        language: "auto",
      };

      const resp = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await safeReadError(resp);
        throw new Error(`Grok TTS failed: ${resp.status} ${resp.statusText}${errText ? ` — ${errText}` : ""}`);
      }

      const arrayBuffer = await resp.arrayBuffer();
      return {
        audio: Buffer.from(arrayBuffer),
        format: "mp3",
        characters: input.length,
      };
    },

    async stt(audio: Buffer, options?: SttOptions): Promise<SttResult> {
      const key = opts.getApiKey();
      if (!key) throw new Error("Grok STT unavailable: xAI API key not configured");
      if (!audio || audio.length === 0) throw new Error("Grok STT: audio is required");

      const form = new FormData();
      const mime = options?.mimeType || "audio/webm";
      const ext = mimeToExt(mime);
      const blob = new Blob([new Uint8Array(audio)], { type: mime });
      form.append("model", STT_MODEL);
      form.append("file", blob, `audio.${ext}`);
      form.append("format", "json");
      if (options?.language) form.append("language", options.language);

      const resp = await fetch(STT_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}` },
        body: form,
      });

      if (!resp.ok) {
        const errText = await safeReadError(resp);
        throw new Error(`Grok STT failed: ${resp.status} ${resp.statusText}${errText ? ` — ${errText}` : ""}`);
      }

      const json = await resp.json() as { text?: string; language?: string; duration?: number };
      return {
        text: (json.text || "").trim(),
        language: json.language,
        durationSeconds: json.duration,
      };
    },
  };
}

async function safeReadError(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function mimeToExt(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("m4a") || mime.includes("mp4")) return "m4a";
  return "bin";
}
