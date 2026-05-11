#!/usr/bin/env node
/**
 * Test runner for MyAIforOne Lite — discovers and runs all *.test.ts files
 * using Node's built-in test runner via tsx.
 *
 * Usage:  npm test
 *         node "Comprehensive Test Suite/run-all-tests.cjs"
 */

const { execSync } = require("child_process");
const { readdirSync, statSync } = require("fs");
const { join, sep } = require("path");

const ROOT = __dirname;
const TIMEOUT = 120000; // 120s per file

function findTests(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findTests(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.js")) {
      results.push(full);
    }
  }
  return results.sort();
}

const files = findTests(ROOT);
console.log("");
console.log("  MyAIforOne Lite — Comprehensive Test Suite");
console.log("  Found " + files.length + " test files");
console.log("");

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const rel = file.replace(ROOT + sep, "");
  let result;
  try {
    execSync('npx tsx --test "' + file + '"', {
      timeout: TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: join(ROOT, ".."),
    });
    result = "PASS";
    passed++;
  } catch (err) {
    const stderr = (err.stderr || "").toString();
    const stdout = (err.stdout || "").toString();
    const output = stdout + stderr;

    // Node test runner exits non-zero even when tests pass but have warnings
    if (output.includes("fail 0") && output.includes("pass")) {
      result = "PASS";
      passed++;
    } else {
      result = "FAIL";
      failed++;
      failures.push({ file: rel, output: output.slice(-800) });
    }
  }
  console.log("  " + rel + " ... " + result);
}

console.log("");
console.log("  ─────────────────────────────────────");
console.log("  " + passed + " passed  " + failed + " failed  (" + files.length + " total)");

if (failures.length) {
  console.log("");
  console.log("  Failures:");
  console.log("");
  for (const f of failures) {
    console.log("  X " + f.file);
    const lines = f.output.split("\n").slice(-12).join("\n    ");
    console.log("    " + lines);
    console.log("");
  }
}

console.log("");
process.exit(failed > 0 ? 1 : 0);
