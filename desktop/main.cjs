const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, Tray } = require('electron');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_OPENCODE_URL,
  fetchOpenCodeAgents,
  normalizeOpenCodeGrouping,
  normalizeOpenCodeUrl
} = require('./providers/opencode.cjs');
const { fetchOpenCodeDesktopAgents } = require('./providers/opencode-desktop.cjs');
const {
  DEFAULT_OPENCLAW_URL,
  createOpenClawDeviceIdentity,
  fetchOpenClawAgents,
  normalizeOpenClawUrl
} = require('./providers/openclaw.cjs');
const {
  fetchVsCodeCopilotAgents,
  normalizeVsCodeCopilotGrouping
} = require('./providers/vscode-copilot.cjs');
const {
  fetchCodexAgents,
  normalizeCodexGrouping
} = require('./providers/codex.cjs');
const {
  fetchClaudeAgents,
  normalizeClaudeGrouping
} = require('./providers/claude.cjs');
const { normalizeLocalServerPort } = require('./local-server.cjs');

const DEFAULT_BOUNDS = { width: 720, height: 500 };
const DEFAULT_AVATAR_BOUNDS = { width: 300, height: 380 };
const AVATAR_SIZE_PRESETS = [
  { label: 'Tiny', width: 120, height: 150 },
  { label: 'Extra Small', width: 150, height: 190 },
  { label: 'Small', width: 220, height: 280 },
  { label: 'Medium', width: 300, height: 380 },
  { label: 'Large', width: 420, height: 540 },
  { label: 'Extra Large', width: 560, height: 720 }
];
const PARTITION = 'persist:taskfolk';
const APP_ICON_PATH = path.join(__dirname, 'icon.png');
const MOST_RECENT_AGENT_ID = '__latest__';
const OPENCODE_REFRESH_MS = 5_000;
const OPENCODE_REQUEST_TIMEOUT_MS = 2_500;
const VSCODE_COPILOT_REFRESH_MS = 5_000;
const CODEX_REFRESH_MS = 5_000;
const CLAUDE_REFRESH_MS = 5_000;
const OPENCLAW_REFRESH_MS = 5_000;
const LOCAL_SERVER_START_TIMEOUT_MS = 12_000;

app.setName('Taskfolk');

let officeWindow = null;
let settingsWindow = null;
let configWindow = null;
let tray = null;
let boundsTimer = null;
let runtimeCredentials = null;
let startupError = '';
let activeBaseUrl = '';
let availableAgents = [];
let openCodeTimer = null;
let openCodeSyncInFlight = false;
let openCodePublished = false;
let openCodeLastError = '';
let runtimeOpenCodeCredentials = null;
let openClawTimer = null;
let openClawSyncInFlight = false;
let openClawPublished = false;
let openClawLastError = '';
let runtimeOpenClawCredentials = null;
let runtimeOpenClawCredentialsUrl = '';
let runtimeOpenClawUrl = '';
let runtimeOpenClawDeviceIdentity = null;
let localServerProcess = null;
let localServerUrl = '';
let localServerCredentials = null;
let vsCodeCopilotTimer = null;
let vsCodeCopilotSyncInFlight = false;
let vsCodeCopilotPublished = false;
let vsCodeCopilotLastError = '';
let codexTimer = null;
let codexSyncInFlight = false;
let codexPublished = false;
let codexLastError = '';
let claudeTimer = null;
let claudeSyncInFlight = false;
let claudePublished = false;
let claudeLastError = '';
let quitting = false;
const runtimeAgentMenuSignatures = new Map();
const companionWindows = new Map();
const windowDrags = new Map();
const mouseIgnoringWindows = new Set();

function companionWindowForSender(event) {
  for (const window of companionWindows.keys()) {
    if (!window.isDestroyed() && event.sender === window.webContents) return window;
  }
  return null;
}

ipcMain.on('office-window-drag:start', (event) => {
  const window = companionWindowForSender(event);
  if (!window) return;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = window.getPosition();
  windowDrags.set(window, { cursor, x, y });
});

ipcMain.on('office-window-drag:move', (event) => {
  const window = companionWindowForSender(event);
  const windowDrag = window && windowDrags.get(window);
  if (!window || !windowDrag) return;
  const cursor = screen.getCursorScreenPoint();
  window.setPosition(
    Math.round(windowDrag.x + cursor.x - windowDrag.cursor.x),
    Math.round(windowDrag.y + cursor.y - windowDrag.cursor.y)
  );
});

ipcMain.on('office-window-drag:end', (event) => {
  const window = companionWindowForSender(event);
  if (!window) return;
  windowDrags.delete(window);
  if (window === officeWindow) saveWindowBounds();
});

ipcMain.on('office-window-mouse:ignore', (event, requested) => {
  const window = companionWindowForSender(event);
  if (!window) return;
  const metadata = companionWindows.get(window);
  const ignore = Boolean(requested) && (metadata?.agentId || displayMode(readConfig()) === 'avatar');
  if (ignore === mouseIgnoringWindows.has(window)) return;
  if (ignore) {
    mouseIgnoringWindows.add(window);
    window.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mouseIgnoringWindows.delete(window);
    window.setIgnoreMouseEvents(false);
  }
});

function displayMode(config = readConfig()) {
  return config.displayMode === 'avatar' ? 'avatar' : 'office';
}

function normalizedOpacity(value) {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.max(0.25, Math.min(1, opacity)) : 1;
}

function configPath() {
  return path.join(app.getPath('userData'), 'office-viewer.json');
}

function readConfig() {
  try {
    return { ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return {};
  }
}

function writeConfig(next) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function hasSavedConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return Boolean(config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).length);
  } catch {
    return false;
  }
}

function ensureRuntimeSourceId(config = readConfig()) {
  if (config.runtimeSourceId) return config.runtimeSourceId;
  const runtimeSourceId = `desktop-${crypto.randomUUID()}`;
  writeConfig({ ...config, runtimeSourceId });
  return runtimeSourceId;
}

function encrypt(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.encryptString(String(value)).toString('base64');
}

function decrypt(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}

function savedCredentials(config = readConfig()) {
  return {
    token: decrypt(config.encryptedToken),
    password: decrypt(config.encryptedPassword)
  };
}

function savedOpenCodeCredentials(config = readConfig()) {
  return {
    username: String(config.openCodeUsername || 'opencode'),
    password: decrypt(config.encryptedOpenCodePassword)
  };
}

function savedOpenClawCredentials(config = readConfig(), baseUrl = '') {
  const normalizedUrl = baseUrl ? normalizeOpenClawUrl(baseUrl) : '';
  const credentialsUrl = config.openClawCredentialsUrl || config.openClawUrl || '';
  const credentialsMatch = !normalizedUrl || !credentialsUrl
    || normalizeOpenClawUrl(credentialsUrl) === normalizedUrl;
  return {
    token: credentialsMatch ? decrypt(config.encryptedOpenClawToken) : '',
    password: credentialsMatch ? decrypt(config.encryptedOpenClawPassword) : '',
    deviceToken: normalizedUrl && config.openClawDeviceTokenUrl === normalizedUrl
      ? decrypt(config.encryptedOpenClawDeviceToken)
      : ''
  };
}

