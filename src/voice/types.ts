/**
 * Voice Mode — Provider abstraction for TTS (text-to-speech) and STT (speech-to-text).
 *
 * Mirrors the multi-model executor pattern:
 *   - Platform has a default provider (`service.platformDefaultVoice`)
 *   - Any agent can override via `agent.voice`
 *   - Providers are pluggable: Browser (free), Grok (xAI), ElevenLabs (Phase 2)
 *
 * A "voice spec" is a string of one of these forms:
 *   - "browser"               — provider only, use provider's default voice
 *   - "grok"                  — provider only, use provider's default voice
 *   - "grok:Ara"              — provider + specific voice id
 *   - "elevenlabs:rachel"     — same form for any provider
 */

export interface Voice {
  id: string;          // e.g., "Ara", "Eve"
  name: string;        // human label
  description?: string;
  language?: string;   // BCP-47 (e.g., "en-US")
  gender?: "male" | "female" | "neutral";
}

export interface TtsOptions {
  voiceId?: string;        // specific voice within the provider
  speed?: number;          // 0.5 – 2.0 (default 1.0)
  format?: "mp3" | "wav";  // default: mp3
}

export interface SttOptions {
  language?: string;       // BCP-47 hint (default: en-US)
  mimeType?: string;       // e.g., "audio/webm", "audio/wav"
}

export interface TtsResult {
  audio: Buffer;           // raw audio bytes
  format: "mp3" | "wav";
  characters: number;      // billed characters (used for cost tracking)
}

export interface SttResult {
  text: string;
  language?: string;
  durationSeconds?: number;
}

/**
 * Voice provider interface. All non-browser providers implement this.
 *
 * The "browser" provider is a special marker: TTS/STT happen client-side via
 * the Web Speech API, so its backend implementation only signals the client
 * to handle the operation locally (it does NOT actually synthesize audio).
 */
export interface VoiceProvider {
  readonly id: string;            // "browser" | "grok" | "elevenlabs"
  readonly name: string;          // display name
  readonly serverSide: boolean;   // true = backend synthesizes; false = client handles via Web Speech API

  listVoices(): Voice[];
  defaultVoice(): string;         // voice id

  /** Synthesize audio from text. Throws if provider is client-side or misconfigured. */
  tts(text: string, options?: TtsOptions): Promise<TtsResult>;

  /** Transcribe audio to text. Throws if provider is client-side or misconfigured. */
  stt(audio: Buffer, options?: SttOptions): Promise<SttResult>;

  /** Returns true if the provider is configured (e.g., has API key). */
  isConfigured(): boolean;
}

/** Parsed voice spec — separates provider from voice id. */
export interface ParsedVoiceSpec {
  providerId: string;
  voiceId?: string;
}

export function parseVoiceSpec(spec: string | undefined | null): ParsedVoiceSpec | null {
  if (!spec) return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx === -1) return { providerId: trimmed };
  return {
    providerId: trimmed.slice(0, idx),
    voiceId: trimmed.slice(idx + 1) || undefined,
  };
}

export function formatVoiceSpec(providerId: string, voiceId?: string): string {
  return voiceId ? `${providerId}:${voiceId}` : providerId;
}
