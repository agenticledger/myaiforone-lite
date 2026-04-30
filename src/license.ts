/**
 * License verification — calls the MyAIforOne licensing server on startup.
 *
 * Policy:
 *   - No licenseKey configured          → unlicensed mode (no restrictions)
 *   - Server says { valid: true }       → full access, use license features
 *   - Server says { valid: false }      → LOCKED (agent execution blocked)
 *   - Server unreachable (net/DNS/5xx)  → grace mode: full access, re-verify every 24h
 *
 * Grace mode exit conditions (checked every 24h):
 *   - Server now returns valid   → exit grace mode, use real license
 *   - Server now returns invalid → stop grace mode, LOCK execution
 *   - Server still unreachable   → stay in grace mode, schedule next re-check
 */

import { log } from "./logger.js";

const DEFAULT_LICENSE_URL = "https://ai41license.agenticledger.ai";
const GRACE_REVERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LicenseInfo {
  valid: boolean;
  org?: string;
  name?: string;
  features?: Record<string, boolean | number | string[]>;
  expiresAt?: string;
  error?: string;
  /** True when the server could not be reached and we're running on a fail-open grace period. */
  graceMode?: boolean;
  /** True when no license key is configured at all (pre-activation state). */
  unlicensed?: boolean;
}

let _cachedLicense: LicenseInfo | null = null;
let _graceReverifyTimer: NodeJS.Timeout | null = null;

/**
 * Verify the license key against the licensing server.
 * See policy in file header. Updates the cached license and manages the
 * grace-mode re-verify loop as a side effect.
 */
