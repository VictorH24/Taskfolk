const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  defaultVsCodeAgentHostMetadataPaths,
  fetchVsCodeAhpSessions
} = require('./vscode-ahp.cjs');

const ACTIVE_ACTIVITY_MS = 30_000;
// VS Code persists the request completion marker before its chat UI has
// necessarily finished committing the last reasoning/response updates. Keep
// the agent working briefly so that persistence race cannot flash Success
// while Copilot still shows "Considering".
const COMPLETION_SETTLE_MS = 1_500;
const DEFAULT_MAX_AGENTS = 24;
const VSCODE_COPILOT_GROUPING_PROJECT = 'project';
const VSCODE_COPILOT_GROUPING_SINGLE = 'single';
const CHAT_INDEX_KEY = 'chat.ChatSessionStore.index';
const SESSION_TAIL_BYTES = 256 * 1024;
const AGENT_HOST_LOG_TAIL_BYTES = 512 * 1024;
const COPILOT_CHAT_LOG_TAIL_BYTES = 256 * 1024;
const MAX_SESSION_RUNTIME_CACHE_ENTRIES = 2_000;
const sessionRuntimeCache = new Map();

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

function defaultVsCodeAgentHostLogRoots(workspaceStorageRoots = defaultVsCodeWorkspaceStorageRoots()) {
  return [...new Set(workspaceStorageRoots
    .filter((root) => path.basename(root) === 'workspaceStorage')
    .map((root) => path.join(path.dirname(path.dirname(root)), 'logs')))];
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
  return value === VSCODE_COPILOT_GROUPING_PROJECT
    ? VSCODE_COPILOT_GROUPING_PROJECT
    : VSCODE_COPILOT_GROUPING_SINGLE;
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

function readFileTail(filePath, maxBytes) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, maxBytes);
    if (!length) return '';
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function readFileHead(filePath, maxBytes) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const length = Math.min(fs.fstatSync(handle).size, maxBytes);
    if (!length) return '';
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function copilotChatLogDirectories(logRoots) {
  const directories = [];
  for (const root of logRoots) {
    let sessions = [];
    try { sessions = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const session of sessions
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(0, 4)) {
      const sessionPath = path.join(root, session.name);
      let windows = [];
      try { windows = fs.readdirSync(sessionPath, { withFileTypes: true }); } catch { continue; }
      for (const window of windows) {
        if (!window.isDirectory() || !/^window\d+$/i.test(window.name)) continue;
        const exthostPath = path.join(sessionPath, window.name, 'exthost');
        const chatLogDirectory = path.join(exthostPath, 'GitHub.copilot-chat');
        if (fs.existsSync(chatLogDirectory)) {
          directories.push({ exthostPath, chatLogDirectory });
        }
      }
    }
  }
  return directories;
}

function readCopilotChatWindowStates(logRoots) {
  const states = new Map();
  for (const { exthostPath, chatLogDirectory } of copilotChatLogDirectories(logRoots)) {
    const exthostLog = readFileHead(path.join(exthostPath, 'exthost.log'), 128 * 1024);
    const workspaceMatch = /[\\/]workspaceStorage[\\/]([a-f\d]{32})(?:[\\/.\s]|$)/i.exec(exthostLog);
    if (!workspaceMatch) continue;

    let latest = null;
    const chatLog = readFileTail(
      path.join(chatLogDirectory, 'GitHub Copilot Chat.log'),
      COPILOT_CHAT_LOG_TAIL_BYTES
    );
    for (const line of chatLog.split(/\r?\n/)) {
      // These markers contain only lifecycle timing. Do not retain or parse
      // prompt, response, tool, or error content from the Copilot Chat log.
      const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*\[(AutomaticInstructionsCollector|ToolCallingLoop)\](?:.*Stop hook result:)?/.exec(line);
      if (!match || (match[2] === 'ToolCallingLoop' && !line.includes('Stop hook result:'))) continue;
      const updatedAt = Date.parse(match[1].replace(' ', 'T'));
      if (!Number.isFinite(updatedAt) || updatedAt <= Number(latest?.updatedAt || 0)) continue;
      latest = {
        status: match[2] === 'AutomaticInstructionsCollector' ? 'active' : 'idle',
        updatedAt
      };
    }
    if (!latest) continue;
    const workspaceStorageId = workspaceMatch[1].toLowerCase();
    const current = states.get(workspaceStorageId);
    if (!current || latest.updatedAt > current.updatedAt) states.set(workspaceStorageId, latest);
  }
  return states;
}