function ensureOpenClawDeviceIdentity(config = readConfig()) {
  if (runtimeOpenClawDeviceIdentity) return runtimeOpenClawDeviceIdentity;
  const saved = {
    deviceId: String(config.openClawDeviceId || ''),
    publicKey: String(config.openClawDevicePublicKey || ''),
    privateKey: decrypt(config.encryptedOpenClawDevicePrivateKey)
  };
  if (saved.deviceId && saved.publicKey && saved.privateKey) {
    runtimeOpenClawDeviceIdentity = saved;
    return saved;
  }
  runtimeOpenClawDeviceIdentity = createOpenClawDeviceIdentity();
  writeConfig({
    ...config,
    openClawDeviceId: runtimeOpenClawDeviceIdentity.deviceId,
    openClawDevicePublicKey: runtimeOpenClawDeviceIdentity.publicKey,
    encryptedOpenClawDevicePrivateKey: encrypt(runtimeOpenClawDeviceIdentity.privateKey)
  });
  return runtimeOpenClawDeviceIdentity;
}

function rememberOpenClawDeviceToken(baseUrl, token, scopes = []) {
  if (!token) return;
  const config = readConfig();
  writeConfig({
    ...config,
    openClawDeviceTokenUrl: normalizeOpenClawUrl(baseUrl),
    encryptedOpenClawDeviceToken: encrypt(token),
    openClawDeviceTokenScopes: Array.isArray(scopes) ? scopes.map(String) : []
  });
}

function connectionMode(config = readConfig()) {
  if (config.connectionMode === 'local') return 'local';
  if (config.connectionMode === 'remote') return 'remote';
  return config.url ? 'remote' : 'local';
}

function localServerPaths() {
  const root = path.join(app.getPath('userData'), 'local-server');
  return {
    root,
    shared: path.join(root, 'shared'),
    config: path.join(root, 'config'),
    fixture: path.join(root, 'test-agents.json')
  };
}

function stopLocalServer() {
  const child = localServerProcess;
  localServerProcess = null;
  localServerUrl = '';
  localServerCredentials = null;
  if (child && child.exitCode === null && !child.killed) child.kill();
}

