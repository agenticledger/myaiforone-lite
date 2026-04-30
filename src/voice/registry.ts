/**
 * Voice provider registry.
 *
 * Single place that:
 *   - Holds the available providers (Browser + Grok in Phase 1)
 *   - Resolves an agent's effective voice (override → platform default → fallback)
 *   - Exposes a snapshot of the current voice config for the UI
 */

import type { AppConfig } from "../config.js";
import { browserProvider } from "./providers/browser.js";
import { createGrokProvider } from "./providers/grok.js";
import type { VoiceProvider, ParsedVoiceSpec } from "./types.js";
import { parseVoiceSpec } from "./types.js";

const FALLBACK_PROVIDER_ID = "browser";

export interface VoiceRegistry {
  list(): VoiceProvider[];
  get(id: string): VoiceProvider | undefined;
  /**
   * Resolve the effective voice for an agent (or platform default if agentId
   * not provided). Falls back to the browser provider when nothing is set or
   * the configured provider is missing/unconfigured.
   */
  resolve(agentId?: string): { provider: VoiceProvider; voiceId?: string };
  /** Voice config snapshot for the admin UI / API. Never includes the API key. */
  snapshot(): VoiceConfigSnapshot;
}

export interface VoiceConfigSnapshot {
  enabled: boolean;
  defaultProvider: string;
  defaultVoiceId?: string;
  autoPlay: boolean;
  maxChars: number;
  providers: Array<{
    id: string;
    name: string;
    serverSide: boolean;
    configured: boolean;
    voices: Array<{ id: string; name: string; description?: string; language?: string; gender?: string }>;
  }>;
}

/**
 * Build a registry bound to a live AppConfig reference. The Grok provider
 * reads its API key lazily (each call) so config edits take effect without
 * restarting the registry.
 */
export function buildVoiceRegistry(config: AppConfig): VoiceRegistry {
  const grok = createGrokProvider({
    getApiKey: () => (config.service as any).providerKeys?.xai,
  });

  const providers: VoiceProvider[] = [browserProvider, grok];
  const byId = new Map<string, VoiceProvider>();
  for (const p of providers) byId.set(p.id, p);

  function platformDefaultSpec(): ParsedVoiceSpec {
    const raw = (config.service as any).platformDefaultVoice as string | undefined;
    return parseVoiceSpec(raw) ?? { providerId: FALLBACK_PROVIDER_ID };
  }

  function resolveProvider(parsed: ParsedVoiceSpec | null): VoiceProvider {
    if (parsed) {
      const p = byId.get(parsed.providerId);
      if (p && p.isConfigured()) return p;
    }
    // Fall back to browser (always configured)
    return browserProvider;
  }

  return {
    list() {
      return providers;
    },

    get(id) {
      return byId.get(id);
    },

    resolve(agentId?: string) {
      const platformDefault = platformDefaultSpec();

      if (agentId) {
        const agent = config.agents[agentId];
        const override = parseVoiceSpec(agent?.voice);
        if (override) {
          const provider = resolveProvider(override);
          // If the override provider resolved to a different provider (because
          // override was unconfigured and we fell back), the override voiceId
          // is meaningless — drop it.
          const voiceId = provider.id === override.providerId ? override.voiceId : undefined;
          return { provider, voiceId };
        }
      }

      const provider = resolveProvider(platformDefault);
      const voiceId = provider.id === platformDefault.providerId ? platformDefault.voiceId : undefined;
      return { provider, voiceId };
    },

    snapshot() {
      const s = config.service as any;
      const def = platformDefaultSpec();
      return {
        enabled: Boolean(s.voiceModeEnabled),
        defaultProvider: def.providerId,
        defaultVoiceId: def.voiceId,
        autoPlay: Boolean(s.voiceAutoPlay),
        maxChars: typeof s.voiceMaxChars === "number" && s.voiceMaxChars > 0 ? s.voiceMaxChars : 2000,
        providers: providers.map(p => ({
          id: p.id,
          name: p.name,
          serverSide: p.serverSide,
          configured: p.isConfigured(),
          voices: p.listVoices().map(v => ({
            id: v.id, name: v.name, description: v.description, language: v.language, gender: v.gender,
          })),
        })),
      };
    },
  };
}