function agentHostLogFiles(logRoots) {
  const files = [];
  for (const root of logRoots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root, entry.name, 'agenthost.log');
      try {
        files.push({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs });
      } catch {}
    }
  }
  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 16)
    .map((entry) => entry.filePath);
}

function readCopilotAgentHostStates(logRoots) {
  const events = new Map();
  for (const filePath of agentHostLogFiles(logRoots)) {
    for (const line of readFileTail(filePath, AGENT_HOST_LOG_TAIL_BYTES).split(/\r?\n/)) {
      // Intentionally stop matching before any prompt or error body. TaskFolk
      // retains only the timestamp, opaque session id, and lifecycle marker.
      const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[\w+\] \[Copilot:([^\]]+)\] (sendMessage called:|Session error:|Session idle\b)/.exec(line);
      if (!match) continue;
      const timestamp = Date.parse(match[1].replace(' ', 'T'));
      if (!Number.isFinite(timestamp)) continue;
      const sessionId = match[2];
      const state = events.get(sessionId) || { activeAt: 0, errorAt: 0, idleAt: 0 };
      if (match[3] === 'sendMessage called:') state.activeAt = Math.max(state.activeAt, timestamp);
      else if (match[3] === 'Session error:') state.errorAt = Math.max(state.errorAt, timestamp);
      else state.idleAt = Math.max(state.idleAt, timestamp);
      events.set(sessionId, state);
    }
  }

  const states = new Map();
  for (const [sessionId, event] of events) {
    const updatedAt = Math.max(event.activeAt, event.errorAt, event.idleAt);
    const status = event.errorAt > event.activeAt
      ? 'blocked'
      : (event.activeAt > event.idleAt ? 'active' : 'idle');
    states.set(sessionId, { status, updatedAt });
  }
  return states;
}

function copilotAgentHostSessionKey(sessionId) {
  const match = /^(?:agent-host-)?copilotcli:\/(.+)$/.exec(String(sessionId || ''));
  return match?.[1] || '';
}

function setNestedValue(target, key, value) {
  if (!target || !Array.isArray(key) || !key.length) return;
  let current = target;
  for (let index = 0; index < key.length - 1; index += 1) {
    const part = key[index];
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = Number.isInteger(key[index + 1]) ? [] : {};
    }
    current = current[part];
  }
  current[key.at(-1)] = value;
}

function responseNeedsApproval(response) {
  if (!Array.isArray(response)) return false;
  return response.some((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item.kind === 'toolInvocationSerialized') {
      // VS Code serializes a tool waiting for confirmation as complete enough to
      // render, but omits the confirmation decision until the user responds.
      return Boolean(item.toolCallId)
        && item.isComplete === true
        && !Object.prototype.hasOwnProperty.call(item, 'isConfirmed');
    }
    if (['confirmation', 'questionCarousel', 'planReview'].includes(item.kind)) {
      return item.isUsed !== true;
    }
    return item.kind === 'elicitationSerialized' && item.state === 'pending';
  });
}

function responseIsStillThinking(response) {
  if (!Array.isArray(response)) return false;
  for (let index = response.length - 1; index >= 0; index -= 1) {
    const item = response[index];
    if (item?.kind !== 'thinking' || !item.id) continue;
    return !Number.isFinite(item.reasoningDurationMs);
  }
  return false;
}

function cacheSessionRuntimeState(sessionPath, fingerprint, value) {
  sessionRuntimeCache.delete(sessionPath);
  sessionRuntimeCache.set(sessionPath, { ...fingerprint, value });
  while (sessionRuntimeCache.size > MAX_SESSION_RUNTIME_CACHE_ENTRIES) {
    sessionRuntimeCache.delete(sessionRuntimeCache.keys().next().value);
  }
  return value;
}