export async function verifyLicense(licenseKey?: string, licenseUrl?: string): Promise<LicenseInfo> {
  // No license key configured — flag as unlicensed so the UI can show an
  // activation popup. Note: `valid: true` is kept so agent execution isn't
  // blocked at the core layer — the popup enforces activation at the UI layer.
  if (!licenseKey) {
    _cachedLicense = { valid: true, unlicensed: true };
    stopGraceReverifyLoop();
    return _cachedLicense;
  }

  const baseUrl = (licenseUrl || DEFAULT_LICENSE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/license/verify`;

  let data: LicenseInfo | null = null;
  let unreachable = false;
  let unreachableReason = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!res.ok) {
      // Non-2xx counts as unreachable — server is malfunctioning, not giving
      // a definitive valid/invalid answer. Fail open into grace mode.
      unreachable = true;
      unreachableReason = `HTTP ${res.status}`;
    } else {
      try {
        data = (await res.json()) as LicenseInfo;
      } catch (parseErr) {
        unreachable = true;
        unreachableReason = `malformed response (${parseErr})`;
      }
    }
  } catch (err) {
    unreachable = true;
    unreachableReason = String(err);
  }

  if (unreachable) {
    log.warn(`License server unreachable (${unreachableReason}). Running in grace mode.`);
    _cachedLicense = {
      valid: true,
      graceMode: true,
      error: "License server unreachable — running in grace mode",
    };
    startGraceReverifyLoop(licenseKey, licenseUrl);
    return _cachedLicense;
  }

  // Definitive response from the server (valid or invalid) — cancel any grace loop.
  _cachedLicense = data!;
  stopGraceReverifyLoop();

  if (data!.valid) {
    log.info(`License verified — org: ${data!.org}, expires: ${data!.expiresAt}`);
  } else {
    log.error(`License invalid: ${data!.error || "expired or revoked"}. Agent execution blocked.`);
  }

  return data!;
}

/**
 * Start the 24h re-verify loop used while we're in grace mode. Idempotent:
 * calling it while a timer is already running is a no-op so we don't stack timers.
 */
function startGraceReverifyLoop(licenseKey: string, licenseUrl?: string) {
  if (_graceReverifyTimer) return;
  log.info(`Grace mode active — will re-verify license every 24h`);
  _graceReverifyTimer = setInterval(async () => {
    log.info(`Grace mode re-check: verifying license...`);
    try {
      const result = await verifyLicense(licenseKey, licenseUrl);
      if (result.graceMode) {
        log.warn(`Grace mode re-check: server still unreachable. Next re-check in 24h.`);
      } else if (result.valid) {
        log.info(`Grace mode re-check: license now valid. Exiting grace mode.`);
      } else {
        log.error(`Grace mode re-check: server rejected license (${result.error || "invalid"}). Agent execution now blocked.`);
      }
    } catch (err) {
      log.warn(`Grace mode re-check failed unexpectedly: ${err}`);
    }
  }, GRACE_REVERIFY_INTERVAL_MS);

  // Don't hold the event loop open just for this timer.
  if (typeof _graceReverifyTimer.unref === "function") {
    _graceReverifyTimer.unref();
  }
}

function stopGraceReverifyLoop() {
  if (_graceReverifyTimer) {
    clearInterval(_graceReverifyTimer);
    _graceReverifyTimer = null;
  }
}

/**
 * Get the cached license info (call verifyLicense first).
 */
export function getLicense(): LicenseInfo | null {
  return _cachedLicense;
}

/**
 * Check if a specific feature is enabled in the current license.
 * Returns true if: no license configured, or feature is enabled, or feature not in license.
 * Returns false only if the license explicitly disables the feature.
 */
export function isFeatureEnabled(feature: string): boolean {
  if (!_cachedLicense || !_cachedLicense.features) return true; // no license = no restrictions
  const val = _cachedLicense.features[feature];
  if (val === undefined) return true; // feature not in license = no restriction
  return !!val;
}

/**
 * Check if the shared agents feature is allowed.
 * Requires BOTH the local service config flag AND the license feature to be true.
 * Default is false — shared agents are off unless explicitly enabled.
 */
export function isSharedAgentsAllowed(config: any): boolean {
  const localFlag = (config?.service as any)?.sharedAgentsEnabled;
  if (!localFlag) return false; // local kill switch — off by default
  return isFeatureEnabled("sharedAgents");
}

/**
 * Get a numeric limit from the license (e.g., maxAgents).
 * Returns Infinity if no license or limit not set.
 */
export function getFeatureLimit(feature: string): number {
  if (!_cachedLicense || !_cachedLicense.features) return Infinity;
  const val = _cachedLicense.features[feature];
  if (typeof val === "number") return val;
  return Infinity;
}

/**
 * Get template access policy from the current license.
 *
 * Returns:
 *   { allowed: true }                                — no restrictions (no license, unlicensed, or templates not in features)
 *   { allowed: false }                               — templates explicitly disabled
 *   { allowed: true, categories?, ids? }             — access limited to matching categories/ids
 *
 * When both categories AND ids are present, a template passes if it matches EITHER.
 */
export function getTemplateAccess(): { allowed: boolean; categories?: string[]; ids?: string[] } {
  if (!_cachedLicense || !_cachedLicense.features) return { allowed: true };
  const f = _cachedLicense.features;

  // Master toggle — if explicitly false, block all templates
  if (f.templates === false) return { allowed: false };

  // If templates key is missing or true, check for granular filters
  const categories = Array.isArray(f.templateCategories) ? f.templateCategories as string[] : undefined;
  const ids = Array.isArray(f.templateIds) ? f.templateIds as string[] : undefined;

  // Has granular filters → return them; otherwise unrestricted
  if (categories || ids) return { allowed: true, categories, ids };
  return { allowed: true };
}

/**
 * Filter a list of templates based on the current license.
 * Each template is expected to have `id: string` and optionally `categories: string[]`.
 * License gating only applies to builtin (platform) templates — user-created templates
 * are always accessible.
 */
export function filterTemplatesByLicense(templates: any[]): any[] {
  const access = getTemplateAccess();
  if (!access.categories && !access.ids) return access.allowed ? templates : templates.filter((t: any) => t.source === "user");

  return templates.filter((t: any) => {
    // User-created templates always pass through
    if (t.source === "user") return true;
    // Match by individual template ID
    if (access.ids && access.ids.includes(t.id)) return true;
    // Match by category overlap
    if (access.categories && Array.isArray(t.categories)) {
      return t.categories.some((c: string) => access.categories!.includes(c));
    }
    return false;
  });
}

/**
 * Check if a single template is accessible under the current license.
 * User-created templates (source: "user") are always accessible.
 */
export function isTemplateAccessible(templateId: string, templateCategories?: string[], source?: string): boolean {
  if (source === "user") return true; // user templates bypass license gating

  const access = getTemplateAccess();
  if (!access.allowed) return false;
  if (!access.categories && !access.ids) return true; // unrestricted

  if (access.ids && access.ids.includes(templateId)) return true;
  if (access.categories && Array.isArray(templateCategories)) {
    return templateCategories.some((c: string) => access.categories!.includes(c));
  }
  return false;
}

/**
 * Check if the platform is licensed to execute agents.
 * Returns null if OK, or an error message if blocked.
 *
 * Rules:
 * - No licenseKey configured → allowed (unlicensed mode, no restrictions)
 * - Valid licenseKey         → allowed
 * - Grace mode               → allowed (we can't reach the server; fail open)
 * - Invalid/expired key      → blocked
 */
export function checkLicenseForExecution(): string | null {
  if (!_cachedLicense) return null; // verifyLicense hasn't been called yet — allow
  if (_cachedLicense.valid) return null; // valid, unlicensed, or grace mode — allow
  return `License invalid: ${_cachedLicense.error || "expired or revoked"}. Enter a valid license key in Admin → Settings and restart.`;
}

/**
 * Re-verify the license (called when the key is updated via Admin UI).
 */
export async function reverifyLicense(licenseKey?: string, licenseUrl?: string): Promise<LicenseInfo> {
  return verifyLicense(licenseKey, licenseUrl);
}

/**
 * Dry-run verification: check a license key against the server WITHOUT touching
 * the cached license or starting the grace-mode loop. Used by the Admin UI's
 * "Verify Only" button so admins can test a key before saving it.
 *
 * Return shape:
 *   { valid: true, org, features, expiresAt }        — server confirmed valid
 *   { valid: false, error }                          — server said invalid
 *   { valid: false, error, unreachable: true }       — couldn't reach server
 */
export async function checkLicenseNoCache(
  licenseKey: string,
  licenseUrl?: string,
): Promise<LicenseInfo & { unreachable?: boolean }> {
  if (!licenseKey) {
    return { valid: false, error: "No license key provided" };
  }

  const baseUrl = (licenseUrl || DEFAULT_LICENSE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/license/verify`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { valid: false, error: `Server returned HTTP ${res.status}`, unreachable: true };
    }
    try {
      return (await res.json()) as LicenseInfo;
    } catch (parseErr) {
      return { valid: false, error: `Malformed response: ${parseErr}`, unreachable: true };
    }
  } catch (err) {
    return { valid: false, error: `Cannot reach license server: ${err}`, unreachable: true };
  }
}