async function startLocalServer() {
  if (localServerProcess && localServerProcess.exitCode === null && localServerUrl && localServerCredentials) {
    return { url: localServerUrl, credentials: localServerCredentials };
  }

  stopLocalServer();
  const paths = localServerPaths();
  for (const directory of [paths.root, paths.shared, paths.config]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const configuredPort = normalizeLocalServerPort(readConfig().localServerPort);
  const token = crypto.randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [path.join(app.getAppPath(), 'server.js')], {
    cwd: paths.root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      PORT: String(configuredPort),
      LOCAL_DESKTOP_MODE: 'true',
      SHARED_DIR: paths.shared,
      CONFIG_DIR: paths.config,
      OPENCLAW_CONFIG_PATH: path.join(paths.config, 'openclaw.json'),
      OPENCLAW_LOG_DIR: path.join(paths.root, 'openclaw-logs'),
      OPENCLAW_SESSIONS_DIR: path.join(paths.root, 'openclaw-agents'),
      OFFICE_FIXTURE_PATH: paths.fixture,
      GATEWAY_AUTH_TOKEN: token,
      GATEWAY_AUTH_PASSWORD: '',
      GATEWAY_AUTH_SECURE_COOKIE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  localServerProcess = child;

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error, url = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (localServerProcess === child) stopLocalServer();
        reject(error);
        return;
      }
      const listeningPort = normalizeLocalServerPort(new URL(url).port);
      if (listeningPort && listeningPort !== configuredPort) {
        const config = readConfig();
        writeConfig({ ...config, localServerPort: listeningPort });
      }
      localServerUrl = url;
      localServerCredentials = { token, password: '' };
      resolve({ url, credentials: localServerCredentials });
    };
    const inspectOutput = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Taskfolk listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(null, match[1]);
    };
    child.stdout.on('data', inspectOutput);
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) console.warn(`Local Taskfolk: ${message}`);
    });
    child.once('error', (error) => finish(new Error(`Could not start local Taskfolk: ${error.message}`)));
    child.once('exit', (code, signal) => {
      const wasCurrent = localServerProcess === child;
      if (wasCurrent) {
        localServerProcess = null;
        localServerUrl = '';
        localServerCredentials = null;
      }
      if (!settled) finish(new Error(`Local Taskfolk stopped before startup (${signal || code}).`));
      else if (wasCurrent && connectionMode() === 'local' && !quitting) {
        openSettingsWindow('The local Taskfolk process stopped. Reopen the office to restart it.');
      }
    });
    const timer = setTimeout(() => {
      finish(new Error(`Local Taskfolk did not start in time.${output.trim() ? ` ${output.trim()}` : ''}`));
    }, LOCAL_SERVER_START_TIMEOUT_MS);
  });
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The Taskfolk URL must use http:// or https://.');
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function endpoint(baseUrl, pathname) {
  const base = new URL(`${baseUrl}/`);
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

function usableBounds(value, defaults = DEFAULT_BOUNDS) {
  const width = Math.max(120, Number(value?.width) || defaults.width);
  const height = Math.max(150, Number(value?.height) || defaults.height);
  if (!Number.isFinite(Number(value?.x)) || !Number.isFinite(Number(value?.y))) return { width, height };

  const candidate = { x: Number(value.x), y: Number(value.y), width, height };
  const display = screen.getDisplayMatching(candidate).workArea;
  const visible = candidate.x < display.x + display.width
    && candidate.x + candidate.width > display.x
    && candidate.y < display.y + display.height
    && candidate.y + candidate.height > display.y;
  return visible ? candidate : { width, height };
}

function saveWindowBounds() {
  if (!officeWindow || officeWindow.isDestroyed() || officeWindow.isMinimized() || officeWindow.isMaximized()) return;
  const config = readConfig();
  const key = displayMode(config) === 'avatar' ? 'avatarBounds' : 'bounds';
  writeConfig({ ...config, [key]: officeWindow.getBounds() });
}

function persistWindowState() {
  if (!officeWindow || officeWindow.isDestroyed() || officeWindow.isMinimized() || officeWindow.isMaximized()) return;
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(saveWindowBounds, 300);
}

function setAlwaysOnTop(enabled) {
  const config = readConfig();
  const alwaysOnTop = Boolean(enabled);
  writeConfig({ ...config, alwaysOnTop });
  for (const window of companionWindows.keys()) {
    if (!window.isDestroyed()) window.setAlwaysOnTop(alwaysOnTop, 'floating');
  }
  rebuildMenus();
}

function openSettingsWindow(message = '') {
  startupError = message;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send('settings:error', message);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 880,
    minWidth: 440,
    minHeight: 760,
    title: 'Taskfolk Settings',
    icon: APP_ICON_PATH,
    backgroundColor: '#101722',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

async function openConfigWindow() {
  if (!activeBaseUrl) return openSettingsWindow('Open an office before accessing its Config page.');
  const configUrl = endpoint(activeBaseUrl, '/avatar-legend.html?app=desktop');
  if (configWindow && !configWindow.isDestroyed()) {
    if (configWindow.webContents.getURL() !== configUrl) await configWindow.loadURL(configUrl);
    configWindow.show();
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'Taskfolk Config',
    icon: APP_ICON_PATH,
    backgroundColor: '#101722',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });
  const allowedOrigin = new URL(activeBaseUrl).origin;
  configWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  configWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  configWindow.on('closed', () => { configWindow = null; });
  await configWindow.loadURL(configUrl);
}

function showConfigWindow() {
  void openConfigWindow().catch((error) => openSettingsWindow(`Could not open Config: ${error.message}`));
}

async function authenticate(baseUrl, credentials, ses) {
  const response = await ses.fetch(endpoint(baseUrl, '/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials)
  });

  if (!response.ok) {
    let message = `Connection failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  await ses.cookies.flushStore();
}

async function fetchAvailableAgents(baseUrl, ses) {
  try {
    const response = await ses.fetch(endpoint(baseUrl, `/api/agents?t=${Date.now()}`), { credentials: 'include' });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data.agents) ? data.agents : []).map((agent) => ({
      id: String(agent.id || ''),
      name: String(agent.name || agent.id || 'Agent'),
      recencyMs: Math.max(
        timestampCandidateMs(agent.lastSeen),
        timestampCandidateMs(agent.updatedAt),
        timestampCandidateMs(agent.activity?.updatedAt),
        timestampCandidateMs(agent.activity?.lastInteractionAt),
        timestampCandidateMs(agent.activity?.lastMessageAt),
        timestampCandidateMs(agent.activity?.timestamp)
      )
    })).filter((agent) => agent.id);
  } catch {
    return [];
  }
}

function timestampCandidateMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mostRecentAvailableAgentId() {
  return [...availableAgents].sort((left, right) => right.recencyMs - left.recencyMs)[0]?.id || '';
}

async function publishRuntimeAgents(provider, agents, config = readConfig()) {
  if (!activeBaseUrl) return;
  const ses = session.fromPartition(PARTITION, { cache: true });
  const response = await ses.fetch(endpoint(activeBaseUrl, '/api/runtime-agents'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId: `${ensureRuntimeSourceId(config)}:${provider}`,
      provider,
      agents
    })
  });
  if (!response.ok) {
    let message = `Taskfolk rejected ${provider} status (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  const nextSignature = agents.map((agent) => `${agent.id}:${agent.name}`).join('|');
  if (nextSignature !== runtimeAgentMenuSignatures.get(provider)) {
    runtimeAgentMenuSignatures.set(provider, nextSignature);
    availableAgents = await fetchAvailableAgents(activeBaseUrl, ses);
    reconcileAdditionalCompanionWindows();
    rebuildMenus();
  }
}

function scheduleOpenCodeSync() {
  clearTimeout(openCodeTimer);
  openCodeTimer = null;
  if (readConfig().openCodeEnabled || openCodePublished) {
    openCodeTimer = setTimeout(syncOpenCodeAdapter, OPENCODE_REFRESH_MS);
  }
}

function openCodeAgentActivityMs(agent) {
  const activityMs = Number(agent?.activity?.updatedAt);
  if (Number.isFinite(activityMs) && activityMs > 0) return activityMs;
  const lastSeenMs = Date.parse(String(agent?.lastSeen || ''));
  return Number.isFinite(lastSeenMs) ? lastSeenMs : 0;
}

async function syncOpenCodeAdapter() {
  if (openCodeSyncInFlight) return;
  openCodeSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.openCodeEnabled) {
      if (openCodePublished) await publishRuntimeAgents('opencode', [], config);
      openCodePublished = false;
      openCodeLastError = '';
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENCODE_REQUEST_TIMEOUT_MS);
    let serverAgents = [];
    let serverError = null;
    try {
      try {
        serverAgents = await fetchOpenCodeAgents({
          baseUrl: config.openCodeUrl || DEFAULT_OPENCODE_URL,
          grouping: normalizeOpenCodeGrouping(config.openCodeGrouping),
          ...(runtimeOpenCodeCredentials || savedOpenCodeCredentials(config)),
          fetchImpl: globalThis.fetch,
          signal: controller.signal
        });
      } catch (error) {
        serverError = error;
      }
    } finally {
      clearTimeout(timeout);
    }
    let desktopAgents = [];
    let desktopError = null;
    try {
      desktopAgents = await fetchOpenCodeDesktopAgents({
        grouping: normalizeOpenCodeGrouping(config.openCodeGrouping)
      });
    } catch (error) {
      desktopError = error;
    }
    const grouping = normalizeOpenCodeGrouping(config.openCodeGrouping);
    let agents;
    if (grouping === 'single') {
      agents = [...desktopAgents, ...serverAgents]
        .sort((left, right) => openCodeAgentActivityMs(right) - openCodeAgentActivityMs(left))
        .slice(0, 1);
    } else {
      const agentsById = new Map(desktopAgents.map((agent) => [agent.id, agent]));
      for (const agent of serverAgents) agentsById.set(agent.id, agent);
      agents = [...agentsById.values()];
    }
    if (!agents.length && serverError && desktopError) {
      throw new Error(`OpenCode server: ${serverError.message}; desktop: ${desktopError.message}`);
    }
    if (!agents.length && serverError && !desktopAgents.length) throw serverError;
    await publishRuntimeAgents('opencode', agents, config);
    openCodePublished = agents.length > 0;
    openCodeLastError = '';
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'OpenCode status request timed out.' : error.message;
    if (message !== openCodeLastError) console.warn(`OpenCode adapter: ${message}`);
    openCodeLastError = message;
    if (openCodePublished) {
      try { await publishRuntimeAgents('opencode', []); } catch {}
      openCodePublished = false;
    }
  } finally {
    openCodeSyncInFlight = false;
    scheduleOpenCodeSync();
  }
}

function startOpenCodeAdapter() {
  clearTimeout(openCodeTimer);
  openCodeTimer = null;
  void syncOpenCodeAdapter();
}

function scheduleVsCodeCopilotSync() {
  clearTimeout(vsCodeCopilotTimer);
  vsCodeCopilotTimer = null;
  if (readConfig().vsCodeCopilotEnabled || vsCodeCopilotPublished) {
    vsCodeCopilotTimer = setTimeout(syncVsCodeCopilotAdapter, VSCODE_COPILOT_REFRESH_MS);
  }
}

async function syncVsCodeCopilotAdapter() {
  if (vsCodeCopilotSyncInFlight) return;
  vsCodeCopilotSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.vsCodeCopilotEnabled) {
      if (vsCodeCopilotPublished) await publishRuntimeAgents('vscode-copilot', [], config);
      vsCodeCopilotPublished = false;
      vsCodeCopilotLastError = '';
      return;
    }
    const agents = await fetchVsCodeCopilotAgents({
      grouping: normalizeVsCodeCopilotGrouping(config.vsCodeCopilotGrouping)
    });
    await publishRuntimeAgents('vscode-copilot', agents, config);
    vsCodeCopilotPublished = agents.length > 0;
    vsCodeCopilotLastError = '';
  } catch (error) {
    const message = error?.message || 'Could not read VS Code Copilot activity.';
    if (message !== vsCodeCopilotLastError) console.warn(`VS Code Copilot adapter: ${message}`);
    vsCodeCopilotLastError = message;
    if (vsCodeCopilotPublished) {
      try { await publishRuntimeAgents('vscode-copilot', []); } catch {}
      vsCodeCopilotPublished = false;
    }
  } finally {
    vsCodeCopilotSyncInFlight = false;
    scheduleVsCodeCopilotSync();
  }
}

