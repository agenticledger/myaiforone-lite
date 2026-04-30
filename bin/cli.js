#!/usr/bin/env node

/**
 * MyAIforOne Lite — CLI entrypoint
 *
 * Usage:
 *   npx myaiforone@latest          # Fresh install OR upgrade existing
 *   npx myaiforone@latest --upgrade # Force upgrade mode
 *   npx myaiforone@latest --version # Print version
 *
 * Detection logic:
 *   1. Check for existing data dir (~/.myaiforone or %APPDATA%\MyAIforOneGateway)
 *   2. If config.json exists there → upgrade path
 *   3. If not → fresh install path
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");

// ─── Helpers ───────────────────────────────────────────────────────────
function getPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
  return pkg.version;
}

function getDataDir() {
  const home = homedir();
  const isWin = process.platform === "win32";
  const appData = isWin ? (process.env.APPDATA || join(home, "AppData", "Roaming")) : home;
  const primary = isWin ? join(appData, "MyAIforOneGateway") : join(home, ".myaiforone");
  return primary;
}

function hasExistingInstall(dataDir) {
  return existsSync(join(dataDir, "config.json"));
}

function getInstalledVersion(dataDir) {
  const versionFile = join(dataDir, ".myaiforone-version");
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, "utf-8").trim();
  }
  // Fallback: check if config.json exists but no version file (pre-upgrade-path install)
  if (existsSync(join(dataDir, "config.json"))) {
    return "unknown";
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const version = getPackageVersion();

  if (args.includes("--version") || args.includes("-v")) {
    console.log(version);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
MyAIforOne Lite v${version}

Usage:
  npx myaiforone@latest            Install or upgrade MyAIforOne Lite
  npx myaiforone@latest --upgrade  Force upgrade mode
  npx myaiforone@latest --version  Print version
  npx myaiforone@latest start      Start the server

Options:
  --upgrade    Force upgrade (skip fresh-install flow)
  --version    Print version and exit
  --help       Show this help
`);
    process.exit(0);
  }

  // "start" subcommand — just run the server
  if (args[0] === "start") {
    const { execSync } = await import("node:child_process");
    try {
      execSync("node " + join(packageRoot, "dist", "index.js"), { stdio: "inherit", cwd: packageRoot });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  const dataDir = getDataDir();
  const existing = hasExistingInstall(dataDir);
  const installedVersion = getInstalledVersion(dataDir);
  const forceUpgrade = args.includes("--upgrade");

  console.log(`\n  MyAIforOne Lite v${version}\n`);

  if (existing || forceUpgrade) {
    // ─── Upgrade path ────────────────────────────────────────────────
    if (installedVersion === version && !forceUpgrade) {
      console.log(`  Already at v${version}. Nothing to do.`);
      console.log(`  Run: npx myaiforone start\n`);
      process.exit(0);
    }

    console.log(`  Existing installation detected at: ${dataDir}`);
    if (installedVersion && installedVersion !== "unknown") {
      console.log(`  Installed version: v${installedVersion}`);
    }
    console.log(`  Upgrading to: v${version}`);
    console.log("");

    // Run the upgrade script
    const { upgrade } = await import("../scripts/upgrade.js");
    await upgrade({ packageRoot, dataDir, fromVersion: installedVersion, toVersion: version });
  } else {
    // ─── Fresh install ───────────────────────────────────────────────
    console.log("  No existing installation found. Setting up fresh install...");
    console.log(`  Data directory: ${dataDir}`);
    console.log("");

    const { freshInstall } = await import("../scripts/upgrade.js");
    await freshInstall({ packageRoot, dataDir, version });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
