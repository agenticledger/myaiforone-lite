/**
 * MyAIforOne Lite — Install & Upgrade Script
 *
 * Handles both fresh installs and upgrades. Never deletes user data.
 *
 * Fresh install:
 *   1. Create data directory (~/.myaiforone)
 *   2. Copy config.example.json → config.json
 *   3. Write version marker
 *   4. Build (if needed)
 *
 * Upgrade:
 *   1. Preserve config.json, agents/, Drive data
 *   2. Merge new config fields into existing config (additive only)
 *   3. Rebuild TypeScript
 *   4. Update version marker
 *   5. Restart service if running
 */

import { resolve, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

// ─── Utility ───────────────────────────────────────────────────────────

function writeVersionMarker(dataDir, version) {
  writeFileSync(join(dataDir, ".myaiforone-version"), version + "\n");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Deep-merge source into target (additive only — never removes keys from target).
 * Arrays are NOT merged — target arrays are preserved as-is.
 */
function mergeConfig(target, source) {
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      // New key from template — add it
      target[key] = source[key];
    } else if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      // Both are plain objects — recurse
      mergeConfig(target[key], source[key]);
    }
    // Otherwise: target already has the key, keep user's value
  }
  return target;
}

/**
 * Copy a directory recursively, skipping files that already exist in the destination.
 */
function copyDirSafe(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirSafe(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Detect running service ────────────────────────────────────────────

function isServiceRunning() {
  try {
    if (process.platform === "darwin") {
      const result = execSync(
        "launchctl list 2>/dev/null | grep myaiforone || true",
        { encoding: "utf-8" }
      );
      return result.includes("myaiforone");
    }
    if (process.platform === "win32") {
      const result = execSync(
        'schtasks /Query /TN MyAIforOneGateway 2>NUL || echo ""',
        { encoding: "utf-8" }
      );
      return result.includes("Running");
    }
  } catch {
    // Ignore errors
  }
  return false;
}

function restartService() {
  try {
    if (process.platform === "darwin") {
      const plistPath = join(
        homedir(),
        "Library",
        "LaunchAgents",
        "com.agenticledger.myaiforone-lite.plist"
      );
      if (existsSync(plistPath)) {
        console.log("  Restarting launchd service...");
        execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
        execSync(`launchctl load "${plistPath}"`);
        console.log("  Service restarted.");
        return true;
      }
    }
    if (process.platform === "win32") {
      console.log("  Restarting Task Scheduler service...");
      execSync("schtasks /End /TN MyAIforOneGateway 2>NUL || echo .");
      execSync("schtasks /Run /TN MyAIforOneGateway");
      console.log("  Service restarted.");
      return true;
    }
  } catch (err) {
    console.warn("  Could not restart service:", err.message);
  }
  return false;
}

// ─── Fresh Install ─────────────────────────────────────────────────────

export async function freshInstall({ packageRoot, dataDir, version }) {
  console.log("  [1/4] Creating data directory...");
  mkdirSync(dataDir, { recursive: true });

  console.log("  [2/4] Initializing config.json...");
  const exampleConfig = join(packageRoot, "config.example.json");
  const targetConfig = join(dataDir, "config.json");
  if (existsSync(exampleConfig)) {
    copyFileSync(exampleConfig, targetConfig);
  } else {
    // Minimal fallback config
    writeJson(targetConfig, {
      service: {
        logLevel: "info",
        webUI: { enabled: true, port: 4889 },
        voiceModeEnabled: false,
        licenseKey: "",
        auth: { enabled: false },
      },
      channels: {},
      agents: {},
      mcps: {},
      defaultAgent: null,
      defaultSkills: [],
      defaultMcps: [],
      defaultPrompts: [],
      promptTrigger: "!",
    });
  }

  console.log("  [3/4] Copying agent templates...");
  const templateSrc = join(packageRoot, "agents", "_template");
  const templateDest = join(dataDir, "agents", "_template");
  copyDirSafe(templateSrc, templateDest);

  console.log("  [4/4] Writing version marker...");
  writeVersionMarker(dataDir, version);

  // Create Drive directory structure
  const home = homedir();
  const driveRoot = join(home, "Desktop", "MyAIforOne Drive Lite");
  mkdirSync(join(driveRoot, "PersonalAgents"), { recursive: true });
  mkdirSync(join(driveRoot, "PersonalRegistry"), { recursive: true });

  console.log("");
  console.log("  Setup complete!");
  console.log("");
  console.log("  Next steps:");
  console.log(`    1. cd into the package and start the server:`);
  console.log(`       npx myaiforone start`);
  console.log(`    2. Open http://localhost:4889`);
  console.log(`    3. Follow the onboarding wizard (API key + first agent)`);
  console.log("");
}

// ─── Upgrade ───────────────────────────────────────────────────────────

export async function upgrade({ packageRoot, dataDir, fromVersion, toVersion }) {
  const wasRunning = isServiceRunning();

  // Step 1: Backup config
  console.log("  [1/5] Backing up config.json...");
  const configPath = join(dataDir, "config.json");
  const backupPath = join(dataDir, `config.backup-${Date.now()}.json`);
  if (existsSync(configPath)) {
    copyFileSync(configPath, backupPath);
    console.log(`         Backup saved: ${backupPath}`);
  }

  // Step 2: Merge new config fields (additive only)
  console.log("  [2/5] Merging config (new fields only, preserving your settings)...");
  const exampleConfig = join(packageRoot, "config.example.json");
  if (existsSync(configPath) && existsSync(exampleConfig)) {
    const userConfig = readJson(configPath);
    const templateConfig = readJson(exampleConfig);
    mergeConfig(userConfig, templateConfig);
    writeJson(configPath, userConfig);
    console.log("         Config updated (existing values preserved).");
  }

  // Step 3: Copy new agent templates (skip existing)
  console.log("  [3/5] Updating agent templates...");
  const templateSrc = join(packageRoot, "agents", "_template");
  const templateDest = join(dataDir, "agents", "_template");
  copyDirSafe(templateSrc, templateDest);

  // Step 4: Ensure Drive directories exist
  console.log("  [4/5] Ensuring Drive directories...");
  const home = homedir();
  const driveRoot = join(home, "Desktop", "MyAIforOne Drive Lite");
  mkdirSync(join(driveRoot, "PersonalAgents"), { recursive: true });
  mkdirSync(join(driveRoot, "PersonalRegistry"), { recursive: true });

  // Step 5: Write version marker
  console.log("  [5/5] Updating version marker...");
  writeVersionMarker(dataDir, toVersion);

  // Restart service if it was running
  if (wasRunning) {
    console.log("");
    restartService();
  }

  console.log("");
  console.log(`  Upgrade complete! v${fromVersion || "unknown"} -> v${toVersion}`);
  console.log("");
  console.log("  Your data is preserved:");
  console.log("    - config.json (backed up + merged)");
  console.log("    - agents/ (untouched)");
  console.log("    - Drive data (untouched)");
  console.log("");
  if (!wasRunning) {
    console.log("  Start the server:");
    console.log("    npx myaiforone start");
    console.log("");
  }
}