function startVsCodeCopilotAdapter() {
  clearTimeout(vsCodeCopilotTimer);
  vsCodeCopilotTimer = null;
  void syncVsCodeCopilotAdapter();
}

function scheduleCodexSync() {
  clearTimeout(codexTimer);
  codexTimer = null;
  if (readConfig().codexEnabled || codexPublished) {
    codexTimer = setTimeout(syncCodexAdapter, CODEX_REFRESH_MS);
  }
}

async function syncCodexAdapter() {
  if (codexSyncInFlight) return;
  codexSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.codexEnabled) {
      if (codexPublished) await publishRuntimeAgents('codex', [], config);
      codexPublished = false;
      codexLastError = '';
      return;
    }
    const agents = await fetchCodexAgents({ grouping: normalizeCodexGrouping(config.codexGrouping) });
    await publishRuntimeAgents('codex', agents, config);
    codexPublished = agents.length > 0;
    codexLastError = '';
  } catch (error) {
    const message = error?.message || 'Could not read Codex activity.';
    if (message !== codexLastError) console.warn(`Codex adapter: ${message}`);
    codexLastError = message;
    if (codexPublished) {
      try { await publishRuntimeAgents('codex', []); } catch {}
      codexPublished = false;
    }
  } finally {
    codexSyncInFlight = false;
    scheduleCodexSync();
  }
}

function startCodexAdapter() {
  clearTimeout(codexTimer);
  codexTimer = null;
  void syncCodexAdapter();
}

function scheduleClaudeSync() {
  clearTimeout(claudeTimer);
  claudeTimer = null;
  if (readConfig().claudeEnabled || claudePublished) {
    claudeTimer = setTimeout(syncClaudeAdapter, CLAUDE_REFRESH_MS);
  }
}

async function syncClaudeAdapter() {
  if (claudeSyncInFlight) return;
  claudeSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.claudeEnabled) {
      if (claudePublished) await publishRuntimeAgents('claude', [], config);
      claudePublished = false;
      claudeLastError = '';
      return;
    }
    const agents = await fetchClaudeAgents({ grouping: normalizeClaudeGrouping(config.claudeGrouping) });
    await publishRuntimeAgents('claude', agents, config);
    claudePublished = agents.length > 0;
    claudeLastError = '';
  } catch (error) {
    const message = error?.message || 'Could not read Claude activity.';
    if (message !== claudeLastError) console.warn(`Claude adapter: ${message}`);
    claudeLastError = message;
    if (claudePublished) {
      try { await publishRuntimeAgents('claude', []); } catch {}
      claudePublished = false;
    }
  } finally {
    claudeSyncInFlight = false;
    scheduleClaudeSync();
  }
}

function startClaudeAdapter() {
  clearTimeout(claudeTimer);
  claudeTimer = null;
  void syncClaudeAdapter();
}

function scheduleOpenClawSync() {
  clearTimeout(openClawTimer);
  openClawTimer = null;
  if (readConfig().openClawEnabled || openClawPublished) {
    openClawTimer = setTimeout(syncOpenClawAdapter, OPENCLAW_REFRESH_MS);
  }
}

async function syncOpenClawAdapter() {
  if (openClawSyncInFlight) return;
  openClawSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.openClawEnabled) {
      if (openClawPublished) await publishRuntimeAgents('openclaw', [], config);
      openClawPublished = false;
      openClawLastError = '';
      return;
    }
    const baseUrl = runtimeOpenClawUrl || config.openClawUrl || DEFAULT_OPENCLAW_URL;
    const agents = await fetchOpenClawAgents({
      baseUrl,
      ...savedOpenClawCredentials(config, baseUrl),
      ...(runtimeOpenClawCredentials && runtimeOpenClawCredentialsUrl === normalizeOpenClawUrl(baseUrl)
        ? runtimeOpenClawCredentials
        : {}),
      deviceIdentity: ensureOpenClawDeviceIdentity(config),
      onDeviceToken: (token, scopes) => rememberOpenClawDeviceToken(baseUrl, token, scopes)
    });
    await publishRuntimeAgents('openclaw', agents, config);
    openClawPublished = agents.length > 0;
    openClawLastError = '';
  } catch (error) {
    const message = error?.message || 'Could not read OpenClaw gateway activity.';
    if (message !== openClawLastError) console.warn(`OpenClaw adapter: ${message}`);
    openClawLastError = message;
    if (openClawPublished) {
      try { await publishRuntimeAgents('openclaw', []); } catch {}
      openClawPublished = false;
    }
  } finally {
    openClawSyncInFlight = false;
    scheduleOpenClawSync();
  }
}

function startOpenClawAdapter() {
  clearTimeout(openClawTimer);
  openClawTimer = null;
  void syncOpenClawAdapter();
}

function companionUrl(baseUrl = activeBaseUrl, config = readConfig(), agentId = '') {
  const url = new URL(endpoint(baseUrl, '/index.html'));
  url.searchParams.set('companion', '1');
  if (agentId || displayMode(config) === 'avatar') {
    url.searchParams.set('companionView', 'avatar');
    const selectedAgent = agentId || config.selectedAgent;
    if (selectedAgent) url.searchParams.set('agent', selectedAgent);
  }
  return url.toString();
}

async function loadCompanionView() {
  if (!officeWindow || officeWindow.isDestroyed() || !activeBaseUrl) return;
  await officeWindow.loadURL(companionUrl());
}

function setOpacity(value) {
  const opacity = normalizedOpacity(value);
  const config = readConfig();
  writeConfig({ ...config, opacity });
  for (const window of companionWindows.keys()) {
    if (!window.isDestroyed()) window.setOpacity(opacity);
  }
  rebuildMenus();
}

function setAvatarWindowSize(width, height, targetWindow = officeWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const metadata = companionWindows.get(targetWindow);
  if (!metadata?.agentId && displayMode(readConfig()) !== 'avatar') return;
  const current = targetWindow.getBounds();
  const workArea = screen.getDisplayMatching(current).workArea;
  const nextWidth = Math.min(Math.max(120, Math.round(width)), workArea.width);
  const nextHeight = Math.min(Math.max(150, Math.round(height)), workArea.height);
  const centeredX = Math.round(current.x + current.width / 2 - nextWidth / 2);
  const centeredY = Math.round(current.y + current.height / 2 - nextHeight / 2);
  const x = Math.max(workArea.x, Math.min(centeredX, workArea.x + workArea.width - nextWidth));
  const y = Math.max(workArea.y, Math.min(centeredY, workArea.y + workArea.height - nextHeight));
  const avatarBounds = { x, y, width: nextWidth, height: nextHeight };
  const config = readConfig();
  writeConfig({ ...config, avatarBounds });
  targetWindow.setBounds(avatarBounds, process.platform === 'darwin');
}

function avatarSizeMenuItems(targetWindow = officeWindow) {
  const bounds = targetWindow?.getBounds() || DEFAULT_AVATAR_BOUNDS;
  return AVATAR_SIZE_PRESETS.map((preset) => ({
    label: `${preset.label} (${preset.width} × ${preset.height})`,
    type: 'radio',
    checked: Math.abs(bounds.width - preset.width) <= 2 && Math.abs(bounds.height - preset.height) <= 2,
    click: () => setAvatarWindowSize(preset.width, preset.height, targetWindow)
  }));
}

