const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, screen, session, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_OPENCODE_URL,
  fetchOpenCodeAgents,
  normalizeOpenCodeGrouping,
  normalizeOpenCodeUrl,
  openCodeRuntimeSignature,
  preferOpenCodeAgent
} = require('./providers/opencode.cjs');
const { fetchOpenCodeDesktopAgents } = require('./providers/opencode-desktop.cjs');
const {
  DEFAULT_OPENCLAW_URL,
  createOpenClawDeviceIdentity,
  fetchOpenClawAgents,
  normalizeOpenClawUrl
} = require('./providers/openclaw.cjs');
const {
  copilotChatLogDirectories,
  defaultVsCodeAgentHostLogRoots,
  defaultVsCodeWorkspaceStorageRoots,
  fetchVsCodeCopilotAgents,
  normalizeVsCodeCopilotGrouping
} = require('./providers/vscode-copilot.cjs');
const {
  fetchCursorAgents,
  normalizeCursorGrouping
} = require('./providers/cursor.cjs');
const {
  fetchCodexAgents,
  normalizeCodexGrouping
} = require('./providers/codex.cjs');
const {
  fetchGooseAgents,
  normalizeGooseGrouping
} = require('./providers/goose.cjs');
const {
  DEFAULT_HERMES_GATEWAY_URL,
  fetchHermesAgents,
  fetchHermesRemoteAgents,
  normalizeHermesConnectionMode,
  normalizeHermesGatewayUrl,
  normalizeHermesGrouping
} = require('./providers/hermes.cjs');
const {
  fetchBuzzAgents,
  normalizeBuzzGrouping
} = require('./providers/buzz.cjs');
const {
  fetchClaudeAgents,
  normalizeClaudeGrouping
} = require('./providers/claude.cjs');
const {
  fetchGeminiAgents,
  normalizeGeminiGrouping
} = require('./providers/gemini.cjs');
const {
  fetchAntigravityAgents,
  normalizeAntigravityGrouping
} = require('./providers/antigravity.cjs');
const {
  DEFAULT_OLLAMA_URL,
  fetchOllamaAgents,
  normalizeOllamaGrouping,
  normalizeOllamaUrl
} = require('./providers/ollama.cjs');
const { fetchOllamaDesktopAgents } = require('./providers/ollama-desktop.cjs');
const {
  DEFAULT_LM_STUDIO_URL,
  fetchLmStudioAgents,
  normalizeLmStudioGrouping,
  normalizeLmStudioUrl
} = require('./providers/lmstudio.cjs');
const { fetchLmStudioDesktopAgents } = require('./providers/lmstudio-desktop.cjs');
const { isLocalServerPortConflict, normalizeLocalServerPort } = require('./local-server.cjs');
const { normalizeAdditionalFolks } = require('./companion-state.cjs');
const {
  integrationRefreshConfig,
  integrationRefreshSettings,
  normalizeIntegrationRefreshMs
} = require('./refresh-intervals.cjs');
const {
  integrationKeyForProvider,
  integrationPollingRefreshMs,
  lowEnergyVisibleProvidersOnly,
  providerPollingAllowedForVisibleSet
} = require('./low-energy-options.cjs');
const {
  DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS,
  runtimePublishDue,
  runtimeRosterMissingFromCache,
  runtimeRosterRefreshMs
} = require('./runtime-publish-policy.cjs');

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
const MAC_TRAY_ICON_PATH = path.join(__dirname, 'assets', 'trayTemplate.png');
const MOST_RECENT_AGENT_ID = '__latest__';
const OPENCODE_REQUEST_TIMEOUT_MS = 2_500;
const RUNTIME_PUBLISH_TIMEOUT_MS = 5_000;
const OLLAMA_REQUEST_TIMEOUT_MS = 2_500;
const LM_STUDIO_REQUEST_TIMEOUT_MS = 2_500;
const AGENT_SNAPSHOT_REFRESH_MS = 5_000;
const AGENT_SNAPSHOT_REQUEST_TIMEOUT_MS = 12_000;
const LOCAL_SERVER_START_TIMEOUT_MS = 12_000;
// Codex ACP discovery can legitimately use its full four-second timeout before
// falling back to the local task index. Keep saved folk restoration pending
// long enough for that first connector snapshot to be published.
const CONNECTOR_STARTUP_GRACE_MS = 4_250;
const SYSTEM_SLEEP_GAP_MS = 20_000;
const AUTO_UPDATE_INITIAL_DELAY_MS = 30_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const CONFIG_BACKUP_FORMAT = 'taskfolk-config-backup';
const CONFIG_BACKUP_VERSION = 1;
const AVATAR_ASSIGNMENTS_FILE = 'avatar-assignments.json';
const AGENT_ACHIEVEMENTS_FILE = 'agent-achievements.json';

app.setName('Taskfolk');

let officeWindow = null;
let settingsWindow = null;
let configWindow = null;
let rankBoardWindow = null;
let tray = null;
let updateStatus = 'idle';
let availableUpdateVersion = '';
let updateDownloadPercent = 0;
let updateRequestIsManual = false;
let updatePromptWindow = null;
let updateErrorWasShown = false;
let automaticUpdateCheckTimer = null;
const liveUpdaterMenuItems = new Set();
let macDockIcon = null;
let dockHideRetryTimer = null;
let dockShowRetryTimer = null;
let boundsTimer = null;
let runtimeCredentials = null;
let startupError = '';
let activeBaseUrl = '';
let availableAgents = [];
let openCodeTimer = null;
let openCodeSyncInFlight = false;
let openCodePublished = false;
let openCodeLastError = '';
let openCodePublishState = null;
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
let vsCodeCopilotSnapshotSignature = '';
let vsCodeCopilotPublishState = null;
let vsCodeCopilotWatchDebounceTimer = null;
const vsCodeCopilotWatchers = new Map();
let cursorTimer = null;
let cursorSyncInFlight = false;
let cursorPublished = false;
let cursorLastError = '';
let codexTimer = null;
let codexSyncInFlight = false;
let codexPublished = false;
let codexLastError = '';
let codexPublishState = null;
let gooseTimer = null;
let gooseSyncInFlight = false;
let goosePublished = false;
let gooseLastError = '';
let hermesTimer = null;
let hermesSyncInFlight = false;
let hermesPublished = false;
let hermesLastError = '';
let runtimeHermesGatewayUrl = '';
let runtimeHermesGatewayToken = '';
let runtimeHermesCredentialsUrl = '';
let buzzTimer = null;
let buzzSyncInFlight = false;
let buzzPublished = false;
let buzzLastError = '';
let claudeTimer = null;
let claudeSyncInFlight = false;
let claudePublished = false;
let claudeLastError = '';
let geminiTimer = null;
let geminiSyncInFlight = false;
let geminiPublished = false;
let geminiLastError = '';
let antigravityTimer = null;
let antigravitySyncInFlight = false;
let antigravityPublished = false;
let antigravityLastError = '';
let ollamaTimer = null;
let ollamaSyncInFlight = false;
let ollamaPublished = false;
let ollamaLastError = '';
let lmStudioTimer = null;
let lmStudioSyncInFlight = false;
let lmStudioPublished = false;
let lmStudioLastError = '';
let runtimeLmStudioToken = '';
let runtimeLmStudioCredentialsUrl = '';
let runtimeSyncGeneration = 0;
let lastRuntimeHeartbeatAt = Date.now();
let quitting = false;
let systemSuspended = false;
let sessionLocked = false;
let runtimePowerSuspended = false;
let providerChecksPaused = false;
let agentSnapshot = null;
let agentSnapshotVersion = 0;
let agentSnapshotTimer = null;
let agentSnapshotRequest = null;
let agentSnapshotController = null;
const runtimeAgentMenuSignatures = new Map();
const runtimeAgentRosters = new Map();
const runtimeAgentLastPublishedAt = new Map();
const companionWindows = new Map();
const windowDrags = new Map();
const mouseIgnoringWindows = new Set();
const additionalFolkBoundsTimers = new Map();

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

ipcMain.on('office-window:visibility', (event, visible) => {
  const targetWindow = companionWindowForSender(event);
  if (!targetWindow) return;
  const metadata = companionWindows.get(targetWindow);
  companionWindows.set(targetWindow, { ...metadata, rendererVisible: Boolean(visible) });
  if (visible) refreshAgentSnapshotForVisibleCompanions();
  else scheduleAgentSnapshotPolling();
});

ipcMain.on('office-window:reload', (event) => {
  const window = companionWindowForSender(event);
  if (window) window.reload();
});

ipcMain.handle('office:agents:get', async (event) => {
  if (!companionWindowForSender(event)) throw new Error('Unauthorized agent snapshot request.');
  return agentSnapshot || refreshAgentSnapshot({ broadcast: false });
});

ipcMain.handle('office:agents:refresh', async (event) => {
  if (!companionWindowForSender(event)) throw new Error('Unauthorized agent snapshot refresh.');
  return refreshAgentSnapshot();
});

ipcMain.on('config:changed', (event) => {
  if (!configWindow || configWindow.isDestroyed() || event.sender !== configWindow.webContents) return;
  void refreshAvailableAgents().catch((error) => {
    console.warn(`Could not refresh agents after Config changed: ${error.message}`);
  });
});

function displayMode(config = readConfig()) {
  return ['avatar', 'random'].includes(config.displayMode) ? config.displayMode : 'office';
}

function isAlwaysOnTopEnabled(config = readConfig()) {
  return config.alwaysOnTop === undefined ? true : Boolean(config.alwaysOnTop);
}

function isLowEnergyModeEnabled(config = readConfig()) {
  return Boolean(config.lowEnergyMode);
}

function areProviderChecksPaused() {
  return providerChecksPaused;
}

function integrationForAgentId(agentId) {
  const id = String(agentId || '');
  const knownAgent = availableAgents.find((agent) => agent.id === id);
  return knownAgent?.integration || integrationKeyForProvider(id.split(':')[0]);
}

function visibleIntegrationKeys(config = readConfig()) {
  if (displayMode(config) !== 'avatar') return null;
  if (config.selectedAgent === MOST_RECENT_AGENT_ID) return null;
  const integrations = new Set();
  for (const agentId of displayedAgentIds()) {
    const integration = integrationForAgentId(agentId);
    if (integration) integrations.add(integration);
  }
  return integrations;
}

function providerPollingAllowed(config, integration) {
  if (areProviderChecksPaused(config)) return false;
  return providerPollingAllowedForVisibleSet(config, integration, visibleIntegrationKeys(config));
}

function runtimeProviderForIntegration(integration) {
  return ({
    openCode: 'opencode',
    openClaw: 'openclaw',
    vsCodeCopilot: 'vscode-copilot',
    cursor: 'cursor',
    codex: 'codex',
    goose: 'goose',
    hermes: 'hermes',
    buzz: 'buzz',
    claude: 'claude',
    gemini: 'gemini',
    antigravity: 'antigravity',
    ollama: 'ollama',
    lmStudio: 'lmstudio'
  })[integration] || '';
}

function runtimeAdapterRefreshMs(config, integration) {
  const refreshMs = integrationPollingRefreshMs(config, integration);
  const provider = runtimeProviderForIntegration(integration);
  return runtimeRosterRefreshMs(
    refreshMs,
    providerPollingAllowed(config, integration),
    Boolean(runtimeAgentRosters.get(provider)?.length)
  );
}

function isShowOnAllDesktopsEnabled(config = readConfig()) {
  return process.platform === 'darwin' && Boolean(config.showOnAllDesktops);
}

function shouldSkipTaskbar(config = readConfig()) {
  return process.platform === 'darwin' && Boolean(config.hideDockIcon);
}

