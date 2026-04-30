/**
 * Keystore — encrypt/decrypt MCP API key files.
 *
 * V1: AES-256-GCM with scrypt-derived key from password (backward compat)
 * V2: AES-256-GCM with direct 256-bit key (machine key from OS keychain)
 *
 * Encrypted files have .env.enc extension, plain files have .env extension.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersonalAgentsDir } from "./config.js";
import { log } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_V1 = "MYAGENT_ENC_V1"; // password-derived key (scrypt)
const HEADER_V2 = "MYAGENT_ENC_V2"; // direct 256-bit key (machine key)

// ─── V1: Password-based encryption (backward compat) ────────────────

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

export function encryptString(plaintext: string, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: HEADER_V1 + salt(16) + iv(12) + tag(16) + ciphertext
  const headerBuf = Buffer.from(HEADER_V1, "utf-8");
  return Buffer.concat([headerBuf, salt, iv, tag, encrypted]);
}

export function decryptString(data: Buffer, password: string): string {
  const headerV1 = Buffer.from(HEADER_V1, "utf-8");
  const headerLen = headerV1.length;

  if (data.subarray(0, headerLen).toString("utf-8") !== HEADER_V1) {
    throw new Error("Not a V1 encrypted keystore file");
  }

  let offset = headerLen;
  const salt = data.subarray(offset, offset + SALT_LEN); offset += SALT_LEN;
  const iv = data.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const tag = data.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}

// ─── V2: Direct key encryption (machine key / hex string) ───────────

/**
 * Encrypt with a direct 256-bit key (hex string).
 * No scrypt derivation — faster, used with machine keys from OS keychain.
 */
export function encryptStringV2(plaintext: string, keyHex: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LEN) throw new Error("Key must be 32 bytes (64 hex chars)");

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: HEADER_V2 + iv(12) + tag(16) + ciphertext (no salt — key is direct)
  const headerBuf = Buffer.from(HEADER_V2, "utf-8");
  return Buffer.concat([headerBuf, iv, tag, encrypted]);
}

/**
 * Decrypt a V2 encrypted buffer with a direct 256-bit key (hex string).
 */
export function decryptStringV2(data: Buffer, keyHex: string): string {
  const headerV2 = Buffer.from(HEADER_V2, "utf-8");
  const headerLen = headerV2.length;

  if (data.subarray(0, headerLen).toString("utf-8") !== HEADER_V2) {
    throw new Error("Not a V2 encrypted keystore file");
  }

  let offset = headerLen;
  const iv = data.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const tag = data.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const ciphertext = data.subarray(offset);

  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LEN) throw new Error("Key must be 32 bytes (64 hex chars)");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}

// ─── Universal decrypt (auto-detects V1 vs V2) ─────────────────────

/**
 * Detect the encryption version of a buffer.
 */
export function detectVersion(data: Buffer): "v1" | "v2" | null {
  const headerV1 = Buffer.from(HEADER_V1, "utf-8");
  const headerV2 = Buffer.from(HEADER_V2, "utf-8");
  if (data.length >= headerV2.length && data.subarray(0, headerV2.length).toString("utf-8") === HEADER_V2) return "v2";
  if (data.length >= headerV1.length && data.subarray(0, headerV1.length).toString("utf-8") === HEADER_V1) return "v1";
  return null;
}

/**
 * Decrypt a buffer using the appropriate method based on header version.
 * For V1 files, `secret` is treated as a password (scrypt derived).
 * For V2 files, `secret` is treated as a direct hex key.
 *
 * The `isDirectKey` hint helps when we know the secret type:
 * - true: secret is a 64-char hex key (machine key)
 * - false: secret is a password string
 * - undefined: auto-detect based on format (hex key for V2, password for V1)
 */
export function decryptAuto(data: Buffer, secret: string, isDirectKey?: boolean): string {
  const version = detectVersion(data);
  if (version === "v2") return decryptStringV2(data, secret);
  if (version === "v1") return decryptString(data, secret);
  throw new Error("Unknown encryption format");
}

/**
 * Encrypt using V2 if secret looks like a hex key (64 chars), else V1.
 */
export function encryptAuto(plaintext: string, secret: string): Buffer {
  if (isHexKey(secret)) {
    return encryptStringV2(plaintext, secret);
  }
  return encryptString(plaintext, secret);
}