async function setDisplayMode(mode, selectedAgent = '') {
  if (!officeWindow || officeWindow.isDestroyed()) return;
  clearTimeout(boundsTimer);
  saveWindowBounds();
  const config = readConfig();
  const nextMode = mode === 'avatar' ? 'avatar' : 'office';
  const nextAgent = nextMode === 'avatar'
    ? String(selectedAgent || config.selectedAgent || availableAgents[0]?.id || '')
    : String(config.selectedAgent || selectedAgent || '');
  const nextConfig = { ...config, displayMode: nextMode, selectedAgent: nextAgent };
  writeConfig(nextConfig);

  const avatarMode = nextMode === 'avatar';
  if (!avatarMode && mouseIgnoringWindows.has(officeWindow)) {
    mouseIgnoringWindows.delete(officeWindow);
    officeWindow.setIgnoreMouseEvents(false);
  }
  officeWindow.setMinimumSize(avatarMode ? 120 : 360, avatarMode ? 150 : 260);
  const nextBounds = usableBounds(
    avatarMode ? nextConfig.avatarBounds : nextConfig.bounds,
    avatarMode ? DEFAULT_AVATAR_BOUNDS : DEFAULT_BOUNDS
  );
  officeWindow.setBounds(nextBounds);
  await loadCompanionView();
  reconcileAdditionalCompanionWindows();
  rebuildMenus();
}

function avatarMenuItems(config = readConfig()) {
  const automatic = {
    label: 'Most Recently Updated (Automatic)',
    type: 'radio',
    checked: displayMode(config) === 'avatar' && config.selectedAgent === MOST_RECENT_AGENT_ID,
    click: () => setDisplayMode('avatar', MOST_RECENT_AGENT_ID)
  };
  if (!availableAgents.length) return [automatic, { type: 'separator' }, { label: 'No agents available', enabled: false }];
  return [automatic, { type: 'separator' }, ...availableAgents.map((agent) => ({
    label: agent.name,
    type: 'radio',
    checked: displayMode(config) === 'avatar' && config.selectedAgent === agent.id,
    click: () => setDisplayMode('avatar', agent.id)
  }))];
}

function viewMenuItems(config = readConfig()) {
  return [
    {
      label: 'Office View',
      type: 'radio',
      checked: displayMode(config) === 'office',
      click: () => setDisplayMode('office')
    },
    { label: 'Single Avatar', submenu: avatarMenuItems(config) }
  ];
}

function displayedAgentIds() {
  const ids = new Set();
  const config = readConfig();
  if (officeWindow && !officeWindow.isDestroyed() && displayMode(config) === 'avatar') {
    const primaryAgentId = config.selectedAgent === MOST_RECENT_AGENT_ID
      ? mostRecentAvailableAgentId()
      : config.selectedAgent;
    if (primaryAgentId) ids.add(primaryAgentId);
  }
  for (const [window, metadata] of companionWindows) {
    if (window !== officeWindow && !window.isDestroyed() && metadata.agentId) ids.add(metadata.agentId);
  }
  return ids;
}

function displayedFolkCount() {
  const primaryAvatarVisible = Boolean(
    officeWindow
    && !officeWindow.isDestroyed()
    && displayMode(readConfig()) === 'avatar'
  );
  let count = primaryAvatarVisible ? 1 : 0;
  for (const [window, metadata] of companionWindows) {
    if (window !== officeWindow && !window.isDestroyed() && metadata.agentId) count += 1;
  }
  return count;
}

function availableAdditionalAgents() {
  if (displayedFolkCount() >= availableAgents.length) return [];
  const displayed = displayedAgentIds();
  return availableAgents.filter((agent) => !displayed.has(agent.id));
}

function reconcileAdditionalCompanionWindows() {
  const availableIds = new Set(availableAgents.map((agent) => agent.id));
  const usedIds = new Set();
  const config = readConfig();
  if (displayMode(config) === 'avatar' && config.selectedAgent) {
    usedIds.add(config.selectedAgent === MOST_RECENT_AGENT_ID ? mostRecentAvailableAgentId() : config.selectedAgent);
  }
  const additionalWindows = [...companionWindows.entries()]
    .filter(([window, metadata]) => window !== officeWindow && !window.isDestroyed() && metadata.agentId);
  for (const [window, metadata] of additionalWindows) {
    if (!availableIds.has(metadata.agentId) || usedIds.has(metadata.agentId)) {
      window.close();
      continue;
    }
    usedIds.add(metadata.agentId);
  }
  const allowedAdditionalCount = Math.max(0, availableAgents.length - (
    officeWindow && !officeWindow.isDestroyed() && displayMode(config) === 'avatar' ? 1 : 0
  ));
  const survivors = additionalWindows.filter(([window]) => !window.isDestroyed());
  for (const [window] of survivors.slice(allowedAdditionalCount)) window.close();
}

function additionalFolkMenuItems() {
  const remaining = availableAdditionalAgents();
  if (!availableAgents.length) return [{ label: 'No agents available', enabled: false }];
  if (!remaining.length) return [{ label: 'All agents are on screen', enabled: false }];
  return remaining.map((agent) => ({
    label: agent.name,
    click: () => createAdditionalCompanionWindow(agent.id)
  }));
}

async function setAdditionalWindowAgent(targetWindow, agentId) {
  const metadata = companionWindows.get(targetWindow);
  if (!metadata || metadata.primary || !availableAgents.some((agent) => agent.id === agentId)) return;
  const usedElsewhere = displayedAgentIds();
  usedElsewhere.delete(metadata.agentId);
  if (usedElsewhere.has(agentId)) return;
  metadata.agentId = agentId;
  try {
    await targetWindow.loadURL(companionUrl(activeBaseUrl, readConfig(), agentId));
  } catch (error) {
    console.warn(`Could not switch companion folk: ${error.message}`);
  }
  rebuildMenus();
}

function additionalAgentMenuItems(targetWindow) {
  const selectedAgent = companionWindows.get(targetWindow)?.agentId;
  const usedElsewhere = displayedAgentIds();
  usedElsewhere.delete(selectedAgent);
  return availableAgents.map((agent) => ({
    label: agent.name,
    type: 'radio',
    checked: agent.id === selectedAgent,
    enabled: agent.id === selectedAgent || !usedElsewhere.has(agent.id),
    click: () => setAdditionalWindowAgent(targetWindow, agent.id)
  }));
}

function showCompanionContextMenu(targetWindow = officeWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const config = readConfig();
  const metadata = companionWindows.get(targetWindow);
  const additionalWindow = Boolean(metadata && !metadata.primary);
  const opacity = Math.round(normalizedOpacity(config.opacity) * 100);
  const menu = Menu.buildFromTemplate([
    ...(additionalWindow
      ? [{ label: 'Folk', submenu: additionalAgentMenuItems(targetWindow) }]
      : viewMenuItems(config)),
    { label: 'Add Another Folk', submenu: additionalFolkMenuItems() },
    { type: 'separator' },
    ...(additionalWindow || displayMode(config) === 'avatar'
      ? [{ label: 'Avatar Size', submenu: avatarSizeMenuItems(targetWindow) }]
      : []),
    {
      label: `Opacity: ${opacity}%`,
      submenu: [100, 90, 75, 50, 25].map((percent) => ({
        label: `${percent}%`,
        type: 'radio',
        checked: opacity === percent,
        click: () => setOpacity(percent / 100)
      }))
    },
    { label: 'Open Setup…', click: () => openSettingsWindow() },
    { label: 'Open Config…', enabled: Boolean(activeBaseUrl), click: showConfigWindow },
    { label: 'Reload', click: () => targetWindow.reload() },
    { label: 'Always on Top', type: 'checkbox', checked: Boolean(config.alwaysOnTop), click: (item) => setAlwaysOnTop(item.checked) },
    { type: 'separator' },
    ...(additionalWindow
      ? [{ label: 'Remove This Folk', click: () => targetWindow.close() }]
      : [{ label: 'Hide', click: () => { targetWindow.hide(); rebuildMenus(); } }]),
    { role: 'quit' }
  ]);
  menu.popup({ window: targetWindow });
}

