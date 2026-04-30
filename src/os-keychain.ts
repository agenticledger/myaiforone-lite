/**
 * OS Keychain abstraction — stores/retrieves secrets using native OS credential storage.
 *
 * - macOS: `security` CLI (Keychain)
 * - Windows: PowerShell DPAPI (encrypted file at %APPDATA%/MyAIforOneGateway/)
 * - Linux/fallback: file at ~/.myaiforone/ with chmod 600
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { log } from "./logger.js";

const SERVICE_NAME = "com.myaiforone.keystore";
const MACHINE_KEY_ACCOUNT = "machine-key";
const MASTER_PASSWORD_ACCOUNT = "master-password";

// ─── Platform-specific implementations ────────────────────────────────

function isMac(): boolean { return platform() === "darwin"; }
function isWindows(): boolean { return platform() === "win32"; }

function getFallbackDir(): string {
  if (isWindows()) {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "MyAIforOneGateway");
  }
  return join(homedir(), ".myaiforone");
}

function ensureFallbackDir(): string {
  const dir = getFallbackDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    if (!isWindows()) {
      try { chmodSync(dir, 0o700); } catch { /* best effort */ }
    }
  }
  return dir;
}

// ─── macOS Keychain ───────────────────────────────────────────────────

function macGet(account: string): string | null {
  try {
    const result = execSync(
      `security find-generic-password -s "${SERVICE_NAME}" -a "${account}" -w 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

function macSet(account: string, value: string): void {
  // Delete first (silently fail if not found), then add
  try {
    execSync(`security delete-generic-password -s "${SERVICE_NAME}" -a "${account}" 2>/dev/null`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { /* not found, ok */ }

  execSync(
    `security add-generic-password -s "${SERVICE_NAME}" -a "${account}" -w "${value.replace(/"/g, '\\"')}"`,
    { stdio: ["pipe", "pipe", "pipe"] }
  );
}

function macDelete(account: string): void {
  try {
    execSync(`security delete-generic-password -s "${SERVICE_NAME}" -a "${account}" 2>/dev/null`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { /* not found, ok */ }
}

// ─── Windows DPAPI ────────────────────────────────────────────────────

function winGet(account: string): string | null {
  const dir = ensureFallbackDir();
  const filePath = join(dir, `${account}.dpapi`);
  if (!existsSync(filePath)) return null;

  try {
    // Use PowerShell to decrypt DPAPI-protected data
    const ps = `
      $bytes = [System.IO.File]::ReadAllBytes('${filePath.replace(/'/g, "''")}')
      $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Text.Encoding]::UTF8.GetString($plain)
    `;
    const result = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

function winSet(account: string, value: string): void {
  const dir = ensureFallbackDir();
  const filePath = join(dir, `${account}.dpapi`);

  const ps = `
    Add-Type -AssemblyName System.Security
    $plain = [System.Text.Encoding]::UTF8.GetBytes('${value.replace(/'/g, "''")}')
    $enc = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes('${filePath.replace(/'/g, "''")}', $enc)
  `;
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function winDelete(account: string): void {
  const dir = getFallbackDir();
  const filePath = join(dir, `${account}.dpapi`);
  try {
    if (existsSync(filePath)) {
      const { unlinkSync } = require("node:fs");
      unlinkSync(filePath);
    }
  } catch { /* best effort */ }
}

// ─── Linux/Fallback (chmod 600 file) ──────────────────────────────────

function fallbackGet(account: string): string | null {
  const dir = getFallbackDir();
  const filePath = join(dir, `${account}.key`);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function fallbackSet(account: string, value: string): void {
  const dir = ensureFallbackDir();
  const filePath = join(dir, `${account}.key`);
  writeFileSync(filePath, value, { mode: 0o600 });
}

function fallbackDelete(account: string): void {
  const dir = getFallbackDir();
  const filePath = join(dir, `${account}.key`);
  try {
    if (existsSync(filePath)) {
      const { unlinkSync } = require("node:fs");
      unlinkSync(filePath);
    }
  } catch { /* best effort */ }
}

// ─── Unified API ──────────────────────────────────────────────────────

function getSecret(account: string): string | null {
  if (isMac()) return macGet(account);
  if (isWindows()) return winGet(account);
  return fallbackGet(account);
}

function setSecret(account: string, value: string): void {
  if (isMac()) return macSet(account, value);
  if (isWindows()) return winSet(account, value);
  return fallbackSet(account, value);
}

function deleteSecret(account: string): void {
  if (isMac()) return macDelete(account);
  if (isWindows()) return winDelete(account);
  return fallbackDelete(account);
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Get the machine key from Keychain, or create one if it doesn't exist.
 * Returns a 64-char hex string (256-bit key).
 */
export function getOrCreateMachineKey(): string {
  const existing = getSecret(MACHINE_KEY_ACCOUNT);
  if (existing) return existing;

  const key = randomBytes(32).toString("hex");
  setSecret(MACHINE_KEY_ACCOUNT, key);
  log.info("Generated and stored new machine encryption key in OS keychain");
  return key;
}

/**
 * Get the machine key if it exists, without creating one.
 */
export function getMachineKey(): string | null {
  return getSecret(MACHINE_KEY_ACCOUNT);
}

/**
 * Set the user's master password (stored in Keychain for auto-start).
 */
export function setMasterPassword(password: string): void {
  setSecret(MASTER_PASSWORD_ACCOUNT, password);
  log.info("Master password stored in OS keychain");
}

/**
 * Get the master password from Keychain, if set.
 */
export function getMasterPassword(): string | null {
  return getSecret(MASTER_PASSWORD_ACCOUNT);
}

/**
 * Remove the master password from Keychain (revert to machine key).
 */
export function clearMasterPassword(): void {
  deleteSecret(MASTER_PASSWORD_ACCOUNT);
  log.info("Master password removed from OS keychain");
}

/**
 * Returns true if the user has set a master password.
 */
export function hasMasterPassword(): boolean {
  return getMasterPassword() !== null;
}

/**
 * Get the current encryption secret — master password if set, else machine key.
 * This is the single source of truth for all encryption/decryption operations.
 *
 * Priority:
 * 1. MYAGENT_MASTER_PASSWORD env var (backward compat / CI)
 * 2. Master password from Keychain (user-set)
 * 3. Machine key from Keychain (auto-generated)
 */
export function getEncryptionSecret(): string {
  // Env var override (backward compat, CI, containers)
  if (process.env.MYAGENT_MASTER_PASSWORD) {
    return process.env.MYAGENT_MASTER_PASSWORD;
  }

  // User-set master password
  const masterPw = getMasterPassword();
  if (masterPw) return masterPw;

  // Auto-generated machine key (creates if needed)
  return getOrCreateMachineKey();
}

/**
 * Returns the current encryption mode for display in the UI.
 */
export function getEncryptionMode(): "env-var" | "master-password" | "machine-key" {
  if (process.env.MYAGENT_MASTER_PASSWORD) return "env-var";
  if (getMasterPassword()) return "master-password";
  return "machine-key";
}
