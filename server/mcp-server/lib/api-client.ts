/**
 * MyAIforOne API Client
 * Wraps all REST API endpoints for use by MCP tools.
 */

// Read env vars lazily on each request so the in-process gateway can
// configure the MCP server's target URL + token AFTER module import.
function getBaseUrl(): string {
  return process.env.MYAGENT_API_URL || "http://localhost:4888";
}
function getApiToken(): string | undefined {
  return process.env.MYAGENT_API_TOKEN;
}

interface RequestOptions {
  method?: string;
  body?: any;
  query?: Record<string, string | number | undefined>;
}

async function api(path: string, opts: RequestOptions = {}): Promise<any> {
  let url = `${getBaseUrl()}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  const apiToken = getApiToken();
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Dashboard & Health ───────────────────────────────────────────
export const health = () => api("/health");
export const dashboard = () => api("/api/dashboard");
export const agentRegistry = () => api("/api/agent-registry");

// ─── Agents ───────────────────────────────────────────────────────
export const listAgents = (org?: string) => api("/api/agents", { query: { org } });
export const getAgent = (id: string) => api(`/api/agents/${id}`);
export const getAgentInstructions = (id: string) => api(`/api/agents/${id}/instructions`);
export const createAgent = (body: any) => api("/api/agents", { method: "POST", body });
export const updateAgent = (id: string, body: any) => api(`/api/agents/${id}`, { method: "PUT", body });
export const deleteAgent = (id: string, confirmAlias: string) =>
  api(`/api/agents/${id}`, { method: "DELETE", body: { confirmAlias } });
export const recoverAgent = (id: string, userText?: string, response?: string) =>
  api(`/api/agents/${id}/recover`, { method: "POST", body: { userText: userText || "Session recovery triggered via MCP tool", response } });

// ─── Chat ─────────────────────────────────────────────────────────
export const sendMessage = (agentId: string, text: string, accountOverride?: string) =>
  api(`/api/chat/${agentId}`, { method: "POST", body: { text, accountOverride } });
export const startStream = (agentId: string, text: string, accountOverride?: string) =>
  api(`/api/chat/${agentId}/stream`, { method: "POST", body: { text, accountOverride } });
export const stopJob = (jobId: string) => api(`/api/chat/jobs/${jobId}/stop`, { method: "POST" });
export const delegate = (agentId: string, text: string) =>
  api("/api/delegate", { method: "POST", body: { agentId, text } });

// ─── Sessions ─────────────────────────────────────────────────────
export const listSessions = (agentId: string) => api(`/api/agents/${agentId}/sessions`);
export const resetSession = (agentId: string, senderId?: string) =>
  api(`/api/agents/${agentId}/sessions/reset`, { method: "POST", body: { senderId } });
export const deleteSession = (agentId: string, senderId: string) =>
  api(`/api/agents/${agentId}/sessions/${senderId}`, { method: "DELETE" });

// ─── Named Session Tabs ────────────────────────────────────────────
export const createSessionTab = (agentId: string, tabId: string, label: string, targetAgentId?: string) =>
  api(`/api/agents/${agentId}/session-tabs`, { method: "POST", body: { tabId, label, ...(targetAgentId ? { targetAgentId } : {}) } });
export const listSessionTabs = (agentId: string) => api(`/api/agents/${agentId}/session-tabs`);
export const getSessionTabHistory = (agentId: string, tabId: string) =>
  api(`/api/agents/${agentId}/session-tabs/${tabId}/history`);
export const renameSessionTab = (agentId: string, tabId: string, label: string) =>
  api(`/api/agents/${agentId}/session-tabs/${tabId}`, { method: "PUT", body: { label } });
export const deleteSessionTab = (agentId: string, tabId: string) =>
  api(`/api/agents/${agentId}/session-tabs/${tabId}`, { method: "DELETE" });

// ─── Model ────────────────────────────────────────────────────────
export const getModel = (agentId: string) => api(`/api/agents/${agentId}/model`);
export const setModel = (agentId: string, model: string) =>
  api(`/api/agents/${agentId}/model`, { method: "PUT", body: { model } });
export const clearModel = (agentId: string) =>
  api(`/api/agents/${agentId}/model`, { method: "DELETE" });

// ─── Cost ─────────────────────────────────────────────────────────
export const getAgentCost = (agentId: string) => api(`/api/agents/${agentId}/cost`);
export const getAllCosts = () => api("/api/cost/all");

// ─── Skills ───────────────────────────────────────────────────────
export const getAgentSkills = (agentId: string) => api(`/api/agents/${agentId}/skills`);
export const getOrgSkills = (orgName: string) => api(`/api/skills/org/${orgName}`);

// ─── Tasks ────────────────────────────────────────────────────────
export const listTasks = (agentId: string) => api(`/api/agents/${agentId}/tasks`);
export const taskStats = (agentId: string) => api(`/api/agents/${agentId}/tasks/stats`);
export const createTask = (agentId: string, body: any) =>
  api(`/api/agents/${agentId}/tasks`, { method: "POST", body });
export const updateTask = (agentId: string, taskId: string, body: any) =>
  api(`/api/agents/${agentId}/tasks/${taskId}`, { method: "PUT", body });
export const deleteTask = (agentId: string, taskId: string) =>
  api(`/api/agents/${agentId}/tasks/${taskId}`, { method: "DELETE" });
export const allTasks = () => api("/api/tasks/all");

// ─── Automations ──────────────────────────────────────────────────
export const listAutomations = () => api("/api/automations");
export const createGoal = (agentId: string, body: any) =>
  api(`/api/agents/${agentId}/goals`, { method: "POST", body });
export const toggleGoal = (agentId: string, goalId: string) =>
  api(`/api/agents/${agentId}/goals/${goalId}/toggle`, { method: "POST" });
export const triggerGoal = (agentId: string, goalId: string) =>
  api(`/api/agents/${agentId}/goals/${goalId}/trigger`, { method: "POST" });
export const goalHistory = (agentId: string, goalId: string) =>
  api(`/api/agents/${agentId}/goals/${goalId}/history`);
export const deleteGoal = (agentId: string, goalId: string) =>
  api(`/api/agents/${agentId}/goals/${goalId}`, { method: "DELETE" });
export const createCron = (agentId: string, body: any) =>
  api(`/api/agents/${agentId}/cron`, { method: "POST", body });
export const toggleCron = (agentId: string, index: number) =>
  api(`/api/agents/${agentId}/cron/${index}/toggle`, { method: "POST" });
export const triggerCron = (agentId: string, index: number) =>
  api(`/api/agents/${agentId}/cron/${index}/trigger`, { method: "POST" });
export const cronHistory = (agentId: string, index: number) =>
  api(`/api/agents/${agentId}/cron/${index}/history`);
export const deleteCron = (agentId: string, index: number) =>
  api(`/api/agents/${agentId}/cron/${index}`, { method: "DELETE" });

// ─── MCPs ─────────────────────────────────────────────────────────
export const listMcps = () => api("/api/mcps");
export const mcpCatalog = () => api("/api/mcp-catalog");
export const listMcpKeys = (agentId: string) => api(`/api/agents/${agentId}/mcp-keys`);
export const saveMcpKey = (agentId: string, mcpName: string, envVar: string, value: string) =>
  api(`/api/agents/${agentId}/mcp-keys`, { method: "POST", body: { mcpName, envVar, value } });
export const deleteMcpKey = (agentId: string, mcpName: string) =>
  api(`/api/agents/${agentId}/mcp-keys/${mcpName}`, { method: "DELETE" });
export const listMcpConnections = (agentId: string) => api(`/api/agents/${agentId}/mcp-connections`);
export const createMcpConnection = (agentId: string, body: any) =>
  api(`/api/agents/${agentId}/mcp-connections`, { method: "POST", body });
export const deleteMcpConnection = (agentId: string, instanceName: string) =>
  api(`/api/agents/${agentId}/mcp-connections/${instanceName}`, { method: "DELETE" });

// ─── Channels ─────────────────────────────────────────────────────
export const listChannels = () => api("/api/channels");
export const updateChannel = (name: string, body: any) =>
  api(`/api/channels/${name}`, { method: "PUT", body });
export const setChannelCredentials = (name: string, credentials: any) =>
  api(`/api/channels/${name}/credentials`, { method: "POST", body: credentials });
export const addAgentRoute = (channelName: string, body: any) =>
  api(`/api/channels/${channelName}/agents`, { method: "POST", body });
export const removeAgentRoute = (channelName: string, agentId: string) =>
  api(`/api/channels/${channelName}/agents/${agentId}`, { method: "DELETE" });
export const stickyRouting = () => api("/api/sticky-routing");

// ─── Registry / Marketplace ───────────────────────────────────────
export const marketplace = (type: string) => api(`/api/marketplace/${type}`);
export const installMarketplace = (id: string, type: string) =>
  api("/api/marketplace/install", { method: "POST", body: { id, type } });
export const assignToAgent = (agentId: string, itemId: string, type: string) =>
  api("/api/marketplace/assign", { method: "POST", body: { agentIds: [agentId], id: itemId, type } });

// ─── Apps ─────────────────────────────────────────────────────────
export const listApps = () => api("/api/apps");
export const createApp = (body: any) => api("/api/apps", { method: "POST", body });
export const updateApp = (id: string, body: any) => api(`/api/apps/${id}`, { method: "PUT", body });
export const deleteApp = (id: string) => api(`/api/apps/${id}`, { method: "DELETE" });

// ─── Activity & Logs ──────────────────────────────────────────────
export const activity = (limit?: number) => api("/api/activity", { query: { limit } });
export const agentLogs = (agentId: string, limit?: number, offset?: number, search?: string, sender?: string) =>
  api(`/api/agents/${agentId}/logs`, { query: { limit, offset, search, sender } });

// ─── Memory ───────────────────────────────────────────────────────
export const agentMemory = (agentId: string, limit?: number) =>
  api(`/api/agents/${agentId}/memory`, { query: { limit } });
export const searchMemory = (agentId: string, query: string) =>
  api(`/api/agents/${agentId}/memory/search`, { method: "POST", body: { query } });
export const clearMemoryContext = (agentId: string) =>
  api(`/api/agents/${agentId}/memory/context`, { method: "DELETE" });

// ─── Pairing ──────────────────────────────────────────────────────
export const listPairing = () => api("/api/pairing");
export const pairSender = (senderKey: string) =>
  api("/api/pairing", { method: "POST", body: { senderKey } });
export const unpairSender = (senderKey: string) =>
  api(`/api/pairing/${encodeURIComponent(senderKey)}`, { method: "DELETE" });

// ─── Config ───────────────────────────────────────────────────────
export const listAccounts = () => api("/api/config/accounts");
export const addAccount = (name: string, path: string) =>
  api("/api/config/accounts", { method: "POST", body: { name, path } });
export const deleteAccount = (name: string) =>
  api(`/api/config/accounts/${encodeURIComponent(name)}`, { method: "DELETE" });
export const accountStatus = (name: string) =>
  api(`/api/config/accounts/${encodeURIComponent(name)}/status`);
export const getServiceConfig = () => api("/api/config/service");
export const updateServiceConfig = (body: any) =>
  api("/api/config/service", { method: "PUT", body });
export const testProvider = (provider: string) =>
  api("/api/config/provider-test", { method: "POST", body: { provider } });

// ─── Voice (TTS / STT) ──────────────────────────────────────────────
export const getVoiceConfig = () => api("/api/voice-config");
export const listVoices = (provider?: string, agentId?: string) =>
  api("/api/voices", { query: { provider, agentId } });
/**
 * Generate TTS audio. Returns a base64-encoded data URL on success when audio
 * is produced server-side, or `{ clientSide: true, ... }` for the browser
 * provider. Used by the `test_voice` MCP tool.
 */
export async function ttsTest(text: string, providerOverride?: string, voiceOverride?: string, agentId?: string): Promise<any> {
  const url = `${getBaseUrl()}/api/tts`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiToken = getApiToken();
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, providerOverride, voiceOverride, agentId }),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    const errText = await res.text();
    try { return { ok: false, error: JSON.parse(errText).error || errText }; }
    catch { return { ok: false, error: errText }; }
  }
  if (ct.includes("application/json")) {
    return { ok: true, ...(await res.json()) };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    bytes: buf.length,
    contentType: ct,
    provider: res.headers.get("X-Voice-Provider") || undefined,
    voiceId: res.headers.get("X-Voice-Voice-Id") || undefined,
    characters: Number(res.headers.get("X-Voice-Characters") || 0) || undefined,
    audioBase64: buf.toString("base64"),
  };
}

// ─── Profile ────────────────────────────────────────────────────────
export const getProfile = () => api("/api/profile");
export const updateProfile = (body: any) => api("/api/profile", { method: "PUT", body });

// ─── Files ────────────────────────────────────────────────────────
export const listFiles = (agentId: string) => api(`/api/agents/${agentId}/files`);
export const downloadFile = (agentId: string, path: string) =>
  api(`/api/agents/${agentId}/download`, { query: { path } });

// ─── Additional ──────────────────────────────────────────────────
export const createProject = (agentId: string, name: string) =>
  api(`/api/agents/${agentId}/projects`, { method: "POST", body: { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name } });

// ─── Projects (cross-agent initiatives) ─────────────────────────
export const listProjects = () => api("/api/projects");
export const getProject = (id: string) => api(`/api/projects/${id}`);
export const createInitiative = (body: any) =>
  api("/api/projects", { method: "POST", body });
export const updateProject = (id: string, body: any) =>
  api(`/api/projects/${id}`, { method: "PUT", body });
export const deleteProject = (id: string) =>
  api(`/api/projects/${id}`, { method: "DELETE" });
export const linkToProject = (id: string, type: string, value: any) =>
  api(`/api/projects/${id}/link`, { method: "POST", body: { type, value } });
export const unlinkFromProject = (id: string, type: string, value: any) =>
  api(`/api/projects/${id}/unlink`, { method: "POST", body: { type, value } });
export const getProjectStatus = (id: string) => api(`/api/projects/${id}/status`);
export const executeProject = (id: string, body?: any) =>
  api(`/api/projects/${id}/execute`, { method: "POST", body: body || {} });
export const pauseProject = (id: string) =>
  api(`/api/projects/${id}/pause`, { method: "POST" });
// ─── Boards (glanceable widget surfaces) ─────────────────────────
export const listBoards = () => api("/api/boards");
export const getBoard = (id: string) => api(`/api/boards/${id}`);
export const createBoard = (body: any) =>
  api("/api/boards", { method: "POST", body });
export const updateBoard = (id: string, body: any) =>
  api(`/api/boards/${id}`, { method: "PUT", body });
export const deleteBoard = (id: string) =>
  api(`/api/boards/${id}`, { method: "DELETE" });
export const addBoardWidget = (id: string, body: any) =>
  api(`/api/boards/${id}/widgets`, { method: "POST", body });
export const removeBoardWidget = (id: string, agentId: string) =>
  api(`/api/boards/${id}/widgets/${agentId}`, { method: "DELETE" });
export const removeBoardWidgetByIndex = (id: string, index: number) =>
  api(`/api/boards/${id}/widgets/${index}?byIndex=true`, { method: "DELETE" });
export const refreshBoard = (id: string) =>
  api(`/api/boards/${id}/refresh`, { method: "POST" });
export const addMonitoredChat = (channelName: string, chatId: string) =>
  api(`/api/channels/${channelName}/monitored`, { method: "POST", body: { chatId: Number(chatId) } });
export const removeMonitoredChat = (channelName: string, chatId: string) =>
  api(`/api/channels/${channelName}/monitored`, { method: "DELETE", body: { chatId: Number(chatId) } });
export const scanSkills = (dir?: string) =>
  api("/api/marketplace/scan-skills", { query: { dir } });
export const createPrompt = (id: string, name: string, content: string) =>
  api("/api/marketplace/create-prompt", { method: "POST", body: { id, name, content } });
export const createSkill = (id: string, name: string, description: string, content: string, scope: string, orgName?: string, agentId?: string) =>
  api("/api/skills/create", { method: "POST", body: { id, name, description, content, scope, orgName, agentId } });
export const addMcpToRegistry = (body: any) =>
  api("/api/marketplace/add-mcp", { method: "POST", body });
export const checkAppHealth = (id: string) =>
  api(`/api/apps/${id}/check-health`, { method: "POST" });
export const startLogin = (name: string, path: string) =>
  api("/api/config/accounts/login", { method: "POST", body: { name, path } });

// ─── Login ───────────────────────────────────────────────────────
export const submitLoginCode = (accountName: string, code: string) =>
  api("/api/config/accounts/login/code", { method: "POST", body: { accountName, code } });

// ─── Marketplace Extras ─────────────────────────────────────────
export const setPlatformDefault = (type: string, id: string) =>
  api("/api/marketplace/platform-default", { method: "POST", body: { type, id } });
export const importSkills = (agentId: string, skills: string[]) =>
  api("/api/marketplace/import-skills", { method: "POST", body: { agentId, skills } });
export const getPromptTrigger = () => api("/api/marketplace/prompt-trigger");
export const setPromptTrigger = (trigger: string) =>
  api("/api/marketplace/prompt-trigger", { method: "POST", body: { trigger } });

// ─── Chat Streaming ─────────────────────────────────────────────
export const getChatJobRaw = (jobId: string, after?: number) =>
  api(`/api/chat/jobs/${jobId}/raw`, { query: { after } });

// ─── Heartbeat ──────────────────────────────────────────────────
export const triggerHeartbeat = (agentId: string, triggeredBy?: string) =>
  api(`/api/agents/${agentId}/heartbeat`, { method: "POST", body: { triggeredBy } });
export const heartbeatHistory = (agentId: string, limit?: number) =>
  api(`/api/agents/${agentId}/heartbeat-history`, { query: { limit } });

// ─── Wiki Sync ──────────────────────────────────────────────────
export const triggerWikiSync = (agentId: string, triggeredBy?: string) =>
  api(`/api/agents/${agentId}/wiki-sync`, { method: "POST", body: { triggeredBy } });
export const wikiSyncHistory = (agentId: string, limit?: number) =>
  api(`/api/agents/${agentId}/wiki-sync-history`, { query: { limit } });

// ─── Whoami ─────────────────────────────────────────────────────
export const whoami = (agentId: string) => api(`/api/whoami/${agentId}`);

// ─── Changelog ──────────────────────────────────────────────────
export const changelog = () => api("/api/changelog");

// ─── Webhook ────────────────────────────────────────────────────
export const sendWebhook = (agentId: string, text: string, secret?: string, channel?: string, chatId?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-webhook-secret"] = secret;
  return api(`/webhook/${agentId}`, { method: "POST", body: { text, channel, chatId } });
};

// ─── Install xbar ───────────────────────────────────────────────
export const installXbar = () => api("/api/install-xbar", { method: "POST" });

// ─── Lab / Platform Agents ───────────────────────────────────────
export const getPlatformAgents = () => api("/api/platform-agents");
export const browseDirs = (path?: string) => api("/api/browse-dirs", { query: { path } });

// ─── SaaS Integration ───────────────────────────────────────────
export const getSaasConfig = () => api("/api/saas/config");
export const updateSaasConfig = (baseUrl?: string, apiKey?: string) =>
  api("/api/saas/config", { method: "PUT", body: { baseUrl, apiKey } });
export const testSaasConnection = (baseUrl?: string, apiKey?: string) =>
  api("/api/saas/test", { method: "POST", body: { baseUrl, apiKey } });
export const publishToSaas = (type: string, id: string, destination?: string) =>
  api("/api/saas/publish", { method: "POST", body: { type, id, destination } });

// ─── File Upload ────────────────────────────────────────────────
export const uploadFile = (agentId: string, fileName: string, base64Content: string, mode?: string) =>
  api(`/api/upload/${agentId}/json`, { method: "POST", body: { fileName, base64Content, mode } });

// ─── User Guide ─────────────────────────────────────────────────
export const getUserGuide = () => api("/api/user-guide");

// ─── Memory Write ───────────────────────────────────────────────
export const writeMemory = (agentId: string, content: string, target?: string) =>
  api(`/api/agents/${agentId}/memory/write`, { method: "POST", body: { content, target } });

// ─── Skill Content ──────────────────────────────────────────────
export const getSkillContent = (path: string) =>
  api("/api/skills/content", { query: { path } });

// ─── Goal/Cron Update ───────────────────────────────────────────
export const updateGoal = (agentId: string, goalId: string, body: any) =>
  api(`/api/agents/${agentId}/goals/${goalId}`, { method: "PUT", body });
export const updateCron = (agentId: string, index: number, body: any) =>
  api(`/api/agents/${agentId}/cron/${index}`, { method: "PUT", body });

// ─── Service Restart ────────────────────────────────────────────
export const restart = () => api("/api/restart", { method: "POST" });

// ─── Discovery ──────────────────────────────────────────────────
export const listCapabilities = () => api("/api/capabilities");

// ─── Drive ──────────────────────────────────────────────────────
export const browseDrive = (path?: string) => api("/api/drive/browse", { query: { path } });
export const readDriveFile = (path: string) => api("/api/drive/read", { query: { path } });
export const searchDrive = (q: string, path?: string, limit?: number, types?: string) =>
  api("/api/drive/search", { query: { q, path, limit, types } });

// ─── API Keys (named bearer tokens for this gateway) ───────────
export const listApiKeys = () => api("/api/auth/keys");
export const createApiKey = (name: string) =>
  api("/api/auth/keys", { method: "POST", body: { name } });
export const deleteApiKey = (id: string) =>
  api(`/api/auth/keys/${encodeURIComponent(id)}`, { method: "DELETE" });

// ─── Team Gateways (remote MyAIforOne deployments wired as MCPs) ─
export const listTeamGateways = () => api("/api/team-gateways");
export const testTeamGateway = (url: string, apiKey: string) =>
  api("/api/team-gateways/test", { method: "POST", body: { url, apiKey } });
export const createTeamGateway = (name: string, url: string, apiKey: string) =>
  api("/api/team-gateways", { method: "POST", body: { name, url, apiKey } });
export const resyncTeamGateway = (id: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}/resync`, { method: "POST" });
export const deleteTeamGateway = (id: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getTeamGateway = (id: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}`);
export const renameTeamGateway = (id: string, name: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
export const rotateTeamGatewayKey = (id: string, apiKey: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}/rotate-key`, { method: "POST", body: { apiKey } });
export const attachTeamGateway = (id: string, agentId: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}/attach`, { method: "POST", body: { agentId } });
export const detachTeamGateway = (id: string, agentId: string) =>
  api(`/api/team-gateways/${encodeURIComponent(id)}/detach`, { method: "POST", body: { agentId } });

// ─── Gym ─────────────────────────────────────────────────────────
export const getGymLearnerProfile = () => api("/api/gym/learner-profile");
export const updateGymLearnerProfile = (body: any) => api("/api/gym/learner-profile", { method: "PUT", body });
export const getGymPlan = () => api("/api/gym/plan");
export const updateGymPlan = (body: any) => api("/api/gym/plan", { method: "PUT", body });
export const getGymProgress = () => api("/api/gym/progress");
export const updateGymProgress = (body: any) => api("/api/gym/progress", { method: "PUT", body });
export const listGymCards = () => api("/api/gym/cards");
export const createGymCard = (body: any) => api("/api/gym/cards", { method: "POST", body });
export const dismissGymCard = (id: string) => api(`/api/gym/cards/${id}`, { method: "DELETE" });
export const snapshotDimensions = (body: any) => api("/api/gym/dimensions/snapshot", { method: "POST", body });
export const listGymPrograms = () => api("/api/gym/programs");
export const getGymProgram = (slug: string) => api(`/api/gym/programs/${slug}`);
export const createGymProgram = (body: any) => api("/api/gym/programs", { method: "POST", body });
export const importGymProgram = (body: any) => api("/api/gym/programs/import-markdown", { method: "POST", body });
export const updateGymProgram = (slug: string, body: any) => api(`/api/gym/programs/${slug}`, { method: "PATCH", body });
export const deleteGymProgram = (slug: string) => api(`/api/gym/programs/${slug}`, { method: "DELETE" });
export const getGymDimensionHistory = () => api("/api/gym/dimensions/history");
export const runGymDigest = () => api("/api/gym/digest/run", { method: "POST" });
export const getAgentActivitySummary = (id: string) => api(`/api/agents/${id}/activity-summary`);
export const searchAgentLogs = (q: string, agentIds?: string) => api("/api/agents/logs/search", { query: { q, agentIds } });
export const getGymFeed = () => api("/api/gym/feed");
export const getGymConfig = () => api("/api/gym/config");
export const listGymGuides = () => api("/api/gym/guides");
export const createGymGuide = (data: Record<string, unknown>) => api("/api/gym/guides", { method: "POST", body: data });
export const getGymInsights = () => api("/api/gym/insights");
export const saveGymInsights = (data: Record<string, unknown>) => api("/api/gym/insights", { method: "POST", body: data });

// Gym Projects & Series
export const listGymProjects = () => api("/api/gym/projects");
export const getGymProject = (slug: string) => api(`/api/gym/projects/${slug}`);
export const createGymProject = (body: any) => api("/api/gym/projects", { method: "POST", body });
export const updateGymProject = (slug: string, body: any) => api(`/api/gym/projects/${slug}`, { method: "PATCH", body });
export const deleteGymProject = (slug: string) => api(`/api/gym/projects/${slug}`, { method: "DELETE" });
export const listGymSeries = (projectSlug: string) => api(`/api/gym/projects/${projectSlug}/series`);
export const getGymSeries = (projectSlug: string, seriesSlug: string) => api(`/api/gym/projects/${projectSlug}/series/${seriesSlug}`);
export const createGymSeries = (projectSlug: string, body: any) => api(`/api/gym/projects/${projectSlug}/series`, { method: "POST", body });
export const updateGymSeries = (projectSlug: string, seriesSlug: string, body: any) => api(`/api/gym/projects/${projectSlug}/series/${seriesSlug}`, { method: "PATCH", body });
export const deleteGymSeries = (projectSlug: string, seriesSlug: string) => api(`/api/gym/projects/${projectSlug}/series/${seriesSlug}`, { method: "DELETE" });
export const importFromAigym = (body: any) => api("/api/gym/import-from-aigym", { method: "POST", body });

// Enrollment & Certificates
export const enrollGymProgram = (slug: string) => api(`/api/gym/enroll/${slug}`, { method: "POST" });
export const unenrollGymProgram = (slug: string) => api(`/api/gym/enroll/${slug}`, { method: "DELETE" });
export const listGymEnrollments = (status?: string) => api(`/api/gym/enrollments${status ? `?status=${status}` : ''}`);
export const completeGymProgram = (slug: string) => api(`/api/gym/programs/${slug}/complete`, { method: "POST" });
export const submitGymQuiz = (slug: string, body: { answers: number[]; score: number; passed: boolean }) => api(`/api/gym/programs/${slug}/submit-quiz`, { method: "POST", body });
export const getGymCertificate = (slug: string) => api(`/api/gym/certificate/${slug}`);

// ─── Agent Templates ─────────────────────────────────────────────
export const listTemplates = (category?: string) => api("/api/templates", { query: { category } });
export const getTemplate = (id: string) => api(`/api/templates/${id}`);
export const createTemplate = (body: any) => api("/api/templates", { method: "POST", body });
export const updateTemplate = (id: string, body: any) => api(`/api/templates/${id}`, { method: "PUT", body });
export const deleteTemplate = (id: string) => api(`/api/templates/${id}`, { method: "DELETE" });
export const personalizeTemplate = (id: string, body: any) => api(`/api/templates/${id}/personalize`, { method: "POST", body });
export const deployTemplate = (id: string, body: any) => api(`/api/templates/${id}/deploy`, { method: "POST", body });
export const saveAgentAsTemplate = (agentId: string, body: any) =>
  api(`/api/agents/${agentId}/save-as-template`, { method: "POST", body });