function latestSessionRuntimeState(workspaceStoragePath, sessionId) {
  let sessionPath = '';
  for (const extension of ['jsonl', 'json']) {
    const candidate = path.join(workspaceStoragePath, 'chatSessions', `${sessionId}.${extension}`);
    if (fs.existsSync(candidate)) {
      sessionPath = candidate;
      break;
    }
  }
  if (!sessionPath) return null;

  let handle;
  try {
    handle = fs.openSync(sessionPath, 'r');
    const stat = fs.fstatSync(handle);
    const fingerprint = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      ino: stat.ino
    };
    const cached = sessionRuntimeCache.get(sessionPath);
    if (cached
      && cached.size === fingerprint.size
      && cached.mtimeMs === fingerprint.mtimeMs
      && cached.ctimeMs === fingerprint.ctimeMs
      && cached.ino === fingerprint.ino) {
      sessionRuntimeCache.delete(sessionPath);
      sessionRuntimeCache.set(sessionPath, cached);
      return cached.value;
    }
    const size = stat.size;
    const length = Math.min(size, SESSION_TAIL_BYTES);
    if (!length) return cacheSessionRuntimeState(sessionPath, fingerprint, null);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    let latestRequest = -1;
    let latestState = null;
    let latestResult = null;
    let latestResponse = [];

    function useRequest(request, index) {
      if (index < latestRequest) return;
      latestRequest = index;
      latestState = request?.modelState && typeof request.modelState === 'object'
        ? request.modelState
        : null;
      latestResult = request?.result && typeof request.result === 'object'
        ? request.result
        : (request?.responseErrorDetails ? { errorDetails: request.responseErrorDetails } : null);
      latestResponse = Array.isArray(request?.response) ? request.response : [];
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }

      const snapshot = record?.kind === 0 ? record.v : record;
      if (Array.isArray(snapshot?.requests)) {
        const index = snapshot.requests.length - 1;
        if (index >= 0) useRequest(snapshot.requests[index], index);
      }

      const key = record?.k;
      if (record?.kind === 2 && Array.isArray(key) && key.length === 1
        && key[0] === 'requests' && Array.isArray(record.v) && record.v.length) {
        const firstIndex = latestRequest + 1;
        useRequest(record.v.at(-1), firstIndex + record.v.length - 1);
        continue;
      }
      if (!Array.isArray(key) || key[0] !== 'requests' || !Number.isInteger(key[1])) continue;
      const requestIndex = key[1];
      if (requestIndex < latestRequest) continue;
      if (requestIndex > latestRequest) {
        latestRequest = requestIndex;
        latestState = null;
        latestResult = null;
        latestResponse = [];
      }
      if (key[2] === 'modelState' && key.length === 3 && record.v && typeof record.v === 'object') {
        latestState = record.v;
      } else if (key[2] === 'modelState' && key[3] === 'completedAt') {
        latestState = { ...(latestState || {}), completedAt: record.v };
      } else if (key[2] === 'result' && key.length === 3) {
        latestResult = record.v && typeof record.v === 'object' ? record.v : null;
      } else if (key[2] === 'responseErrorDetails' && key.length === 3) {
        latestResult = { errorDetails: record.v };
      } else if (key[2] === 'response') {
        if (record.kind === 2 && key.length === 3 && Array.isArray(record.v)) {
          latestResponse.push(...record.v);
        } else if (record.kind === 1 && key.length === 3 && Array.isArray(record.v)) {
          latestResponse = record.v;
        } else if (record.kind === 1 && Number.isInteger(key[3])) {
          setNestedValue(latestResponse, key.slice(3), record.v);
        }
      }
    }
    return cacheSessionRuntimeState(sessionPath, fingerprint, {
      modelState: latestState,
      awaitingApproval: responseNeedsApproval(latestResponse),
      failed: Number(latestState?.value) === 3 || Boolean(latestResult?.errorDetails),
      stillThinking: responseIsStillThinking(latestResponse)
    });
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function clearVsCodeCopilotCaches() {
  sessionRuntimeCache.clear();
}

