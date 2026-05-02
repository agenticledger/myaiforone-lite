/**
 * esbuild bundler — produces CJS bundles for pkg (desktop builds).
 *
 * Two entry points:
 *   1. dist/index.js        → dist/server-bundle.cjs   (main Express server)
 *   2. server/mcp-server-lite/dist/index.js → dist/mcp-lite.cjs (MCP stdio server)
 *
 * Both bundle all dependencies into a single file so pkg doesn't need to
 * resolve node_modules from a virtual snapshot filesystem.
 */

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// CJS polyfill: the source code uses `import.meta.url` to derive __dirname.
// In CJS output, import.meta is empty ({}), so we inject a shim that provides
// the correct value using Node's native __filename.
const importMetaBanner = [
  "/* bundled by esbuild for pkg */",
  'var __import_meta_url = require("node:url").pathToFileURL(__filename).href;',
].join("\n");

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  // Replace import.meta.url with our CJS-compatible shim variable
  define: {
    "import.meta.url": "__import_meta_url",
  },
  // better-sqlite3 is an optional native addon — never installed in Lite,
  // but referenced in a try/catch.  Keep it external so esbuild doesn't choke.
  external: ["better-sqlite3"],
};

async function main() {
  // 1. Main server
  await build({
    ...shared,
    entryPoints: [resolve(root, "dist", "index.js")],
    outfile: resolve(root, "dist", "server-bundle.cjs"),
    banner: { js: importMetaBanner },
  });
  console.log("✓ dist/server-bundle.cjs");

  // 2. MCP server (standalone — spawned as a child process by Claude CLI)
  await build({
    ...shared,
    entryPoints: [resolve(root, "server", "mcp-server-lite", "dist", "index.js")],
    outfile: resolve(root, "dist", "mcp-lite.cjs"),
    banner: { js: importMetaBanner },
  });
  console.log("✓ dist/mcp-lite.cjs");
}

main().catch((err) => {
  console.error("esbuild failed:", err);
  process.exit(1);
});
