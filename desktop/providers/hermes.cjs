const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 90_000;
const DEFAULT_MAX_AGENTS = 24;
const HERMES_GROUPING_PROJECT = 'project';
const HERMES_GROUPING_SINGLE = 'single';
const HERMES_CONNECTION_LOCAL = 'local';
const HERMES_CONNECTION_REMOTE = 'remote';
const DEFAULT_HERMES_GATEWAY_URL = 'http://127.0.0.1:9119';
const HERMES_GATEWAY_TIMEOUT_MS = 8_000;

function normalizeHermesGrouping(value) {
  return value === HERMES_GROUPING_PROJECT ? HERMES_GROUPING_PROJECT : HERMES_GROUPING_SINGLE;
}

function normalizeHermesConnectionMode(value) {
  return value === HERMES_CONNECTION_REMOTE ? HERMES_CONNECTION_REMOTE : HERMES_CONNECTION_LOCAL;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.').map(Number);
  return octets.length === 4 && octets[0] === 127
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

function isTailscaleHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const octets = host.split('.').map(Number);
  return (octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
      && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255))
    || host.startsWith('fd7a:115c:a1e0:');
}

function normalizeHermesGatewayUrl(value = DEFAULT_HERMES_GATEWAY_URL) {
  const input = String(value || DEFAULT_HERMES_GATEWAY_URL).trim();
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  } catch (error) {
    throw new Error(`The Hermes gateway URL is not valid: ${error.message}`);
  }
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The Hermes gateway URL must use http://, https://, ws://, or wss://.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol === 'http:' && !isLoopbackHost(hostname) && hostname !== 'host.docker.internal' && !isTailscaleHost(hostname)) {
    throw new Error('Remote Hermes gateways must use https://. Plain HTTP is allowed only for loopback, host.docker.internal, and Tailscale addresses.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function hermesGatewayWebSocketUrl(baseUrl, token = '') {
  const url = new URL(normalizeHermesGatewayUrl(baseUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/ws`;
  url.search = '';
  if (token) url.searchParams.set('token', String(token));
  return url.toString();
}

function hermesRoot({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.HERMES_HOME || path.join(home, '.hermes'));
}

function hermesDatabaseCandidates(options = {}) {
  const root = hermesRoot(options);
  const candidates = [path.join(root, 'state.db')];
  const profilesRoot = path.join(root, 'profiles');
  let profiles = [];
  try { profiles = fs.readdirSync(profilesRoot, { withFileTypes: true }); } catch {}
  for (const profile of profiles) {
    if (profile.isDirectory()) candidates.push(path.join(profilesRoot, profile.name, 'state.db'));
  }
  return candidates.map((candidate) => path.resolve(candidate));
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isHermesRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('wmic.exe', ['process', 'get', 'CommandLine', '/FORMAT:LIST']);
      return /(?:^|[\\/\s])hermes(?:\.exe)?(?:\s|$)/im.test(output)
        || /Hermes(?: Agent)?\.exe/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'command=']);
    return /\/Hermes(?: Agent)?\.app\/Contents\/MacOS\/Hermes(?:\s|$)/im.test(output)
      || /(?:^|[\/\s])hermes(?:\s|$)/im.test(output)
      || /(?:^|[\/\s])hermes-agent(?:\s|$)/im.test(output);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function safeIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function findColumn(columns, candidates) {
  const byLower = new Map(columns.map((column) => [String(column.name).toLowerCase(), String(column.name)]));
  for (const candidate of candidates) {
    if (byLower.has(candidate.toLowerCase())) return byLower.get(candidate.toLowerCase());
  }
  return '';
}

function sessionRows(db, limit = 500) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = 'sessions'").get();
  if (!table?.name) return [];
  const columns = db.prepare(`PRAGMA table_info(${safeIdentifier(table.name)})`).all();
  const fields = {
    id: findColumn(columns, ['id', 'session_id']),
    source: findColumn(columns, ['source', 'session_type']),
    cwd: findColumn(columns, ['cwd', 'working_directory', 'working_dir']),
    repoRoot: findColumn(columns, ['git_repo_root']),
    title: findColumn(columns, ['title', 'display_name', 'name']),
    model: findColumn(columns, ['model', 'model_name']),
    provider: findColumn(columns, ['billing_provider', 'provider']),
    started: findColumn(columns, ['started_at', 'created_at']),
    ended: findColumn(columns, ['ended_at']),
    activity: findColumn(columns, ['last_activity_at', 'updated_at']),
    activityDescription: findColumn(columns, ['last_activity_description']),
    profileName: findColumn(columns, ['profile_name']),
    parent: findColumn(columns, ['parent_session_id']),
    archived: findColumn(columns, ['archived'])
  };
  if (!fields.id) return [];
  const expression = (field, alias) => field ? `${safeIdentifier(field)} AS ${alias}` : `NULL AS ${alias}`;
  const filters = [];
  if (fields.parent) filters.push(`${safeIdentifier(fields.parent)} IS NULL`);
  if (fields.archived) filters.push(`COALESCE(${safeIdentifier(fields.archived)}, 0) = 0`);
  if (fields.source) filters.push(`LOWER(COALESCE(${safeIdentifier(fields.source)}, '')) NOT IN ('tool', 'kanban')`);
  const order = fields.activity || fields.started || fields.id;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1_200));
  // Deliberately select session metadata only. Hermes messages, prompts, tool
  // calls, system prompts, credentials, and routing records are never queried.
  // Hidden sessions remain eligible: Hermes uses that flag for profile/Bot
  // sessions owned by another UI surface, not as an inactivity marker.
  return db.prepare(`
    SELECT ${expression(fields.id, 'id')}, ${expression(fields.source, 'source')},
      ${expression(fields.cwd, 'cwd')}, ${expression(fields.repoRoot, 'repo_root')},
      ${expression(fields.title, 'title')}, ${expression(fields.model, 'model')},
      ${expression(fields.provider, 'provider')},
      ${expression(fields.started, 'started_at')}, ${expression(fields.ended, 'ended_at')},
      ${expression(fields.activity, 'last_activity_at')},
      ${expression(fields.activityDescription, 'last_activity_description')},
      ${expression(fields.profileName, 'profile_name')},
      ${fields.activityDescription ? '1' : '0'} AS activity_state_available
    FROM ${safeIdentifier(table.name)}
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY ${safeIdentifier(order)} DESC
    LIMIT ?
  `).all(safeLimit);
}

function timestampMs(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function modelProvider(row) {
  const explicit = cleanText(row?.provider, 80);
  if (explicit) return explicit;
  const model = cleanText(row?.model, 120);
  if (model.includes('/')) return cleanText(model.split('/')[0], 80);
  return '';
}

function projectIdentity(workspacePath) {
  const normalized = path.resolve(String(workspacePath || '.'));
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return { id: `hermes-project:${digest}`, assignmentKey: `runtime:hermes-project:${digest}` };
}

function profileIdentity(profileName) {
  const normalized = cleanText(profileName, 120).toLowerCase() || 'default';
  const digest = crypto.createHash('sha256').update(`profile:${normalized}`).digest('hex').slice(0, 20);
  return { id: `hermes-profile:${digest}`, assignmentKey: `runtime:hermes-profile:${digest}` };
}

function databaseProfileName(dbPath) {
  const profileRoot = path.dirname(dbPath);
  return path.basename(path.dirname(profileRoot)).toLowerCase() === 'profiles'
    ? path.basename(profileRoot)
    : 'default';
}

function hermesLifecycle(row, nowMs) {
  const updatedAt = timestampMs(row?.last_activity_at, row?.started_at) || nowMs;
  const recent = nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const open = row?.ended_at === null || row?.ended_at === undefined || row?.ended_at === '';
  const description = cleanText(row?.last_activity_description, 160).toLowerCase();
  const activityStateAvailable = Boolean(row?.activity_state_available);
  const awaitingApproval = open && recent && /approval|permission|confirm|waiting for user/.test(description);
  // Modern Hermes clears last_activity_description in the turn's finally
  // block. That is a stronger live/idle boundary than a recency window. Older
  // schemas without the column retain the timestamp-only compatibility path.
  const active = open && recent && !awaitingApproval && (!activityStateAvailable || Boolean(description));
  if (awaitingApproval) {
    return { status: 'blocked', displayState: 'Needs approval', pose: 'approval', activityStatus: 'approval', updatedAt };
  }
  if (active) return { status: 'active', displayState: 'Working', pose: 'working', activityStatus: 'busy', updatedAt };
  // A modern Hermes turn clears last_activity_description when its finally
  // block completes. Report that fresh completion explicitly so short turns
  // still produce a Success pulse even when polling never observed Working.
  if (recent && ((!open) || (activityStateAvailable && !description))) {
    return { status: 'success', displayState: 'Success', pose: 'success', activityStatus: 'completed', updatedAt };
  }
  return { status: 'idle', displayState: 'Idle', pose: null, activityStatus: 'idle', updatedAt };
}

function agentFromRow(row, nowMs) {
  const sessionId = cleanText(row?.id, 160);
  if (!sessionId) return null;
  const workspacePath = cleanText(row?.repo_root || row?.cwd, 1_024);
  const hasWorkspace = Boolean(workspacePath && path.isAbsolute(workspacePath));
  const profileName = cleanText(row?.profile_name || row?.database_profile, 120) || 'default';
  const identity = hasWorkspace ? projectIdentity(workspacePath) : profileIdentity(profileName);
  const projectName = hasWorkspace
    ? path.basename(path.resolve(workspacePath)) || 'Workspace'
    : profileName === 'default' ? 'Default' : profileName;
  const lifecycle = hermesLifecycle(row, nowMs);
  const model = cleanText(row?.model, 120);
  const provider = modelProvider(row);
  const source = cleanText(row?.source, 40) || 'local';
  const title = cleanText(row?.title, 240) || `Hermes session in ${projectName}`;
  return {
    id: identity.id,
    name: `Hermes · ${projectName}`.slice(0, 180),
    role: ['Hermes Agent', !hasWorkspace && profileName !== 'default' ? profileName : '', provider, model]
      .filter(Boolean).join(' · '),
    status: lifecycle.status,
    task: title,
    lastSeen: new Date(lifecycle.updatedAt).toISOString(),
    workspacePath: hasWorkspace ? path.resolve(workspacePath) : null,
    source: 'hermes',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: lifecycle.displayState,
    pose: lifecycle.pose,
    activity: {
      provider: 'hermes', status: lifecycle.activityStatus, derivedStatus: lifecycle.status,
      updatedAt: lifecycle.updatedAt, sessionLabel: title.slice(0, 120), sessionKeyShort: sessionId,
      client: source, model: model || null, modelProvider: provider || null,
      profile: profileName
    }
  };
}

function agentsFromRows(rows, nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = HERMES_GROUPING_PROJECT) {
  const candidates = rows.map((row) => agentFromRow(row, nowMs)).filter(Boolean).sort((left, right) => {
    const rank = (agent) => agent.pose === 'approval' ? 2 : Number(agent.status === 'active');
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  const normalizedGrouping = normalizeHermesGrouping(grouping);
  const profileFallbacks = new Map();
  if (normalizedGrouping === HERMES_GROUPING_PROJECT) {
    for (const agent of candidates) {
      if (agent.workspacePath) continue;
      const profile = cleanText(agent.activity?.profile, 120).toLowerCase() || 'default';
      if (!profileFallbacks.has(profile)) profileFallbacks.set(profile, agent);
    }
  }
  const reconciled = [];
  const reconciledProfiles = new Set();
  for (const agent of candidates) {
    const profile = cleanText(agent.activity?.profile, 120).toLowerCase() || 'default';
    const fallback = profileFallbacks.get(profile);
    if (!fallback) {
      reconciled.push(agent);
      continue;
    }
    if (reconciledProfiles.has(profile)) continue;
    reconciledProfiles.add(profile);
    // Keep the stable Hermes profile identity, but let the strongest and most
    // recent session for that profile drive its task and lifecycle. This folds
    // project and cwd-less Desktop activity into one visible profile agent.
    const profileName = cleanText(fallback.activity?.profile, 120) || 'default';
    reconciled.push({
      ...fallback,
      role: ['Hermes Agent', profileName !== 'default' ? profileName : '',
        agent.activity?.modelProvider, agent.activity?.model].filter(Boolean).join(' · '),
      status: agent.status,
      task: agent.task,
      lastSeen: agent.lastSeen,
      displayState: agent.displayState,
      pose: agent.pose,
      activity: { ...agent.activity, profile: profileName }
    });
  }
  const projects = new Map();
  for (const agent of reconciled) {
    if (!projects.has(agent.id)) projects.set(agent.id, agent);
  }
  const agents = [...projects.values()];
  if (normalizedGrouping === HERMES_GROUPING_SINGLE) {
    return agents[0] ? [{ ...agents[0], id: 'hermes-all-projects', name: 'Hermes', avatarAssignmentKey: 'runtime:hermes-single' }] : [];
  }
  return agents.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
}

function socketData(event) {
  const value = event?.data ?? event;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  return String(value || '');
}

function gatewayError(frame, method) {
  const message = cleanText(frame?.error?.message, 300) || `Hermes rejected ${method}.`;
  return new Error(`Hermes gateway: ${message}`);
}

async function requestHermesGateway({
  baseUrl = DEFAULT_HERMES_GATEWAY_URL,
  token = '',
  requests,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = HERMES_GATEWAY_TIMEOUT_MS
} = {}) {
  if (typeof WebSocketImpl !== 'function') throw new Error('A WebSocket implementation is required.');
  const list = Array.isArray(requests) && requests.length
    ? requests
    : [{ key: 'profiles', method: 'profiles.list', params: { include_sessions: true } }];
  const url = hermesGatewayWebSocketUrl(baseUrl, token);
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const pending = new Map();
    const results = new Map();
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Hermes gateway request timed out.')), Math.max(250, Number(timeoutMs) || HERMES_GATEWAY_TIMEOUT_MS));

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(Object.fromEntries(results));
    }

    function sendRequests() {
      for (const request of list) {
        const key = String(request?.key || request?.method || 'request');
        const id = `${key}:${crypto.randomUUID()}`;
        pending.set(id, { key, method: String(request?.method || ''), optional: Boolean(request?.optional) });
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id, method: request.method, params: request.params || {}
        }));
      }
    }

    socket.addEventListener('open', sendRequests);
    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(socketData(event)); } catch { return; }
      if (!pending.has(frame?.id)) return;
      const request = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error && !request.optional) return finish(gatewayError(frame, request.method));
      if (frame.error) results.set(request.key, null);
      else results.set(request.key, frame.result);
      if (results.size === list.length) finish();
    });
    socket.addEventListener('error', () => finish(new Error('Could not connect to the Hermes gateway.')));
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('The Hermes gateway closed the connection.'));
    });
  });
}

function remoteProfileIdentity(baseUrl, profileName) {
  const server = normalizeHermesGatewayUrl(baseUrl);
  const profile = cleanText(profileName, 120).toLowerCase() || 'default';
  const digest = crypto.createHash('sha256').update(`${server}\n${profile}`).digest('hex').slice(0, 20);
  return { id: `hermes-remote:${digest}`, assignmentKey: `runtime:hermes-remote:${digest}` };
}

function remoteStatus(value) {
  const status = cleanText(value, 80).toLowerCase();
  if (/approval|permission|confirm|blocked|waiting/.test(status)) {
    return { status: 'blocked', displayState: 'Needs approval', pose: 'approval', activityStatus: 'approval' };
  }
  if (/running|working|active|busy|stream|tool|thinking/.test(status)) {
    return { status: 'active', displayState: 'Working', pose: 'working', activityStatus: 'busy' };
  }
  return { status: 'idle', displayState: 'Idle', pose: null, activityStatus: 'idle' };
}

function normalizeHermesRemoteAgents(profilesPayload, activePayload, {
  baseUrl = DEFAULT_HERMES_GATEWAY_URL,
  grouping = HERMES_GROUPING_PROJECT,
  maxAgents = DEFAULT_MAX_AGENTS,
  now = Date.now
} = {}) {
  const nowMs = typeof now === 'function' ? now() : Number(now) || Date.now();
  const profiles = Array.isArray(profilesPayload?.profiles) ? profilesPayload.profiles : [];
  const activeListAvailable = Array.isArray(activePayload?.sessions);
  const activeSessions = Array.isArray(activePayload?.sessions) ? activePayload.sessions : [];
  const activeByStoredId = new Map();
  for (const session of activeSessions) {
    const key = cleanText(session?.session_key || session?.stored_session_id || session?.id, 160);
    if (key) activeByStoredId.set(key, session);
  }
  const host = new URL(normalizeHermesGatewayUrl(baseUrl)).host;
  const agents = profiles.map((profile, index) => {
    const profileName = cleanText(profile?.name, 120) || (profile?.is_default ? 'default' : `profile-${index + 1}`);
    const label = cleanText(profile?.display_name, 120) || (profileName === 'default' ? 'Default' : profileName);
    const last = profile?.last_session && typeof profile.last_session === 'object' ? profile.last_session : null;
    const worker = profile?.worker_session && typeof profile.worker_session === 'object' ? profile.worker_session : null;
    const live = activeByStoredId.get(cleanText(last?.resolved_id || last?.id, 160));
    const latest = [last, worker, live].filter(Boolean).sort((left, right) =>
      timestampMs(right?.last_active, right?.started_at) - timestampMs(left?.last_active, left?.started_at))[0] || null;
    const updatedAt = timestampMs(live?.last_active, latest?.last_active, latest?.started_at);
    const recentMetadata = latest && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
    const lifecycle = live
      ? remoteStatus(live.status)
      : activeListAvailable && recentMetadata
        ? { status: 'success', displayState: 'Success', pose: 'success', activityStatus: 'completed' }
        : recentMetadata ? remoteStatus('active') : remoteStatus('idle');
    const model = cleanText(live?.model || profile?.model, 120);
    const provider = cleanText(profile?.provider, 80) || modelProvider({ model });
    const sessionId = cleanText(live?.session_key || live?.id || last?.resolved_id || last?.id || worker?.id, 160);
    const title = cleanText(live?.title || latest?.title, 240)
      || (profile?.description ? cleanText(profile.description, 240) : `Hermes profile ${label}`);
    const identity = remoteProfileIdentity(baseUrl, profileName);
    return {
      id: identity.id,
      name: `Hermes · ${label}`.slice(0, 180),
      role: ['Hermes Agent', profileName !== 'default' ? profileName : '', provider, model, host]
        .filter(Boolean).join(' · '),
      status: lifecycle.status,
      task: title,
      lastSeen: new Date(updatedAt).toISOString(),
      workspacePath: null,
      source: 'hermes',
      avatarAssignmentKey: identity.assignmentKey,
      displayState: lifecycle.displayState,
      pose: lifecycle.pose,
      activity: {
        provider: 'hermes', status: lifecycle.activityStatus, derivedStatus: lifecycle.status,
        updatedAt, sessionLabel: title.slice(0, 120), sessionKeyShort: sessionId || null,
        client: 'gateway', model: model || null, modelProvider: provider || null,
        profile: profileName, remoteHost: host
      }
    };
  }).sort((left, right) => {
    const rank = (agent) => agent.pose === 'approval' ? 2 : Number(agent.status === 'active');
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeHermesGrouping(grouping) === HERMES_GROUPING_SINGLE) {
    return agents[0] ? [{
      ...agents[0],
      id: `hermes-remote:${crypto.createHash('sha256').update(normalizeHermesGatewayUrl(baseUrl)).digest('hex').slice(0, 20)}`,
      name: 'Hermes',
      avatarAssignmentKey: `runtime:hermes-remote:${crypto.createHash('sha256').update(normalizeHermesGatewayUrl(baseUrl)).digest('hex').slice(0, 20)}`
    }] : [];
  }
  return agents.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
}

async function fetchHermesRemoteAgents({
  baseUrl = DEFAULT_HERMES_GATEWAY_URL,
  token = '',
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = HERMES_GATEWAY_TIMEOUT_MS,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = HERMES_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const payloads = await requestHermesGateway({
    baseUrl, token, WebSocketImpl, timeoutMs,
    requests: [
      // Hermes currently couples lifecycle summaries and previews in this RPC.
      // Taskfolk discards preview fields immediately and never publishes them.
      { key: 'profiles', method: 'profiles.list', params: { include_sessions: true } },
      { key: 'active', method: 'session.active_list', params: {}, optional: true }
    ]
  });
  return normalizeHermesRemoteAgents(payloads.profiles, payloads.active, {
    baseUrl, grouping, maxAgents, now
  });
}

async function fetchHermesAgents({
  dbPaths,
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = HERMES_GROUPING_PROJECT,
  now = Date.now,
  ...pathOptions
} = {}) {
  const running = processRunning === undefined ? await isHermesRunning() : Boolean(processRunning);
  if (!running) return [];
  const candidates = dbPaths || hermesDatabaseCandidates(pathOptions);
  const rows = [];
  for (const dbPath of candidates) {
    if (!fs.existsSync(dbPath)) continue;
    let db;
    try {
      db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
      const databaseProfile = databaseProfileName(dbPath);
      rows.push(...sessionRows(db, Math.max(500, maxAgents * 30)).map((row) => ({
        ...row,
        database_profile: databaseProfile
      })));
    } finally {
      try { db?.close(); } catch {}
    }
  }
  return agentsFromRows(rows, now(), maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  DEFAULT_HERMES_GATEWAY_URL,
  HERMES_CONNECTION_LOCAL,
  HERMES_CONNECTION_REMOTE,
  HERMES_GROUPING_PROJECT,
  HERMES_GROUPING_SINGLE,
  agentFromRow,
  agentsFromRows,
  databaseProfileName,
  fetchHermesAgents,
  fetchHermesRemoteAgents,
  hermesGatewayWebSocketUrl,
  hermesDatabaseCandidates,
  hermesLifecycle,
  hermesRoot,
  isHermesRunning,
  modelProvider,
  normalizeHermesConnectionMode,
  normalizeHermesGatewayUrl,
  normalizeHermesGrouping,
  normalizeHermesRemoteAgents,
  profileIdentity,
  projectIdentity,
  remoteProfileIdentity,
  requestHermesGateway,
  sessionRows,
  timestampMs
};
