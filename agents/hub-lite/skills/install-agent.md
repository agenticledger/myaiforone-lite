---
description: Install an agent from the MyAIforOne registry into the local app
---

# Install Agent from Registry

When the user asks to install an agent, follow this procedure.

## Step 1: Browse & Confirm

Use `browse_agent_registry` to find the agent. Then use `get_agent_detail` to get full details. Confirm with the user before installing.

## Step 2: Install

Use the `install_agent` tool with:
- `registryId`: the agent's registry ID

This handles everything: fetches the agent package from the remote registry, copies files to the Drive folder, registers in config, and makes the agent appear in the sidebar immediately.

## Step 3: Confirm Success

Tell the user:

1. The agent is installed and ready — they can select it from the sidebar
2. Its mention alias is `@<agent-id>`
3. Any MCP keys or API credentials it needs (check `requiredMcpKeys` from the result)
4. Suggest what to ask it first

## Important

- NEVER write agent files manually to disk
- NEVER tell the user to "open a Claude Code session from" a directory
- ALWAYS use `install_agent` — it handles file creation, config registration, and sidebar visibility
- All tools (`browse_agent_registry`, `get_agent_detail`, `install_agent`) come from the `myaiforone-lite` MCP