function isMenuBarIconEnabled(config = readConfig()) {
  if (process.platform !== 'darwin') return true;
  // A hidden Dock icon must always leave the menu-bar icon available, even if
  // an older or imported configuration contains conflicting values.
  if (config.hideDockIcon) return true;
  // Before this was a separate preference, menu-bar visibility was implied by
  // hideDockIcon. Preserve that behavior for existing installations.
  if (Object.prototype.hasOwnProperty.call(config, 'showMenuBarIcon')) {
    return Boolean(config.showMenuBarIcon);
  }
  return Boolean(config.hideDockIcon);
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

function readJsonObjectFile(filePath, fallback = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writePrivateJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
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

function savedLmStudioToken(config = readConfig(), baseUrl = '') {
  const normalizedUrl = baseUrl ? normalizeLmStudioUrl(baseUrl) : '';
  const credentialsUrl = config.lmStudioCredentialsUrl || config.lmStudioUrl || '';
  const credentialsMatch = !normalizedUrl || !credentialsUrl
    || normalizeLmStudioUrl(credentialsUrl) === normalizedUrl;
  return credentialsMatch ? decrypt(config.encryptedLmStudioApiToken) : '';
}

function savedHermesGatewayToken(config = readConfig(), baseUrl = '') {
  const normalizedUrl = baseUrl ? normalizeHermesGatewayUrl(baseUrl) : '';
  const credentialsUrl = config.hermesCredentialsUrl || config.hermesGatewayUrl || '';
  const credentialsMatch = !normalizedUrl || !credentialsUrl
    || normalizeHermesGatewayUrl(credentialsUrl) === normalizedUrl;
  return credentialsMatch ? decrypt(config.encryptedHermesGatewayToken) : '';
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
    customVariants: path.join(app.getPath('userData'), 'custom-variants'),
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
  for (const directory of [paths.root, paths.shared, paths.config, paths.customVariants]) {
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
      CUSTOM_AVATAR_VARIANTS_DIR: paths.customVariants,
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
      const text = chunk.toString();
      output += text;
      const message = text.trim();
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
      if (!settled && configuredPort && isLocalServerPortConflict(output)) {
        settled = true;
        clearTimeout(timer);
        const config = readConfig();
        writeConfig({ ...config, localServerPort: 0 });
        void startLocalServer().then(resolve, reject);
        return;
      }
      if (!settled) {
        const details = output.trim();
        finish(new Error(`Local Taskfolk stopped before startup (${signal || code}).${details ? ` ${details}` : ''}`));
      }
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

function savedAdditionalFolks(config = readConfig()) {
  return normalizeAdditionalFolks(config.additionalFolks);
}

function saveAdditionalFolk(agentId, bounds) {
  const id = String(agentId || '').trim();
  if (!id) return;
  const config = readConfig();
  const additionalFolks = savedAdditionalFolks(config);
  const existingIndex = additionalFolks.findIndex((folk) => folk.agentId === id);
  const next = normalizeAdditionalFolks([{ agentId: id, bounds }])[0] || { agentId: id };
  if (existingIndex >= 0) additionalFolks[existingIndex] = next;
  else additionalFolks.push(next);
  writeConfig({ ...config, additionalFolks });
}

function forgetAdditionalFolk(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return;
  const config = readConfig();
  writeConfig({
    ...config,
    additionalFolks: savedAdditionalFolks(config).filter((folk) => folk.agentId !== id)
  });
}

function saveAdditionalFolkBounds(targetWindow) {
  const metadata = companionWindows.get(targetWindow);
  if (!metadata || metadata.primary || !metadata.agentId || targetWindow.isDestroyed()
    || targetWindow.isMinimized() || targetWindow.isMaximized()) return;
  saveAdditionalFolk(metadata.agentId, targetWindow.getBounds());
}

function persistAdditionalFolkBounds(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  clearTimeout(additionalFolkBoundsTimers.get(targetWindow));
  additionalFolkBoundsTimers.set(targetWindow, setTimeout(() => {
    additionalFolkBoundsTimers.delete(targetWindow);
    saveAdditionalFolkBounds(targetWindow);
  }, 300));
}

function removeAdditionalFolk(targetWindow) {
  const metadata = companionWindows.get(targetWindow);
  if (!metadata || metadata.primary) return;
  forgetAdditionalFolk(metadata.agentId);
  targetWindow.close();
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

function ensureDockHidden(retriesRemaining = 2) {
  if (process.platform !== 'darwin' || !app.dock) return;
  // Showing an NSWindow can promote the development Electron bundle on the
  // next native event-loop turn. Reassert accessory mode even when the Dock is
  // currently hidden, then keep checking after the window has been shown.
  for (const window of BrowserWindow.getAllWindows()) window.setSkipTaskbar(true);
  app.setActivationPolicy('accessory');
  if (app.dock.isVisible()) app.dock.hide();
  // Keep the existing retry schedule instead of creating overlapping timers.
  if (dockHideRetryTimer || retriesRemaining <= 0) return;
  dockHideRetryTimer = setTimeout(() => {
    dockHideRetryTimer = null;
    if (!readConfig().hideDockIcon) return;
    ensureDockHidden(retriesRemaining - 1);
  }, 1_100);
}

function applyMacDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (!macDockIcon) {
    const packagedIconPath = path.join(process.resourcesPath, 'icon.icns');
    macDockIcon = nativeImage.createFromPath(app.isPackaged ? packagedIconPath : APP_ICON_PATH);
    if (macDockIcon.isEmpty() && app.isPackaged) macDockIcon = nativeImage.createFromPath(APP_ICON_PATH);
  }
  if (!macDockIcon.isEmpty()) app.dock.setIcon(macDockIcon);
}

function ensureDockVisible(retriesRemaining = 4) {
  if (process.platform !== 'darwin' || !app.dock) return;
  // A window may finish opening with a stale config snapshot after the user
  // has enabled menu-bar-only mode. Never let that late caller show the Dock.
  if (readConfig().hideDockIcon) {
    ensureDockHidden();
    return;
  }
  // Reassert the regular policy on every attempt: macOS can accept the request
  // before it has finished registering the application with the Dock.
  for (const window of BrowserWindow.getAllWindows()) window.setSkipTaskbar(false);
  app.setActivationPolicy('regular');
  // Explicitly reapply the PNG when entering regular mode. Some installed
  // builds otherwise get a Dock entry and running dot with blank artwork.
  applyMacDockIcon();

  const verifyVisible = () => {
    if (readConfig().hideDockIcon) {
      ensureDockHidden();
      return;
    }
    if (app.dock.isVisible()) {
      clearTimeout(dockShowRetryTimer);
      dockShowRetryTimer = null;
      return;
    }
    if (dockShowRetryTimer || retriesRemaining <= 0) return;
    dockShowRetryTimer = setTimeout(() => {
      dockShowRetryTimer = null;
      if (!readConfig().hideDockIcon) ensureDockVisible(retriesRemaining - 1);
    }, 1_100);
  };

  app.dock.show().then(verifyVisible, verifyVisible);
  // Do not depend on show() settling to schedule reconciliation. During early
  // packaged-app startup macOS can leave that promise pending with no icon.
  verifyVisible();
}

function applyDockVisibility() {
  if (process.platform !== 'darwin' || !app.dock) return;
  // Callers that create windows can retain an older config object while doing
  // asynchronous work. The persisted preference is the source of truth.
  const config = readConfig();
  if (config.hideDockIcon) {
    clearTimeout(dockShowRetryTimer);
    dockShowRetryTimer = null;
    // Accessory activation policy is authoritative; hide() remains as a
    // compatibility fallback. Menu-bar visibility is managed independently.
    ensureDockHidden();
    return;
  }

  // Keep the status item until macOS confirms that the Dock entry is visible,
  // so switching modes cannot briefly make Taskfolk unreachable.
  clearTimeout(dockHideRetryTimer);
  dockHideRetryTimer = null;
  clearTimeout(dockShowRetryTimer);
  dockShowRetryTimer = null;
  ensureDockVisible();
}

function setHideDockIcon(enabled) {
  const config = readConfig();
  const hideDockIcon = Boolean(enabled);
  const showMenuBarIcon = isMenuBarIconEnabled(config);
  if (hideDockIcon && !showMenuBarIcon) {
    settingsWindow?.webContents.send('settings:dock-visibility', false);
    rebuildMenus();
    return;
  }
  writeConfig({ ...config, hideDockIcon, showMenuBarIcon });
  applyDockVisibility({ ...config, hideDockIcon });
  settingsWindow?.webContents.send('settings:dock-visibility', hideDockIcon);
  rebuildMenus();
}

function applyMenuBarVisibility() {
  if (process.platform !== 'darwin' || isMenuBarIconEnabled()) {
    createTray();
    return;
  }
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  rebuildMenus();
}

function setShowMenuBarIcon(enabled) {
  const config = readConfig();
  const showMenuBarIcon = Boolean(enabled);
  if (!showMenuBarIcon && config.hideDockIcon) {
    settingsWindow?.webContents.send('settings:menu-bar-visibility', true);
    rebuildMenus();
    return;
  }
  writeConfig({ ...config, showMenuBarIcon });
  applyMenuBarVisibility();
  settingsWindow?.webContents.send('settings:menu-bar-visibility', showMenuBarIcon);
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
    skipTaskbar: shouldSkipTaskbar(),
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.platform === 'darwin') settingsWindow.setSkipTaskbar(shouldSkipTaskbar());
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  applyDockVisibility();
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
    skipTaskbar: shouldSkipTaskbar(),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'config-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });
  if (process.platform === 'darwin') configWindow.setSkipTaskbar(shouldSkipTaskbar());
  applyDockVisibility();
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

async function openRankBoardWindow() {
  if (!activeBaseUrl) return openSettingsWindow('Open an office before accessing its Rank Board.');
  const rankBoardUrl = endpoint(activeBaseUrl, '/rank-board.html?app=desktop');
  if (rankBoardWindow && !rankBoardWindow.isDestroyed()) {
    if (rankBoardWindow.webContents.getURL() !== rankBoardUrl) await rankBoardWindow.loadURL(rankBoardUrl);
    rankBoardWindow.show();
    rankBoardWindow.focus();
    return;
  }

  rankBoardWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 680,
    minHeight: 480,
    title: 'Taskfolk Rank Board',
    icon: APP_ICON_PATH,
    backgroundColor: '#101722',
    autoHideMenuBar: true,
    skipTaskbar: shouldSkipTaskbar(),
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });
  if (process.platform === 'darwin') rankBoardWindow.setSkipTaskbar(shouldSkipTaskbar());
  applyDockVisibility();
  const allowedOrigin = new URL(activeBaseUrl).origin;
  rankBoardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  rankBoardWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  rankBoardWindow.on('closed', () => { rankBoardWindow = null; });
  await rankBoardWindow.loadURL(rankBoardUrl);
}

function showRankBoardWindow() {
  void openRankBoardWindow().catch((error) => openSettingsWindow(`Could not open Rank Board: ${error.message}`));
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

function requestWithTimeout(request, controller, timeoutMs, message) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller?.abort();
      const error = new Error(message);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([request, expired]).finally(() => clearTimeout(timeout));
}

function broadcastAgentSnapshot(snapshot) {
  for (const targetWindow of companionWindows.keys()) {
    if (!targetWindow.isDestroyed()) targetWindow.webContents.send('office:agents-snapshot', snapshot);
  }
}

function broadcastProviderChecksPaused(paused = areProviderChecksPaused()) {
  for (const targetWindow of companionWindows.keys()) {
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send('office:provider-checks-paused', Boolean(paused));
    }
  }
}

function stopAgentSnapshotPolling() {
  clearTimeout(agentSnapshotTimer);
  agentSnapshotTimer = null;
}

function scheduleAgentSnapshotPolling() {
  stopAgentSnapshotPolling();
  const hasVisibleCompanion = [...companionWindows.entries()].some(([targetWindow, metadata]) => (
    !targetWindow.isDestroyed()
    && targetWindow.isVisible()
    && !targetWindow.isMinimized()
    && metadata?.rendererVisible !== false
  ));
  if (quitting || runtimePowerSuspended || areProviderChecksPaused() || !activeBaseUrl || !hasVisibleCompanion) return;
  agentSnapshotTimer = setTimeout(async () => {
    await refreshAgentSnapshot();
    scheduleAgentSnapshotPolling();
  }, AGENT_SNAPSHOT_REFRESH_MS);
  agentSnapshotTimer.unref();
}

function refreshAgentSnapshotForVisibleCompanions() {
  if (areProviderChecksPaused() && agentSnapshot) return stopAgentSnapshotPolling();
  if (!activeBaseUrl) return scheduleAgentSnapshotPolling();
  void refreshAgentSnapshot().finally(scheduleAgentSnapshotPolling);
}

function resetAgentSnapshotCoordinator() {
  stopAgentSnapshotPolling();
  agentSnapshotController?.abort();
  agentSnapshotController = null;
  agentSnapshotRequest = null;
  agentSnapshot = null;
  agentSnapshotVersion = 0;
}

async function refreshAgentSnapshot({ broadcast = true } = {}) {
  if (agentSnapshotRequest) return agentSnapshotRequest;
  if (areProviderChecksPaused() && agentSnapshot) return agentSnapshot;
  if (!activeBaseUrl) throw new Error('No active Taskfolk server.');

  const requestedBaseUrl = activeBaseUrl;
  const controller = new AbortController();
  agentSnapshotController = controller;
  let request;
  request = (async () => {
    const ses = session.fromPartition(PARTITION, { cache: true });
    const response = await requestWithTimeout(
      ses.fetch(endpoint(requestedBaseUrl, `/api/agents?t=${Date.now()}`), {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      }),
      controller,
      AGENT_SNAPSHOT_REQUEST_TIMEOUT_MS,
      'Agent snapshot request timed out.'
    );
    if (!response.ok) throw new Error(`Agent snapshot failed (${response.status}).`);
    const data = await response.json();
    if (requestedBaseUrl !== activeBaseUrl) return agentSnapshot;
    agentSnapshot = {
      version: ++agentSnapshotVersion,
      fetchedAt: Date.now(),
      data,
      error: null
    };
    if (broadcast) broadcastAgentSnapshot(agentSnapshot);
    return agentSnapshot;
  })().catch((error) => {
    const failure = {
      ...(agentSnapshot || { version: agentSnapshotVersion, fetchedAt: 0, data: null }),
      error: error?.name === 'AbortError' ? 'Agent snapshot request was canceled.' : error.message
    };
    if (broadcast && requestedBaseUrl === activeBaseUrl) broadcastAgentSnapshot(failure);
    return failure;
  }).finally(() => {
    if (agentSnapshotController === controller) agentSnapshotController = null;
    if (agentSnapshotRequest === request) agentSnapshotRequest = null;
  });
  agentSnapshotRequest = request;
  return request;
}

async function fetchAvailableAgents(baseUrl, ses) {
  const controller = new AbortController();
  try {
    const response = await requestWithTimeout(
      ses.fetch(endpoint(baseUrl, `/api/agents?t=${Date.now()}`), {
        credentials: 'include',
        signal: controller.signal
      }),
      controller,
      RUNTIME_PUBLISH_TIMEOUT_MS,
      'Agent discovery request timed out.'
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data.agents) ? data.agents : []).map((agent) => ({
      id: String(agent.id || ''),
      name: String(agent.name || agent.id || 'Agent'),
      integration: integrationKeyForProvider(agent.source || agent.activity?.provider || String(agent.id || '').split(':')[0]),
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function savedAvatarAgentIsUnavailable(config, agents = availableAgents) {
  return displayMode(config) === 'avatar'
    && config.selectedAgent !== MOST_RECENT_AGENT_ID
    && !agents.some((agent) => agent.id === config.selectedAgent);
}

function savedAdditionalFolkIsUnavailable(config, agents = availableAgents) {
  const availableIds = new Set(agents.map((agent) => agent.id));
  return savedAdditionalFolks(config).some((folk) => !availableIds.has(folk.agentId));
}

function savedCompanionFolkIsUnavailable(config, agents = availableAgents) {
  return savedAvatarAgentIsUnavailable(config, agents)
    || savedAdditionalFolkIsUnavailable(config, agents);
}

async function refreshAvailableAgents() {
  if (!activeBaseUrl) return;
  const ses = session.fromPartition(PARTITION, { cache: true });
  availableAgents = await fetchAvailableAgents(activeBaseUrl, ses);

  let config = readConfig();
  const selectedAgentUnavailable = savedAvatarAgentIsUnavailable(config);
  if (selectedAgentUnavailable) {
    config = { ...config, selectedAgent: availableAgents[0]?.id || '' };
    writeConfig(config);
    await loadCompanionView();
  }

  reconcileAdditionalCompanionWindows();
  rebuildMenus();
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
  const controller = new AbortController();
  const response = await requestWithTimeout(
    ses.fetch(endpoint(activeBaseUrl, '/api/runtime-agents'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceId: `${ensureRuntimeSourceId(config)}:${provider}`,
        provider,
        publishedAtMs: Date.now(),
        agents
      }),
      signal: controller.signal
    }),
    controller,
    RUNTIME_PUBLISH_TIMEOUT_MS,
    `${provider} status publish timed out.`
  );
  if (!response.ok) {
    let message = `Taskfolk rejected ${provider} status (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (agents.length) runtimeAgentRosters.set(provider, agents);
  else runtimeAgentRosters.delete(provider);
  runtimeAgentLastPublishedAt.set(provider, Date.now());
  const nextSignature = agents.map((agent) => `${agent.id}:${agent.name}`).join('|');
  const missingFromMenuCache = runtimeRosterMissingFromCache(availableAgents, agents);
  if (nextSignature !== runtimeAgentMenuSignatures.get(provider) || missingFromMenuCache) {
    runtimeAgentMenuSignatures.set(provider, nextSignature);
    availableAgents = await fetchAvailableAgents(activeBaseUrl, ses);
    reconcileAdditionalCompanionWindows();
    rebuildMenus();
  }
}

async function preserveRuntimeAgentsForSkippedPolling(config, integration) {
  if (providerPollingAllowed(config, integration)) return false;
  const provider = runtimeProviderForIntegration(integration);
  const agents = runtimeAgentRosters.get(provider);
  if (!provider || !agents?.length) return true;
  const lastPublishedAt = runtimeAgentLastPublishedAt.get(provider) || 0;
  if (Date.now() - lastPublishedAt >= DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS) {
    await publishRuntimeAgents(provider, agents, config);
  }
  return true;
}

async function publishCodexRuntimeAgents(agents, config = readConfig()) {
  const nowMs = Date.now();
  const signature = JSON.stringify({
    baseUrl: activeBaseUrl,
    sourceId: ensureRuntimeSourceId(config),
    agents
  });
  if (!runtimePublishDue(
    codexPublishState,
    signature,
    nowMs,
    DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS
  )) return false;
  await publishRuntimeAgents('codex', agents, config);
  codexPublishState = { signature, publishedAtMs: nowMs };
  return true;
}

async function publishOpenCodeRuntimeAgents(agents, config = readConfig()) {
  const nowMs = Date.now();
  const signature = JSON.stringify({
    baseUrl: activeBaseUrl,
    sourceId: ensureRuntimeSourceId(config),
    agents: openCodeRuntimeSignature(agents)
  });
  if (!runtimePublishDue(
    openCodePublishState,
    signature,
    nowMs,
    DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS
  )) return false;
  await publishRuntimeAgents('opencode', agents, config);
  openCodePublishState = { signature, publishedAtMs: nowMs };
  return true;
}

function scheduleOpenCodeSync() {
  clearTimeout(openCodeTimer);
  openCodeTimer = null;
  if (readConfig().openCodeEnabled || openCodePublished) {
    openCodeTimer = setTimeout(syncOpenCodeAdapter, runtimeAdapterRefreshMs(readConfig(), 'openCode'));
  }
}

async function syncOpenCodeAdapter() {
  if (openCodeSyncInFlight) {
    scheduleOpenCodeSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  openCodeSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.openCodeEnabled) {
      if (openCodePublished) await publishOpenCodeRuntimeAgents([], config);
      openCodePublished = false;
      openCodeLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'openCode')) return;
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
      const preferred = [...desktopAgents, ...serverAgents]
        .reduce((current, candidate) => preferOpenCodeAgent(current, candidate), null);
      agents = preferred ? [preferred] : [];
    } else {
      const agentsById = new Map(desktopAgents.map((agent) => [agent.id, agent]));
      for (const agent of serverAgents) {
        agentsById.set(agent.id, preferOpenCodeAgent(agentsById.get(agent.id), agent));
      }
      agents = [...agentsById.values()];
    }
    if (!agents.length && serverError && desktopError) {
      throw new Error(`OpenCode server: ${serverError.message}; desktop: ${desktopError.message}`);
    }
    if (!agents.length && serverError && !desktopAgents.length) throw serverError;
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishOpenCodeRuntimeAgents(agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    openCodePublished = agents.length > 0;
    openCodeLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.name === 'AbortError' ? 'OpenCode status request timed out.' : error.message;
    if (message !== openCodeLastError) console.warn(`OpenCode adapter: ${message}`);
    openCodeLastError = message;
    if (openCodePublished) {
      try { await publishOpenCodeRuntimeAgents([]); } catch {}
      openCodePublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
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
    vsCodeCopilotTimer = setTimeout(syncVsCodeCopilotAdapter, runtimeAdapterRefreshMs(readConfig(), 'vsCodeCopilot'));
  }
}

function stopVsCodeCopilotWatchers() {
  clearTimeout(vsCodeCopilotWatchDebounceTimer);
  vsCodeCopilotWatchDebounceTimer = null;
  for (const watcher of vsCodeCopilotWatchers.values()) {
    try { watcher.close(); } catch {}
  }
  vsCodeCopilotWatchers.clear();
}

function scheduleVsCodeCopilotWatchSync() {
  clearTimeout(vsCodeCopilotWatchDebounceTimer);
  vsCodeCopilotWatchDebounceTimer = setTimeout(() => {
    vsCodeCopilotWatchDebounceTimer = null;
    if (vsCodeCopilotSyncInFlight) return scheduleVsCodeCopilotWatchSync();
    clearTimeout(vsCodeCopilotTimer);
    vsCodeCopilotTimer = null;
    void syncVsCodeCopilotAdapter();
  }, 100);
  vsCodeCopilotWatchDebounceTimer.unref();
}

function refreshVsCodeCopilotWatchers() {
  const config = readConfig();
  if (!config.vsCodeCopilotEnabled || !providerPollingAllowed(config, 'vsCodeCopilot')) {
    stopVsCodeCopilotWatchers();
    return;
  }
  const workspaceStorageRoots = defaultVsCodeWorkspaceStorageRoots();
  for (const root of workspaceStorageRoots) {
    let workspaces = [];
    try { workspaces = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const sessionsPath = path.join(root, workspace.name, 'chatSessions');
      if (vsCodeCopilotWatchers.has(sessionsPath)) continue;
      try {
        const watcher = fs.watch(sessionsPath, scheduleVsCodeCopilotWatchSync);
        watcher.on('error', () => {
          try { watcher.close(); } catch {}
          vsCodeCopilotWatchers.delete(sessionsPath);
        });
        vsCodeCopilotWatchers.set(sessionsPath, watcher);
      } catch {}
    }
  }
  for (const { chatLogDirectory } of copilotChatLogDirectories(
    defaultVsCodeAgentHostLogRoots(workspaceStorageRoots)
  )) {
    if (vsCodeCopilotWatchers.has(chatLogDirectory)) continue;
    try {
      const watcher = fs.watch(chatLogDirectory, (_eventType, filename) => {
        if (!filename || String(filename) === 'GitHub Copilot Chat.log') {
          scheduleVsCodeCopilotWatchSync();
        }
      });
      watcher.on('error', () => {
        try { watcher.close(); } catch {}
        vsCodeCopilotWatchers.delete(chatLogDirectory);
      });
      vsCodeCopilotWatchers.set(chatLogDirectory, watcher);
    } catch {}
  }
}

function startVsCodeCopilotWatchers() {
  stopVsCodeCopilotWatchers();
  refreshVsCodeCopilotWatchers();
}

function vsCodeCopilotStatusSignature(agents) {
  return JSON.stringify(agents.map((agent) => ({
    id: agent.id,
    status: agent.status,
    displayState: agent.displayState,
    task: agent.task,
    session: agent.activity?.sessionKeyShort
  })));
}

async function publishVsCodeCopilotRuntimeAgents(agents, config = readConfig()) {
  const nowMs = Date.now();
  const signature = JSON.stringify({
    baseUrl: activeBaseUrl,
    sourceId: ensureRuntimeSourceId(config),
    agents
  });
  if (!runtimePublishDue(
    vsCodeCopilotPublishState,
    signature,
    nowMs,
    DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS
  )) return false;
  await publishRuntimeAgents('vscode-copilot', agents, config);
  vsCodeCopilotPublishState = { signature, publishedAtMs: nowMs };
  return true;
}

function refreshAgentSnapshotAfterRuntimePublish() {
  const pending = agentSnapshotRequest;
  void Promise.resolve(pending)
    .finally(() => refreshAgentSnapshot())
    .finally(scheduleAgentSnapshotPolling);
}

async function syncVsCodeCopilotAdapter() {
  if (vsCodeCopilotSyncInFlight) {
    scheduleVsCodeCopilotSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  vsCodeCopilotSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.vsCodeCopilotEnabled) {
      if (vsCodeCopilotPublished) await publishVsCodeCopilotRuntimeAgents([], config);
      vsCodeCopilotPublished = false;
      vsCodeCopilotLastError = '';
      if (vsCodeCopilotSnapshotSignature) {
        vsCodeCopilotSnapshotSignature = '';
        refreshAgentSnapshotAfterRuntimePublish();
      }
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'vsCodeCopilot')) return;
    const agents = await fetchVsCodeCopilotAgents({
      grouping: normalizeVsCodeCopilotGrouping(config.vsCodeCopilotGrouping)
    });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishVsCodeCopilotRuntimeAgents(agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    const snapshotSignature = vsCodeCopilotStatusSignature(agents);
    if (snapshotSignature !== vsCodeCopilotSnapshotSignature) {
      vsCodeCopilotSnapshotSignature = snapshotSignature;
      refreshAgentSnapshotAfterRuntimePublish();
    }
    vsCodeCopilotPublished = agents.length > 0;
    vsCodeCopilotLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read VS Code Copilot activity.';
    if (message !== vsCodeCopilotLastError) console.warn(`VS Code Copilot adapter: ${message}`);
    vsCodeCopilotLastError = message;
    if (vsCodeCopilotPublished) {
      try { await publishVsCodeCopilotRuntimeAgents([]); } catch {}
      vsCodeCopilotPublished = false;
      if (vsCodeCopilotSnapshotSignature) {
        vsCodeCopilotSnapshotSignature = '';
        refreshAgentSnapshotAfterRuntimePublish();
      }
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    vsCodeCopilotSyncInFlight = false;
    refreshVsCodeCopilotWatchers();
    scheduleVsCodeCopilotSync();
  }
}

function startVsCodeCopilotAdapter() {
  clearTimeout(vsCodeCopilotTimer);
  vsCodeCopilotTimer = null;
  startVsCodeCopilotWatchers();
  void syncVsCodeCopilotAdapter();
}

function scheduleCursorSync() {
  clearTimeout(cursorTimer);
  cursorTimer = null;
  if (readConfig().cursorEnabled || cursorPublished) {
    cursorTimer = setTimeout(syncCursorAdapter, runtimeAdapterRefreshMs(readConfig(), 'cursor'));
  }
}

async function syncCursorAdapter() {
  if (cursorSyncInFlight) {
    scheduleCursorSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  cursorSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.cursorEnabled) {
      if (cursorPublished) await publishRuntimeAgents('cursor', [], config);
      cursorPublished = false;
      cursorLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'cursor')) return;
    const agents = await fetchCursorAgents({
      grouping: normalizeCursorGrouping(config.cursorGrouping)
    });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('cursor', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    cursorPublished = agents.length > 0;
    cursorLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Cursor activity.';
    if (message !== cursorLastError) console.warn(`Cursor adapter: ${message}`);
    cursorLastError = message;
    if (cursorPublished) {
      try { await publishRuntimeAgents('cursor', []); } catch {}
      cursorPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    cursorSyncInFlight = false;
    scheduleCursorSync();
  }
}

function startCursorAdapter() {
  clearTimeout(cursorTimer);
  cursorTimer = null;
  void syncCursorAdapter();
}

function scheduleCodexSync() {
  clearTimeout(codexTimer);
  codexTimer = null;
  if (readConfig().codexEnabled || codexPublished) {
    codexTimer = setTimeout(syncCodexAdapter, runtimeAdapterRefreshMs(readConfig(), 'codex'));
  }
}

async function syncCodexAdapter() {
  if (codexSyncInFlight) {
    scheduleCodexSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  codexSyncInFlight = true;
  try {
    const config = readConfig();
    const grouping = normalizeCodexGrouping(config.codexGrouping);
    if (!config.codexEnabled) {
      if (codexPublished) await publishCodexRuntimeAgents([], config);
      codexPublished = false;
      codexLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'codex')) return;
    const agents = await fetchCodexAgents({ grouping });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishCodexRuntimeAgents(agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    codexPublished = agents.length > 0;
    codexLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Codex activity.';
    if (message !== codexLastError) console.warn(`Codex adapter: ${message}`);
    codexLastError = message;
    if (codexPublished) {
      try { await publishCodexRuntimeAgents([]); } catch {}
      codexPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    codexSyncInFlight = false;
    scheduleCodexSync();
  }
}

function startCodexAdapter() {
  clearTimeout(codexTimer);
  codexTimer = null;
  void syncCodexAdapter();
}

function scheduleGooseSync() {
  clearTimeout(gooseTimer);
  gooseTimer = null;
  if (readConfig().gooseEnabled || goosePublished) {
    gooseTimer = setTimeout(syncGooseAdapter, runtimeAdapterRefreshMs(readConfig(), 'goose'));
  }
}

async function syncGooseAdapter() {
  if (gooseSyncInFlight) {
    scheduleGooseSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  gooseSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.gooseEnabled) {
      if (goosePublished) await publishRuntimeAgents('goose', [], config);
      goosePublished = false;
      gooseLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'goose')) return;
    const agents = await fetchGooseAgents({ grouping: normalizeGooseGrouping(config.gooseGrouping) });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('goose', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    goosePublished = agents.length > 0;
    gooseLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Goose activity.';
    if (message !== gooseLastError) console.warn(`Goose adapter: ${message}`);
    gooseLastError = message;
    if (goosePublished) {
      try { await publishRuntimeAgents('goose', []); } catch {}
      goosePublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    gooseSyncInFlight = false;
    scheduleGooseSync();
  }
}

function startGooseAdapter() {
  clearTimeout(gooseTimer);
  gooseTimer = null;
  void syncGooseAdapter();
}

function scheduleHermesSync() {
  clearTimeout(hermesTimer);
  hermesTimer = null;
  if (readConfig().hermesEnabled || hermesPublished) {
    hermesTimer = setTimeout(syncHermesAdapter, runtimeAdapterRefreshMs(readConfig(), 'hermes'));
  }
}

async function syncHermesAdapter() {
  if (hermesSyncInFlight) {
    scheduleHermesSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  hermesSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.hermesEnabled) {
      if (hermesPublished) await publishRuntimeAgents('hermes', [], config);
      hermesPublished = false;
      hermesLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'hermes')) return;
    const hermesMode = process.env.HERMES_GATEWAY_URL
      ? 'remote'
      : normalizeHermesConnectionMode(config.hermesConnectionMode);
    const agents = hermesMode === 'remote'
      ? await fetchHermesRemoteAgents({
          baseUrl: runtimeHermesGatewayUrl || config.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL,
          token: runtimeHermesGatewayToken
            || savedHermesGatewayToken(config, runtimeHermesGatewayUrl || config.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL),
          grouping: normalizeHermesGrouping(config.hermesGrouping)
        })
      : await fetchHermesAgents({ grouping: normalizeHermesGrouping(config.hermesGrouping) });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('hermes', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    hermesPublished = agents.length > 0;
    hermesLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Hermes activity.';
    if (message !== hermesLastError) console.warn(`Hermes adapter: ${message}`);
    hermesLastError = message;
    if (hermesPublished) {
      try { await publishRuntimeAgents('hermes', []); } catch {}
      hermesPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    hermesSyncInFlight = false;
    scheduleHermesSync();
  }
}

function startHermesAdapter() {
  clearTimeout(hermesTimer);
  hermesTimer = null;
  void syncHermesAdapter();
}

function scheduleBuzzSync() {
  clearTimeout(buzzTimer);
  buzzTimer = null;
  if (readConfig().buzzEnabled || buzzPublished) {
    buzzTimer = setTimeout(syncBuzzAdapter, runtimeAdapterRefreshMs(readConfig(), 'buzz'));
  }
}

async function syncBuzzAdapter() {
  if (buzzSyncInFlight) {
    scheduleBuzzSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  buzzSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.buzzEnabled) {
      if (buzzPublished) await publishRuntimeAgents('buzz', [], config);
      buzzPublished = false;
      buzzLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'buzz')) return;
    const agents = await fetchBuzzAgents({ grouping: normalizeBuzzGrouping(config.buzzGrouping) });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('buzz', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    buzzPublished = agents.length > 0;
    buzzLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Buzz activity.';
    if (message !== buzzLastError) console.warn(`Buzz adapter: ${message}`);
    buzzLastError = message;
    if (buzzPublished) {
      try { await publishRuntimeAgents('buzz', []); } catch {}
      buzzPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    buzzSyncInFlight = false;
    scheduleBuzzSync();
  }
}

function startBuzzAdapter() {
  clearTimeout(buzzTimer);
  buzzTimer = null;
  void syncBuzzAdapter();
}

function scheduleClaudeSync() {
  clearTimeout(claudeTimer);
  claudeTimer = null;
  if (readConfig().claudeEnabled || claudePublished) {
    claudeTimer = setTimeout(syncClaudeAdapter, runtimeAdapterRefreshMs(readConfig(), 'claude'));
  }
}

async function syncClaudeAdapter() {
  if (claudeSyncInFlight) {
    scheduleClaudeSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  claudeSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.claudeEnabled) {
      if (claudePublished) await publishRuntimeAgents('claude', [], config);
      claudePublished = false;
      claudeLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'claude')) return;
    const agents = await fetchClaudeAgents({ grouping: normalizeClaudeGrouping(config.claudeGrouping) });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('claude', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    claudePublished = agents.length > 0;
    claudeLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Claude activity.';
    if (message !== claudeLastError) console.warn(`Claude adapter: ${message}`);
    claudeLastError = message;
    if (claudePublished) {
      try { await publishRuntimeAgents('claude', []); } catch {}
      claudePublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    claudeSyncInFlight = false;
    scheduleClaudeSync();
  }
}

function startClaudeAdapter() {
  clearTimeout(claudeTimer);
  claudeTimer = null;
  void syncClaudeAdapter();
}

function scheduleGeminiSync() {
  clearTimeout(geminiTimer);
  geminiTimer = null;
  if (readConfig().geminiEnabled || geminiPublished) {
    geminiTimer = setTimeout(syncGeminiAdapter, runtimeAdapterRefreshMs(readConfig(), 'gemini'));
  }
}

async function syncGeminiAdapter() {
  if (geminiSyncInFlight) {
    scheduleGeminiSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  geminiSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.geminiEnabled) {
      if (geminiPublished) await publishRuntimeAgents('gemini', [], config);
      geminiPublished = false;
      geminiLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'gemini')) return;
    const agents = await fetchGeminiAgents({ grouping: normalizeGeminiGrouping(config.geminiGrouping) });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('gemini', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    geminiPublished = agents.length > 0;
    geminiLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Gemini activity.';
    if (message !== geminiLastError) console.warn(`Gemini adapter: ${message}`);
    geminiLastError = message;
    if (geminiPublished) {
      try { await publishRuntimeAgents('gemini', []); } catch {}
      geminiPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    geminiSyncInFlight = false;
    scheduleGeminiSync();
  }
}

function startGeminiAdapter() {
  clearTimeout(geminiTimer);
  geminiTimer = null;
  void syncGeminiAdapter();
}

function scheduleAntigravitySync() {
  clearTimeout(antigravityTimer);
  antigravityTimer = null;
  if (readConfig().antigravityEnabled || antigravityPublished) {
    antigravityTimer = setTimeout(syncAntigravityAdapter, runtimeAdapterRefreshMs(readConfig(), 'antigravity'));
  }
}

async function syncAntigravityAdapter() {
  if (antigravitySyncInFlight) {
    scheduleAntigravitySync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  antigravitySyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.antigravityEnabled) {
      if (antigravityPublished) await publishRuntimeAgents('antigravity', [], config);
      antigravityPublished = false;
      antigravityLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'antigravity')) return;
    const agents = await fetchAntigravityAgents({
      grouping: normalizeAntigravityGrouping(config.antigravityGrouping)
    });
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('antigravity', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    antigravityPublished = agents.length > 0;
    antigravityLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read Google Antigravity activity.';
    if (message !== antigravityLastError) console.warn(`Google Antigravity adapter: ${message}`);
    antigravityLastError = message;
    if (antigravityPublished) {
      try { await publishRuntimeAgents('antigravity', []); } catch {}
      antigravityPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    antigravitySyncInFlight = false;
    scheduleAntigravitySync();
  }
}

function startAntigravityAdapter() {
  clearTimeout(antigravityTimer);
  antigravityTimer = null;
  void syncAntigravityAdapter();
}

function scheduleOllamaSync() {
  clearTimeout(ollamaTimer);
  ollamaTimer = null;
  if (readConfig().ollamaEnabled || ollamaPublished) {
    ollamaTimer = setTimeout(syncOllamaAdapter, runtimeAdapterRefreshMs(readConfig(), 'ollama'));
  }
}

async function syncOllamaAdapter() {
  if (ollamaSyncInFlight) {
    scheduleOllamaSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  ollamaSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.ollamaEnabled) {
      if (ollamaPublished) await publishRuntimeAgents('ollama', [], config);
      ollamaPublished = false;
      ollamaLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'ollama')) return;
    const baseUrl = config.ollamaUrl || DEFAULT_OLLAMA_URL;
    const normalizedUrl = normalizeOllamaUrl(baseUrl);
    const hostname = new URL(normalizedUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const localServer = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
    let desktopAgents = [];
    let desktopError = null;
    if (localServer) {
      try {
        desktopAgents = await fetchOllamaDesktopAgents({
          grouping: normalizeOllamaGrouping(config.ollamaGrouping)
        });
      } catch (error) {
        desktopError = error;
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
    let serverAgents = [];
    let serverError = null;
    try {
      serverAgents = await fetchOllamaAgents({
        baseUrl: normalizedUrl,
        grouping: normalizeOllamaGrouping(config.ollamaGrouping),
        signal: controller.signal
      });
    } catch (error) {
      serverError = error;
    } finally {
      clearTimeout(timeout);
    }
    const agents = desktopAgents.length ? desktopAgents : serverAgents;
    if (!agents.length && serverError && desktopError) {
      throw new Error(`Ollama server: ${serverError.message}; desktop: ${desktopError.message}`);
    }
    if (!agents.length && serverError && !desktopAgents.length) throw serverError;
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('ollama', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    ollamaPublished = agents.length > 0;
    ollamaLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.name === 'AbortError'
      ? 'Ollama status request timed out.'
      : error?.message || 'Could not read Ollama activity.';
    if (message !== ollamaLastError) console.warn(`Ollama adapter: ${message}`);
    ollamaLastError = message;
    if (ollamaPublished) {
      try { await publishRuntimeAgents('ollama', []); } catch {}
      ollamaPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    ollamaSyncInFlight = false;
    scheduleOllamaSync();
  }
}

function startOllamaAdapter() {
  clearTimeout(ollamaTimer);
  ollamaTimer = null;
  void syncOllamaAdapter();
}

function scheduleLmStudioSync() {
  clearTimeout(lmStudioTimer);
  lmStudioTimer = null;
  if (readConfig().lmStudioEnabled || lmStudioPublished) {
    lmStudioTimer = setTimeout(syncLmStudioAdapter, runtimeAdapterRefreshMs(readConfig(), 'lmStudio'));
  }
}

async function syncLmStudioAdapter() {
  if (lmStudioSyncInFlight) {
    scheduleLmStudioSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  lmStudioSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.lmStudioEnabled) {
      if (lmStudioPublished) await publishRuntimeAgents('lmstudio', [], config);
      lmStudioPublished = false;
      lmStudioLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'lmStudio')) return;
    const baseUrl = normalizeLmStudioUrl(config.lmStudioUrl || DEFAULT_LM_STUDIO_URL);
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const localServer = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
    let agents;
    if (localServer) {
      agents = await fetchLmStudioDesktopAgents({
        grouping: normalizeLmStudioGrouping(config.lmStudioGrouping)
      });
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LM_STUDIO_REQUEST_TIMEOUT_MS);
      try {
        agents = await fetchLmStudioAgents({
          baseUrl,
          apiToken: runtimeLmStudioCredentialsUrl === baseUrl
            ? runtimeLmStudioToken
            : savedLmStudioToken(config, baseUrl),
          grouping: normalizeLmStudioGrouping(config.lmStudioGrouping),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('lmstudio', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    lmStudioPublished = agents.length > 0;
    lmStudioLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.name === 'AbortError'
      ? 'LM Studio status request timed out.'
      : error?.message || 'Could not read LM Studio activity.';
    if (message !== lmStudioLastError) console.warn(`LM Studio adapter: ${message}`);
    lmStudioLastError = message;
    if (lmStudioPublished) {
      try { await publishRuntimeAgents('lmstudio', []); } catch {}
      lmStudioPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    lmStudioSyncInFlight = false;
    scheduleLmStudioSync();
  }
}

function startLmStudioAdapter() {
  clearTimeout(lmStudioTimer);
  lmStudioTimer = null;
  void syncLmStudioAdapter();
}

function scheduleOpenClawSync() {
  clearTimeout(openClawTimer);
  openClawTimer = null;
  if (readConfig().openClawEnabled || openClawPublished) {
    openClawTimer = setTimeout(syncOpenClawAdapter, runtimeAdapterRefreshMs(readConfig(), 'openClaw'));
  }
}

async function syncOpenClawAdapter() {
  if (openClawSyncInFlight) {
    scheduleOpenClawSync();
    return;
  }
  const syncGeneration = runtimeSyncGeneration;
  openClawSyncInFlight = true;
  try {
    const config = readConfig();
    if (!config.openClawEnabled) {
      if (openClawPublished) await publishRuntimeAgents('openclaw', [], config);
      openClawPublished = false;
      openClawLastError = '';
      return;
    }
    if (await preserveRuntimeAgentsForSkippedPolling(config, 'openClaw')) return;
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
    if (syncGeneration !== runtimeSyncGeneration) return;
    await publishRuntimeAgents('openclaw', agents, config);
    if (syncGeneration !== runtimeSyncGeneration) return;
    openClawPublished = agents.length > 0;
    openClawLastError = '';
  } catch (error) {
    if (syncGeneration !== runtimeSyncGeneration) return;
    const message = error?.message || 'Could not read OpenClaw gateway activity.';
    if (message !== openClawLastError) console.warn(`OpenClaw adapter: ${message}`);
    openClawLastError = message;
    if (openClawPublished) {
      try { await publishRuntimeAgents('openclaw', []); } catch {}
      openClawPublished = false;
    }
  } finally {
    if (syncGeneration !== runtimeSyncGeneration) return;
    openClawSyncInFlight = false;
    scheduleOpenClawSync();
  }
}

function startOpenClawAdapter() {
  clearTimeout(openClawTimer);
  openClawTimer = null;
  void syncOpenClawAdapter();
}

function startRuntimeAdapters() {
  if (runtimePowerSuspended || areProviderChecksPaused()) return;
  startOpenCodeAdapter();
  startVsCodeCopilotAdapter();
  startCursorAdapter();
  startCodexAdapter();
  startGooseAdapter();
  startHermesAdapter();
  startBuzzAdapter();
  startClaudeAdapter();
  startGeminiAdapter();
  startAntigravityAdapter();
  startOllamaAdapter();
  startLmStudioAdapter();
  startOpenClawAdapter();
}

function startRuntimeAdapterForIntegration(integration) {
  if (runtimePowerSuspended || areProviderChecksPaused()) return;
  const start = ({
    openCode: startOpenCodeAdapter,
    openClaw: startOpenClawAdapter,
    vsCodeCopilot: startVsCodeCopilotAdapter,
    cursor: startCursorAdapter,
    codex: startCodexAdapter,
    goose: startGooseAdapter,
    hermes: startHermesAdapter,
    buzz: startBuzzAdapter,
    claude: startClaudeAdapter,
    gemini: startGeminiAdapter,
    antigravity: startAntigravityAdapter,
    ollama: startOllamaAdapter,
    lmStudio: startLmStudioAdapter
  })[integration];
  if (start) start();
}

function stopRuntimeAdapters() {
  runtimeSyncGeneration += 1;
  for (const timer of [
    openCodeTimer,
    vsCodeCopilotTimer,
    cursorTimer,
    codexTimer,
    gooseTimer,
    hermesTimer,
    buzzTimer,
    claudeTimer,
    geminiTimer,
    antigravityTimer,
    ollamaTimer,
    lmStudioTimer,
    openClawTimer
  ]) clearTimeout(timer);
  stopVsCodeCopilotWatchers();
  openCodeTimer = null;
  vsCodeCopilotTimer = null;
  cursorTimer = null;
  codexTimer = null;
  gooseTimer = null;
  hermesTimer = null;
  buzzTimer = null;
  claudeTimer = null;
  geminiTimer = null;
  antigravityTimer = null;
  ollamaTimer = null;
  lmStudioTimer = null;
  openClawTimer = null;
  openCodeSyncInFlight = false;
  vsCodeCopilotSyncInFlight = false;
  cursorSyncInFlight = false;
  codexSyncInFlight = false;
  gooseSyncInFlight = false;
  hermesSyncInFlight = false;
  buzzSyncInFlight = false;
  claudeSyncInFlight = false;
  geminiSyncInFlight = false;
  antigravitySyncInFlight = false;
  ollamaSyncInFlight = false;
  lmStudioSyncInFlight = false;
  openClawSyncInFlight = false;
}

async function restoreCachedRuntimeRostersAfterWake(config = readConfig(), expectedGeneration = runtimeSyncGeneration) {
  for (const [provider, agents] of runtimeAgentRosters) {
    if (expectedGeneration !== runtimeSyncGeneration || runtimePowerSuspended || areProviderChecksPaused()) return false;
    if (!agents.length) continue;
    try {
      await publishRuntimeAgents(provider, agents, config);
    } catch (error) {
      console.warn(`Could not restore cached ${provider} agents after wake: ${error.message}`);
    }
  }
  return expectedGeneration === runtimeSyncGeneration && !runtimePowerSuspended && !areProviderChecksPaused();
}

function restartRuntimeAdaptersAfterWake({ refreshSnapshotImmediately = true } = {}) {
  if (!activeBaseUrl || runtimePowerSuspended || areProviderChecksPaused()) return;
  runtimeSyncGeneration += 1;
  const restartGeneration = runtimeSyncGeneration;
  openCodeSyncInFlight = false;
  vsCodeCopilotSyncInFlight = false;
  cursorSyncInFlight = false;
  codexSyncInFlight = false;
  gooseSyncInFlight = false;
  hermesSyncInFlight = false;
  buzzSyncInFlight = false;
  claudeSyncInFlight = false;
  geminiSyncInFlight = false;
  antigravitySyncInFlight = false;
  ollamaSyncInFlight = false;
  lmStudioSyncInFlight = false;
  openClawSyncInFlight = false;
  const interruptedSnapshotRequest = agentSnapshotRequest;
  agentSnapshotController?.abort();
  for (const window of companionWindows.keys()) {
    if (!window.isDestroyed()) window.webContents.send('office:system-resume');
  }
  void (async () => {
    const restored = await restoreCachedRuntimeRostersAfterWake(readConfig(), restartGeneration);
    if (!restored) return;
    startRuntimeAdapters();
    await Promise.resolve(interruptedSnapshotRequest);
    if (restartGeneration !== runtimeSyncGeneration || runtimePowerSuspended || areProviderChecksPaused()) return;
    if (refreshSnapshotImmediately) await refreshAgentSnapshot();
    scheduleAgentSnapshotPolling();
  })();
}

function checkForSystemSleepGap() {
  const now = Date.now();
  const elapsed = now - lastRuntimeHeartbeatAt;
  lastRuntimeHeartbeatAt = now;
  if (elapsed > SYSTEM_SLEEP_GAP_MS && !runtimePowerSuspended) restartRuntimeAdaptersAfterWake();
}

async function publishBackgroundPollingSuspended(suspended) {
  if (!activeBaseUrl) return;
  try {
    const ses = session.fromPartition(PARTITION, { cache: true });
    await ses.fetch(endpoint(activeBaseUrl, '/api/background-polling'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suspended: Boolean(suspended) })
    });
  } catch (error) {
    console.warn(`Could not update background polling state: ${error.message}`);
  }
}

function updateRuntimePowerSuspension() {
  const suspended = isLowEnergyModeEnabled() && (systemSuspended || sessionLocked);
  if (suspended === runtimePowerSuspended) return;
  runtimePowerSuspended = suspended;
  for (const targetWindow of companionWindows.keys()) {
    if (!targetWindow.isDestroyed()) targetWindow.webContents.send('office:power-suspended', suspended);
  }
  if (suspended) {
    stopRuntimeAdapters();
    stopAgentSnapshotPolling();
    agentSnapshotController?.abort();
    void publishBackgroundPollingSuspended(true);
  } else {
    void publishBackgroundPollingSuspended(false);
    restartRuntimeAdaptersAfterWake();
  }
}

function companionUrl(baseUrl = activeBaseUrl, config = readConfig(), agentId = '') {
  const url = new URL(endpoint(baseUrl, '/index.html'));
  url.searchParams.set('companion', '1');
  if (isLowEnergyModeEnabled(config)) url.searchParams.set('lowEnergy', '1');
  if (isLowEnergyModeEnabled(config) && config.lowEnergyStaticIdlePoses) {
    url.searchParams.set('lowEnergyStaticIdle', '1');
  }
  if (isLowEnergyModeEnabled(config) && config.lowEnergyStaticAllPoses) {
    url.searchParams.set('lowEnergyStaticAll', '1');
  }
  if (displayMode(config) === 'random') {
    url.searchParams.set('randomStatuses', '1');
  }
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

async function setLowEnergyMode(enabled) {
  const config = readConfig();
  const lowEnergyMode = Boolean(enabled);
  writeConfig({ ...config, lowEnergyMode });
  settingsWindow?.webContents.send('settings:low-energy-mode', lowEnergyMode);
  updateRuntimePowerSuspension();
  for (const [targetWindow, metadata] of companionWindows.entries()) {
    if (targetWindow.isDestroyed()) continue;
    try {
      await targetWindow.loadURL(companionUrl(activeBaseUrl, readConfig(), metadata?.agentId || ''));
    } catch (error) {
      console.warn(`Could not apply Low Energy Mode: ${error.message}`);
    }
  }
  scheduleAgentSnapshotPolling();
  rebuildMenus();
}

function setProviderChecksPaused(enabled) {
  providerChecksPaused = Boolean(enabled);
  broadcastProviderChecksPaused(providerChecksPaused);
  if (providerChecksPaused) {
    stopRuntimeAdapters();
    stopAgentSnapshotPolling();
    agentSnapshotController?.abort();
  } else {
    restartRuntimeAdaptersAfterWake({ refreshSnapshotImmediately: false });
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
  if (displayMode(readConfig()) === 'random' && mode !== 'random') return;
  clearTimeout(boundsTimer);
  saveWindowBounds();
  const config = readConfig();
  const nextMode = ['avatar', 'random'].includes(mode) ? mode : 'office';
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
  if (nextMode === 'office') startRuntimeAdapters();
  else startRuntimeAdapterForIntegration(integrationForAgentId(nextAgent));
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
  const currentMode = displayMode(config);
  if (currentMode === 'random') {
    return [{
      label: 'Random Office View',
      type: 'radio',
      checked: true,
      enabled: false
    }];
  }
  return [
    {
      label: 'Office View',
      // Avatar choices live in a submenu, so this is the only item in its
      // native menu-level group. A lone radio item can be selected by macOS
      // even when `checked` is false (notably in the menu-bar tray menu).
      type: 'checkbox',
      checked: currentMode === 'office',
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
  void restoreAdditionalCompanionWindows();
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
  const previousAgentId = metadata.agentId;
  metadata.agentId = agentId;
  try {
    await targetWindow.loadURL(companionUrl(activeBaseUrl, readConfig(), agentId));
    forgetAdditionalFolk(previousAgentId);
    saveAdditionalFolk(agentId, targetWindow.getBounds());
    startRuntimeAdapterForIntegration(integrationForAgentId(agentId));
  } catch (error) {
    metadata.agentId = previousAgentId;
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

function updateDialogWindow() {
  return updatePromptWindow && !updatePromptWindow.isDestroyed()
    ? updatePromptWindow
    : null;
}

function showUpdateMessage(options) {
  const targetWindow = updateDialogWindow();
  return targetWindow
    ? dialog.showMessageBox(targetWindow, options)
    : dialog.showMessageBox(options);
}

function updaterMenuItem(targetWindow = officeWindow) {
  if (updateStatus === 'checking') {
    return { id: 'taskfolk-update', label: 'Checking for Updates…', enabled: false };
  }
  if (updateStatus === 'downloading') {
    const progress = updateDownloadPercent > 0 ? ` (${updateDownloadPercent}%)` : '';
    return { id: 'taskfolk-update', label: `Downloading Taskfolk ${availableUpdateVersion || 'Update'}…${progress}`, enabled: false };
  }
  if (updateStatus === 'downloaded') {
    return {
      id: 'taskfolk-update',
      label: `Restart to Update to Taskfolk ${availableUpdateVersion}…`,
      click: () => confirmInstallUpdate(targetWindow)
    };
  }
  if (updateStatus === 'available') {
    return {
      id: 'taskfolk-update',
      label: `Download Taskfolk ${availableUpdateVersion}…`,
      click: () => downloadAvailableUpdate(targetWindow)
    };
  }
  return {
    id: 'taskfolk-update',
    label: 'Check for Updates…',
    click: () => checkForTaskfolkUpdates(targetWindow)
  };
}

function registerLiveUpdaterMenuItem(menu) {
  const item = menu?.getMenuItemById('taskfolk-update');
  if (item) liveUpdaterMenuItems.add(item);
  return menu;
}

function refreshLiveUpdaterMenuItems() {
  const state = updaterMenuItem();
  for (const item of liveUpdaterMenuItems) {
    item.label = state.label;
    item.enabled = state.enabled !== false;
  }
}

function applyUpdateProgressIndicators() {
  const downloading = updateStatus === 'downloading';
  const fraction = downloading ? Math.max(0, Math.min(1, updateDownloadPercent / 100)) : -1;
  if (process.platform === 'darwin' && tray && !tray.isDestroyed()) {
    tray.setTitle(downloading && updateDownloadPercent > 0 ? `${updateDownloadPercent}%` : '');
  }
  const progressWindow = updateDialogWindow()
    || (officeWindow && !officeWindow.isDestroyed() ? officeWindow : null)
    || (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null)
    || BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  progressWindow?.setProgressBar(fraction);
}

async function showUpdateError(error) {
  updateStatus = 'idle';
  updateDownloadPercent = 0;
  rebuildMenus();
  if (!updateRequestIsManual || updateErrorWasShown) return;
  updateErrorWasShown = true;
  const detail = String(error?.message || error || 'The update service could not be reached.');
  await showUpdateMessage({
    type: 'error',
    title: 'Taskfolk Update',
    message: 'Taskfolk could not check for updates.',
    detail
  });
  updateRequestIsManual = false;
}

async function checkForTaskfolkUpdates(targetWindow = officeWindow, { manual = true } = {}) {
  if (updateStatus === 'checking' || updateStatus === 'downloading') return;
  updatePromptWindow = targetWindow && !targetWindow.isDestroyed() ? targetWindow : null;
  updateRequestIsManual = manual;
  updateErrorWasShown = false;
  updateStatus = 'checking';
  rebuildMenus();

  const runtimeUpdateUrl = String(process.env.TASKFOLK_UPDATE_URL || '').trim();
  const packagedUpdateConfig = path.join(process.resourcesPath, 'app-update.yml');
  if (!runtimeUpdateUrl && (!app.isPackaged || !fs.existsSync(packagedUpdateConfig))) {
    updateStatus = 'idle';
    rebuildMenus();
    if (manual) {
      await showUpdateMessage({
        type: 'info',
        title: 'Taskfolk Update',
        message: app.isPackaged
          ? 'Updates are not configured for this build.'
          : 'Update checks are available in packaged builds.',
        detail: app.isPackaged
          ? 'Build Taskfolk with its production update-feed URL to enable update checks.'
          : `This development build is running Taskfolk ${app.getVersion()}.`
      });
    }
    updateRequestIsManual = false;
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    await showUpdateError(error);
  }
}

function runAutomaticUpdateCheck() {
  if (updateStatus !== 'idle') return;
  void checkForTaskfolkUpdates(officeWindow, { manual: false });
}

function scheduleAutomaticUpdateChecks() {
  if (automaticUpdateCheckTimer) return;
  automaticUpdateCheckTimer = setTimeout(() => {
    runAutomaticUpdateCheck();
    automaticUpdateCheckTimer = setInterval(
      runAutomaticUpdateCheck,
      AUTO_UPDATE_CHECK_INTERVAL_MS
    );
    automaticUpdateCheckTimer.unref();
  }, AUTO_UPDATE_INITIAL_DELAY_MS);
  automaticUpdateCheckTimer.unref();
}

async function downloadAvailableUpdate(targetWindow = updateDialogWindow()) {
  if (updateStatus === 'downloading' || updateStatus === 'downloaded') return;
  updatePromptWindow = targetWindow && !targetWindow.isDestroyed() ? targetWindow : updateDialogWindow();
  updateStatus = 'downloading';
  updateDownloadPercent = 0;
  rebuildMenus();
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateRequestIsManual = true;
    await showUpdateError(error);
  }
}

async function confirmInstallUpdate(targetWindow = updateDialogWindow()) {
  updatePromptWindow = targetWindow && !targetWindow.isDestroyed() ? targetWindow : updateDialogWindow();
  const { response } = await showUpdateMessage({
    type: 'info',
    title: 'Taskfolk Update Ready',
    message: `Taskfolk ${availableUpdateVersion} is ready to install.`,
    detail: 'Taskfolk will close, install the update, and reopen.',
    buttons: ['Restart and Update', 'Later'],
    defaultId: 0,
    cancelId: 1
  });
  if (response !== 0) return;
  quitting = true;
  autoUpdater.quitAndInstall(false, true);
}

function initializeAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const updateUrl = String(process.env.TASKFOLK_UPDATE_URL || '').trim();
  if (updateUrl) autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });

  autoUpdater.on('checking-for-update', () => {
    updateStatus = 'checking';
    rebuildMenus();
  });
  autoUpdater.on('update-available', async (info) => {
    availableUpdateVersion = String(info?.version || '').trim();
    updateStatus = 'available';
    rebuildMenus();
    const { response } = await showUpdateMessage({
      type: 'info',
      title: 'Taskfolk Update Available',
      message: `Taskfolk ${availableUpdateVersion} is available.`,
      detail: `You are currently using Taskfolk ${app.getVersion()}.`,
      buttons: ['Download Update', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    updateRequestIsManual = false;
    if (response === 0) await downloadAvailableUpdate();
  });
  autoUpdater.on('update-not-available', async () => {
    updateStatus = 'idle';
    rebuildMenus();
    if (!updateRequestIsManual) return;
    await showUpdateMessage({
      type: 'info',
      title: 'Taskfolk Update',
      message: 'Taskfolk is up to date.',
      detail: `You are using the latest version, Taskfolk ${app.getVersion()}.`
    });
    updateRequestIsManual = false;
  });
  autoUpdater.on('download-progress', (progress) => {
    updateStatus = 'downloading';
    const nextPercent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
    if (nextPercent === updateDownloadPercent) return;
    updateDownloadPercent = nextPercent;
    refreshLiveUpdaterMenuItems();
    applyUpdateProgressIndicators();
  });
  autoUpdater.on('update-downloaded', async (info) => {
    availableUpdateVersion = String(info?.version || availableUpdateVersion).trim();
    updateStatus = 'downloaded';
    updateDownloadPercent = 100;
    rebuildMenus();
    await confirmInstallUpdate();
  });
  autoUpdater.on('error', (error) => {
    void showUpdateError(error);
  });
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
    { label: 'Open Rank Board…', enabled: Boolean(activeBaseUrl), click: showRankBoardWindow },
    { label: 'Reload', click: () => targetWindow.reload() },
    { label: 'Pause Provider Checks', type: 'checkbox', checked: areProviderChecksPaused(config), click: (item) => setProviderChecksPaused(item.checked) },
    { label: 'Low Energy Mode', type: 'checkbox', checked: isLowEnergyModeEnabled(config), click: (item) => { void setLowEnergyMode(item.checked); } },
    { label: 'Always on Top', type: 'checkbox', checked: isAlwaysOnTopEnabled(config), click: (item) => setAlwaysOnTop(item.checked) },
    updaterMenuItem(targetWindow),
    { type: 'separator' },
    ...(additionalWindow
      ? [{ label: 'Remove This Folk', click: () => removeAdditionalFolk(targetWindow) }]
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
  const targetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 120,
    minHeight: 150,
    show: false,
    skipTaskbar: shouldSkipTaskbar(config),
    resizable: true,
    movable: true,
    alwaysOnTop: isAlwaysOnTopEnabled(config),
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
      // Keep normal Chromium lifecycle throttling so hidden or occluded
      // companions do not continue painting and running renderer timers.
      backgroundThrottling: true,
      devTools: !app.isPackaged
    }
  });

  targetWindow.webContents.on('did-finish-load', () => {
    if (runtimePowerSuspended) targetWindow.webContents.send('office:power-suspended', true);
    targetWindow.webContents.send('office:provider-checks-paused', areProviderChecksPaused());
  });

  // Electron can promote the application when constructing an NSWindow even
  // when skipTaskbar was supplied in the constructor. Apply it directly to the
  // native window before it is shown as well.
  if (process.platform === 'darwin') targetWindow.setSkipTaskbar(shouldSkipTaskbar(config));

  targetWindow.on('show', () => {
    refreshAgentSnapshotForVisibleCompanions();
  });
  targetWindow.on('hide', scheduleAgentSnapshotPolling);
  targetWindow.on('minimize', scheduleAgentSnapshotPolling);
  targetWindow.on('restore', () => {
    refreshAgentSnapshotForVisibleCompanions();
  });

  if (process.platform === 'darwin') {
    const showOnAllDesktops = isShowOnAllDesktopsEnabled(config);
    targetWindow.setVisibleOnAllWorkspaces(showOnAllDesktops, {
      visibleOnFullScreen: showOnAllDesktops
    });
  }

  return targetWindow;
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

async function createAdditionalCompanionWindow(agentId, options = {}) {
  if (!activeBaseUrl || !availableAdditionalAgents().some((agent) => agent.id === agentId)) return;
  const config = readConfig();
  const referenceWindow = BrowserWindow.getFocusedWindow() || officeWindow;
  const bounds = options.bounds
    ? usableBounds(options.bounds, config.avatarBounds || DEFAULT_AVATAR_BOUNDS)
    : cascadedAvatarBounds(referenceWindow);
  const targetWindow = createCompanionBrowserWindow(bounds, config);
  companionWindows.set(targetWindow, { primary: false, agentId });
  secureCompanionNavigation(targetWindow, activeBaseUrl);
  targetWindow.on('move', () => persistAdditionalFolkBounds(targetWindow));
  targetWindow.on('resize', () => persistAdditionalFolkBounds(targetWindow));
  targetWindow.on('closed', () => {
    clearTimeout(additionalFolkBoundsTimers.get(targetWindow));
    additionalFolkBoundsTimers.delete(targetWindow);
    windowDrags.delete(targetWindow);
    mouseIgnoringWindows.delete(targetWindow);
    companionWindows.delete(targetWindow);
    scheduleAgentSnapshotPolling();
    rebuildMenus();
  });
  targetWindow.once('ready-to-show', () => {
    targetWindow.show();
    applyDockVisibility();
  });
  targetWindow.setOpacity(normalizedOpacity(config.opacity));
  try {
    await targetWindow.loadURL(companionUrl(activeBaseUrl, config, agentId));
    scheduleAgentSnapshotPolling();
    if (options.persist !== false) saveAdditionalFolk(agentId, targetWindow.getBounds());
    startRuntimeAdapterForIntegration(integrationForAgentId(agentId));
  } catch (error) {
    console.warn(`Could not add companion folk: ${error.message}`);
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  }
  applyDockVisibility(config);
  rebuildMenus();
}

async function restoreAdditionalCompanionWindows(config = readConfig()) {
  const displayed = displayedAgentIds();
  const availableIds = new Set(availableAgents.map((agent) => agent.id));
  for (const folk of savedAdditionalFolks(config)) {
    if (!availableIds.has(folk.agentId) || displayed.has(folk.agentId)) continue;
    await createAdditionalCompanionWindow(folk.agentId, { bounds: folk.bounds, persist: false });
    displayed.add(folk.agentId);
  }
}

async function createOfficeWindow(baseUrl, credentials, authenticated = false) {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  if (activeBaseUrl !== normalizedUrl) {
    resetAgentSnapshotCoordinator();
    configWindow?.destroy();
    rankBoardWindow?.destroy();
    runtimeAgentMenuSignatures.clear();
    runtimeAgentRosters.clear();
    runtimeAgentLastPublishedAt.clear();
    openCodePublished = false;
    openCodePublishState = null;
    vsCodeCopilotPublished = false;
    vsCodeCopilotPublishState = null;
    cursorPublished = false;
    codexPublished = false;
    codexPublishState = null;
    goosePublished = false;
    hermesPublished = false;
    buzzPublished = false;
    claudePublished = false;
    geminiPublished = false;
    antigravityPublished = false;
    ollamaPublished = false;
    lmStudioPublished = false;
    openClawPublished = false;
  }
  activeBaseUrl = normalizedUrl;
  let config = readConfig();
  const ses = session.fromPartition(PARTITION, { cache: true });
  if (!authenticated) await authenticate(normalizedUrl, credentials, ses);
  if (runtimePowerSuspended) void publishBackgroundPollingSuspended(true);
  startRuntimeAdapters();
  availableAgents = await fetchAvailableAgents(normalizedUrl, ses);
  // A connector may still be publishing its first snapshot. Retry before
  // replacing the primary selection or skipping any saved additional folk.
  if (savedCompanionFolkIsUnavailable(config)) {
    await wait(CONNECTOR_STARTUP_GRACE_MS);
    availableAgents = await fetchAvailableAgents(normalizedUrl, ses);
  }
  if (savedAvatarAgentIsUnavailable(config)) {
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
    scheduleAgentSnapshotPolling();
    if (officeWindow === primaryWindow) officeWindow = null;
    rebuildMenus();
  });
  primaryWindow.once('ready-to-show', () => {
    primaryWindow.show();
    applyDockVisibility();
  });
  primaryWindow.setOpacity(normalizedOpacity(config.opacity));

  await primaryWindow.loadURL(companionUrl(normalizedUrl, config));
  await restoreAdditionalCompanionWindows(config);
  scheduleAgentSnapshotPolling();
  applyDockVisibility(config);
  settingsWindow?.close();
  rebuildMenus();
}

function menuTemplate() {
  const config = readConfig();
  const alwaysOnTop = isAlwaysOnTopEnabled(config);
  return [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Office',
      submenu: [
        { label: 'Setup…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { label: 'Config…', enabled: Boolean(activeBaseUrl), click: showConfigWindow },
        { label: 'Rank Board…', enabled: Boolean(activeBaseUrl), click: showRankBoardWindow },
        { label: 'Reload Office', accelerator: 'CmdOrCtrl+R', enabled: Boolean(officeWindow), click: () => officeWindow?.reload() },
        { type: 'separator' },
        ...viewMenuItems(config),
        { type: 'separator' },
        { label: 'Pause Provider Checks', type: 'checkbox', checked: areProviderChecksPaused(config), click: (item) => setProviderChecksPaused(item.checked) },
        { label: 'Low Energy Mode', type: 'checkbox', checked: isLowEnergyModeEnabled(config), click: (item) => { void setLowEnergyMode(item.checked); } },
        { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
        ...(process.platform === 'darwin'
          ? [
              { label: 'Show in Dock', type: 'checkbox', checked: !config.hideDockIcon, enabled: isMenuBarIconEnabled(config), click: (item) => setHideDockIcon(!item.checked) },
              { label: 'Show in Menu Bar', type: 'checkbox', checked: isMenuBarIconEnabled(config), enabled: !config.hideDockIcon, click: (item) => setShowMenuBarIcon(item.checked) }
            ]
          : []),
        updaterMenuItem(officeWindow),
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ];
}

function quickAccessMenuTemplate(config = readConfig()) {
  const alwaysOnTop = isAlwaysOnTopEnabled(config);
  return [
    { label: isOfficeVisible() ? 'Hide Office' : 'Show Office', click: toggleOffice },
    { label: 'Reload', enabled: Boolean(officeWindow), click: () => officeWindow?.reload() },
    { type: 'separator' },
    ...viewMenuItems(config),
    { type: 'separator' },
    { label: 'Pause Provider Checks', type: 'checkbox', checked: areProviderChecksPaused(config), click: (item) => setProviderChecksPaused(item.checked) },
    { label: 'Low Energy Mode', type: 'checkbox', checked: isLowEnergyModeEnabled(config), click: (item) => { void setLowEnergyMode(item.checked); } },
    { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
    ...(process.platform === 'darwin'
      ? [
          { label: 'Show in Dock', type: 'checkbox', checked: !config.hideDockIcon, enabled: isMenuBarIconEnabled(config), click: (item) => setHideDockIcon(!item.checked) },
          { label: 'Show in Menu Bar', type: 'checkbox', checked: isMenuBarIconEnabled(config), enabled: !config.hideDockIcon, click: (item) => setShowMenuBarIcon(item.checked) }
        ]
      : []),
    { label: 'Setup…', click: () => openSettingsWindow() },
    { label: 'Config…', enabled: Boolean(activeBaseUrl), click: showConfigWindow },
    { label: 'Rank Board…', enabled: Boolean(activeBaseUrl), click: showRankBoardWindow },
    updaterMenuItem(officeWindow),
    { type: 'separator' },
    { role: 'quit' }
  ];
}

function rebuildMenus() {
  const config = readConfig();
  const menuBarOnly = process.platform === 'darwin' && Boolean(config.hideDockIcon);
  // Installing a macOS application menu promotes an accessory app back to a
  // regular app. In menu-bar-only mode the Tray context menu is the complete
  // application menu, so keep the native application menu disabled.
  liveUpdaterMenuItems.clear();
  const applicationMenu = menuBarOnly
    ? null
    : registerLiveUpdaterMenuItem(Menu.buildFromTemplate(menuTemplate()));
  Menu.setApplicationMenu(applicationMenu);
  const quickAccessTemplate = quickAccessMenuTemplate(config);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(registerLiveUpdaterMenuItem(Menu.buildFromTemplate(quickAccessTemplate)));
  }
  if (tray) tray.setContextMenu(registerLiveUpdaterMenuItem(Menu.buildFromTemplate(quickAccessTemplate)));
  applyUpdateProgressIndicators();
}

function isOfficeVisible() {
  for (const window of companionWindows.keys()) {
    if (!window.isDestroyed() && window.isVisible()) return true;
  }
  return false;
}

function toggleOffice() {
  if (!officeWindow) return openSettingsWindow();
  const hideOffice = isOfficeVisible();
  for (const window of companionWindows.keys()) {
    if (window.isDestroyed()) continue;
    if (hideOffice) window.hide();
    else window.show();
  }
  if (!hideOffice) {
    officeWindow.focus();
  }
  rebuildMenus();
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  const trayIconPath = process.platform === 'darwin'
    ? MAC_TRAY_ICON_PATH
    : path.join(__dirname, '..', 'public', 'favicon.png');
  const fallbackIconPath = path.join(__dirname, '..', 'public', 'favicon.png');
  let sourceIcon = nativeImage.createEmpty();
  let fallbackIcon = nativeImage.createEmpty();
  try {
    sourceIcon = nativeImage.createFromPath(trayIconPath);
    fallbackIcon = sourceIcon.isEmpty()
      ? nativeImage.createFromPath(fallbackIconPath)
      : sourceIcon;
  } catch (error) {
    console.warn(`Could not read the Taskfolk menu-bar icon: ${error.message}`);
  }
  if (fallbackIcon.isEmpty()) {
    console.warn('Could not create the Taskfolk menu-bar icon.');
    return;
  }
  const icon = process.platform === 'darwin'
    ? fallbackIcon
    : fallbackIcon.resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Taskfolk');
  if (process.platform !== 'darwin') tray.on('click', toggleOffice);
  rebuildMenus();
}

ipcMain.handle('settings:load', () => {
  const config = readConfig();
  const credentials = savedCredentials(config);
  const mode = connectionMode(config);
  return {
    appVersion: app.getVersion(),
    connectionMode: mode,
    url: mode === 'remote' ? (activeBaseUrl || config.url || '') : (config.url || ''),
    credentialsStored: Boolean(
      (mode === 'remote' && (runtimeCredentials?.token || runtimeCredentials?.password))
      || credentials.token
      || credentials.password
    ),
    alwaysOnTop: isAlwaysOnTopEnabled(config),
    lowEnergyMode: isLowEnergyModeEnabled(config),
    lowEnergyRefreshOverrideEnabled: Boolean(config.lowEnergyRefreshOverrideEnabled),
    lowEnergyRefreshMs: normalizeIntegrationRefreshMs(config.lowEnergyRefreshMs, 30_000),
    lowEnergyVisibleProvidersOnly: lowEnergyVisibleProvidersOnly(config),
    lowEnergyStaticAllPoses: Boolean(config.lowEnergyStaticAllPoses),
    lowEnergyStaticIdlePoses: Boolean(config.lowEnergyStaticIdlePoses),
    showOnAllDesktopsSupported: process.platform === 'darwin',
    showOnAllDesktops: isShowOnAllDesktopsEnabled(config),
    dockIconSupported: process.platform === 'darwin',
    hideDockIcon: Boolean(config.hideDockIcon),
    menuBarIconSupported: process.platform === 'darwin',
    showMenuBarIcon: isMenuBarIconEnabled(config),
    displayMode: displayMode(config),
    selectedAgent: config.selectedAgent || '',
    opacity: normalizedOpacity(config.opacity),
    avatarWidth: Number(config.avatarBounds?.width) || DEFAULT_AVATAR_BOUNDS.width,
    avatarHeight: Number(config.avatarBounds?.height) || DEFAULT_AVATAR_BOUNDS.height,
    integrationRefreshMs: integrationRefreshSettings(config),
    openCodeEnabled: Boolean(config.openCodeEnabled),
    openCodeGrouping: normalizeOpenCodeGrouping(config.openCodeGrouping),
    openCodeUrl: config.openCodeUrl || DEFAULT_OPENCODE_URL,
    openCodeUsername: runtimeOpenCodeCredentials?.username || config.openCodeUsername || 'opencode',
    openCodeCredentialsStored: Boolean(runtimeOpenCodeCredentials?.password || decrypt(config.encryptedOpenCodePassword)),
    vsCodeCopilotEnabled: Boolean(config.vsCodeCopilotEnabled),
    vsCodeCopilotGrouping: normalizeVsCodeCopilotGrouping(config.vsCodeCopilotGrouping),
    cursorEnabled: Boolean(config.cursorEnabled),
    cursorGrouping: normalizeCursorGrouping(config.cursorGrouping),
    codexEnabled: Boolean(config.codexEnabled),
    codexGrouping: normalizeCodexGrouping(config.codexGrouping),
    gooseEnabled: Boolean(config.gooseEnabled),
    gooseGrouping: normalizeGooseGrouping(config.gooseGrouping),
    hermesEnabled: Boolean(config.hermesEnabled),
    hermesGrouping: normalizeHermesGrouping(config.hermesGrouping),
    hermesConnectionMode: normalizeHermesConnectionMode(config.hermesConnectionMode),
    hermesGatewayUrl: runtimeHermesGatewayUrl || config.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL,
    hermesCredentialsStored: Boolean(
      (runtimeHermesCredentialsUrl === (runtimeHermesGatewayUrl || config.hermesGatewayUrl)
        && runtimeHermesGatewayToken)
      || savedHermesGatewayToken(config, runtimeHermesGatewayUrl || config.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL)
    ),
    buzzEnabled: Boolean(config.buzzEnabled),
    buzzGrouping: normalizeBuzzGrouping(config.buzzGrouping),
    claudeEnabled: Boolean(config.claudeEnabled),
    claudeGrouping: normalizeClaudeGrouping(config.claudeGrouping),
    geminiEnabled: Boolean(config.geminiEnabled),
    geminiGrouping: normalizeGeminiGrouping(config.geminiGrouping),
    antigravityEnabled: Boolean(config.antigravityEnabled),
    antigravityGrouping: normalizeAntigravityGrouping(config.antigravityGrouping),
    ollamaEnabled: Boolean(config.ollamaEnabled),
    ollamaGrouping: normalizeOllamaGrouping(config.ollamaGrouping),
    ollamaUrl: config.ollamaUrl || DEFAULT_OLLAMA_URL,
    lmStudioEnabled: Boolean(config.lmStudioEnabled),
    lmStudioGrouping: normalizeLmStudioGrouping(config.lmStudioGrouping),
    lmStudioUrl: config.lmStudioUrl || DEFAULT_LM_STUDIO_URL,
    lmStudioCredentialsStored: Boolean(
      (runtimeLmStudioCredentialsUrl === normalizeLmStudioUrl(config.lmStudioUrl || DEFAULT_LM_STUDIO_URL)
        && runtimeLmStudioToken)
      || savedLmStudioToken(config, config.lmStudioUrl || DEFAULT_LM_STUDIO_URL)
    ),
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
  if (stat.size > 10 * 1024 * 1024) throw new Error('That configuration backup is larger than 10 MB.');
  let imported;
  try {
    imported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
    throw new Error('The selected file is not a Taskfolk configuration object.');
  }
  const hasBackupFormat = imported.format === CONFIG_BACKUP_FORMAT;
  if (hasBackupFormat && imported.version !== CONFIG_BACKUP_VERSION) {
    throw new Error(`This Taskfolk backup uses unsupported format version ${imported.version}.`);
  }
  const isBackup = hasBackupFormat
    && imported.files
    && typeof imported.files === 'object'
    && !Array.isArray(imported.files);
  if (hasBackupFormat && !isBackup) {
    throw new Error('The selected Taskfolk backup does not contain a valid files object.');
  }
  const importedConfig = isBackup ? imported.files['office-viewer.json'] : imported;
  if (!importedConfig || typeof importedConfig !== 'object' || Array.isArray(importedConfig)) {
    throw new Error('The selected backup does not contain a valid Taskfolk configuration.');
  }

  let importedOpenClawUrl;
  let importedLmStudioUrl;
  let importedHermesUrl;
  try {
    importedOpenClawUrl = normalizeOpenClawUrl(importedConfig.openClawUrl || DEFAULT_OPENCLAW_URL);
  } catch (error) {
    throw new Error(`The configuration has an invalid OpenClaw URL: ${error.message}`);
  }
  try {
    importedLmStudioUrl = normalizeLmStudioUrl(importedConfig.lmStudioUrl || DEFAULT_LM_STUDIO_URL);
  } catch (error) {
    throw new Error(`The configuration has an invalid LM Studio URL: ${error.message}`);
  }
  try {
    importedHermesUrl = normalizeHermesGatewayUrl(importedConfig.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL);
  } catch (error) {
    throw new Error(`The configuration has an invalid Hermes gateway URL: ${error.message}`);
  }

  const importedLocalData = {};
  if (isBackup) {
    for (const fileName of [AVATAR_ASSIGNMENTS_FILE, AGENT_ACHIEVEMENTS_FILE]) {
      if (!Object.prototype.hasOwnProperty.call(imported.files, fileName)) continue;
      importedLocalData[fileName] = imported.files[fileName];
      if (!importedLocalData[fileName]
        || typeof importedLocalData[fileName] !== 'object'
        || Array.isArray(importedLocalData[fileName])) {
        throw new Error(`The selected backup contains an invalid ${fileName} file.`);
      }
    }
  }

  const localConfigDir = localServerPaths().config;
  for (const [fileName, value] of Object.entries(importedLocalData)) {
    writePrivateJsonFile(path.join(localConfigDir, fileName), value);
  }
  writeConfig(importedConfig);
  applyMenuBarVisibility();
  applyDockVisibility(importedConfig);
  runtimeCredentials = savedCredentials(importedConfig);
  runtimeOpenCodeCredentials = savedOpenCodeCredentials(importedConfig);
  runtimeLmStudioCredentialsUrl = importedLmStudioUrl;
  runtimeLmStudioToken = savedLmStudioToken(importedConfig, runtimeLmStudioCredentialsUrl);
  runtimeHermesGatewayUrl = importedHermesUrl;
  runtimeHermesCredentialsUrl = importedHermesUrl;
  runtimeHermesGatewayToken = savedHermesGatewayToken(importedConfig, importedHermesUrl);
  runtimeOpenClawUrl = '';
  runtimeOpenClawCredentialsUrl = importedOpenClawUrl;
  runtimeOpenClawCredentials = savedOpenClawCredentials(importedConfig, runtimeOpenClawCredentialsUrl);
  runtimeOpenClawDeviceIdentity = null;
  return { canceled: false, restoredLocalData: isBackup };
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
  const localConfigDir = localServerPaths().config;
  const backup = {
    format: CONFIG_BACKUP_FORMAT,
    version: CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    files: {
      'office-viewer.json': readConfig(),
      [AVATAR_ASSIGNMENTS_FILE]: readJsonObjectFile(path.join(localConfigDir, AVATAR_ASSIGNMENTS_FILE)),
      [AGENT_ACHIEVEMENTS_FILE]: readJsonObjectFile(
        path.join(localConfigDir, AGENT_ACHIEVEMENTS_FILE),
        { agents: {} }
      )
    }
  };
  writePrivateJsonFile(result.filePath, backup);
  return { canceled: false };
});

ipcMain.handle('settings:reset-config', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    title: 'Reset Taskfolk Configuration?',
    message: 'Reset Taskfolk like a fresh install?',
    detail: 'This removes all saved Setup settings, encrypted credentials, integration choices, and window preferences. The current office will close. This cannot be undone.',
    buttons: ['Cancel', 'Reset Configuration'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (result.response !== 1) return { canceled: true };

  clearTimeout(boundsTimer);
  boundsTimer = null;
  for (const timer of additionalFolkBoundsTimers.values()) clearTimeout(timer);
  additionalFolkBoundsTimers.clear();
  stopRuntimeAdapters();
  resetAgentSnapshotCoordinator();
  stopLocalServer();
  configWindow?.destroy();
  rankBoardWindow?.destroy();
  for (const window of [...companionWindows.keys()]) {
    if (!window.isDestroyed()) window.destroy();
  }
  companionWindows.clear();
  windowDrags.clear();
  mouseIgnoringWindows.clear();
  officeWindow = null;
  activeBaseUrl = '';
  availableAgents = [];
  runtimeCredentials = null;
  runtimeOpenCodeCredentials = null;
  runtimeLmStudioCredentialsUrl = '';
  runtimeLmStudioToken = '';
  runtimeHermesGatewayUrl = '';
  runtimeHermesCredentialsUrl = '';
  runtimeHermesGatewayToken = '';
  runtimeOpenClawUrl = '';
  runtimeOpenClawCredentialsUrl = '';
  runtimeOpenClawCredentials = null;
  runtimeOpenClawDeviceIdentity = null;
  startupError = '';
  runtimeAgentMenuSignatures.clear();
  runtimeAgentRosters.clear();
  runtimeAgentLastPublishedAt.clear();
  try {
    fs.unlinkSync(configPath());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await session.fromPartition(PARTITION, { cache: true }).clearStorageData();
  applyMenuBarVisibility();
  applyDockVisibility({});
  rebuildMenus();
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

ipcMain.handle('settings:hermes-test', async (_event, input = {}) => {
  const config = readConfig();
  let baseUrl;
  try {
    baseUrl = normalizeHermesGatewayUrl(input.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL);
  } catch (error) {
    return { ok: false, message: error.message };
  }
  const enteredToken = String(input.hermesGatewayToken || '').trim();
  const token = enteredToken
    || (runtimeHermesCredentialsUrl === baseUrl ? runtimeHermesGatewayToken : '')
    || savedHermesGatewayToken(config, baseUrl);
  try {
    const agents = await fetchHermesRemoteAgents({
      baseUrl,
      token,
      grouping: 'project'
    });
    if (enteredToken) {
      runtimeHermesGatewayUrl = baseUrl;
      runtimeHermesCredentialsUrl = baseUrl;
      runtimeHermesGatewayToken = enteredToken;
    }
    return {
      ok: true,
      gatewayUrl: baseUrl,
      agentCount: agents.length,
      message: `Connected to Hermes and found ${agents.length} profile${agents.length === 1 ? '' : 's'}.`
    };
  } catch (error) {
    return { ok: false, gatewayUrl: baseUrl, message: error.message || 'Could not connect to Hermes.' };
  }
});

ipcMain.handle('settings:connect', async (_event, input = {}) => {
  const config = readConfig();
  const mode = input.connectionMode === 'remote' ? 'remote' : 'local';
  const avatarWidth = Math.min(1200, Math.max(120, Math.round(Number(input.avatarWidth) || DEFAULT_AVATAR_BOUNDS.width)));
  const avatarHeight = Math.min(1200, Math.max(150, Math.round(Number(input.avatarHeight) || DEFAULT_AVATAR_BOUNDS.height)));
  const openCodeUrl = normalizeOpenCodeUrl(input.openCodeUrl || DEFAULT_OPENCODE_URL);
  const ollamaUrl = normalizeOllamaUrl(input.ollamaUrl || DEFAULT_OLLAMA_URL);
  const lmStudioUrl = normalizeLmStudioUrl(input.lmStudioUrl || DEFAULT_LM_STUDIO_URL);
  const openClawUrl = normalizeOpenClawUrl(input.openClawUrl || DEFAULT_OPENCLAW_URL);
  runtimeOpenClawUrl = openClawUrl;
  const savedOpenCode = savedOpenCodeCredentials(config);
  const replaceOpenCodeCredentials = Boolean(String(input.openCodePassword || ''));
  runtimeOpenCodeCredentials = replaceOpenCodeCredentials
    ? { username: String(input.openCodeUsername || 'opencode').trim() || 'opencode', password: String(input.openCodePassword) }
    : (runtimeOpenCodeCredentials || savedOpenCode);
  runtimeOpenCodeCredentials.username = String(input.openCodeUsername || runtimeOpenCodeCredentials.username || 'opencode').trim() || 'opencode';
  const enteredLmStudioToken = String(input.lmStudioApiToken || '').trim();
  runtimeLmStudioToken = enteredLmStudioToken
    || (runtimeLmStudioCredentialsUrl === lmStudioUrl ? runtimeLmStudioToken : '')
    || savedLmStudioToken(config, lmStudioUrl);
  runtimeLmStudioCredentialsUrl = lmStudioUrl;
  const savedOpenClaw = savedOpenClawCredentials(config, openClawUrl);
  const replaceOpenClawCredentials = Boolean(
    String(input.openClawToken || '').trim() || String(input.openClawPassword || '')
  );
  runtimeOpenClawCredentials = replaceOpenClawCredentials
    ? { token: String(input.openClawToken || '').trim(), password: String(input.openClawPassword || '') }
    : (runtimeOpenClawCredentialsUrl === openClawUrl ? runtimeOpenClawCredentials : null) || savedOpenClaw;
  runtimeOpenClawCredentialsUrl = openClawUrl;
  const openClawDeviceIdentity = ensureOpenClawDeviceIdentity(config);
  const hermesConnectionMode = normalizeHermesConnectionMode(input.hermesConnectionMode);
  const hermesGatewayUrl = normalizeHermesGatewayUrl(input.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL);
  const enteredHermesToken = String(input.hermesGatewayToken || '').trim();
  runtimeHermesGatewayToken = enteredHermesToken
    || (runtimeHermesCredentialsUrl === hermesGatewayUrl ? runtimeHermesGatewayToken : '')
    || savedHermesGatewayToken(config, hermesGatewayUrl);
  runtimeHermesGatewayUrl = hermesGatewayUrl;
  runtimeHermesCredentialsUrl = hermesGatewayUrl;
  const nextConfig = {
    ...config,
    connectionMode: mode,
    alwaysOnTop: Boolean(input.alwaysOnTop),
    lowEnergyMode: Boolean(input.lowEnergyMode),
    lowEnergyRefreshOverrideEnabled: Boolean(input.lowEnergyRefreshOverrideEnabled),
    lowEnergyRefreshMs: normalizeIntegrationRefreshMs(input.lowEnergyRefreshMs, 30_000),
    lowEnergyVisibleProvidersOnly: input.lowEnergyVisibleProvidersOnly !== false,
    lowEnergyStaticAllPoses: Boolean(input.lowEnergyStaticAllPoses),
    lowEnergyStaticIdlePoses: Boolean(input.lowEnergyStaticIdlePoses),
    showOnAllDesktops: process.platform === 'darwin' && Boolean(input.showOnAllDesktops),
    hideDockIcon: process.platform === 'darwin' && Boolean(input.hideDockIcon) && Boolean(input.showMenuBarIcon),
    showMenuBarIcon: process.platform === 'darwin' && Boolean(input.showMenuBarIcon),
    displayMode: ['avatar', 'random'].includes(input.displayMode) ? input.displayMode : 'office',
    selectedAgent: String(input.selectedAgent || config.selectedAgent || ''),
    opacity: normalizedOpacity(input.opacity),
    avatarBounds: { ...(config.avatarBounds || {}), width: avatarWidth, height: avatarHeight },
    runtimeSourceId: config.runtimeSourceId || `desktop-${crypto.randomUUID()}`,
    ...integrationRefreshConfig(input),
    openCodeEnabled: Boolean(input.openCodeEnabled),
    openCodeGrouping: normalizeOpenCodeGrouping(input.openCodeGrouping),
    openCodeUrl,
    openCodeUsername: runtimeOpenCodeCredentials.username,
    encryptedOpenCodePassword: encrypt(runtimeOpenCodeCredentials.password),
    vsCodeCopilotEnabled: Boolean(input.vsCodeCopilotEnabled),
    vsCodeCopilotGrouping: normalizeVsCodeCopilotGrouping(input.vsCodeCopilotGrouping),
    cursorEnabled: Boolean(input.cursorEnabled),
    cursorGrouping: normalizeCursorGrouping(input.cursorGrouping),
    codexEnabled: Boolean(input.codexEnabled),
    codexGrouping: normalizeCodexGrouping(input.codexGrouping),
    gooseEnabled: Boolean(input.gooseEnabled),
    gooseGrouping: normalizeGooseGrouping(input.gooseGrouping),
    hermesEnabled: Boolean(input.hermesEnabled),
    hermesGrouping: normalizeHermesGrouping(input.hermesGrouping),
    hermesConnectionMode,
    hermesGatewayUrl,
    hermesCredentialsUrl: hermesGatewayUrl,
    encryptedHermesGatewayToken: encrypt(runtimeHermesGatewayToken),
    buzzEnabled: Boolean(input.buzzEnabled),
    buzzGrouping: normalizeBuzzGrouping(input.buzzGrouping),
    claudeEnabled: Boolean(input.claudeEnabled),
    claudeGrouping: normalizeClaudeGrouping(input.claudeGrouping),
    geminiEnabled: Boolean(input.geminiEnabled),
    geminiGrouping: normalizeGeminiGrouping(input.geminiGrouping),
    antigravityEnabled: Boolean(input.antigravityEnabled),
    antigravityGrouping: normalizeAntigravityGrouping(input.antigravityGrouping),
    ollamaEnabled: Boolean(input.ollamaEnabled),
    ollamaGrouping: normalizeOllamaGrouping(input.ollamaGrouping),
    ollamaUrl,
    lmStudioEnabled: Boolean(input.lmStudioEnabled),
    lmStudioGrouping: normalizeLmStudioGrouping(input.lmStudioGrouping),
    lmStudioUrl,
    lmStudioCredentialsUrl: lmStudioUrl,
    encryptedLmStudioApiToken: encrypt(runtimeLmStudioToken),
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
    updateRuntimePowerSuspension();
    applyMenuBarVisibility();
    applyDockVisibility(nextConfig);
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
  updateRuntimePowerSuspension();
  applyMenuBarVisibility();
  applyDockVisibility(nextConfig);
  await createOfficeWindow(url, credentials, true);
  stopLocalServer();
  startupError = '';
  return { ok: true };
});

app.whenReady().then(async () => {
  powerMonitor.on('suspend', () => {
    systemSuspended = true;
    updateRuntimePowerSuspension();
  });
  powerMonitor.on('resume', () => {
    systemSuspended = false;
    updateRuntimePowerSuspension();
    if (!isLowEnergyModeEnabled()) restartRuntimeAdaptersAfterWake();
  });
  powerMonitor.on('lock-screen', () => {
    sessionLocked = true;
    updateRuntimePowerSuspension();
  });
  powerMonitor.on('unlock-screen', () => {
    sessionLocked = false;
    updateRuntimePowerSuspension();
    if (!isLowEnergyModeEnabled()) restartRuntimeAdaptersAfterWake();
  });
  setInterval(checkForSystemSleepGap, 5_000).unref();
  initializeAutoUpdater();
  scheduleAutomaticUpdateChecks();
  let config = readConfig();
  if (config.displayMode === 'random') {
    config = { ...config, displayMode: 'office' };
    writeConfig(config);
  }
  applyMenuBarVisibility();
  if (process.platform === 'darwin') applyDockVisibility(config);
  rebuildMenus();
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
  runtimeLmStudioCredentialsUrl = normalizeLmStudioUrl(config.lmStudioUrl || DEFAULT_LM_STUDIO_URL);
  runtimeLmStudioToken = String(process.env.LM_STUDIO_API_TOKEN || process.env.LM_API_TOKEN || '')
    || savedLmStudioToken(config, runtimeLmStudioCredentialsUrl);
  runtimeHermesGatewayUrl = normalizeHermesGatewayUrl(
    process.env.HERMES_GATEWAY_URL || config.hermesGatewayUrl || DEFAULT_HERMES_GATEWAY_URL
  );
  runtimeHermesCredentialsUrl = runtimeHermesGatewayUrl;
  runtimeHermesGatewayToken = String(process.env.HERMES_GATEWAY_TOKEN || '')
    || savedHermesGatewayToken(config, runtimeHermesGatewayUrl);
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
  if (automaticUpdateCheckTimer) clearTimeout(automaticUpdateCheckTimer);
  automaticUpdateCheckTimer = null;
  saveWindowBounds();
  for (const [window, metadata] of companionWindows) {
    if (!metadata.primary) saveAdditionalFolkBounds(window);
  }
  stopRuntimeAdapters();
  resetAgentSnapshotCoordinator();
  stopLocalServer();
});
