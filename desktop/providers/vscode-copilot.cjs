const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 30_000;
const DEFAULT_MAX_AGENTS = 24;
const VSCODE_COPILOT_GROUPING_PROJECT = 'project';
const VSCODE_COPILOT_GROUPING_SINGLE = 'single';
const CHAT_INDEX_KEY = 'chat.ChatSessionStore.index';

function defaultVsCodeWorkspaceStorageRoots({
  platform = process.platform,
  env = process.env,
  home = os.homedir()
} = {}) {
  if (env.VSCODE_WORKSPACE_STORAGE) return [path.resolve(env.VSCODE_WORKSPACE_STORAGE)];
  if (platform === 'darwin') {
    const applicationSupport = path.join(home, 'Library', 'Application Support');
    return ['Code', 'Code - Insiders'].map((name) => path.join(applicationSupport, name, 'User', 'workspaceStorage'));
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return ['Code', 'Code - Insiders'].map((name) => path.join(appData, name, 'User', 'workspaceStorage'));
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return ['Code', 'Code - Insiders'].map((name) => path.join(configHome, name, 'User', 'workspaceStorage'));
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isVsCodeRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Code.exe', '/FO', 'CSV', '/NH']);
      return /"Code\.exe"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin') {
      return /\/Visual Studio Code(?: - Insiders)?\.app\/Contents\/MacOS\/(?:Code(?: - Insiders)?|Electron|Visual Studio Code(?: - Insiders)?)\s*$/im.test(output);
    }
    return /(^|\/)code(?:-insiders)?\s*$/im.test(output);
  } catch {
    return false;
  }
}

function normalizeVsCodeCopilotGrouping(value) {
  return value === VSCODE_COPILOT_GROUPING_SINGLE
    ? VSCODE_COPILOT_GROUPING_SINGLE
    : VSCODE_COPILOT_GROUPING_PROJECT;
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function readWorkspaceReference(workspaceStoragePath) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(workspaceStoragePath, 'workspace.json'), 'utf8'));
    return String(value.folder || value.workspace || '').trim();
  } catch {
    return '';
  }
}

function readChatIndex(workspaceStoragePath, DatabaseSyncImpl) {
  const dbPath = path.join(workspaceStoragePath, 'state.vscdb');
  if (!fs.existsSync(dbPath)) return [];
  const db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(CHAT_INDEX_KEY);
    if (!row?.value) return [];
    const index = JSON.parse(row.value);
    return Object.values(index?.entries || {}).filter((entry) => entry && typeof entry === 'object');
  } finally {
    db.close();
  }
}

function workspaceDetails(reference) {
  let parsed;
  try { parsed = new URL(reference); } catch { parsed = null; }
  const isLocal = parsed?.protocol === 'file:';
  const localPath = isLocal ? decodeURIComponent(parsed.pathname) : '';
  const displayPath = localPath || decodeURIComponent(parsed?.pathname || reference).replace(/\/+$/, '');
  let name = path.basename(displayPath) || 'Workspace';
  if (/\.code-workspace$/i.test(name)) name = name.replace(/\.code-workspace$/i, '');
  return { name, workspacePath: localPath || null };
}

function sessionFileMtime(workspaceStoragePath, sessionId) {
  for (const extension of ['jsonl', 'json']) {
    try {
      return fs.statSync(path.join(workspaceStoragePath, 'chatSessions', `${sessionId}.${extension}`)).mtimeMs;
    } catch {}
  }
  return 0;
}

function projectIdentity(reference) {
  const normalized = String(reference || '').trim();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `vscode-copilot-project:${digest}`,
    assignmentKey: `runtime:vscode-copilot-project:${digest}`
  };
}

function normalizeSession(entry, reference, workspaceStoragePath, nowMs) {
  const sessionId = String(entry?.sessionId || '').trim();
  if (!sessionId || !reference || entry?.isEmpty === true) return null;
  const lastMessageMs = Number(entry?.lastMessageDate) || 0;
  const fileMtimeMs = sessionFileMtime(workspaceStoragePath, sessionId);
  const updatedAt = Math.max(lastMessageMs, fileMtimeMs);
  const status = updatedAt > 0 && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS ? 'active' : 'idle';
  const workspace = workspaceDetails(reference);
  const project = projectIdentity(reference);
  const title = String(entry?.title || '').trim();
  return {
    id: project.id,
    name: `Copilot · ${workspace.name}`,
    role: 'VS Code · GitHub Copilot',
    status,
    task: (title && title !== 'New Chat' ? title : `Copilot chat in ${workspace.name}`).slice(0, 240),
    lastSeen: new Date(updatedAt || nowMs).toISOString(),
    workspacePath: workspace.workspacePath,
    source: 'vscode-copilot',
    avatarAssignmentKey: project.assignmentKey,
    displayState: status === 'active' ? 'Working' : 'Sleeping',
    pose: status === 'active' ? 'working' : 'sleeping',
    activity: {
      provider: 'vscode-copilot',
      status: status === 'active' ? 'busy' : 'idle',
      derivedStatus: status,
      updatedAt: updatedAt || nowMs,
      sessionLabel: title && title !== 'New Chat' ? title.slice(0, 120) : 'Copilot chat',
      sessionKeyShort: sessionId,
      client: 'vscode'
    }
  };
}

function singleVsCodeCopilotAgent(agent) {
  if (!agent) return null;
  return {
    ...agent,
    id: 'vscode-copilot-all-projects',
    name: 'VS Code Copilot',
    avatarAssignmentKey: 'runtime:vscode-copilot-single'
  };
}

function workspaceStorageDirectories(roots) {
  const directories = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(path.join(root, entry.name));
    }
  }
  return directories;
}

async function fetchVsCodeCopilotAgents({
  workspaceStorageRoots = defaultVsCodeWorkspaceStorageRoots(),
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = VSCODE_COPILOT_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isVsCodeRunning() : Boolean(processRunning);
  if (!running) return [];
  const nowMs = now();
  const agents = [];
  for (const workspaceStoragePath of workspaceStorageDirectories(workspaceStorageRoots)) {
    const reference = readWorkspaceReference(workspaceStoragePath);
    if (!reference) continue;
    let entries;
    try { entries = readChatIndex(workspaceStoragePath, DatabaseSyncImpl); } catch { continue; }
    const latest = entries
      .filter((entry) => entry?.isEmpty !== true)
      .sort((left, right) => Number(right?.lastMessageDate || 0) - Number(left?.lastMessageDate || 0))[0];
    const agent = normalizeSession(latest, reference, workspaceStoragePath, nowMs);
    if (agent) agents.push(agent);
  }
  agents.sort((left, right) => {
    const statusDelta = Number(right.status === 'active') - Number(left.status === 'active');
    return statusDelta || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeVsCodeCopilotGrouping(grouping) === VSCODE_COPILOT_GROUPING_SINGLE) {
    return agents[0] ? [singleVsCodeCopilotAgent(agents[0])] : [];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, 24));
  return agents.slice(0, limit);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  CHAT_INDEX_KEY,
  VSCODE_COPILOT_GROUPING_PROJECT,
  VSCODE_COPILOT_GROUPING_SINGLE,
  defaultVsCodeWorkspaceStorageRoots,
  fetchVsCodeCopilotAgents,
  isVsCodeRunning,
  normalizeSession,
  normalizeVsCodeCopilotGrouping,
  projectIdentity,
  singleVsCodeCopilotAgent,
  workspaceDetails
};
