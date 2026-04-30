# Upgrade Guide

## Upgrading MyAIforOne Lite

### Automatic Upgrade (recommended)

Run:

```bash
npx myaiforone@latest
```

This will:
1. Detect your existing installation (`~/.myaiforone` on Mac/Linux, `%APPDATA%\MyAIforOneGateway` on Windows)
2. Back up your `config.json` (saved as `config.backup-<timestamp>.json`)
3. Merge any new config fields (your existing settings are never overwritten)
4. Update agent templates (your agents are never touched)
5. Update the version marker
6. Restart the service if it was running

Your data is always preserved:
- `config.json` — backed up, then merged (additive only)
- `agents/` — never modified
- `~/Desktop/MyAIforOne Drive Lite/` — never modified

### Force Upgrade

If auto-detection fails, force upgrade mode:

```bash
npx myaiforone@latest --upgrade
```

### Check Version

```bash
npx myaiforone@latest --version
```

---

## Upgrading from Lite to Full MyAIforOne

When you are ready to move to the full multi-agent platform, your agents and data carry over.

### Step 1: Install Full MyAIforOne

Follow the full MyAIforOne installation instructions (separate repo/installer).

### Step 2: Migrate Drive Data (Manual)

The Lite Drive lives at:
```
~/Desktop/MyAIforOne Drive Lite/
```

The full platform Drive lives at:
```
~/Desktop/MyAIforOne Drive/
```

Copy your agent data from Lite to Full:

**macOS / Linux:**
```bash
# Copy PersonalAgents
cp -R ~/Desktop/MyAIforOne\ Drive\ Lite/PersonalAgents/* \
      ~/Desktop/MyAIforOne\ Drive/PersonalAgents/

# Copy PersonalRegistry (if you have custom registry items)
cp -R ~/Desktop/MyAIforOne\ Drive\ Lite/PersonalRegistry/* \
      ~/Desktop/MyAIforOne\ Drive/PersonalRegistry/
```

**Windows (PowerShell):**
```powershell
# Copy PersonalAgents
Copy-Item -Recurse -Force "$env:USERPROFILE\Desktop\MyAIforOne Drive Lite\PersonalAgents\*" `
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalAgents\"

# Copy PersonalRegistry
Copy-Item -Recurse -Force "$env:USERPROFILE\Desktop\MyAIforOne Drive Lite\PersonalRegistry\*" `
  "$env:USERPROFILE\Desktop\MyAIforOne Drive\PersonalRegistry\"
```

### Step 3: Verify

1. Start the full MyAIforOne platform
2. Open the web UI — your agents should appear with their memory, skills, and conversation history intact
3. If everything looks good, you can optionally remove the Lite Drive folder:
   ```bash
   rm -rf ~/Desktop/MyAIforOne\ Drive\ Lite/
   ```

### What Carries Over

| Data | Location | Carries Over? |
|------|----------|---------------|
| Agent config (name, tools, MCPs) | `config.json` | Manual — re-create in full platform or copy agent entries |
| Agent memory | `Drive/PersonalAgents/<agent>/memory/` | Yes (copy step above) |
| Conversation logs | `Drive/PersonalAgents/<agent>/conversation_log.jsonl` | Yes |
| Agent CLAUDE.md | `Drive/PersonalAgents/<agent>/CLAUDE.md` | Yes |
| Agent skills | `Drive/PersonalAgents/<agent>/skills/` | Yes |
| MCP key files | `Drive/PersonalAgents/<agent>/keys/` | Yes |
| Custom registry | `Drive/PersonalRegistry/` | Yes |

### What Does NOT Carry Over

- **config.json** — The full platform has a different config structure with channels, org charts, boards, etc. You will need to recreate your agent entries in the full platform config (or use the web UI "Create Agent" flow).
- **Lite-specific settings** — Service config fields that only apply to Lite are ignored by the full platform.

### Migrating config.json Agent Entries

If you want to manually port agent definitions:

1. Open your Lite `config.json` (backed up at `~/.myaiforone/config.json`)
2. Open the full platform `config.json`
3. Copy each agent entry from `"agents": { ... }` into the full platform config
4. Update the `agentHome`, `claudeMd`, and `memoryDir` paths to point to the full Drive location:
   - Change `MyAIforOne Drive Lite` to `MyAIforOne Drive` in all paths
5. Restart the full platform

This is a one-time manual step. Once migrated, the full platform manages everything.