function cascadedAvatarBounds(referenceWindow) {
  const config = readConfig();
  const base = referenceWindow && !referenceWindow.isDestroyed()
    ? referenceWindow.getBounds()
    : usableBounds(config.avatarBounds, DEFAULT_AVATAR_BOUNDS);
  const workArea = screen.getDisplayMatching(base).workArea;
  const width = Math.min(Math.max(120, Number(config.avatarBounds?.width) || DEFAULT_AVATAR_BOUNDS.width), workArea.width);
  const height = Math.min(Math.max(150, Number(config.avatarBounds?.height) || DEFAULT_AVATAR_BOUNDS.height), workArea.height);
  const offset = 28 * Math.max(1, companionWindows.size);
  return {
    x: Math.max(workArea.x, Math.min(base.x + offset, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(base.y + offset, workArea.y + workArea.height - height)),
    width,
    height
  };
}

function createCompanionBrowserWindow(bounds, config = readConfig()) {
  return new BrowserWindow({
    ...bounds,
    minWidth: 120,
    minHeight: 150,
    show: false,
    resizable: true,
    movable: true,
    alwaysOnTop: Boolean(config.alwaysOnTop),
    title: 'Taskfolk',
    icon: APP_ICON_PATH,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'office-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Companion windows must continue polling and animating while another app
      // has focus. Electron otherwise throttles background renderer timers.
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });
}

function secureCompanionNavigation(targetWindow, baseUrl) {
  const allowedOrigin = new URL(baseUrl).origin;
  targetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  targetWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  targetWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
    showCompanionContextMenu(targetWindow);
  });
}

async function createAdditionalCompanionWindow(agentId) {
  if (!activeBaseUrl || !availableAdditionalAgents().some((agent) => agent.id === agentId)) return;
  const config = readConfig();
  const referenceWindow = BrowserWindow.getFocusedWindow() || officeWindow;
  const targetWindow = createCompanionBrowserWindow(cascadedAvatarBounds(referenceWindow), config);
  companionWindows.set(targetWindow, { primary: false, agentId });
  secureCompanionNavigation(targetWindow, activeBaseUrl);
  targetWindow.on('closed', () => {
    windowDrags.delete(targetWindow);
    mouseIgnoringWindows.delete(targetWindow);
    companionWindows.delete(targetWindow);
    rebuildMenus();
  });
  targetWindow.once('ready-to-show', () => targetWindow.show());
  targetWindow.setOpacity(normalizedOpacity(config.opacity));
  try {
    await targetWindow.loadURL(companionUrl(activeBaseUrl, config, agentId));
  } catch (error) {
    console.warn(`Could not add companion folk: ${error.message}`);
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  }
  rebuildMenus();
}

async function createOfficeWindow(baseUrl, credentials, authenticated = false) {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  if (activeBaseUrl !== normalizedUrl) {
    configWindow?.destroy();
    runtimeAgentMenuSignatures.clear();
    openCodePublished = false;
    vsCodeCopilotPublished = false;
    openClawPublished = false;
  }
  activeBaseUrl = normalizedUrl;
  let config = readConfig();
  const ses = session.fromPartition(PARTITION, { cache: true });
  if (!authenticated) await authenticate(normalizedUrl, credentials, ses);
  availableAgents = await fetchAvailableAgents(normalizedUrl, ses);
  if (displayMode(config) === 'avatar'
    && config.selectedAgent !== MOST_RECENT_AGENT_ID
    && !availableAgents.some((agent) => agent.id === config.selectedAgent)) {
    config = { ...config, selectedAgent: availableAgents[0]?.id || '' };
    writeConfig(config);
  }

  for (const window of [...companionWindows.keys()]) {
    if (!window.isDestroyed()) window.destroy();
  }
  companionWindows.clear();
  windowDrags.clear();
  mouseIgnoringWindows.clear();
  const avatarMode = displayMode(config) === 'avatar';
  officeWindow = createCompanionBrowserWindow(usableBounds(
    avatarMode ? config.avatarBounds : config.bounds,
    avatarMode ? DEFAULT_AVATAR_BOUNDS : DEFAULT_BOUNDS
  ), config);
  officeWindow.setMinimumSize(avatarMode ? 120 : 360, avatarMode ? 150 : 260);
  const primaryWindow = officeWindow;
  companionWindows.set(primaryWindow, { primary: true, agentId: '' });
  secureCompanionNavigation(primaryWindow, normalizedUrl);
  officeWindow.on('move', persistWindowState);
  officeWindow.on('resize', persistWindowState);
  officeWindow.on('closed', () => {
    windowDrags.delete(primaryWindow);
    mouseIgnoringWindows.delete(primaryWindow);
    companionWindows.delete(primaryWindow);
    if (officeWindow === primaryWindow) officeWindow = null;
    rebuildMenus();
  });
  primaryWindow.once('ready-to-show', () => primaryWindow.show());
  primaryWindow.setOpacity(normalizedOpacity(config.opacity));

  await primaryWindow.loadURL(companionUrl(normalizedUrl, config));
  startOpenCodeAdapter();
  startVsCodeCopilotAdapter();
  startCodexAdapter();
  startClaudeAdapter();
  startOpenClawAdapter();
  settingsWindow?.close();
  rebuildMenus();
}

function menuTemplate() {
  const config = readConfig();
  const alwaysOnTop = Boolean(config.alwaysOnTop);
  return [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Office',
      submenu: [
        { label: 'Setup…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { label: 'Config…', enabled: Boolean(activeBaseUrl), click: showConfigWindow },
        { label: 'Reload Office', accelerator: 'CmdOrCtrl+R', enabled: Boolean(officeWindow), click: () => officeWindow?.reload() },
        { type: 'separator' },
        ...viewMenuItems(config),
        { type: 'separator' },
        { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ];
}

function rebuildMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
  if (!tray) return;
  const config = readConfig();
  const alwaysOnTop = Boolean(config.alwaysOnTop);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: officeWindow?.isVisible() ? 'Hide Office' : 'Show Office', click: toggleOffice },
    { label: 'Reload', enabled: Boolean(officeWindow), click: () => officeWindow?.reload() },
    { type: 'separator' },
    ...viewMenuItems(config),
    { type: 'separator' },
    { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
    { label: 'Setup…', click: () => openSettingsWindow() },
    { label: 'Config…', enabled: Boolean(activeBaseUrl), click: showConfigWindow },
    { type: 'separator' },
    { role: 'quit' }
  ]));
}

function toggleOffice() {
  if (!officeWindow) return openSettingsWindow();
  if (officeWindow.isVisible()) officeWindow.hide();
  else {
    officeWindow.show();
    officeWindow.focus();
  }
  rebuildMenus();
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'favicon.svg');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  if (icon.isEmpty()) return;
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Taskfolk');
  tray.on('click', toggleOffice);
  rebuildMenus();
}

