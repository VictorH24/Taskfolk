const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const AHP_ROOT_CHANNEL = 'ahp-root://';
const AHP_PROTOCOL_VERSIONS = ['0.7.0'];
const DEFAULT_AHP_TIMEOUT_MS = 2_000;
const DEFAULT_AHP_SESSION_LIMIT = 100;

function defaultVsCodeAgentHostMetadataPaths(workspaceStorageRoots) {
  return [...new Set(workspaceStorageRoots.map((root) => path.join(
    path.dirname(path.dirname(root)),
    'agent-host',
    'local-endpoint',
    'metadata.json'
  )))];
}

function isUsableEndpoint(value, platform = process.platform, statSync = fs.statSync) {
  if (!value || typeof value !== 'object') return false;
  if (value.type !== 'editor' || Number(value.schemaVersion) !== 1) return false;
  if (!Number.isInteger(Number(value.pid)) || Number(value.pid) <= 0) return false;
  if (!path.isAbsolute(String(value.endpointPath || ''))) return false;
  if (!String(value.connectionToken || '') || !String(value.protocolVersion || '')) return false;
  if (!AHP_PROTOCOL_VERSIONS.includes(String(value.protocolVersion))) return false;
  if (platform !== 'win32') {
    try {
      if (!statSync(value.endpointPath).isSocket()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function readVsCodeAhpEndpoints(metadataPaths, {
  platform = process.platform,
  lstatSync = fs.lstatSync,
  readFileSync = fs.readFileSync,
  statSync = fs.statSync
} = {}) {
  const endpoints = [];
  const seen = new Set();
  for (const metadataPath of metadataPaths) {
    let stat;
    let records;
    try {
      stat = lstatSync(metadataPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (typeof process.getuid === 'function' && Number.isInteger(stat.uid)
        && stat.uid !== process.getuid()) continue;
      records = JSON.parse(readFileSync(metadataPath, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!isUsableEndpoint(record, platform, statSync)) continue;
      const endpointPath = String(record.endpointPath);
      if (seen.has(endpointPath)) continue;
      seen.add(endpointPath);
      endpoints.push({
        type: 'editor',
        schemaVersion: 1,
        pid: Number(record.pid),
        instanceId: String(record.instanceId || ''),
        endpointPath,
        connectionToken: String(record.connectionToken),
        protocolVersion: String(record.protocolVersion)
      });
    }
  }
  return endpoints;
}

function socketError(error, fallback) {
  const message = String(error?.message || '').trim();
  return new Error(message || fallback);
}

async function queryVsCodeAhpEndpoint(endpoint, {
  WebSocketImpl = WebSocket,
  connect = (socketPath) => net.createConnection(socketPath),
  timeoutMs = DEFAULT_AHP_TIMEOUT_MS,
  sessionLimit = DEFAULT_AHP_SESSION_LIMIT,
  clientId = `taskfolk-${crypto.randomUUID()}`
} = {}) {
  const token = encodeURIComponent(endpoint.connectionToken);
  const socket = new WebSocketImpl(`ws://localhost/?tkn=${token}`, {
    createConnection: () => connect(endpoint.endpointPath),
    handshakeTimeout: timeoutMs,
    perMessageDeflate: false
  });
  let nextId = 1;
  const pending = new Map();
  let closedError = null;

  function rejectPending(error) {
    if (closedError) return;
    closedError = socketError(error, 'The VS Code Agent Host connection closed.');
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(closedError);
    }
    pending.clear();
  }

  socket.on('message', (data) => {
    let message;
    try { message = JSON.parse(data.toString('utf8')); } catch { return; }
    if (message?.id === undefined || message?.id === null) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(new Error(String(message.error.message || 'AHP request failed.')));
    } else {
      request.resolve(message.result);
    }
  });
  socket.on('error', rejectPending);
  socket.on('close', () => rejectPending(new Error('The VS Code Agent Host connection closed.')));

  await new Promise((resolve, reject) => {
    if (socket.readyState === WebSocketImpl.OPEN) return resolve();
    const timer = setTimeout(() => {
      reject(new Error('Timed out connecting to the VS Code Agent Host.'));
      try { socket.terminate(); } catch {}
    }, timeoutMs);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(socketError(error, 'Could not connect to the VS Code Agent Host.'));
    });
  });

  function request(method, params) {
    if (closedError) return Promise.reject(closedError);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for AHP ${method}.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (error) => {
        if (!error) return;
        const queued = pending.get(id);
        if (!queued) return;
        pending.delete(id);
        clearTimeout(queued.timer);
        queued.reject(socketError(error, `Could not send AHP ${method}.`));
      });
    });
  }

  try {
    const initialized = await request('initialize', {
      channel: AHP_ROOT_CHANNEL,
      protocolVersions: AHP_PROTOCOL_VERSIONS,
      clientId,
      clientInfo: { name: 'taskfolk', title: 'Taskfolk' },
      initialSubscriptions: [AHP_ROOT_CHANNEL]
    });
    if (!AHP_PROTOCOL_VERSIONS.includes(String(initialized?.protocolVersion || ''))) {
      throw new Error('VS Code selected an unsupported AHP version.');
    }
    const listed = await request('listSessions', {
      channel: AHP_ROOT_CHANNEL,
      limit: sessionLimit
    });
    const sessions = Array.isArray(listed?.items) ? listed.items : [];
    const inputNeeded = sessions.filter((session) => (Number(session?.status) & 16) !== 0);
    const inputKindsByResource = new Map();
    await Promise.all(inputNeeded.map(async (session) => {
      const resource = String(session?.resource || '');
      if (!/^[a-z][a-z\d+.-]*:\//i.test(resource) || resource === AHP_ROOT_CHANNEL) return;
      try {
        const subscribed = await request('subscribe', { channel: resource });
        const snapshot = subscribed?.snapshot || subscribed?.snapshots?.[0];
        const input = Array.isArray(snapshot?.state?.inputNeeded) ? snapshot.state.inputNeeded : [];
        inputKindsByResource.set(resource, input.map((entry) => String(entry?.kind || '')).filter(Boolean));
      } catch {}
    }));
    return sessions.map((session) => ({
      ...session,
      inputKinds: inputKindsByResource.get(String(session?.resource || '')) || []
    }));
  } finally {
    try { socket.close(); } catch {}
  }
}

