const crypto = require('node:crypto');

const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096';
const DEFAULT_MAX_AGENTS = 24;
const OPENCODE_GROUPING_PROJECT = 'project';
const OPENCODE_GROUPING_SINGLE = 'single';

function normalizeOpenCodeUrl(value) {
  const url = new URL(String(value || DEFAULT_OPENCODE_URL).trim());
  if (url.protocol !== 'http:') throw new Error('The OpenCode server URL must use http://.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('The OpenCode adapter only connects to a server on this computer.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname.replace(/^\//, ''), `${baseUrl}/`).toString();
}

async function fetchJson(fetchImpl, url, signal, authorization) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      ...(authorization ? { authorization } : {})
    },
    signal
  });
  if (!response.ok) throw new Error(`OpenCode returned HTTP ${response.status}.`);
  return response.json();
}

function statusType(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (!value || typeof value !== 'object') return 'idle';
  return String(value.type || value.status || value.state || 'idle').trim().toLowerCase();
}

function normalizedStatus(value) {
  const raw = statusType(value);
  if (/error|failed|blocked|retry/.test(raw)) return 'blocked';
  if (/busy|running|working|active|streaming|processing/.test(raw)) return 'active';
  return 'idle';
}

function timestampMs(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 1e12 ? number * 1000 : number;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionUpdatedMs(session) {
  return timestampMs(
    session?.time?.updated ||
    session?.time_updated ||
    session?.updatedAt ||
    session?.updated_at ||
    session?.time?.created ||
    session?.time_created
  );
}

function basename(value) {
  const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function normalizeProjectDirectory(value) {
  const directory = String(value || '').trim().replace(/\\/g, '/');
  if (/^\/+$/u.test(directory)) return '/';
  if (/^[a-z]:\/+$/iu.test(directory)) return `${directory.slice(0, 2).toLowerCase()}/`;
  return directory.replace(/\/+$/, '');
}

function normalizeOpenCodeGrouping(value) {
  return value === OPENCODE_GROUPING_SINGLE ? OPENCODE_GROUPING_SINGLE : OPENCODE_GROUPING_PROJECT;
}

function singleOpenCodeAgent(agent) {
  if (!agent) return null;
  return {
    ...agent,
    id: 'opencode-all-projects',
    name: 'OpenCode',
    avatarAssignmentKey: 'runtime:opencode-single'
  };
}

function projectIdentity(session) {
  const directory = normalizeProjectDirectory(session?.directory || session?.path);
  const sessionId = String(session?.id || session?.sessionID || '').trim();
  const source = directory || `session:${sessionId}`;
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
  return {
    id: `opencode-project:${digest}`,
    assignmentKey: `runtime:opencode-project:${digest}`,
    directory
  };
}

function sessionModel(session) {
  if (typeof session?.model === 'string') return session.model;
  const provider = session?.model?.providerID || session?.providerID || session?.provider;
  const model = session?.model?.modelID || session?.modelID;
  return [provider, model].filter(Boolean).join('/') || '';
}

function sessionAgent(session) {
  return String(session?.agent || session?.agentName || '').trim();
}

function taskForSession(session, rawStatus) {
  const title = String(session?.title || '').trim();
  if (title) return title.slice(0, 240);
  const project = basename(session?.directory || session?.path);
  if (rawStatus === 'retry') return `Retrying${project ? ` in ${project}` : ''}`;
  if (rawStatus === 'busy') return `Working${project ? ` in ${project}` : ''}`;
  return `OpenCode session${project ? ` in ${project}` : ''}`;
}

function normalizeSession(session, statusValue, nowMs) {
  const sessionId = String(session?.id || session?.sessionID || '').trim();
  if (!sessionId) return null;
  const rawStatus = statusType(statusValue);
  const status = normalizedStatus(statusValue);
  const sourceUpdatedMs = sessionUpdatedMs(session) || nowMs;
  const updatedMs = status === 'idle' ? sourceUpdatedMs : nowMs;
  const directory = String(session?.directory || session?.path || '').trim();
  const project = projectIdentity(session);
  const projectName = basename(directory);
  const model = sessionModel(session);
  const agent = sessionAgent(session);
  return {
    id: project.id,
    name: projectName ? `OpenCode · ${projectName}` : 'OpenCode',
    role: ['OpenCode', agent, model].filter(Boolean).join(' · '),
    status,
    task: taskForSession(session, rawStatus),
    lastSeen: new Date(updatedMs).toISOString(),
    workspacePath: directory || null,
    source: 'opencode',
    avatarAssignmentKey: project.assignmentKey,
    displayState: status === 'active' ? 'Working' : status === 'blocked' ? 'Blocked' : 'Idle',
    pose: status === 'active' ? 'working' : status === 'blocked' ? 'blocked' : null,
    activity: {
      provider: 'opencode',
      status: rawStatus,
      derivedStatus: status,
      updatedAt: sourceUpdatedMs,
      sessionLabel: String(session?.title || sessionId).slice(0, 120),
      sessionKeyShort: sessionId,
      model: model || null,
      agent: agent || null
    }
  };
}

async function fetchOpenCodeAgents({
  baseUrl = DEFAULT_OPENCODE_URL,
  username = 'opencode',
  password = '',
  fetchImpl = globalThis.fetch,
  signal,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = OPENCODE_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const normalizedUrl = normalizeOpenCodeUrl(baseUrl);
  const authorization = password
    ? `Basic ${Buffer.from(`${String(username || 'opencode')}:${String(password)}`).toString('base64')}`
    : '';
  const [statuses, sessions] = await Promise.all([
    fetchJson(fetchImpl, endpoint(normalizedUrl, '/session/status'), signal, authorization),
    fetchJson(fetchImpl, endpoint(normalizedUrl, '/session'), signal, authorization)
  ]);
  const statusById = statuses && typeof statuses === 'object' && !Array.isArray(statuses) ? statuses : {};
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const byId = new Map(sessionList.map((session) => [String(session?.id || session?.sessionID || ''), session]));
  const nowMs = now();
  if (normalizeOpenCodeGrouping(grouping) === OPENCODE_GROUPING_SINGLE) {
    const latestSession = [...sessionList]
      .sort((left, right) => sessionUpdatedMs(right) - sessionUpdatedMs(left))[0];
    if (!latestSession) return [];
    const latestId = String(latestSession?.id || latestSession?.sessionID || '');
    const agent = normalizeSession(latestSession, statusById[latestId], nowMs);
    return agent ? [singleOpenCodeAgent(agent)] : [];
  }
  const activeIds = Object.entries(statusById)
    .filter(([, value]) => normalizedStatus(value) !== 'idle')
    .map(([id]) => id);
  const latestId = [...sessionList].sort((left, right) => sessionUpdatedMs(right) - sessionUpdatedMs(left))[0]?.id;
  const selectedIds = [...new Set(activeIds.length ? activeIds : (latestId ? [String(latestId)] : []))]
    .sort((left, right) => sessionUpdatedMs(byId.get(right)) - sessionUpdatedMs(byId.get(left)));
  const normalizedAgents = selectedIds
    .map((id) => normalizeSession(byId.get(id) || { id }, statusById[id], nowMs))
    .filter(Boolean)
    .sort((left, right) => {
      const statusDelta = (right.status === 'active' ? 2 : right.status === 'blocked' ? 1 : 0)
        - (left.status === 'active' ? 2 : left.status === 'blocked' ? 1 : 0);
      return statusDelta || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
    });
  const agentsByProject = new Map();
  for (const agent of normalizedAgents) {
    if (!agentsByProject.has(agent.id)) agentsByProject.set(agent.id, agent);
  }
  const agents = [...agentsByProject.values()];
  return agents.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, 24)));
}

module.exports = {
  DEFAULT_OPENCODE_URL,
  OPENCODE_GROUPING_PROJECT,
  OPENCODE_GROUPING_SINGLE,
  fetchOpenCodeAgents,
  normalizeSession,
  normalizeOpenCodeGrouping,
  normalizeOpenCodeUrl,
  normalizeProjectDirectory,
  normalizedStatus,
  projectIdentity,
  singleOpenCodeAgent,
  statusType
};