function isHexKey(s: string): boolean {
  return s.length === 64 && /^[0-9a-f]+$/i.test(s);
}

// ─── File-level operations ──────────────────────────────────────────

export function isEncrypted(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const data = readFileSync(filePath);
    return detectVersion(data) !== null;
  } catch {
    return false;
  }
}

function isStubFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.includes("# Encrypted");
  } catch {
    return false;
  }
}

function isPlaintextEnvFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, "utf-8");
    if (!content.trim()) return false;
    if (content.includes("# Encrypted")) return false;
    // Must have at least one KEY=VALUE line
    return content.split("\n").some(l => {
      const t = l.trim();
      return t && !t.startsWith("#") && t.includes("=") && t.split("=")[1]?.trim();
    });
  } catch {
    return false;
  }
}

/**
 * Encrypt all plaintext .env files in a directory → .env.enc
 */
export function encryptDir(dir: string, secret: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env")) continue;
    const plainPath = join(dir, file);
    if (isStubFile(plainPath)) continue; // already encrypted
    try {
      const content = readFileSync(plainPath, "utf-8");
      if (!content.trim()) continue;
      const encrypted = encryptAuto(content, secret);
      const encPath = plainPath + ".enc";
      writeFileSync(encPath, encrypted);
      writeFileSync(plainPath, `# Encrypted — see ${file}.enc\n`);
      count++;
    } catch (err) {
      log.warn(`Failed to encrypt ${file}: ${err}`);
    }
  }
  return count;
}

/**
 * Decrypt all .env.enc files in a directory → .env
 */
export function decryptDir(dir: string, secret: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env.enc")) continue;
    const encPath = join(dir, file);
    const plainPath = encPath.replace(".enc", "");
    try {
      const data = readFileSync(encPath);
      const content = decryptAuto(data, secret);
      writeFileSync(plainPath, content);
      count++;
    } catch (err) {
      log.warn(`Failed to decrypt ${file}: ${err}`);
    }
  }
  return count;
}

/**
 * Re-encrypt all .env.enc files in a directory from old secret to new secret.
 */
export function reEncryptDir(dir: string, oldSecret: string, newSecret: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env.enc")) continue;
    const encPath = join(dir, file);
    try {
      const data = readFileSync(encPath);
      const plaintext = decryptAuto(data, oldSecret);
      const reEncrypted = encryptAuto(plaintext, newSecret);
      writeFileSync(encPath, reEncrypted);
      count++;
    } catch (err) {
      log.warn(`Failed to re-encrypt ${file}: ${err}`);
    }
  }
  return count;
}

/**
 * Count plaintext vs encrypted key files in a directory.
 */
export function countKeyFiles(dir: string): { plaintext: number; encrypted: number } {
  if (!existsSync(dir)) return { plaintext: 0, encrypted: 0 };
  let plaintext = 0, encrypted = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".env.enc")) encrypted++;
    else if (f.endsWith(".env") && isPlaintextEnvFile(join(dir, f))) plaintext++;
  }
  return { plaintext, encrypted };
}

/**
 * Auto-migrate all plaintext .env files in common key directories.
 * Called on startup to encrypt any remaining plaintext keys.
 * Returns total files migrated.
 */