function sessionDedupeKey(session) {
  const resource = String(session?.resource || '');
  if (resource) return resource;
  const directories = Array.isArray(session?.workingDirectories) ? session.workingDirectories.join('|') : '';
  return [session?.provider, session?.title, session?.createdAt, directories].map(String).join('\u0000');
}

async function fetchVsCodeAhpSessions({
  metadataPaths,
  endpoints = readVsCodeAhpEndpoints(metadataPaths || []),
  queryEndpoint = queryVsCodeAhpEndpoint,
  ...queryOptions
} = {}) {
  if (!endpoints.length) return { available: false, sessions: [] };
  const results = await Promise.allSettled(endpoints.map((endpoint) => queryEndpoint(endpoint, queryOptions)));
  const successful = results.filter((result) => result.status === 'fulfilled');
  if (!successful.length) return { available: false, sessions: [] };
  const sessions = new Map();
  for (const result of successful) {
    for (const session of result.value) {
      const key = sessionDedupeKey(session);
      const current = sessions.get(key);
      if (!current || Date.parse(session?.modifiedAt || 0) > Date.parse(current?.modifiedAt || 0)) {
        sessions.set(key, session);
      }
    }
  }
  return { available: true, sessions: [...sessions.values()] };
}

module.exports = {
  AHP_PROTOCOL_VERSIONS,
  AHP_ROOT_CHANNEL,
  DEFAULT_AHP_SESSION_LIMIT,
  DEFAULT_AHP_TIMEOUT_MS,
  defaultVsCodeAgentHostMetadataPaths,
  fetchVsCodeAhpSessions,
  isUsableEndpoint,
  queryVsCodeAhpEndpoint,
  readVsCodeAhpEndpoints,
  sessionDedupeKey
};
