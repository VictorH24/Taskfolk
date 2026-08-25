const crypto = require('node:crypto');
const { version: TASKFOLK_VERSION } = require('../../package.json');

const DEFAULT_OPENCLAW_URL = 'ws://127.0.0.1:18789';
const DEFAULT_MAX_SESSIONS = 200;
const OPENCLAW_PROTOCOL_VERSION = 4;
const OPENCLAW_REQUEST_TIMEOUT_MS = 8_000;
const OPENCLAW_RECONNECT_MIN_MS = 1_000;
const OPENCLAW_RECONNECT_MAX_MS = 30_000;
const OPENCLAW_DEFAULT_TICK_INTERVAL_MS = 30_000;
const OPENCLAW_LEGACY_REFRESH_MS = 5_000;
const OPENCLAW_OPERATOR_SCOPES = Object.freeze(['operator.read', 'operator.approvals']);

function normalizeOpenClawUrl(value) {
  const input = String(value || DEFAULT_OPENCLAW_URL).trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `ws://${input}`);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('The OpenClaw gateway URL must use ws://, wss://, http://, or https://.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol === 'ws:' && !isLoopbackHost(hostname) && !isDockerHost(hostname) && !isTailscaleIpv4(hostname) && !isTailscaleIpv6(hostname)) {
    throw new Error('Remote OpenClaw gateways must use wss://. Plain ws:// is allowed only for loopback, host.docker.internal, and Tailscale addresses.');
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

function isDockerHost(hostname) {
  return hostname === 'host.docker.internal';
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

function buildDeviceAuthPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return [
    'v3',
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token || '',
    nonce,
    String(platform || '').trim().toLowerCase(),
    String(deviceFamily || '').trim().toLowerCase()
  ].join('|');
}

function buildConnectDevice(identity, {
  clientId,
  clientMode,
  role,
  scopes,
  token,
  nonce,
  signedAtMs,
  platform = process.platform,
  deviceFamily = '',
  signatureVersion = 'v2'
}) {
  if (!identity?.deviceId || !identity?.publicKey || !identity?.privateKey) return undefined;
  const signedAt = Number.isSafeInteger(signedAtMs) && signedAtMs >= 0 ? signedAtMs : Date.now();
  const params = {
    deviceId: identity.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs: signedAt,
    token,
    nonce,
    platform,
    deviceFamily
  };
  const payload = signatureVersion === 'v3'
    ? buildDeviceAuthPayloadV3(params)
    : buildDeviceAuthPayload(params);
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

function sessionActiveRunState(session) {
  if (Array.isArray(session?.activeRunIds) && session.activeRunIds.length === 0) return false;
  if (typeof session?.hasActiveRun === 'boolean') return session.hasActiveRun;
  if (typeof session?.agentRuntime?.hasActiveRun === 'boolean') return session.agentRuntime.hasActiveRun;
  if (Array.isArray(session?.activeRunIds)) return session.activeRunIds.length > 0;
  return null;
}

function normalizedSessionStatus(session, nowMs) {
  const raw = rawSessionStatus(session);
  if (session?.abortedLastRun || /error|fail|blocked|fatal|abort|cancel/.test(raw)) return 'blocked';
  const activeRun = sessionActiveRunState(session);
  if (activeRun === true) return 'active';
  if (activeRun === false) {
    const updatedAt = sessionUpdatedMs(session);
    return updatedAt && nowMs - updatedAt <= 30_000 ? 'success' : 'idle';
  }
  if (/active|running|working|busy|stream|processing|in[-_ ]?progress|started|queued/.test(raw)) return 'active';
  if (session?.startedAt && !session?.endedAt && !/done|complete|finish|idle|success/.test(raw)) return 'active';
  const updatedAt = sessionUpdatedMs(session);
  if (!raw && updatedAt && nowMs - updatedAt <= 2 * 60 * 1000) return 'active';
  // OpenClaw gateway snapshots may expose a completed run only as a freshly
  // updated idle session, without an observable active -> idle transition.
  if (/done|complete|finish|idle|success|succeeded/.test(raw) && updatedAt && nowMs - updatedAt <= 30_000) return 'success';
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

function approvalRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['approvals', 'requests', 'pending', 'items']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function approvalValue(approval, keys) {
  const sources = [
    approval,
    approval?.approval,
    approval?.request,
    approval?.payload,
    approval?.context,
    approval?.metadata,
    approval?.systemRunPlan
  ];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = String(source[key] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

function approvalSessionKey(approval) {
  return approvalValue(approval, ['sessionKey', 'session_key', 'sessionId', 'sessionID']);
}

function approvalAgentId(approval) {
  const explicit = approvalValue(approval, ['agentId', 'agent_id']);
  return explicit || sessionAgentId({ key: approvalSessionKey(approval) });
}

function approvalTargets(payloads) {
  const sessionKeys = new Set();
  const agentIds = new Set();
  for (const payload of payloads || []) {
    for (const approval of approvalRows(payload)) {
      const sessionKey = approvalSessionKey(approval);
      const agentId = approvalAgentId(approval);
      if (sessionKey) sessionKeys.add(sessionKey);
      if (agentId) agentIds.add(agentId);
    }
  }
  return { sessionKeys, agentIds };
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

function normalizeOpenClawAgents(agentsPayload, sessionsPayload, {
  now = Date.now,
  approvalPayloads = []
} = {}) {
  const nowMs = now();
  const sessions = sessionRows(sessionsPayload);
  const sessionsByAgent = new Map();
  const approvals = approvalTargets(approvalPayloads);
  for (const session of sessions) {
    const id = sessionAgentId(session);
    if (!id) continue;
    const rows = sessionsByAgent.get(id) || [];
    rows.push(session);
    sessionsByAgent.set(id, rows);
  }

  return configuredAgentRows(agentsPayload).map((agent, index) => {
    const id = String(agent?.id || agent?.agentId || `openclaw-agent-${index + 1}`).trim();
    const agentSessions = sessionsByAgent.get(id) || [];
    agentSessions.sort((left, right) => sessionUpdatedMs(right) - sessionUpdatedMs(left));
    const approvalSession = agentSessions.find((candidate) => {
      const key = String(candidate?.key || candidate?.sessionKey || candidate?.sessionId || '').trim();
      return approvals.sessionKeys.has(key);
    });
    const awaitingApproval = Boolean(approvalSession || approvals.agentIds.has(id));
    const session = approvalSession || agentSessions[0];
    const status = awaitingApproval
      ? 'blocked'
      : (session ? normalizedSessionStatus(session, nowMs) : 'idle');
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
      displayState: awaitingApproval ? 'Needs approval' : status === 'active' ? 'Working' : status === 'blocked' ? 'Blocked' : status === 'success' ? 'Done' : 'Idle',
      pose: awaitingApproval ? 'approval' : status === 'active' ? 'working' : status === 'blocked' ? 'blocked' : null,
      activity: {
        provider: 'openclaw',
        status: awaitingApproval ? 'approval' : (rawSessionStatus(session) || (session ? 'idle' : 'configured')),
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

function gatewaySessionKey(session) {
  return String(session?.key || session?.sessionKey || session?.sessionId || '').trim();
}

function gatewayApprovalId(approval) {
  return String(
    approval?.id || approval?.approvalId || approval?.requestId
    || approval?.approval?.id || approval?.request?.id || ''
  ).trim();
}

class OpenClawGatewayClient {
  constructor({
    baseUrl = DEFAULT_OPENCLAW_URL,
    token = '',
    deviceToken = '',
    password = '',
    deviceIdentity,
    onDeviceToken,
    onSnapshot,
    onError,
    includeConfig = false,
    includeCron = false,
    WebSocketImpl = globalThis.WebSocket,
    timeoutMs = OPENCLAW_REQUEST_TIMEOUT_MS,
    reconnectMinMs = OPENCLAW_RECONNECT_MIN_MS,
    reconnectMaxMs = OPENCLAW_RECONNECT_MAX_MS,
    legacyRefreshMs = OPENCLAW_LEGACY_REFRESH_MS,
    activeRefreshMs = OPENCLAW_LEGACY_REFRESH_MS,
    now = Date.now
  } = {}) {
    if (typeof WebSocketImpl !== 'function') throw new Error('A WebSocket implementation is required.');
    this.baseUrl = normalizeOpenClawUrl(baseUrl);
    this.token = String(token || '');
    this.deviceToken = String(deviceToken || '');
    this.password = String(password || '');
    this.deviceIdentity = deviceIdentity;
    this.onDeviceToken = onDeviceToken;
    this.onSnapshot = onSnapshot;
    this.onError = onError;
    this.includeConfig = Boolean(includeConfig);
    this.includeCron = Boolean(includeCron);
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = Math.max(10, Number(timeoutMs) || OPENCLAW_REQUEST_TIMEOUT_MS);
    this.reconnectMinMs = Math.max(10, Number(reconnectMinMs) || OPENCLAW_RECONNECT_MIN_MS);
    this.reconnectMaxMs = Math.max(this.reconnectMinMs, Number(reconnectMaxMs) || OPENCLAW_RECONNECT_MAX_MS);
    this.legacyRefreshMs = Math.max(10, Number(legacyRefreshMs) || OPENCLAW_LEGACY_REFRESH_MS);
    this.activeRefreshMs = Math.max(10, Number(activeRefreshMs) || OPENCLAW_LEGACY_REFRESH_MS);
    this.now = now;
    this.socket = null;
    this.pending = new Map();
    this.connectionPromise = null;
    this.connectionResolve = null;
    this.connectionReject = null;
    this.handshakeTimer = null;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.legacyRefreshTimer = null;
    this.activeRefreshTimer = null;
    this.refreshTimer = null;
    this.refreshRequest = null;
    this.queuedRefresh = new Set();
    this.reconnectDelayMs = this.reconnectMinMs;
    this.tickIntervalMs = OPENCLAW_DEFAULT_TICK_INTERVAL_MS;
    this.lastError = null;
    this.connected = false;
    this.stopped = false;
    this.hasSnapshot = false;
    this.initializing = false;
    this.eventSequence = null;
    this.queuedEvents = [];
    this.agentsPayload = { agents: [] };
    this.sessionsPayload = { sessions: [] };
    this.configPayload = null;
    this.cronPayload = { jobs: [] };
    this.execApprovals = new Map();
    this.pluginApprovals = new Map();
  }

  async getSnapshot() {
    if (!this.connected || !this.hasSnapshot || this.initializing) await this.connect();
    return this.snapshot();
  }

  snapshot() {
    if (!this.hasSnapshot) return null;
    const approvalPayloads = [
      { approvals: [...this.execApprovals.values()] },
      { approvals: [...this.pluginApprovals.values()] }
    ];
    return {
      agents: normalizeOpenClawAgents(this.agentsPayload, this.sessionsPayload, {
        now: this.now,
        approvalPayloads
      }),
      sessions: [...sessionRows(this.sessionsPayload)],
      config: this.configPayload?.config || this.configPayload?.value || this.configPayload || null,
      cronJobs: Array.isArray(this.cronPayload?.jobs) ? [...this.cronPayload.jobs] : []
    };
  }

  connect({ force = false } = {}) {
    if (this.stopped) return Promise.reject(new Error('The OpenClaw gateway client has stopped.'));
    if (this.connectionPromise) return this.connectionPromise;
    if (this.connected && this.hasSnapshot && !this.initializing) return Promise.resolve(this.snapshot());
    if (this.reconnectTimer && !force) {
      return Promise.reject(this.lastError || new Error('The OpenClaw gateway is reconnecting.'));
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    let resolveConnection;
    let rejectConnection;
    this.connectionPromise = new Promise((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    this.connectionResolve = resolveConnection;
    this.connectionReject = rejectConnection;
    const connectionPromise = this.connectionPromise;

    try {
      const socket = new this.WebSocketImpl(this.baseUrl);
      this.socket = socket;
      this.eventSequence = null;
      this.queuedEvents = [];
      this.handshakeTimer = setTimeout(() => {
        this.disconnect(new Error('OpenClaw gateway request timed out.'), socket);
      }, this.timeoutMs);
      this.handshakeTimer.unref?.();

      socket.addEventListener('message', (event) => this.handleMessage(event, socket));
      socket.addEventListener('error', () => {
        this.disconnect(new Error('Could not connect to the OpenClaw gateway.'), socket);
      });
      socket.addEventListener('close', () => {
        this.disconnect(new Error('The OpenClaw gateway closed the connection.'), socket);
      });
    } catch (error) {
      this.disconnect(error, this.socket);
    }

    return connectionPromise;
  }

  async request(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.connected || !this.hasSnapshot || this.initializing) await this.connect();
    return this.sendRequest(method, params, timeoutMs);
  }

  sendRequest(method, params = {}, timeoutMs = this.timeoutMs) {
    if (!this.socket || (!this.connected && method !== 'connect')) {
      return Promise.reject(new Error('The OpenClaw gateway is not connected.'));
    }
    const socket = this.socket;
    const id = `${method}:${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenClaw gateway request timed out: ${method}.`));
      }, Math.max(10, Number(timeoutMs) || this.timeoutMs));
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer, socket });
      try {
        socket.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleMessage(event, socket) {
    if (socket !== this.socket || this.stopped) return;
    let frame;
    try { frame = JSON.parse(socketData(event)); } catch { return; }
    if (this.connected) this.scheduleWatchdog();

    if (!this.connected && frame?.type === 'event' && frame?.event === 'connect.challenge') {
      this.handleChallenge(frame.payload, socket);
      return;
    }

    if (frame?.type === 'res') {
      const pending = this.pending.get(frame.id);
      if (!pending || pending.socket !== socket) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (!frame.ok) pending.reject(gatewayError(frame.error, pending.method));
      else pending.resolve(frame.payload);
      return;
    }

    if (frame?.type !== 'event' || !this.connected) return;
    if (Number.isSafeInteger(frame.seq)) {
      if (this.eventSequence !== null && frame.seq > this.eventSequence + 1) {
        this.scheduleRefresh('agents', 'sessions', 'approvals', ...(this.includeCron ? ['cron'] : []));
      }
      if (this.eventSequence !== null && frame.seq <= this.eventSequence) return;
      this.eventSequence = frame.seq;
    }
    if (this.initializing || !this.hasSnapshot) {
      this.queuedEvents.push(frame);
      return;
    }
    this.applyEvent(frame);
  }

  handleChallenge(challenge, socket) {
    const nonce = String(challenge?.nonce || '');
    const signedAtMs = challenge?.ts;
    if (!nonce || (this.deviceIdentity && (!Number.isSafeInteger(signedAtMs) || signedAtMs < 0))) {
      this.disconnect(new Error('The OpenClaw gateway sent an invalid connection challenge.'), socket);
      return;
    }
    const selectedToken = String(this.token || this.deviceToken || '');
    const auth = {};
    if (selectedToken) auth.token = selectedToken;
    if (this.deviceToken && !this.token) auth.deviceToken = this.deviceToken;
    if (this.password) auth.password = this.password;
    const role = 'operator';
    const scopes = [...OPENCLAW_OPERATOR_SCOPES];
    const clientId = this.deviceIdentity ? 'cli' : 'gateway-client';
    const clientMode = this.deviceIdentity ? 'cli' : 'backend';
    const platform = process.platform;
    const params = {
      minProtocol: OPENCLAW_PROTOCOL_VERSION,
      maxProtocol: OPENCLAW_PROTOCOL_VERSION,
      client: { id: clientId, displayName: 'Taskfolk', version: TASKFOLK_VERSION, platform, mode: clientMode },
      role,
      scopes,
      caps: ['approvals', 'exec-approvals', 'plugin-approvals'],
      commands: [],
      permissions: {},
      auth,
      device: buildConnectDevice(this.deviceIdentity, {
        clientId,
        clientMode,
        role,
        scopes,
        token: selectedToken,
        nonce,
        signedAtMs,
        platform,
        signatureVersion: 'v3'
      }),
      locale: 'en-US',
      userAgent: 'taskfolk-desktop'
    };

    this.sendRequest('connect', params).then((hello) => {
      if (socket !== this.socket || this.stopped) return;
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.connected = true;
      this.initializing = true;
      this.tickIntervalMs = Math.max(10, Number(hello?.policy?.tickIntervalMs) || OPENCLAW_DEFAULT_TICK_INTERVAL_MS);
      this.scheduleWatchdog();
      const issuedToken = String(hello?.auth?.deviceToken || '');
      if (issuedToken) {
        this.deviceToken = issuedToken;
        if (typeof this.onDeviceToken === 'function') this.onDeviceToken(issuedToken, hello?.auth?.scopes || []);
      }
      return this.hydrate(socket);
    }).catch((error) => this.disconnect(error, socket));
  }

  async hydrate(socket) {
    const optional = (method, params = {}) => this.sendRequest(method, params).catch(() => null);
    const [agents, sessions, config, cron, execApprovals, pluginApprovals] = await Promise.all([
      this.sendRequest('agents.list', {}),
      this.sendRequest('sessions.list', {
        limit: DEFAULT_MAX_SESSIONS,
        configuredAgentsOnly: true,
        includeDerivedTitles: true
      }),
      this.includeConfig ? optional('config.get') : Promise.resolve(null),
      this.includeCron ? optional('cron.list', { includeDisabled: true, limit: 200 }) : Promise.resolve(null),
      optional('exec.approval.list'),
      optional('plugin.approval.list')
    ]);
    if (socket !== this.socket || this.stopped) return;

    this.agentsPayload = agents || { agents: [] };
    this.sessionsPayload = sessions || { sessions: [] };
    this.configPayload = config;
    this.cronPayload = cron || { jobs: [] };
    this.replaceApprovals(this.execApprovals, execApprovals);
    this.replaceApprovals(this.pluginApprovals, pluginApprovals);
    this.hasSnapshot = true;

    let subscribed = false;
    try {
      await this.sendRequest('sessions.subscribe', {});
      subscribed = true;
    } catch {}
    if (socket !== this.socket || this.stopped) return;

    this.initializing = false;
    const events = this.queuedEvents.splice(0);
    for (const frame of events) this.applyEvent(frame, false);
    if (this.queuedRefresh.size) this.scheduleRefresh();
    this.lastError = null;
    this.reconnectDelayMs = this.reconnectMinMs;
    if (!subscribed) this.scheduleLegacyRefresh();
    this.notifySnapshot();
    const resolve = this.connectionResolve;
    this.connectionResolve = null;
    this.connectionReject = null;
    this.connectionPromise = null;
    resolve?.(this.snapshot());
  }

  replaceApprovals(target, payload) {
    target.clear();
    for (const approval of approvalRows(payload)) {
      const id = gatewayApprovalId(approval);
      if (id) target.set(id, approval);
    }
  }

  applyEvent(frame, notify = true) {
    const event = String(frame?.event || '');
    const payload = frame?.payload && typeof frame.payload === 'object' ? frame.payload : {};
    let changed = false;

    if (event === 'sessions.changed') {
      changed = this.applySessionChange(payload);
    } else if (event === 'agent') {
      changed = this.applyAgentEvent(payload);
    } else if (event === 'exec.approval.requested' || event === 'plugin.approval.requested') {
      const target = event.startsWith('exec.') ? this.execApprovals : this.pluginApprovals;
      const id = gatewayApprovalId(payload);
      if (id) {
        target.set(id, payload);
        changed = true;
      } else {
        this.scheduleRefresh('approvals');
      }
    } else if (event === 'exec.approval.resolved' || event === 'plugin.approval.resolved') {
      const target = event.startsWith('exec.') ? this.execApprovals : this.pluginApprovals;
      const id = gatewayApprovalId(payload);
      if (id) changed = target.delete(id);
      else this.scheduleRefresh('approvals');
    } else if (event === 'cron' && this.includeCron) {
      this.scheduleRefresh('cron');
    } else if (event === 'config.changed') {
      this.scheduleRefresh('agents', ...(this.includeConfig ? ['config'] : []));
    } else if (event === 'shutdown') {
      this.disconnect(new Error('The OpenClaw gateway is shutting down.'), this.socket);
      return;
    }

    if (changed && notify) this.notifySnapshot();
  }

  applySessionChange(payload) {
    const row = payload?.session && typeof payload.session === 'object'
      ? payload.session
      : payload?.row && typeof payload.row === 'object'
        ? payload.row
        : payload;
    const key = gatewaySessionKey(row) || gatewaySessionKey(payload);
    if (!key) {
      this.scheduleRefresh('sessions');
      return false;
    }
    const sessions = sessionRows(this.sessionsPayload);
    const index = sessions.findIndex((session) => gatewaySessionKey(session) === key);
    const reason = String(payload.reason || payload.action || payload.type || '').toLowerCase();
    if (/delete|remove/.test(reason)) {
      if (index < 0) return false;
      sessions.splice(index, 1);
      return true;
    }

    const meaningfulKeys = Object.keys(row).filter((field) => !['key', 'sessionKey', 'sessionId', 'reason', 'action', 'type'].includes(field));
    if (!meaningfulKeys.length) {
      this.scheduleRefresh('sessions');
      return false;
    }
    const previous = index >= 0 ? sessions[index] : null;
    const includesActivity = ['status', 'state', 'hasActiveRun', 'activeRunIds', 'startedAt', 'endedAt']
      .some((field) => Object.prototype.hasOwnProperty.call(row, field))
      || ['agentRuntime', 'runtime'].some((field) => {
        const runtime = row[field];
        return runtime && typeof runtime === 'object'
          && ['status', 'hasActiveRun'].some((key) => Object.prototype.hasOwnProperty.call(runtime, key));
      });
    const merged = { ...(index >= 0 ? sessions[index] : {}), ...row, key };
    if (Object.prototype.hasOwnProperty.call(row, 'activeRunIds') && row.activeRunIds === null) {
      delete merged.activeRunIds;
    }
    if (index >= 0) sessions[index] = merged;
    else sessions.push(merged);
    if (previous && normalizedSessionStatus(previous, this.now()) === 'active' && !includesActivity) {
      this.scheduleRefresh('sessions');
    }
    return true;
  }

  applyAgentEvent(payload) {
    const key = gatewaySessionKey(payload) || gatewaySessionKey(payload?.data);
    if (!key) return false;
    const phase = String(payload?.data?.phase || payload.phase || payload.status || '').trim().toLowerCase();
    let status;
    if (/start|running|active/.test(phase)) status = 'running';
    else if (/error|fail|abort/.test(phase)) status = 'failed';
    else if (/end|finish|complete|success/.test(phase)) status = 'idle';
    else return false;
    const changed = this.applySessionChange({
      key,
      status,
      updatedAt: this.now(),
      ...(payload.agentId ? { agentId: payload.agentId } : {})
    });
    if (status !== 'running') this.scheduleRefresh('sessions');
    return changed;
  }

  scheduleRefresh(...sections) {
    for (const section of sections) this.queuedRefresh.add(section);
    if (this.refreshTimer || this.initializing || this.stopped) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const selected = [...this.queuedRefresh];
      this.queuedRefresh.clear();
      void this.refresh(selected).catch((error) => {
        if (this.connected && typeof this.onError === 'function') this.onError(error);
      });
    }, 25);
    this.refreshTimer.unref?.();
  }

  async refresh(sections = ['agents', 'sessions', 'approvals']) {
    if (!this.connected || this.stopped) return this.getSnapshot();
    if (this.refreshRequest) {
      for (const section of sections) this.queuedRefresh.add(section);
      return this.refreshRequest;
    }
    const selected = new Set(sections);
    const request = (async () => {
      const operations = [];
      if (selected.has('agents')) operations.push(this.sendRequest('agents.list').then((payload) => { this.agentsPayload = payload; }));
      if (selected.has('sessions')) operations.push(this.sendRequest('sessions.list', {
        limit: DEFAULT_MAX_SESSIONS,
        configuredAgentsOnly: true,
        includeDerivedTitles: true
      }).then((payload) => { this.sessionsPayload = payload; }));
      if (selected.has('config') && this.includeConfig) {
        operations.push(this.sendRequest('config.get').then((payload) => { this.configPayload = payload; }).catch(() => {}));
      }
      if (selected.has('cron') && this.includeCron) {
        operations.push(this.sendRequest('cron.list', { includeDisabled: true, limit: 200 })
          .then((payload) => { this.cronPayload = payload; }).catch(() => {}));
      }
      if (selected.has('approvals')) {
        operations.push(this.sendRequest('exec.approval.list')
          .then((payload) => this.replaceApprovals(this.execApprovals, payload)).catch(() => {}));
        operations.push(this.sendRequest('plugin.approval.list')
          .then((payload) => this.replaceApprovals(this.pluginApprovals, payload)).catch(() => {}));
      }
      await Promise.all(operations);
      this.notifySnapshot();
      return this.snapshot();
    })().finally(() => {
      if (this.refreshRequest === request) this.refreshRequest = null;
      if (this.queuedRefresh.size) this.scheduleRefresh();
    });
    this.refreshRequest = request;
    return request;
  }

  notifySnapshot() {
    if (!this.hasSnapshot) return;
    this.scheduleActiveRefresh();
    if (typeof this.onSnapshot === 'function') this.onSnapshot(this.snapshot());
  }

  scheduleActiveRefresh() {
    clearTimeout(this.activeRefreshTimer);
    this.activeRefreshTimer = null;
    if (!this.connected || this.stopped || this.initializing || this.legacyRefreshTimer) return;
    const nowMs = this.now();
    if (!sessionRows(this.sessionsPayload).some((session) => normalizedSessionStatus(session, nowMs) === 'active')) return;
    this.activeRefreshTimer = setTimeout(() => {
      this.activeRefreshTimer = null;
      void this.refresh(['sessions']).catch((error) => {
        if (!this.connected || this.stopped) return;
        if (typeof this.onError === 'function') this.onError(error);
        this.scheduleActiveRefresh();
      });
    }, this.activeRefreshMs);
    this.activeRefreshTimer.unref?.();
  }

  scheduleWatchdog() {
    clearTimeout(this.watchdogTimer);
    if (!this.connected || this.stopped) return;
    const socket = this.socket;
    this.watchdogTimer = setTimeout(() => {
      this.disconnect(new Error('The OpenClaw gateway stopped sending heartbeat events.'), socket);
    }, this.tickIntervalMs * 2);
    this.watchdogTimer.unref?.();
  }

  scheduleLegacyRefresh() {
    clearInterval(this.legacyRefreshTimer);
    this.legacyRefreshTimer = setInterval(() => {
      void this.refresh(['agents', 'sessions', 'approvals', ...(this.includeCron ? ['cron'] : [])]).catch(() => {});
    }, this.legacyRefreshMs);
    this.legacyRefreshTimer.unref?.();
  }

  disconnect(error, socket = this.socket) {
    if (socket && socket !== this.socket) return;
    const current = this.socket;
    this.socket = null;
    this.lastError = error;
    this.connected = false;
    this.initializing = false;
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.watchdogTimer);
    clearTimeout(this.refreshTimer);
    clearTimeout(this.activeRefreshTimer);
    clearInterval(this.legacyRefreshTimer);
    this.handshakeTimer = null;
    this.watchdogTimer = null;
    this.refreshTimer = null;
    this.activeRefreshTimer = null;
    this.legacyRefreshTimer = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
    const reject = this.connectionReject;
    this.connectionResolve = null;
    this.connectionReject = null;
    this.connectionPromise = null;
    reject?.(error);
    try { current?.close(); } catch {}
    if (this.stopped) return;
    if (typeof this.onError === 'function') this.onError(error);
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectMaxMs, Math.max(this.reconnectMinMs, delay * 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {});
    }, delay);
    this.reconnectTimer.unref?.();
  }

  close() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.disconnect(new Error('The OpenClaw gateway client has stopped.'), this.socket);
  }
}

function createOpenClawGatewayClient(options) {
  return new OpenClawGatewayClient(options);
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
        const scopes = requests.some((request) => /(?:^|\.)approval(?:\.|$)/.test(request.method))
          ? ['operator.read', 'operator.approvals']
          : ['operator.read'];
        const clientId = deviceIdentity ? 'cli' : 'gateway-client';
        const clientMode = deviceIdentity ? 'cli' : 'backend';
        const nonce = String(frame?.payload?.nonce || '');
        const signedAtMs = Number(frame?.payload?.ts);
        send('connect', {
          minProtocol: OPENCLAW_PROTOCOL_VERSION,
          maxProtocol: OPENCLAW_PROTOCOL_VERSION,
          client: { id: clientId, displayName: 'Taskfolk', version: TASKFOLK_VERSION, platform: process.platform, mode: clientMode },
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
            nonce,
            signedAtMs
          }),
          locale: 'en-US',
          userAgent: 'taskfolk-desktop'
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
  gatewayClient,
  WebSocketImpl,
  timeoutMs,
  now = Date.now
} = {}) {
  if (gatewayClient) return (await gatewayClient.getSnapshot()).agents;
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
  let approvalPayloads = [];
  try {
    const approvalResult = await rpcImpl({
      baseUrl,
      token,
      deviceToken,
      password,
      deviceIdentity,
      onDeviceToken,
      WebSocketImpl,
      timeoutMs,
      requests: [
        { key: 'execApprovals', method: 'exec.approval.list', params: {} },
        { key: 'pluginApprovals', method: 'plugin.approval.list', params: {} }
      ]
    });
    approvalPayloads = [approvalResult.execApprovals, approvalResult.pluginApprovals];
  } catch {}
  return normalizeOpenClawAgents(payloads.agents, payloads.sessions, { now, approvalPayloads });
}

async function fetchOpenClawSnapshot({
  baseUrl = DEFAULT_OPENCLAW_URL,
  token = '',
  deviceToken = '',
  password = '',
  deviceIdentity,
  onDeviceToken,
  rpcImpl = gatewayRpcBatch,
  gatewayClient,
  WebSocketImpl,
  timeoutMs,
  now = Date.now
} = {}) {
  if (gatewayClient) return gatewayClient.getSnapshot();
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
      },
      { key: 'config', method: 'config.get', params: {} },
      { key: 'cron', method: 'cron.list', params: { includeDisabled: true, limit: 200 } }
    ]
  });
  let approvalPayloads = [];
  try {
    const approvalResult = await rpcImpl({
      baseUrl,
      token,
      deviceToken,
      password,
      deviceIdentity,
      onDeviceToken,
      WebSocketImpl,
      timeoutMs,
      requests: [
        { key: 'execApprovals', method: 'exec.approval.list', params: {} },
        { key: 'pluginApprovals', method: 'plugin.approval.list', params: {} }
      ]
    });
    approvalPayloads = [approvalResult.execApprovals, approvalResult.pluginApprovals];
  } catch {}
  return {
    agents: normalizeOpenClawAgents(payloads.agents, payloads.sessions, { now, approvalPayloads }),
    sessions: sessionRows(payloads.sessions),
    config: payloads.config?.config || payloads.config?.value || payloads.config || null,
    cronJobs: Array.isArray(payloads.cron?.jobs) ? payloads.cron.jobs : []
  };
}

