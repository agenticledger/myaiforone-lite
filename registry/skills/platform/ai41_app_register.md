---
name: ai41_app_register
description: >-
  Register a deployed app in the MyAIforOne platform and create a developer agent for ongoing maintenance. Called by ai41_app_orchestrator Phase 7.
allowed-tools: Read
---

# App Register

Register the deployed app in the platform and create a developer agent. Uses MCP tools — no manual file editing.

## Step 1: Register the App

Use the `create_app` MCP tool with:

```json
{
  "name": "{APP_NAME}",
  "url": "{DEPLOY_URL}",
  "category": "{CATEGORY}",
  "githubRepo": "{GITHUB_REPO_URL}",
  "provider": "me"
}
```

Categories: `finance`, `productivity`, `engineering`, `operations`, `infrastructure`, `devtools`, `communication`, `analytics`

Choose the category that best matches the app's purpose.

## Step 2: Create a Developer Agent

Use the `create_agent` MCP tool with:

```json
{
  "agentId": "{APP_SLUG}-dev",
  "name": "{APP_NAME} Developer",
  "alias": "@{APP_SLUG}-dev",
  "description": "Develops and maintains {APP_NAME}",
  "workspace": "{PROJECT_DIR}",
  "persistent": true,
  "streaming": true,
  "advancedMemory": true,
  "tools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  "mcps": ["github", "myaiforone"],
  "heartbeatInstructions": "Check the GitHub repo for open issues. Check Railway deployment health at {DEPLOY_URL}/api/health. If anything needs fixing, fix it, commit, and push to trigger a redeploy."
}
```

The developer agent:
- Has the app's workspace as its working directory
- Has GitHub MCP for repo management
- Has MyAIforOne MCP for platform operations
- Has a heartbeat that monitors the app's health

## Step 3: Update App with Developer Agent

Use the `update_app` MCP tool to set the `agentDeveloper` field:

```json
{
  "id": "{APP_SLUG}",
  "status": "live"
}
```

## Step 4: Final Report

Tell the user:

```
Your app is live!

App: {APP_NAME}
URL: {DEPLOY_URL}
GitHub: {GITHUB_REPO_URL}
Status: live (visible in Registry)

Developer agent created:
- Agent: {APP_NAME} Developer (@{APP_SLUG}-dev)
- Workspace: {PROJECT_DIR}
- Heartbeat: monitors health and GitHub issues

To make changes, chat with @{APP_SLUG}-dev or edit the code directly in the workspace.
```