ipcMain.handle('settings:load', () => {
  const config = readConfig();
  const credentials = savedCredentials(config);
  const mode = connectionMode(config);
  return {
    connectionMode: mode,
    url: mode === 'remote' ? (activeBaseUrl || config.url || '') : (config.url || ''),
    credentialsStored: Boolean(
      (mode === 'remote' && (runtimeCredentials?.token || runtimeCredentials?.password))
      || credentials.token
      || credentials.password
    ),
    alwaysOnTop: config.alwaysOnTop === undefined ? true : Boolean(config.alwaysOnTop),
    displayMode: displayMode(config),
    selectedAgent: config.selectedAgent || '',
    opacity: normalizedOpacity(config.opacity),
    avatarWidth: Number(config.avatarBounds?.width) || DEFAULT_AVATAR_BOUNDS.width,
    avatarHeight: Number(config.avatarBounds?.height) || DEFAULT_AVATAR_BOUNDS.height,
    openCodeEnabled: config.openCodeEnabled === undefined ? mode === 'local' : Boolean(config.openCodeEnabled),
    openCodeGrouping: normalizeOpenCodeGrouping(config.openCodeGrouping),
    openCodeUrl: config.openCodeUrl || DEFAULT_OPENCODE_URL,
    openCodeUsername: runtimeOpenCodeCredentials?.username || config.openCodeUsername || 'opencode',
    openCodeCredentialsStored: Boolean(runtimeOpenCodeCredentials?.password || decrypt(config.encryptedOpenCodePassword)),
    vsCodeCopilotEnabled: config.vsCodeCopilotEnabled === undefined ? mode === 'local' : Boolean(config.vsCodeCopilotEnabled),
    vsCodeCopilotGrouping: normalizeVsCodeCopilotGrouping(config.vsCodeCopilotGrouping),
    codexEnabled: config.codexEnabled === undefined ? mode === 'local' : Boolean(config.codexEnabled),
    codexGrouping: normalizeCodexGrouping(config.codexGrouping),
    claudeEnabled: config.claudeEnabled === undefined ? mode === 'local' : Boolean(config.claudeEnabled),
    claudeGrouping: normalizeClaudeGrouping(config.claudeGrouping),
    openClawEnabled: Boolean(config.openClawEnabled),
    openClawUrl: runtimeOpenClawUrl || config.openClawUrl || DEFAULT_OPENCLAW_URL,
    openClawCredentialsStored: Boolean(
      (runtimeOpenClawCredentialsUrl === (runtimeOpenClawUrl || config.openClawUrl)
        && (runtimeOpenClawCredentials?.token || runtimeOpenClawCredentials?.password))
      || savedOpenClawCredentials(config, runtimeOpenClawUrl || config.openClawUrl || DEFAULT_OPENCLAW_URL).token
      || savedOpenClawCredentials(config, runtimeOpenClawUrl || config.openClawUrl || DEFAULT_OPENCLAW_URL).password
    ),
    agents: availableAgents,
    hasSavedConfiguration: hasSavedConfig(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    error: startupError
  };
});

ipcMain.handle('settings:import-config', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner, {
    title: 'Import Taskfolk Configuration',
    properties: ['openFile'],
    filters: [
      { name: 'Taskfolk configuration', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > 1024 * 1024) throw new Error('That configuration file is larger than 1 MB.');
  let imported;
  try {
    imported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
    throw new Error('The selected file is not a Taskfolk configuration object.');
  }

  let importedOpenClawUrl;
  try {
    importedOpenClawUrl = normalizeOpenClawUrl(imported.openClawUrl || DEFAULT_OPENCLAW_URL);
  } catch (error) {
    throw new Error(`The configuration has an invalid OpenClaw URL: ${error.message}`);
  }

  writeConfig(imported);
  runtimeCredentials = savedCredentials(imported);
  runtimeOpenCodeCredentials = savedOpenCodeCredentials(imported);
  runtimeOpenClawUrl = '';
  runtimeOpenClawCredentialsUrl = importedOpenClawUrl;
  runtimeOpenClawCredentials = savedOpenClawCredentials(imported, runtimeOpenClawCredentialsUrl);
  runtimeOpenClawDeviceIdentity = null;
  return { canceled: false };
});

ipcMain.handle('settings:export-config', async (event) => {
  if (!hasSavedConfig()) throw new Error('There is no saved configuration to export yet.');
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(owner, {
    title: 'Export Taskfolk Configuration',
    defaultPath: path.join(app.getPath('documents'), 'taskfolk-config.json'),
    filters: [{ name: 'Taskfolk configuration', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.copyFileSync(configPath(), result.filePath);
  return { canceled: false };
});

ipcMain.handle('settings:openclaw-test', async (_event, input = {}) => {
  const config = readConfig();
  let baseUrl;
  try {
    baseUrl = normalizeOpenClawUrl(input.openClawUrl || DEFAULT_OPENCLAW_URL);
  } catch (error) {
    return { ok: false, stage: 'url', message: error.message };
  }
  const enteredToken = String(input.openClawToken || '').trim();
  const enteredPassword = String(input.openClawPassword || '');
  const hasEnteredCredentials = Boolean(enteredToken || enteredPassword);
  const credentials = hasEnteredCredentials
    ? { token: enteredToken, password: enteredPassword, deviceToken: '' }
    : (runtimeOpenClawCredentialsUrl === baseUrl ? runtimeOpenClawCredentials : null)
      || savedOpenClawCredentials(config, baseUrl);
  const deviceIdentity = ensureOpenClawDeviceIdentity(config);
  if (hasEnteredCredentials) {
    runtimeOpenClawCredentials = credentials;
    runtimeOpenClawCredentialsUrl = baseUrl;
  }

  try {
    const agents = await fetchOpenClawAgents({
      baseUrl,
      ...(credentials || {}),
      deviceIdentity,
      onDeviceToken: (token, scopes) => rememberOpenClawDeviceToken(baseUrl, token, scopes)
    });
    return {
      ok: true,
      stage: 'connected',
      gatewayUrl: baseUrl,
      deviceId: deviceIdentity.deviceId,
      agentCount: agents.length,
      message: `Connected to OpenClaw and read ${agents.length} configured agent${agents.length === 1 ? '' : 's'}.`
    };
  } catch (error) {
    return {
      ok: false,
      stage: error.pairingRequired ? 'pairing' : error.gatewayCode ? 'gateway' : 'transport',
      gatewayUrl: baseUrl,
      deviceId: deviceIdentity.deviceId,
      pairingRequired: Boolean(error.pairingRequired),
      requestId: error.requestId || '',
      gatewayCode: error.gatewayCode || '',
      detailsCode: error.detailsCode || '',
      message: error.message || 'Could not connect to OpenClaw.'
    };
  }
});

ipcMain.handle('settings:connect', async (_event, input = {}) => {
  const config = readConfig();
  const mode = input.connectionMode === 'remote' ? 'remote' : 'local';
  const avatarWidth = Math.min(1200, Math.max(120, Math.round(Number(input.avatarWidth) || DEFAULT_AVATAR_BOUNDS.width)));
  const avatarHeight = Math.min(1200, Math.max(150, Math.round(Number(input.avatarHeight) || DEFAULT_AVATAR_BOUNDS.height)));
  const openCodeUrl = normalizeOpenCodeUrl(input.openCodeUrl || DEFAULT_OPENCODE_URL);
  const openClawUrl = normalizeOpenClawUrl(input.openClawUrl || DEFAULT_OPENCLAW_URL);
  runtimeOpenClawUrl = openClawUrl;
  const savedOpenCode = savedOpenCodeCredentials(config);
  const replaceOpenCodeCredentials = Boolean(String(input.openCodePassword || ''));
  runtimeOpenCodeCredentials = replaceOpenCodeCredentials
    ? { username: String(input.openCodeUsername || 'opencode').trim() || 'opencode', password: String(input.openCodePassword) }
    : (runtimeOpenCodeCredentials || savedOpenCode);
  runtimeOpenCodeCredentials.username = String(input.openCodeUsername || runtimeOpenCodeCredentials.username || 'opencode').trim() || 'opencode';
  const savedOpenClaw = savedOpenClawCredentials(config, openClawUrl);
  const replaceOpenClawCredentials = Boolean(
    String(input.openClawToken || '').trim() || String(input.openClawPassword || '')
  );
  runtimeOpenClawCredentials = replaceOpenClawCredentials
    ? { token: String(input.openClawToken || '').trim(), password: String(input.openClawPassword || '') }
    : (runtimeOpenClawCredentialsUrl === openClawUrl ? runtimeOpenClawCredentials : null) || savedOpenClaw;
  runtimeOpenClawCredentialsUrl = openClawUrl;
  const openClawDeviceIdentity = ensureOpenClawDeviceIdentity(config);
  const nextConfig = {
    ...config,
    connectionMode: mode,
    alwaysOnTop: Boolean(input.alwaysOnTop),
    displayMode: input.displayMode === 'avatar' ? 'avatar' : 'office',
    selectedAgent: String(input.selectedAgent || config.selectedAgent || ''),
    opacity: normalizedOpacity(input.opacity),
    avatarBounds: { ...(config.avatarBounds || {}), width: avatarWidth, height: avatarHeight },
    runtimeSourceId: config.runtimeSourceId || `desktop-${crypto.randomUUID()}`,
    openCodeEnabled: Boolean(input.openCodeEnabled),
    openCodeGrouping: normalizeOpenCodeGrouping(input.openCodeGrouping),
    openCodeUrl,
    openCodeUsername: runtimeOpenCodeCredentials.username,
    encryptedOpenCodePassword: encrypt(runtimeOpenCodeCredentials.password),
    vsCodeCopilotEnabled: Boolean(input.vsCodeCopilotEnabled),
    vsCodeCopilotGrouping: normalizeVsCodeCopilotGrouping(input.vsCodeCopilotGrouping),
    codexEnabled: Boolean(input.codexEnabled),
    codexGrouping: normalizeCodexGrouping(input.codexGrouping),
    claudeEnabled: Boolean(input.claudeEnabled),
    claudeGrouping: normalizeClaudeGrouping(input.claudeGrouping),
    openClawEnabled: Boolean(input.openClawEnabled),
    openClawUrl,
    openClawCredentialsUrl: openClawUrl,
    encryptedOpenClawToken: encrypt(runtimeOpenClawCredentials.token),
    encryptedOpenClawPassword: encrypt(runtimeOpenClawCredentials.password),
    openClawDeviceId: openClawDeviceIdentity.deviceId,
    openClawDevicePublicKey: openClawDeviceIdentity.publicKey,
    encryptedOpenClawDevicePrivateKey: encrypt(openClawDeviceIdentity.privateKey)
  };

  if (mode === 'local') {
    writeConfig(nextConfig);
    const local = await startLocalServer();
    runtimeCredentials = local.credentials;
    await createOfficeWindow(local.url, local.credentials);
    startupError = '';
    return { ok: true };
  }

  const url = normalizeBaseUrl(input.url);
  const saved = savedCredentials(config);
  const replaceCredentials = Boolean(String(input.token || '').trim());
  const credentials = replaceCredentials
    ? { token: String(input.token).trim(), password: String(input.password || '') }
    : (connectionMode(config) === 'remote' ? runtimeCredentials : null) || saved;
  runtimeCredentials = credentials;
  nextConfig.url = url;
  nextConfig.encryptedToken = encrypt(credentials.token);
  nextConfig.encryptedPassword = encrypt(credentials.password);
  const ses = session.fromPartition(PARTITION, { cache: true });
  await authenticate(url, credentials, ses);
  writeConfig(nextConfig);
  await createOfficeWindow(url, credentials, true);
  stopLocalServer();
  startupError = '';
  return { ok: true };
});

app.whenReady().then(async () => {
  createTray();
  rebuildMenus();
  const config = readConfig();
  const environmentUrl = String(process.env.TASKFOLK_URL || '').trim();
  const environmentCredentials = environmentUrl ? {
    token: String(process.env.TASKFOLK_TOKEN || ''),
    password: String(process.env.TASKFOLK_PASSWORD || '')
  } : null;
  const credentials = environmentCredentials || savedCredentials(config);
  runtimeCredentials = credentials;
  runtimeOpenCodeCredentials = process.env.OPENCODE_SERVER_PASSWORD
    ? {
        username: String(process.env.OPENCODE_SERVER_USERNAME || 'opencode'),
        password: String(process.env.OPENCODE_SERVER_PASSWORD)
      }
    : savedOpenCodeCredentials(config);
  runtimeOpenClawCredentials = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD
    ? {
        token: String(process.env.OPENCLAW_GATEWAY_TOKEN || ''),
        password: String(process.env.OPENCLAW_GATEWAY_PASSWORD || '')
      }
    : savedOpenClawCredentials(config, runtimeOpenClawUrl || config.openClawUrl || DEFAULT_OPENCLAW_URL);
  runtimeOpenClawUrl = process.env.OPENCLAW_GATEWAY_URL
    ? normalizeOpenClawUrl(process.env.OPENCLAW_GATEWAY_URL)
    : '';
  runtimeOpenClawCredentialsUrl = runtimeOpenClawUrl || normalizeOpenClawUrl(config.openClawUrl || DEFAULT_OPENCLAW_URL);
  const startupUrl = environmentUrl || config.url;
  const startupMode = environmentUrl ? 'remote' : connectionMode(config);

  if (startupMode === 'local' && config.connectionMode === 'local') {
    try {
      const local = await startLocalServer();
      runtimeCredentials = local.credentials;
      await createOfficeWindow(local.url, local.credentials);
    } catch (error) {
      openSettingsWindow(error.message);
    }
  } else if (startupUrl) {
    try {
      await createOfficeWindow(startupUrl, credentials);
    } catch (error) {
      openSettingsWindow(error.message);
    }
  } else {
    openSettingsWindow();
  }

  app.on('activate', () => {
    if (officeWindow) officeWindow.show();
    else openSettingsWindow();
  });
});

app.on('window-all-closed', () => {
  // The tray keeps the companion available until the user explicitly quits.
  if (!tray && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  clearTimeout(openCodeTimer);
  clearTimeout(vsCodeCopilotTimer);
  clearTimeout(codexTimer);
  clearTimeout(claudeTimer);
  clearTimeout(openClawTimer);
  stopLocalServer();
});