async function fetchOpenClawCronRuns({
  id,
  limit = 24,
  baseUrl = DEFAULT_OPENCLAW_URL,
  token = '',
  deviceToken = '',
  password = '',
  deviceIdentity,
  onDeviceToken,
  rpcImpl = gatewayRpcBatch,
  gatewayClient,
  WebSocketImpl,
  timeoutMs
} = {}) {
  const jobId = String(id || '').trim();
  if (!jobId) throw new Error('An OpenClaw cron job id is required.');
  const rowLimit = Math.max(1, Math.min(Number(limit) || 24, 100));
  const payloads = gatewayClient
    ? { runs: await gatewayClient.request('cron.runs', { id: jobId, limit: rowLimit }) }
    : await rpcImpl({
        baseUrl,
        token,
        deviceToken,
        password,
        deviceIdentity,
        onDeviceToken,
        WebSocketImpl,
        timeoutMs,
        requests: [{ key: 'runs', method: 'cron.runs', params: { id: jobId, limit: rowLimit } }]
      });
  const payload = payloads.runs && typeof payloads.runs === 'object' ? payloads.runs : {};
  return {
    ...payload,
    jobId,
    runs: Array.isArray(payload.runs) ? payload.runs : Array.isArray(payload.entries) ? payload.entries : []
  };
}

module.exports = {
  DEFAULT_OPENCLAW_URL,
  OpenClawGatewayClient,
  buildDeviceAuthPayload,
  buildDeviceAuthPayloadV3,
  createOpenClawDeviceIdentity,
  createOpenClawGatewayClient,
  fetchOpenClawAgents,
  fetchOpenClawCronRuns,
  fetchOpenClawSnapshot,
  gatewayRpcBatch,
  normalizeOpenClawAgents,
  normalizeOpenClawUrl,
  normalizedSessionStatus,
  approvalAgentId,
  approvalSessionKey,
  sessionAgentId,
  sessionActiveRunState
};
