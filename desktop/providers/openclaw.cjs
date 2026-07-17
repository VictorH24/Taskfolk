const crypto = require('node:crypto');

const DEFAULT_OPENCLAW_URL = 'ws://127.0.0.1:18789';
const DEFAULT_MAX_SESSIONS = 200;
const OPENCLAW_PROTOCOL_VERSION = 4;
const OPENCLAW_REQUEST_TIMEOUT_MS = 8_000;

function normalizeOpenClawUrl(value) {
  const url = new URL(String(value || DEFAULT_OPENCLAW_URL).trim());
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('The OpenClaw gateway URL must use ws://, wss://, http://, or https://.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol === 'ws:' && !isLoopbackHost(hostname) && !isTailscaleIpv4(hostname) && !isTailscaleIpv6(hostname)) {
    throw new Error('Remote OpenClaw gateways must use wss://. Plain ws:// is allowed only for loopback and Tailscale 100.64.0.0/10 addresses.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function isLoopbackHost(hostname) {
  if (['localhost', '::1'].includes(hostname)) return true;
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets[0] === 127
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

function isTailscaleIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

function isTailscaleIpv6(hostname) {
  return hostname.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

function createOpenClawDeviceIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBytes = publicDer.subarray(publicDer.length - 32);
  return {
    deviceId: crypto.createHash('sha256').update(publicKeyBytes).digest('hex'),
    publicKey: publicKeyBytes.toString('base64url'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  };
}

function buildDeviceAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  return ['v2', deviceId, clientId, clientMode, role, scopes.join(','), String(signedAtMs), token || '', nonce].join('|');
}

function buildConnectDevice(identity, { clientId, clientMode, role, scopes, token, nonce }) {
  if (!identity?.deviceId || !identity?.publicKey || !identity?.privateKey) return undefined;
  const signedAt = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs: signedAt,
    token,
    nonce
  });
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(identity.privateKey, 'base64'),
    type: 'pkcs8',
    format: 'der'
  });
  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url'),
    signedAt,
    nonce
  };
}

function gatewayError(error, key) {
  const message = error?.message || `OpenClaw rejected ${key}.`;
  const detailsCode = String(error?.details?.code || '').toUpperCase();
  let result;
  if (error?.code === 'NOT_PAIRED' || detailsCode.includes('PAIRING_REQUIRED')) {
    result = new Error(`OpenClaw device pairing is required. Approve the Taskfolk device on the OpenClaw host; Taskfolk will retry automatically. ${message}`);
    result.pairingRequired = true;
  } else {
    result = new Error(message);
  }
  result.gatewayCode = String(error?.code || 'UNAVAILABLE');
  result.detailsCode = detailsCode;
  result.requestId = String(error?.details?.requestId || '');
  result.gatewayDetails = error?.details || null;
  return result;
}

function timestampMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionUpdatedMs(session) {
  return Math.max(
    timestampMs(session?.updatedAt),
    timestampMs(session?.lastActivityAt),
    timestampMs(session?.lastInteractionAt),
    timestampMs(session?.startedAt),
    timestampMs(session?.createdAt)
  );
}

function sessionAgentId(session) {
  const explicit = String(session?.agentId || session?.agent_id || '').trim();
  if (explicit) return explicit;
  const match = String(session?.key || session?.sessionKey || '').match(/^agent:([^:]+):/i);
  return match?.[1] || '';
}

function rawSessionStatus(session) {
  return String(
    session?.status ||
    session?.state ||
    session?.agentRuntime?.status ||
    session?.runtime?.status ||
    ''
  ).trim().toLowerCase();
}

function normalizedSessionStatus(session, nowMs) {
  const raw = rawSessionStatus(session);
  if (session?.abortedLastRun || /error|fail|blocked|fatal|abort|cancel/.test(raw)) return 'blocked';
  if (/active|running|working|busy|stream|processing|in[-_ ]?progress|started|queued/.test(raw)) return 'active';
  if (session?.startedAt && !session?.endedAt && !/done|complete|finish|idle|success/.test(raw)) return 'active';
  const updatedAt = sessionUpdatedMs(session);
  if (!raw && updatedAt && nowMs - updatedAt <= 2 * 60 * 1000) return 'active';
  if (/done|complete|finish|success|succeeded/.test(raw) && updatedAt && nowMs - updatedAt <= 30_000) return 'success';
  return 'idle';
}

function configuredAgentRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.agents) ? payload.agents : [];
}

function sessionRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.sessions) ? payload.sessions : [];
}

function agentName(agent, id) {
  return String(agent?.name || agent?.identity?.name || agent?.label || id).trim() || id;
}

function agentModel(agent, session) {
  const value = session?.model || session?.modelOverride || agent?.model || agent?.effectiveModel;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return [value.provider || value.providerId, value.model || value.id || value.modelId].filter(Boolean).join('/');
  }
  return '';
}

function sessionLabel(session) {
  const label = String(
    session?.derivedTitle || session?.displayName || session?.label || session?.subject || ''
  ).trim();
  if (label) return label.slice(0, 240);
  const key = String(session?.key || session?.sessionKey || session?.sessionId || '').trim();
  const shortKey = key.replace(/^agent:[^:]+:/i, '');
  return shortKey ? `Session ${shortKey}`.slice(0, 240) : 'OpenClaw session';
}

function workspacePath(agent, session) {
  return String(
    session?.workspacePath || session?.workspace || session?.cwd ||
    agent?.workspacePath || agent?.workspace || agent?.workspaceDir || ''
  ).trim() || null;
}

function normalizeOpenClawAgents(agentsPayload, sessionsPayload, { now = Date.now } = {}) {
  const nowMs = now();
  const sessions = sessionRows(sessionsPayload);
  const sessionsByAgent = new Map();
  for (const session of sessions) {
    const id = sessionAgentId(session);
    if (!id) continue;
    const current = sessionsByAgent.get(id);
    if (!current || sessionUpdatedMs(session) > sessionUpdatedMs(current)) sessionsByAgent.set(id, session);
  }

  return configuredAgentRows(agentsPayload).map((agent, index) => {
    const id = String(agent?.id || agent?.agentId || `openclaw-agent-${index + 1}`).trim();
    const session = sessionsByAgent.get(id);
    const status = session ? normalizedSessionStatus(session, nowMs) : 'idle';
    // A configured agent without a matching session has no activity timestamp.
    // Using the poll time here makes an untouched agent look perpetually fresh.
    const updatedAt = sessionUpdatedMs(session);
    const model = agentModel(agent, session);
    const key = String(session?.key || session?.sessionKey || session?.sessionId || '').trim();
    return {
      id,
      name: agentName(agent, id),
      role: ['OpenClaw', model].filter(Boolean).join(' · '),
      status,
      task: session ? sessionLabel(session) : 'Configured in OpenClaw; no session activity yet',
      lastSeen: updatedAt ? new Date(updatedAt).toISOString() : null,
      workspacePath: workspacePath(agent, session),
      source: 'openclaw',
      avatarAssignmentKey: `runtime:openclaw:${id}`,
      displayState: status === 'active' ? 'Working' : status === 'blocked' ? 'Blocked' : status === 'success' ? 'Done' : 'Idle',
      pose: status === 'active' ? 'working' : status === 'blocked' ? 'blocked' : null,
      activity: {
        provider: 'openclaw',
        status: rawSessionStatus(session) || (session ? 'idle' : 'configured'),
        derivedStatus: status,
        updatedAt: updatedAt || null,
        sessionLabel: session ? sessionLabel(session).slice(0, 120) : 'Configured agent',
        sessionKeyShort: key.replace(/^agent:[^:]+:/i, '') || null,
        model: model || null
      }
    };
  }).slice(0, 24);
}

function socketData(event) {
  return typeof event?.data === 'string' ? event.data : String(event?.data || event || '');
}