function latestSessionModelState(workspaceStoragePath, sessionId) {
  return latestSessionRuntimeState(workspaceStoragePath, sessionId)?.modelState || null;
}

function modelStateStatus(state, nowMs = Date.now(), stillThinking = false, failed = false) {
  if (failed) return 'blocked';
  if (!state) return null;
  // VS Code model state 3 is a terminal request error. A failed response can
  // leave its final thinking item unfinished, so the error must win over the
  // streaming-reasoning signal.
  if (Number(state.value) === 3) return 'blocked';
  if (stillThinking) return 'active';
  const completedAt = Number(state.completedAt) || 0;
  if (!completedAt) return 'active';
  return nowMs - completedAt >= COMPLETION_SETTLE_MS ? 'idle' : 'active';
}

function sessionCompletionStatus(workspaceStoragePath, sessionId, nowMs = Date.now()) {
  const runtimeState = latestSessionRuntimeState(workspaceStoragePath, sessionId);
  const fileMtimeMs = sessionFileMtime(workspaceStoragePath, sessionId);
  const stillThinking = runtimeState?.stillThinking
    && (!runtimeState?.modelState?.completedAt
      || (fileMtimeMs > 0 && nowMs - fileMtimeMs <= ACTIVE_ACTIVITY_MS));
  return modelStateStatus(
    runtimeState?.modelState,
    nowMs,
    stillThinking,
    runtimeState?.failed
  );
}

function sessionNeedsApproval(workspaceStoragePath, sessionId) {
  return latestSessionRuntimeState(workspaceStoragePath, sessionId)?.awaitingApproval === true;
}

function projectIdentity(reference) {
  const normalized = String(reference || '').trim();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `vscode-copilot-project:${digest}`,
    assignmentKey: `runtime:vscode-copilot-project:${digest}`
  };
}

