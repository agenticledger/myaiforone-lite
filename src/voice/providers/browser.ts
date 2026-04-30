/**
 * Browser provider — client-side Web Speech API.
 *
 * The actual TTS/STT happens in the browser. The backend only signals the
 * client to use the Web Speech API. tts()/stt() throw because they should
 * never be called server-side; the route layer checks `serverSide` first
 * and short-circuits to a 200 with `{ provider: "browser", clientSide: true }`.
 */

import type { VoiceProvider, Voice, TtsResult, SttResult } from "../types.js";

const BROWSER_VOICES: Voice[] = [
  { id: "default", name: "System default", description: "Browser's default voice (varies by OS)", language: "en-US" },
];

export const browserProvider: VoiceProvider = {
  id: "browser",
  name: "Browser (Web Speech API)",
  serverSide: false,

  listVoices() {
    return BROWSER_VOICES;
  },

  defaultVoice() {
    return "default";
  },

  isConfigured() {
    return true; // browser is always available — no key required
  },

  async tts(): Promise<TtsResult> {
    throw new Error("Browser provider is client-side; do not invoke tts() on the server");
  },

  async stt(): Promise<SttResult> {
    throw new Error("Browser provider is client-side; do not invoke stt() on the server");
  },
};