export function migrateAllPlaintextKeys(gatewayBaseDir: string, secret: string): number {
  const dirs: string[] = [];

  // Gateway data/mcp-keys/
  dirs.push(join(gatewayBaseDir, "data", "mcp-keys"));

  // PersonalAgents/mcp-keys/
  try {
    const paDir = getPersonalAgentsDir();
    dirs.push(join(paDir, "mcp-keys"));

    // Scan agent-level mcp-keys/ dirs
    if (existsSync(paDir)) {
      for (const entry of readdirSync(paDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const agentKeysDir = join(paDir, entry.name, "mcp-keys");
        if (existsSync(agentKeysDir)) dirs.push(agentKeysDir);
        // Also check nested dirs (e.g., "AgenticLedger Consulting/bastion/mcp-keys")
        try {
          const subDir = join(paDir, entry.name);
          for (const sub of readdirSync(subDir, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            const nestedKeysDir = join(subDir, sub.name, "mcp-keys");
            if (existsSync(nestedKeysDir)) dirs.push(nestedKeysDir);
          }
        } catch { /* not readable */ }
      }
    }
  } catch { /* personalAgents not configured */ }

  let total = 0;
  for (const dir of dirs) {
    const count = encryptDir(dir, secret);
    if (count > 0) log.info(`[Keystore] Encrypted ${count} key files in ${dir}`);
    total += count;
  }
  return total;
}

// ─── Export bundle (for machine migration) ──────────────────────────

/**
 * Create an encrypted export bundle of all key files.
 * The bundle is encrypted with a user-chosen export password (always V1/scrypt).
 */
export function createExportBundle(dirs: string[], currentSecret: string, exportPassword: string): Buffer {
  const entries: { name: string; content: string }[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      // Collect decrypted content from .env.enc files
      if (file.endsWith(".env.enc")) {
        try {
          const data = readFileSync(join(dir, file));
          const content = decryptAuto(data, currentSecret);
          entries.push({ name: file.replace(".enc", ""), content });
        } catch { /* skip unreadable */ }
      }
      // Also collect plaintext .env files (non-stubs)
      else if (file.endsWith(".env") && isPlaintextEnvFile(join(dir, file))) {
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          entries.push({ name: file, content });
        } catch { /* skip */ }
      }
    }
  }

  // Bundle as JSON, encrypt with export password (V1 — portable)
  const json = JSON.stringify(entries);
  return encryptString(json, exportPassword);
}

/**
 * Import an export bundle, re-encrypting with the local machine's secret.
 */
export function importExportBundle(bundle: Buffer, exportPassword: string, localSecret: string, targetDir: string): number {
  const json = decryptString(bundle, exportPassword); // V1 — password-based
  const entries: { name: string; content: string }[] = JSON.parse(json);

  let count = 0;
  for (const { name, content } of entries) {
    const encPath = join(targetDir, name + ".enc");
    const plainPath = join(targetDir, name);
    const encrypted = encryptAuto(content, localSecret);
    writeFileSync(encPath, encrypted);
    writeFileSync(plainPath, `# Encrypted — see ${name}.enc\n`);
    count++;
  }
  return count;
}

// ─── Key loading (main API used by executor) ────────────────────────

/**
 * Load env vars from a .env file, auto-decrypting if .env.enc exists.
 * Priority: agent-level > shared > gateway
 */
export function loadMcpKeysWithDecryption(
  gatewayDir: string,
  agentMemoryDir: string | null,
  mcpName: string,
  secret?: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const personalAgentsBase = getPersonalAgentsDir();

  // Level 3: Gateway data/mcp-keys/ (last resort)
  const gatewayVars = loadEnvFile(join(gatewayDir, `${mcpName}.env`), join(gatewayDir, `${mcpName}.env.enc`), secret);
  Object.assign(vars, gatewayVars);

  // Level 2: Shared personalAgents/mcp-keys/ (overrides gateway)
  const sharedKeysDir = join(personalAgentsBase, "mcp-keys");
  const sharedVars = loadEnvFile(join(sharedKeysDir, `${mcpName}.env`), join(sharedKeysDir, `${mcpName}.env.enc`), secret);
  Object.assign(vars, sharedVars);

  // Level 1: Agent-specific agent/mcp-keys/ (highest priority)
  if (agentMemoryDir) {
    const agentKeysDir = join(agentMemoryDir, "..", "mcp-keys");
    const agentVars = loadEnvFile(join(agentKeysDir, `${mcpName}.env`), join(agentKeysDir, `${mcpName}.env.enc`), secret);
    Object.assign(vars, agentVars);
  }

  return vars;
}

function loadEnvFile(plainPath: string, encPath: string, secret?: string): Record<string, string> {
  const vars: Record<string, string> = {};

  // Try encrypted file first
  if (secret && existsSync(encPath)) {
    try {
      const data = readFileSync(encPath);
      const version = detectVersion(data);
      if (version) {
        const content = decryptAuto(data, secret);
        parseEnvContent(content, vars);
        return vars;
      }
    } catch { /* fall through to plain */ }
  }

  // Try plain file
  if (existsSync(plainPath)) {
    try {
      const content = readFileSync(plainPath, "utf-8");
      if (!content.includes("# Encrypted")) {
        parseEnvContent(content, vars);
      }
    } catch { /* ignore */ }
  }

  return vars;
}

function parseEnvContent(content: string, vars: Record<string, string>): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val) vars[key] = val;
  }
}