function gatewayRpcBatch({
  baseUrl = DEFAULT_OPENCLAW_URL,
  token = '',
  deviceToken = '',
  password = '',
  deviceIdentity,
  onDeviceToken,
  requests,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = OPENCLAW_REQUEST_TIMEOUT_MS
}) {
  if (typeof WebSocketImpl !== 'function') throw new Error('A WebSocket implementation is required.');
  const url = normalizeOpenClawUrl(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const pending = new Map();
    const results = new Map();
    let settled = false;
    let connected = false;
    const timer = setTimeout(() => finish(new Error('OpenClaw gateway request timed out.')), timeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(Object.fromEntries(results));
    }

    function send(method, params = {}, key = method) {
      const id = `${key}:${Math.random().toString(36).slice(2)}`;
      pending.set(id, key);
      socket.send(JSON.stringify({ type: 'req', id, method, params }));
    }

    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(socketData(event)); } catch { return; }
      if (!connected && frame?.type === 'event' && frame?.event === 'connect.challenge') {
        const selectedToken = String(token || deviceToken || '');
        const auth = {};
        if (selectedToken) auth.token = selectedToken;
        if (deviceToken && !token) auth.deviceToken = String(deviceToken);
        if (password) auth.password = String(password);
        const role = 'operator';
        const scopes = ['operator.read'];
        const clientId = deviceIdentity ? 'cli' : 'gateway-client';
        const clientMode = deviceIdentity ? 'cli' : 'backend';
        const nonce = String(frame?.payload?.nonce || '');
        send('connect', {
          minProtocol: OPENCLAW_PROTOCOL_VERSION,
          maxProtocol: OPENCLAW_PROTOCOL_VERSION,
          client: { id: clientId, displayName: 'Taskfolk', version: '1.0.0', platform: process.platform, mode: clientMode },
          role,
          scopes,
          caps: [],
          commands: [],
          permissions: {},
          auth,
          device: buildConnectDevice(deviceIdentity, {
            clientId,
            clientMode,
            role,
            scopes,
            token: selectedToken,
            nonce
          }),
          locale: 'en-US',
          userAgent: 'taskfolk-desktop/1.0.0'
        }, 'connect');
        return;
      }
      if (frame?.type !== 'res' || !pending.has(frame.id)) return;
      const key = pending.get(frame.id);
      pending.delete(frame.id);
      if (!frame.ok) {
        finish(gatewayError(frame?.error, key));
        return;
      }
      if (key === 'connect') {
        connected = true;
        const issuedToken = String(frame?.payload?.auth?.deviceToken || '');
        if (issuedToken && typeof onDeviceToken === 'function') {
          onDeviceToken(issuedToken, frame?.payload?.auth?.scopes || []);
        }
        for (const request of requests) send(request.method, request.params || {}, request.key || request.method);
        return;
      }
      results.set(key, frame.payload);
      if (results.size === requests.length) finish();
    });
    socket.addEventListener('error', () => finish(new Error('Could not connect to the OpenClaw gateway.')));
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('The OpenClaw gateway closed the connection.'));
    });
  });
}

async function fetchOpenClawAgents({
  baseUrl = DEFAULT_OPENCLAW_URL,
  token = '',
  deviceToken = '',
  password = '',
  deviceIdentity,
  onDeviceToken,
  rpcImpl = gatewayRpcBatch,
  WebSocketImpl,
  timeoutMs,
  now = Date.now
} = {}) {
  const payloads = await rpcImpl({
    baseUrl,
    token,
    deviceToken,
    password,
    deviceIdentity,
    onDeviceToken,
    WebSocketImpl,
    timeoutMs,
    requests: [
      { key: 'agents', method: 'agents.list', params: {} },
      {
        key: 'sessions',
        method: 'sessions.list',
        params: { limit: DEFAULT_MAX_SESSIONS, configuredAgentsOnly: true, includeDerivedTitles: true }
      }
    ]
  });
  return normalizeOpenClawAgents(payloads.agents, payloads.sessions, { now });
}

module.exports = {
  DEFAULT_OPENCLAW_URL,
  buildDeviceAuthPayload,
  createOpenClawDeviceIdentity,
  fetchOpenClawAgents,
  gatewayRpcBatch,
  normalizeOpenClawAgents,
  normalizeOpenClawUrl,
  normalizedSessionStatus,
  sessionAgentId
};
