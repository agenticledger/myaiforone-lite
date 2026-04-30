/**
 * Shared bearer-token validation used by both /api/* (web-ui.ts) and /mcp
 * (mcp-http.ts). Keeps the auth model in one place so the two endpoints can
 * never drift apart.
 *
 * The web UI's authMiddleware in src/web-ui.ts has its own copy that also
 * stamps lastUsedAt and synthesizes a virtual ApiKey for legacy tokens; this
 * module covers the read-only validation path that /mcp needs.
 */
import type { AppConfig, ApiKey } from "./config.js";

export interface AuthMatchResult {
  /** The matching ApiKey record (real or synthesized for legacy tokens). */
  apiKey: ApiKey;
}

/**
 * Returns true when auth is gated on (i.e. tokens are required to call the
 * gateway). When false, /mcp should match the open behavior of /api/*.
 */
export function isAuthEnabled(config: AppConfig): boolean {
  const auth = (config.service as any).auth as { enabled?: boolean } | undefined;
  return !!auth?.enabled;
}

/**
 * Match a raw bearer token against the configured apiKeys[] (preferred) and
 * legacy auth.tokens[]. Returns the matching record or null. When a legacy
 * token matches, a synthesized record (id="legacy") is returned so callers
 * still have a uniform shape to work with.
 */
export function matchToken(config: AppConfig, token: string | null): ApiKey | null {
  if (!token) return null;
  const keys = ((config.service as any).apiKeys as ApiKey[]) || [];
  for (const k of keys) {
    if (k.key === token) {
      // Best-effort lastUsedAt stamp — the disk persistence happens elsewhere
      // (web-ui.ts saveConfigToDisk on next admin view). We still update the
      // in-memory record so downstream readers see fresh info.
      k.lastUsedAt = new Date().toISOString();
      return k;
    }
  }
  const auth = (config.service as any).auth as { tokens?: string[] } | undefined;
  if (auth?.tokens?.includes(token)) {
    return {
      id: "legacy",
      name: "Legacy Token",
      key: token,
      createdAt: new Date(0).toISOString(),
      scopes: ["*"],
    };
  }
  return null;
}

/**
 * Extract the bearer token from an HTTP Authorization header value.
 * Returns null if the header is missing or not in `Bearer <token>` form.
 */
export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