function normalizeSession(
  entry,
  reference,
  workspaceStoragePath,
  nowMs,
  agentHostStates = new Map(),
  copilotChatState = null
) {
  const sessionId = String(entry?.sessionId || '').trim();
  if (!sessionId || !reference || entry?.isEmpty === true) return null;
  const lastMessageMs = Number(entry?.lastMessageDate) || 0;
  const fileMtimeMs = sessionFileMtime(workspaceStoragePath, sessionId);
  const agentHostState = agentHostStates.get(copilotAgentHostSessionKey(sessionId));
  const lifecycleState = [agentHostState, copilotChatState].reduce((selected, state) => {
    if (!state) return selected;
    return !selected || state.updatedAt > selected.updatedAt ? state : selected;
  }, null);
  const updatedAt = Math.max(
    lastMessageMs,
    fileMtimeMs,
    agentHostState?.updatedAt || 0,
    copilotChatState?.updatedAt || 0
  );
  // Agent Host can refresh the chat index merely by restoring an old session.
  // Its log timestamp is the authoritative lifecycle time when available.
  const statusUpdatedAt = lifecycleState?.updatedAt || updatedAt;
  const runtimeState = latestSessionRuntimeState(workspaceStoragePath, sessionId);
  const awaitingApproval = runtimeState?.awaitingApproval === true;
  const stillThinking = runtimeState?.stillThinking
    && (!runtimeState?.modelState?.completedAt
      || (fileMtimeMs > 0 && nowMs - fileMtimeMs <= ACTIVE_ACTIVITY_MS));
  const explicitStatus = lifecycleState?.status || modelStateStatus(
      runtimeState?.modelState,
      nowMs,
      stillThinking,
      runtimeState?.failed
    );
  const failed = explicitStatus === 'blocked';
  const needsApproval = awaitingApproval && !failed;
  const status = needsApproval
    ? 'blocked'
    : (explicitStatus || (updatedAt > 0 && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS ? 'active' : 'idle'));
  const workspace = workspaceDetails(reference);
  const project = projectIdentity(reference);
  const title = String(entry?.title || '').trim();
  return {
    id: project.id,
    name: `Copilot · ${workspace.name}`,
    role: 'VS Code · GitHub Copilot',
    status,
    task: (title && title !== 'New Chat' ? title : `Copilot chat in ${workspace.name}`).slice(0, 240),
    lastSeen: new Date(statusUpdatedAt || nowMs).toISOString(),
    workspacePath: workspace.workspacePath,
    source: 'vscode-copilot',
    avatarAssignmentKey: project.assignmentKey,
    displayState: needsApproval
      ? 'Needs approval'
      : (status === 'blocked' ? 'Blocked' : (status === 'active' ? 'Working' : 'Idle')),
    pose: needsApproval ? 'approval' : (status === 'active' ? 'working' : null),
    activity: {
      provider: 'vscode-copilot',
      status: needsApproval
        ? 'approval'
        : (status === 'blocked' ? 'error' : (status === 'active' ? 'busy' : 'idle')),
      derivedStatus: status,
      updatedAt: statusUpdatedAt || nowMs,
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

function isCopilotAhpProvider(value) {
  return /^(?:github-?)?copilot(?:cli)?$/i.test(String(value || '').trim());
}

function ahpSessionReference(session) {
  const directories = Array.isArray(session?.workingDirectories) ? session.workingDirectories : [];
  return String(directories[0] || session?.project?.uri || '').trim();
}

function ahpInputDisplay(inputKinds) {
  const kinds = new Set(Array.isArray(inputKinds) ? inputKinds : []);
  if (kinds.has('toolConfirmation')) return { displayState: 'Needs approval', activityStatus: 'approval' };
  if (kinds.has('toolAuthentication')) return { displayState: 'Needs authentication', activityStatus: 'authentication' };
  if (kinds.has('chatInput')) return { displayState: 'Needs input', activityStatus: 'input' };
  if (kinds.has('toolClientExecution')) return { displayState: 'Needs client tool', activityStatus: 'client-tool' };
  return { displayState: 'Needs input', activityStatus: 'input' };
}

function normalizeAhpSession(session, nowMs = Date.now()) {
  if (!isCopilotAhpProvider(session?.provider)) return null;
  const rawStatus = Number(session?.status) || 0;
  if ((rawStatus & 64) !== 0) return null;
  const needsInput = (rawStatus & 16) !== 0;
  const failed = (rawStatus & 2) !== 0;
  const active = !needsInput && !failed && (rawStatus & 8) !== 0;
  const status = needsInput || failed ? 'blocked' : active ? 'active' : 'idle';
  const input = ahpInputDisplay(session?.inputKinds);
  const reference = ahpSessionReference(session);
  const workspace = reference ? workspaceDetails(reference) : { name: 'VS Code', workspacePath: null };
  const identity = projectIdentity(reference || 'vscode-ahp:unknown-workspace');
  const title = String(session?.title || '').trim();
  const modifiedAt = Date.parse(session?.modifiedAt || '') || nowMs;
  const displayState = needsInput
    ? input.displayState
    : failed ? 'Blocked' : active ? 'Working' : 'Idle';
  return {
    id: identity.id,
    name: `Copilot · ${workspace.name}`,
    role: 'VS Code · GitHub Copilot',
    status,
    task: (title || `Copilot chat in ${workspace.name}`).slice(0, 240),
    lastSeen: new Date(modifiedAt).toISOString(),
    workspacePath: workspace.workspacePath,
    source: 'vscode-copilot',
    avatarAssignmentKey: identity.assignmentKey,
    displayState,
    pose: needsInput ? 'approval' : active ? 'working' : null,
    activity: {
      provider: 'vscode-copilot',
      status: needsInput ? input.activityStatus : failed ? 'error' : active ? 'busy' : 'idle',
      derivedStatus: status,
      updatedAt: modifiedAt,
      sessionLabel: title ? title.slice(0, 120) : 'Copilot chat',
      sessionKeyShort: String(session?.resource || ''),
      client: 'vscode',
      transport: 'ahp'
    }
  };
}

function agentsFromAhpSessions(sessions, nowMs, maxAgents, grouping) {
  const byProject = new Map();
  for (const session of sessions) {
    const agent = normalizeAhpSession(session, nowMs);
    if (!agent) continue;
    const current = byProject.get(agent.id);
    if (!current || Number(agent.activity.updatedAt) > Number(current.activity.updatedAt)) {
      byProject.set(agent.id, agent);
    }
  }
  const agents = [...byProject.values()].sort((left, right) => {
    const priority = (agent) => agent.status === 'blocked' ? 2 : Number(agent.status === 'active');
    const statusDelta = priority(right) - priority(left);
    return statusDelta || Number(right.activity.updatedAt) - Number(left.activity.updatedAt);
  });
  if (normalizeVsCodeCopilotGrouping(grouping) === VSCODE_COPILOT_GROUPING_SINGLE) {
    const latest = agents.reduce((selected, agent) => {
      if (!selected) return agent;
      return Number(agent.activity.updatedAt) > Number(selected.activity.updatedAt) ? agent : selected;
    }, null);
    return latest ? [singleVsCodeCopilotAgent(latest)] : [];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, 24));
  return agents.slice(0, limit);
}

function copilotSessionIdentity(value) {
  const raw = String(value || '').trim();
  const uuid = /(?:^|[:/])([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(raw);
  if (uuid) return uuid[1].toLowerCase();
  return raw.replace(/^agent-host-/i, '').toLowerCase();
}

function mergeVsCodeCopilotAgents(ahpAgents, localAgents, maxAgents, grouping) {
  const bySession = new Map();
  for (const agent of localAgents) {
    const key = copilotSessionIdentity(agent?.activity?.sessionKeyShort) || `local:${agent.id}`;
    bySession.set(key, agent);
  }
  // AHP owns lifecycle state for sessions visible through both sources.
  for (const agent of ahpAgents) {
    const key = copilotSessionIdentity(agent?.activity?.sessionKeyShort) || `ahp:${agent.id}`;
    bySession.set(key, agent);
  }

  const byProject = new Map();
  for (const agent of bySession.values()) {
    const current = byProject.get(agent.id);
    const currentUpdatedAt = Number(current?.activity?.updatedAt || 0);
    const updatedAt = Number(agent?.activity?.updatedAt || 0);
    if (!current || updatedAt > currentUpdatedAt
      || (updatedAt === currentUpdatedAt && agent?.activity?.transport === 'ahp')) {
      byProject.set(agent.id, agent);
    }
  }
  const merged = [...byProject.values()].sort((left, right) => {
    const priority = (agent) => agent.status === 'blocked' ? 2 : Number(agent.status === 'active');
    const statusDelta = priority(right) - priority(left);
    return statusDelta || Number(right.activity?.updatedAt || 0) - Number(left.activity?.updatedAt || 0);
  });
  if (normalizeVsCodeCopilotGrouping(grouping) === VSCODE_COPILOT_GROUPING_SINGLE) {
    const latest = merged.reduce((selected, agent) => {
      if (!selected) return agent;
      return Number(agent.activity?.updatedAt || 0) > Number(selected.activity?.updatedAt || 0)
        ? agent
        : selected;
    }, null);
    return latest ? [singleVsCodeCopilotAgent(latest)] : [];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, 24));
  return merged.slice(0, limit);
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
  agentHostLogRoots = defaultVsCodeAgentHostLogRoots(workspaceStorageRoots),
  agentHostMetadataPaths = defaultVsCodeAgentHostMetadataPaths(workspaceStorageRoots),
  ahpSessionFetcher = fetchVsCodeAhpSessions,
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = VSCODE_COPILOT_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isVsCodeRunning() : Boolean(processRunning);
  if (!running) return [];
  const nowMs = now();
  let ahpAgents = [];
  try {
    const ahp = await ahpSessionFetcher({ metadataPaths: agentHostMetadataPaths });
    ahpAgents = ahp?.available
      ? agentsFromAhpSessions(ahp.sessions || [], nowMs, maxAgents, grouping)
      : [];
  } catch {}
  const agentHostStates = readCopilotAgentHostStates(agentHostLogRoots);
  const copilotChatWindowStates = readCopilotChatWindowStates(agentHostLogRoots);
  const agents = [];
  for (const workspaceStoragePath of workspaceStorageDirectories(workspaceStorageRoots)) {
    const reference = readWorkspaceReference(workspaceStoragePath);
    if (!reference) continue;
    let entries;
    try { entries = readChatIndex(workspaceStoragePath, DatabaseSyncImpl); } catch { continue; }
    const nonEmptyEntries = entries.filter((entry) => entry?.isEmpty !== true);
    const latestEntry = nonEmptyEntries.reduce((selected, entry) => {
      if (!selected) return entry;
      const entryUpdatedAt = Math.max(
        Number(entry?.lastMessageDate) || 0,
        sessionFileMtime(workspaceStoragePath, String(entry?.sessionId || ''))
      );
      const selectedUpdatedAt = Math.max(
        Number(selected?.lastMessageDate) || 0,
        sessionFileMtime(workspaceStoragePath, String(selected?.sessionId || ''))
      );
      return entryUpdatedAt > selectedUpdatedAt ? entry : selected;
    }, null);
    const chatWindowState = copilotChatWindowStates.get(path.basename(workspaceStoragePath).toLowerCase());
    const candidates = nonEmptyEntries
      .map((entry) => normalizeSession(
        entry,
        reference,
        workspaceStoragePath,
        nowMs,
        agentHostStates,
        entry === latestEntry ? chatWindowState : null
      ))
      .filter(Boolean);
    const agent = candidates.reduce((selected, candidate) => {
      if (!selected) return candidate;
      return Number(candidate.activity?.updatedAt || 0) > Number(selected.activity?.updatedAt || 0)
        ? candidate
        : selected;
    }, null);
    if (agent) agents.push(agent);
  }
  agents.sort((left, right) => {
    const priority = (agent) => agent.status === 'blocked' ? 2 : Number(agent.status === 'active');
    const statusDelta = priority(right) - priority(left);
    return statusDelta || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  let localAgents = agents;
  if (normalizeVsCodeCopilotGrouping(grouping) === VSCODE_COPILOT_GROUPING_SINGLE) {
    const latest = agents.reduce((selected, agent) => {
      if (!selected) return agent;
      return Number(agent.activity?.updatedAt || 0) > Number(selected.activity?.updatedAt || 0)
        ? agent
        : selected;
    }, null);
    localAgents = latest ? [singleVsCodeCopilotAgent(latest)] : [];
  } else {
    const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, 24));
    localAgents = agents.slice(0, limit);
  }
  return mergeVsCodeCopilotAgents(ahpAgents, localAgents, maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  AGENT_HOST_LOG_TAIL_BYTES,
  CHAT_INDEX_KEY,
  COMPLETION_SETTLE_MS,
  COPILOT_CHAT_LOG_TAIL_BYTES,
  VSCODE_COPILOT_GROUPING_PROJECT,
  VSCODE_COPILOT_GROUPING_SINGLE,
  clearVsCodeCopilotCaches,
  defaultVsCodeWorkspaceStorageRoots,
  agentsFromAhpSessions,
  ahpInputDisplay,
  ahpSessionReference,
  copilotChatLogDirectories,
  defaultVsCodeAgentHostLogRoots,
  defaultVsCodeAgentHostMetadataPaths,
  fetchVsCodeCopilotAgents,
  isCopilotAhpProvider,
  isVsCodeRunning,
  copilotSessionIdentity,
  mergeVsCodeCopilotAgents,
  normalizeSession,
  normalizeAhpSession,
  normalizeVsCodeCopilotGrouping,
  projectIdentity,
  readCopilotChatWindowStates,
  sessionCompletionStatus,
  sessionNeedsApproval,
  singleVsCodeCopilotAgent,
  workspaceDetails
};
