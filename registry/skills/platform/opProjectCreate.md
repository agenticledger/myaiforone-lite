---
name: opProjectCreate
description: >-
  Create and execute a cross-agent project from a high-level description. Dialogues to refine scope, breaks down into tasks, creates the project entity with linked agents/artifacts, and optionally kicks off autonomous background execution. Use when a user says "build me a project for X" or "I want to start a new initiative".
allowed-tools: Read Write Edit Glob Grep Bash
---

# Project Create & Execute

Take a high-level objective from the user, plan it, create the project, and optionally execute it autonomously.

**Arguments:** User message describes what they want to achieve. Extract the objective, scope, and any specific requirements.

If no description provided, ask: "What do you want this project to achieve?"

---

## Phase 1: Understand & Plan

### Step 1: Extract the Objective

From the user's description, identify:
- **Project name** — short, descriptive
- **Description** — 1-2 sentence summary of what this project achieves
- **Deliverables** — what artifacts, agents, apps, content, or infrastructure will be created
- **Owner agent** — who owns this project (default: the agent running this skill)
- **Team members** — other agents that will participate

### Step 2: Break Down into Tasks

Create a task list. Each task should be:
- **Actionable** — clear what "done" looks like
- **Ordered** — dependencies respected (can't deploy before building)
- **Assigned** — which agent will do this task
- **Sized** — no task should be bigger than a single agent session

Categories to consider for every project:
- **Build tasks** — create the actual thing (website, app, content, agents)
- **Platform tasks** — create agents, orgs, register apps
- **Marketing tasks** — LinkedIn posts, outreach messages, PDFs
- **Deployment tasks** — Railway, domain setup, DNS
- **Review task** — final checklist verification (always include this as the last task)

### Step 3: Identify Credentials Needed

Check if the project will need:
- GitHub token (for repo creation/push)
- Railway token (for deployment)
- Namecheap credentials (for domain registration)
- Resend API key (for email/contact forms)
- LinkedIn MCP (for posting)
- Any other API keys or tokens

### Step 4: Present the Plan

Show the user:
```
## Project: {name}

**Description:** {description}
**Owner:** {agent}
**Team:** {agents}

### Tasks:
1. {task 1} — {agent} — {priority}
2. {task 2} — {agent} — {priority}
...
N. Project review — verify all deliverables — high

### Credentials Needed:
- {credential 1}: {what for}
- {credential 2}: {what for}

### Shall I create this project and start executing?
```

Wait for user approval before proceeding.

---

## Phase 2: Create the Project

Once approved, execute in this order:

### Step 5: Create the Project Entity

Use the `create_initiative` MCP tool:
```
create_initiative(
  name: "{project name}",
  description: "{description}",
  owner: "{owner agent ID}",
  teamMembers: ["{agent1}", "{agent2}"],
  plan: "{markdown plan with all tasks as checkboxes}",
  notes: "{any context, references, or notes from the conversation}"
)
```

Save the returned `projectId`.

### Step 6: Create Tasks

For each task, use `create_task`:
```
create_task(
  agentId: "{assigned agent}",
  title: "{task title}",
  description: "{detailed description}",
  priority: "{high|medium|low}",
  project: "{project-slug}"  // per-agent task board grouping
)
```

Save each `taskId`.

### Step 7: Link Tasks to Project

For each task, use `link_to_project`:
```
link_to_project(
  projectId: "{projectId}",
  type: "task",
  value: { agentId: "{agent}", taskId: "{taskId}" }
)
```

### Step 8: Link Agents to Project

For each team member agent:
```
link_to_project(
  projectId: "{projectId}",
  type: "agent",
  value: "{agentId}"
)
```

### Step 9: Save Credentials

If credentials were provided, write them to the project's credentials file:
```
Path: PersonalAgents/projects/{projectId}/credentials.json
```

Write only the credentials relevant to this project. Format:
```json
{
  "github_token": "ghp_...",
  "railway_token": "...",
  "resend_api_key": "re_..."
}
```

### Step 10: Save Context

Write any reference notes, design decisions, or links to:
```
Path: PersonalAgents/projects/{projectId}/context.md
```

Use `update_project` with the `notes` field to update context.

---

## Phase 3: Execute (Optional)

### Step 11: Ask About Execution

Ask the user:
```
Project "{name}" is set up with {N} tasks. How would you like to proceed?

1. **Execute now** — I'll work through all tasks in this conversation
2. **Execute in background** — I'll set up autonomous execution (runs on a schedule, notifies you when done or blocked)
3. **Manual** — You'll direct me task by task
```

### If "Execute now" (Option 1):
Work through tasks sequentially in the conversation. For each task:
1. Update status to `in_progress` via `update_task`
2. Execute the task
3. Update status to `done` via `update_task`
4. If blocked, update to `blocked` and explain why
5. Move to the next task

### If "Execute in background" (Option 2):
Use `execute_project` MCP tool:
```
execute_project(
  projectId: "{projectId}",
  schedule: "*/15 * * * *",  // or ask user preference
  reportTo: "slack:{owner's slack channel}"
)
```

Report to the user:
```
Project is now executing autonomously.
- Schedule: every 15 minutes
- Notifications: {channel}
- To check status: ask me "what's the status of {project name}?"
- To pause: ask me to pause the project
```

### If "Manual" (Option 3):
Report the project is ready and wait for the user to direct.

---

## Phase 4: Review

### Step 12: Final Checklist

When all tasks are done (or user asks for status), run through the review task checklist:
- Verify each deliverable exists
- Verify deployments are live
- Verify agents are created and connected
- Verify artifacts are linked to the project
- Report pass/fail for each item

Use `get_project_status` to pull the current rollup.

---

## Quick Reference: MCP Tools Used

| Tool | When |
|------|------|
| `create_initiative` | Create the project entity |
| `create_task` | Create each task |
| `link_to_project` | Link tasks, agents, orgs, apps, artifacts |
| `update_task` | Update task status during execution |
| `update_project` | Update project status, plan, notes |
| `get_project_status` | Check progress |
| `execute_project` | Start autonomous background execution |
| `pause_project` | Pause autonomous execution |
| `create_agent` | Create agents needed by the project |
| `add_agent_route` | Connect agents to channels |
| `create_project` | Create per-agent task board grouping |
