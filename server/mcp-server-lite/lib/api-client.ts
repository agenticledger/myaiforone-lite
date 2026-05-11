/**
 * MyAIforOne Lite — API Client
 * Wraps the subset of REST API endpoints needed by the Lite MCP server.
 */

function getBaseUrl(): string {
  return process.env.MYAGENT_API_URL || "http://localhost:4889";
}
function getApiToken(): string | undefined {
  return process.env.MYAGENT_API_TOKEN;
}

/** Remote Agent Registry base URL */
function getRegistryUrl(): string {
  return process.env.MYAGENT_REGISTRY_URL || "https://myaiforone.com";
}

interface RequestOptions {
  method?: string;
  body?: any;
  query?: Record<string, string | number | undefined>;
  baseUrl?: string;
}

async function api(path: string, opts: RequestOptions = {}): Promise<any> {
  const base = opts.baseUrl || getBaseUrl();
  let url = `${base}${path}`;
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
  // Only attach auth for local gateway calls (not registry calls)
  if (!opts.baseUrl) {
    const apiToken = getApiToken();
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  }

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

// ─── Agents ───────────────────────────────────────────────────────
export const listAgents = (org?: string) => api("/api/agents", { query: { org } });
export const getAgent = (id: string) => api(`/api/agents/${id}`);
export const getAgentInstructions = (id: string) => api(`/api/agents/${id}/instructions`);
export const createAgent = (body: any) => api("/api/agents", { method: "POST", body });
export const updateAgent = (id: string, body: any) => api(`/api/agents/${id}`, { method: "PUT", body });
export const deleteAgent = (id: string, confirmAlias: string) =>
  api(`/api/agents/${id}`, { method: "DELETE", body: { confirmAlias } });

// ─── Chat ─────────────────────────────────────────────────────────
export const sendMessage = (agentId: string, text: string) =>
  api(`/api/chat/${agentId}`, { method: "POST", body: { text } });
export const startStream = (agentId: string, text: string) =>
  api(`/api/chat/${agentId}/stream`, { method: "POST", body: { text } });
export const getChatJobRaw = (jobId: string, after?: number) =>
  api(`/api/chat/jobs/${jobId}/raw`, { query: { after } });
export const stopJob = (jobId: string) =>
  api(`/api/chat/jobs/${jobId}/stop`, { method: "POST" });

// ─── Sessions ─────────────────────────────────────────────────────
export const resetSession = (agentId: string) =>
  api(`/api/agents/${agentId}/sessions/reset`, { method: "POST" });

// ─── MCPs ─────────────────────────────────────────────────────────
export const listMcps = () => api("/api/mcps");
export const saveMcpKey = (agentId: string, mcpName: string, envVar: string, value: string) =>
  api(`/api/agents/${agentId}/mcp-keys`, { method: "POST", body: { mcpName, envVar, value } });

// ─── Marketplace ─────────────────────────────────────────────────
export const marketplace = (type: string, source?: string) =>
  api(`/api/marketplace/${type}`, { query: { source } });
export const assignToAgents = (type: string, id: string, agentIds: string[]) =>
  api("/api/marketplace/assign", { method: "POST", body: { type, id, agentIds } });
export const createSkill = (body: any) =>
  api("/api/skills/create", { method: "POST", body });
export const createPrompt = (id: string, name: string, content: string) =>
  api("/api/marketplace/create-prompt", { method: "POST", body: { id, name, content } });

// ─── Apps ─────────────────────────────────────────────────────────
export const createApp = (body: any) => api("/api/apps", { method: "POST", body });

// ─── Config ───────────────────────────────────────────────────────
export const getServiceConfig = () => api("/api/config/service");

// ─── Templates ────────────────────────────────────────────────────
export const listTemplates = (category?: string) => api("/api/templates", { query: { category } });
export const getTemplate = (id: string) => api(`/api/templates/${id}`);
export const deployTemplate = (id: string, body: any) =>
  api(`/api/templates/${id}/deploy`, { method: "POST", body });

// ─── Upgrade ─────────────────────────────────────────────────────
export const upgradeToPro = (licenseKey?: string) =>
  api("/api/upgrade", { method: "POST", body: { licenseKey } });

// ─── Agent Registry (remote — myaiforone.com) ─────────────────────
export const browseAgentRegistry = (query?: string, category?: string) =>
  api("/api/registry/agents", { baseUrl: getRegistryUrl(), query: { q: query, category } });

export const getRegistryAgent = (id: string) =>
  api(`/api/registry/agents/${id}`, { baseUrl: getRegistryUrl() });

export const getRegistryAgentPackage = (id: string) =>
  api(`/api/registry/agents/${id}/package`, { baseUrl: getRegistryUrl() });
