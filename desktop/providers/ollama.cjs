const crypto = require('node:crypto');

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MAX_AGENTS = 24;
const OLLAMA_GROUPING_CHAT = 'chat';
const OLLAMA_GROUPING_SINGLE = 'single';

function normalizeOllamaUrl(value) {
  const url = new URL(String(value || DEFAULT_OLLAMA_URL).trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The Ollama server URL must use http:// or https://.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function normalizeOllamaGrouping(value) {
  return value === OLLAMA_GROUPING_CHAT ? OLLAMA_GROUPING_CHAT : OLLAMA_GROUPING_SINGLE;
}

function ollamaEndpoint(baseUrl, pathname) {
  return new URL(pathname.replace(/^\//, ''), `${baseUrl}/`).toString();
}

function modelIdentity(baseUrl, modelName) {
  const digest = crypto.createHash('sha256')
    .update(`${normalizeOllamaUrl(baseUrl)}\n${String(modelName || '').trim()}`)
    .digest('hex')
    .slice(0, 20);
  return {
    id: `ollama-model:${digest}`,
    assignmentKey: `runtime:ollama-model:${digest}`
  };
}

function bytesLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function normalizeRunningModel(model, baseUrl, nowMs) {
  const modelName = String(model?.model || model?.name || '').trim();
  if (!modelName) return null;
  const identity = modelIdentity(baseUrl, modelName);
  const details = model?.details && typeof model.details === 'object' ? model.details : {};
  const parameterSize = String(details.parameter_size || '').trim();
  const quantization = String(details.quantization_level || '').trim();
  const memory = bytesLabel(model?.size_vram || model?.size);
  const contextLength = Number(model?.context_length);
  const expiresAtMs = Date.parse(String(model?.expires_at || ''));
  const roleDetails = [parameterSize, quantization, memory].filter(Boolean).join(' · ');
  return {
    id: identity.id,
    name: `Ollama · ${modelName}`,
    role: `Ollama${roleDetails ? ` · ${roleDetails}` : ''}`,
    status: 'active',
    task: `Model loaded${Number.isFinite(expiresAtMs) ? ` until ${new Date(expiresAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`,
    lastSeen: new Date(nowMs).toISOString(),
    workspacePath: null,
    source: 'ollama',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: 'Working',
    pose: 'working',
    activity: {
      provider: 'ollama',
      status: 'loaded',
      derivedStatus: 'active',
      updatedAt: nowMs,
      sessionLabel: modelName.slice(0, 120),
      sessionKeyShort: String(model?.digest || identity.id).slice(0, 20),
      model: modelName,
      family: String(details.family || '').trim() || null,
      parameterSize: parameterSize || null,
      quantization: quantization || null,
      contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : null,
      sizeVram: Number(model?.size_vram) || null,
      expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null
    }
  };
}

async function fetchOllamaAgents({
  baseUrl = DEFAULT_OLLAMA_URL,
  fetchImpl = globalThis.fetch,
  signal,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = OLLAMA_GROUPING_CHAT,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const normalizedUrl = normalizeOllamaUrl(baseUrl);
  const response = await fetchImpl(ollamaEndpoint(normalizedUrl, '/api/ps'), {
    headers: { accept: 'application/json' },
    signal
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const body = await response.json();
  const nowMs = now();
  const agents = (Array.isArray(body?.models) ? body.models : [])
    .map((model) => normalizeRunningModel(model, normalizedUrl, nowMs))
    .filter(Boolean)
    .sort((left, right) => {
      return Date.parse(right.activity.expiresAt || 0) - Date.parse(left.activity.expiresAt || 0)
        || left.name.localeCompare(right.name);
    });
  if (normalizeOllamaGrouping(grouping) === OLLAMA_GROUPING_SINGLE) {
    if (!agents[0]) return [];
    const modelNames = agents.map((agent) => agent.activity.model);
    return [{
      ...agents[0],
      id: 'ollama-all-models',
      name: 'Ollama',
      role: `Ollama · ${agents.length} loaded model${agents.length === 1 ? '' : 's'}`,
      task: agents.length === 1 ? `${modelNames[0]} loaded` : `${modelNames.slice(0, 3).join(', ')}${modelNames.length > 3 ? ` +${modelNames.length - 3}` : ''}`,
      avatarAssignmentKey: 'runtime:ollama-single',
      activity: { ...agents[0].activity, loadedModels: modelNames }
    }];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return agents.slice(0, limit);
}

module.exports = {
  DEFAULT_OLLAMA_URL,
  OLLAMA_GROUPING_CHAT,
  OLLAMA_GROUPING_SINGLE,
  bytesLabel,
  fetchOllamaAgents,
  modelIdentity,
  normalizeOllamaGrouping,
  normalizeOllamaUrl,
  normalizeRunningModel,
  ollamaEndpoint
};
