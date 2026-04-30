---
name: op_devbrowser
description: Use when controlling a browser programmatically — navigating pages, clicking, filling forms, scraping content, taking screenshots, or automating any web workflow. Trigger when user asks to visit a URL, interact with a site, extract web data, or automate browser tasks.
allowed-tools: Bash
---

# op_devbrowser

Control a real Chromium browser from the CLI. Scripts run via `dev-browser` against a persistent background daemon.

## When to Use

- Navigate to a URL and read/interact with its content
- Scrape headlines, prices, data from any site
- Fill forms, click buttons, automate web workflows
- Take screenshots for visual inspection
- Connect to the user's running Chrome instance

## Quick Start

```bash
dev-browser <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com");
console.log(await page.title());
EOF
```

Named pages (`"main"`, `"login"`, etc.) **persist between runs** — no need to re-navigate.

## Core Browser API

```js
browser.getPage("name")     // Get or create a named persistent page
browser.newPage()           // Anonymous page (cleaned up after script)
browser.listPages()         // All open tabs: [{id, url, title, name}]
browser.closePage("name")   // Close a named page
```

## Key Page Methods (Playwright)

```js
await page.goto("https://...")
await page.title()
await page.url()
await page.click("selector")
await page.fill("selector", "value")
await page.press("selector", "Enter")
await page.waitForSelector(".results")
await page.waitForURL("**/success")
await page.textContent("selector")
await page.evaluate(() => document.body.innerText)  // plain JS only
```

## AI Snapshot (element discovery)

```js
const result = await page.snapshotForAI();
console.log(result.full);
// Then use page.getByRole("button", { name: "Submit" }).click()
```

Use `snapshotForAI()` to discover elements on unknown pages. Skip it when you already know selectors.

## Screenshots & File I/O

```js
// Screenshot
const buf = await page.screenshot();
const path = await saveScreenshot(buf, "debug.png");
console.log(path);  // ~/.dev-browser/tmp/debug.png

// Write / read temp files
await writeFile("data.json", JSON.stringify(result));
const raw = await readFile("data.json");
```

## Sandbox Constraints

Scripts run in QuickJS — NOT Node.js:
- No `require()` / `import()`
- No `process`, `fs`, `path`, `fetch`
- No TypeScript syntax inside `page.evaluate()`

## Connect to Existing Chrome

```bash
# Auto-discover Chrome with --remote-debugging-port=9222
dev-browser --connect <<'EOF'
const tabs = await browser.listPages();
console.log(JSON.stringify(tabs, null, 2));
EOF

# Specific endpoint
dev-browser --connect http://localhost:9222 <<'EOF'
const page = await browser.getPage("TARGET_ID");
console.log(await page.title());
EOF
```

## CLI Reference

```bash
dev-browser run script.js          # Run a script file
dev-browser --headless <<'EOF'     # Headless mode
dev-browser --timeout 10 <<'EOF'   # Fail fast (default 30s)
dev-browser status                 # Daemon status
dev-browser browsers               # List browser instances
dev-browser stop                   # Stop daemon + all browsers
dev-browser install                # Install Playwright + Chromium
dev-browser install-skill          # Install skill into agent dirs
```

## Common Patterns

**Scrape data:**
```js
const page = await browser.getPage("scrape");
await page.goto("https://news.ycombinator.com");
const titles = await page.$$eval(".titleline > a", els => els.map(e => e.textContent));
console.log(JSON.stringify(titles));
```

**Error recovery:**
```js
const page = await browser.getPage("checkout");
const path = await saveScreenshot(await page.screenshot(), "debug.png");
console.log(JSON.stringify({ screenshot: path, url: page.url(), title: await page.title() }));
```

## Tips

- Use short `--timeout 10` so scripts fail fast instead of hanging
- Keep page names stable (`"login"`, `"results"`) — resume after failures
- One script = one action. Log state at end for the next decision.
- `--browser my-project` gives isolated browser state per project
