const crypto = require('node:crypto');

const DEFAULT_LM_STUDIO_URL = 'http://127.0.0.1:1234';
const DEFAULT_MAX_AGENTS = 24;
const LM_STUDIO_GROUPING_CHAT = 'chat';
const LM_STUDIO_GROUPING_MODEL = 'model';
const LM_STUDIO_GROUPING_SINGLE = 'single';
const APPROVAL_STATUS_PATTERN = /^(?:awaiting[_ -]?approval|waiting[_ -]?(?:for[_ -]?)?(?:approval|confirmation)|pending[_ -]?approval|approval[_ -]?required|requires[_ -]?(?:approval|confirmation)|confirmation[_ -]?required)$/i;

function normalizeLmStudioUrl(value) {
  const url = new URL(String(value || DEFAULT_LM_STUDIO_URL).trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The LM Studio server URL must use http:// or https://.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function normalizeLmStudioGrouping(value) {
  return [LM_STUDIO_GROUPING_CHAT, LM_STUDIO_GROUPING_MODEL].includes(value)
    ? LM_STUDIO_GROUPING_CHAT
    : LM_STUDIO_GROUPING_SINGLE;
}

function lmStudioEndpoint(baseUrl, pathname) {
  return new URL(pathname.replace(/^\//, ''), `${baseUrl}/`).toString();
}

function instanceIdentity(baseUrl, instanceId) {
  const digest = crypto.createHash('sha256')
    .update(`${normalizeLmStudioUrl(baseUrl)}\n${String(instanceId || '').trim()}`)
    .digest('hex')
    .slice(0, 20);
  return {
    id: `lmstudio-model:${digest}`,
    assignmentKey: `runtime:lmstudio-model:${digest}`
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

function hasExplicitApproval(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasExplicitApproval);
  const status = String(
    value.approval_status || value.approvalStatus || value.tool_call_status ||
    value.toolCallStatus || value.status || value.state || ''
  ).trim();
  if (APPROVAL_STATUS_PATTERN.test(status)
    || value.awaitingApproval === true
    || value.requiresApproval === true
    || value.confirmationRequired === true) return true;
  return Object.values(value).some((child) => child && typeof child === 'object' && hasExplicitApproval(child));
}

function normalizeLoadedInstance(model, instance, baseUrl, nowMs) {
  const modelKey = String(model?.key || '').trim();
  const instanceId = String(instance?.id || modelKey).trim();
  if (!modelKey || !instanceId) return null;
  const identity = instanceIdentity(baseUrl, instanceId);
  const displayName = String(model?.display_name || modelKey).trim();
  const quantization = String(model?.quantization?.name || '').trim();
  const parameterSize = String(model?.params_string || '').trim();
  const format = String(model?.format || '').trim().toUpperCase();
  const memory = bytesLabel(model?.size_bytes);
  const config = instance?.config && typeof instance.config === 'object' ? instance.config : {};
  const contextLength = Number(config.context_length);
  const parallel = Number(config.parallel);
  const roleDetails = [parameterSize, quantization, format, memory].filter(Boolean).join(' · ');
  const awaitingApproval = hasExplicitApproval(instance);
  return {
    id: identity.id,
    name: `LM Studio · ${displayName}`,
    role: `LM Studio${roleDetails ? ` · ${roleDetails}` : ''}`,
    status: awaitingApproval ? 'blocked' : 'active',
    task: 'Model loaded',
    lastSeen: new Date(nowMs).toISOString(),
    workspacePath: null,
    source: 'lmstudio',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: awaitingApproval ? 'Needs approval' : 'Working',
    pose: awaitingApproval ? 'approval' : 'working',
    activity: {
      provider: 'lmstudio',
      status: awaitingApproval ? 'approval' : 'loaded',
      derivedStatus: awaitingApproval ? 'blocked' : 'active',
      updatedAt: nowMs,
      sessionLabel: displayName.slice(0, 120),
      sessionKeyShort: instanceId.slice(0, 20),
      model: modelKey,
      instanceId,
      publisher: String(model?.publisher || '').trim() || null,
      architecture: String(model?.architecture || '').trim() || null,
      parameterSize: parameterSize || null,
      quantization: quantization || null,
      contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : null,
      parallel: Number.isFinite(parallel) && parallel > 0 ? parallel : null,
      sizeBytes: Number(model?.size_bytes) || null
    }
  };
}

async function fetchLmStudioAgents({
  baseUrl = DEFAULT_LM_STUDIO_URL,
  apiToken = '',
  fetchImpl = globalThis.fetch,
  signal,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = LM_STUDIO_GROUPING_MODEL,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const normalizedUrl = normalizeLmStudioUrl(baseUrl);
  const token = String(apiToken || '').trim();
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(lmStudioEndpoint(normalizedUrl, '/api/v1/models'), { headers, signal });
  if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}.`);
  const body = await response.json();
  const nowMs = now();
  const agents = (Array.isArray(body?.models) ? body.models : [])
    .flatMap((model) => (Array.isArray(model?.loaded_instances) ? model.loaded_instances : [])
      .map((instance) => normalizeLoadedInstance(model, instance, normalizedUrl, nowMs)))
    .filter(Boolean)
    .sort((left, right) => Number(right.pose === 'approval') - Number(left.pose === 'approval')
      || left.name.localeCompare(right.name)
      || left.activity.instanceId.localeCompare(right.activity.instanceId));
  if (normalizeLmStudioGrouping(grouping) === LM_STUDIO_GROUPING_SINGLE) {
    if (!agents[0]) return [];
    const modelNames = [...new Set(agents.map((agent) => agent.activity.model))];
    return [{
      ...agents[0],
      id: 'lmstudio-all-models',
      name: 'LM Studio',
      role: `LM Studio · ${agents.length} loaded instance${agents.length === 1 ? '' : 's'}`,
      task: agents.length === 1
        ? `${agents[0].activity.sessionLabel} loaded`
        : `${modelNames.slice(0, 3).join(', ')}${modelNames.length > 3 ? ` +${modelNames.length - 3}` : ''}`,
      avatarAssignmentKey: 'runtime:lmstudio-single',
      activity: { ...agents[0].activity, loadedModels: modelNames, loadedInstanceCount: agents.length }
    }];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return agents.slice(0, limit);
}

module.exports = {
  DEFAULT_LM_STUDIO_URL,
  LM_STUDIO_GROUPING_CHAT,
  LM_STUDIO_GROUPING_MODEL,
  LM_STUDIO_GROUPING_SINGLE,
  bytesLabel,
  fetchLmStudioAgents,
  hasExplicitApproval,
  instanceIdentity,
  lmStudioEndpoint,
  normalizeLmStudioGrouping,
  normalizeLmStudioUrl,
  normalizeLoadedInstance
};
