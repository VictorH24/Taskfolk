const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 60_000;
const MAX_INCOMPLETE_ASSISTANT_MS = 30 * 60_000;
const UNCHANGED_TIMESTAMP_TOLERANCE_MS = 250;

function defaultOllamaDbPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.OLLAMA_DESKTOP_DB && env.OLLAMA_DESKTOP_DB !== ':memory:') return path.resolve(env.OLLAMA_DESKTOP_DB);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ollama', 'db.sqlite');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Ollama', 'db.sqlite');
  }
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(dataHome, 'Ollama', 'db.sqlite');
}

function defaultOllamaPidPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.OLLAMA_PID_PATH) return path.resolve(env.OLLAMA_PID_PATH);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ollama', 'ollama.pid');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Ollama', 'ollama.pid');
  }
  const runtimeRoot = env.XDG_RUNTIME_DIR || env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(runtimeRoot, 'Ollama', 'ollama.pid');
}

function defaultOllamaServerLogPath({ env = process.env, home = os.homedir() } = {}) {
  const ollamaHome = env.OLLAMA_HOME ? path.resolve(env.OLLAMA_HOME) : path.join(home, '.ollama');
  return path.join(ollamaHome, 'logs', 'server.log');
}

function readFileTail(filePath, maxBytes = 256 * 1024) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(descriptor);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function serverLogHasActiveTask(logText) {
  const activeTasks = new Set();
  for (const line of String(logText || '').split(/\r?\n/)) {
    const taskMatch = line.match(/\btask\s+(\d+)\s*\|/);
    if (!taskMatch) continue;
    const taskId = taskMatch[1];
    if (/\bstop processing\b/i.test(line)) {
      activeTasks.delete(taskId);
    } else if (/\bprocessing task\b|\bnew prompt\b|\bn_decoded\s*=/i.test(line)) {
      activeTasks.add(taskId);
    }
  }
  return activeTasks.size > 0;
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

function pidFileIsLive(pidPath, readFile = fs.readFileSync, signal = process.kill) {
  let pid;
  try {
    pid = Number(String(readFile(pidPath, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    signal(pid, 0);
    return true;
  } catch (error) {
    // A zero-signal EPERM still proves that the PID exists; hardened desktop
    // environments can deny signaling an otherwise live sibling process.
    if (pid && error?.code === 'EPERM') return true;
    return false;
  }
}

async function isOllamaDesktopRunning({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  run = runProcess,
  readFile,
  signal
} = {}) {
  if (pidFileIsLive(defaultOllamaPidPath({ platform, env, home }), readFile, signal)) return true;
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Ollama.exe', '/FO', 'CSV', '/NH']);
      return /"Ollama\.exe"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin') return /\/Ollama\.app\/Contents\/MacOS\/Ollama\s*$/im.test(output);
    return /(^|\/)ollama-app\s*$/im.test(output) || /\/Ollama\s*$/m.test(output);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function chatRows(db, limit) {
  let approvalExpression = '0';
  try {
    const toolCallTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tool_calls' LIMIT 1"
    ).get();
    if (toolCallTable) {
      approvalExpression = `EXISTS (
        SELECT 1
        FROM tool_calls pending_tool
        WHERE pending_tool.message_id = m.id
          AND (
            pending_tool.function_result IS NULL
            OR TRIM(pending_tool.function_result) = ''
          )
      )`;
    }
  } catch {}
  return db.prepare(`
    SELECT
      c.id,
      COALESCE(
        NULLIF(TRIM(c.title), ''),
        (
          SELECT SUBSTR(first_user.content, 1, 160)
          FROM messages first_user
          WHERE first_user.chat_id = c.id AND first_user.role = 'user'
          ORDER BY first_user.id ASC
          LIMIT 1
        ),
        ''
      ) AS title,
      m.role AS message_role,
      m.stream AS message_stream,
      m.model_name,
      m.created_at AS message_created,
      m.updated_at AS message_updated,
      ${approvalExpression} AS awaiting_approval
    FROM chats c
    JOIN messages m ON m.id = (
      SELECT latest.id
      FROM messages latest
      WHERE latest.chat_id = c.id
      ORDER BY latest.updated_at DESC, latest.id DESC
      LIMIT 1
    )
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT ?
  `).all(limit);
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowActivityMs(row) {
  return Math.max(timestampMs(row?.message_updated), timestampMs(row?.message_created));
}

function rowIsActive(row, nowMs) {
  if (Boolean(row?.message_stream)) return true;
  const role = String(row?.message_role || '').toLowerCase();
  if (role === 'user') return nowMs - rowActivityMs(row) <= ACTIVE_ACTIVITY_MS;
  if (role !== 'assistant') return false;
  const createdAt = timestampMs(row?.message_created);
  const updatedAt = timestampMs(row?.message_updated);
  // Ollama Desktop 0.32 creates the assistant row before inference with
  // stream=0 and leaves updated_at equal to created_at. It advances updated_at
  // only when the response finishes, so equality is the reliable in-flight
  // signal for this schema. Bound it so a crashed generation cannot stay busy
  // forever.
  return createdAt > 0
    && Math.abs(updatedAt - createdAt) <= UNCHANGED_TIMESTAMP_TOLERANCE_MS
    && nowMs - createdAt <= MAX_INCOMPLETE_ASSISTANT_MS;
}

function chatIdentity(chatId) {
  const normalized = String(chatId || '').trim();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `ollama-chat:${digest}`,
    assignmentKey: `runtime:ollama-chat:${digest}`
  };
}

function cleanSessionTitle(value, maxLength = 120) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function agentFromRow(row, nowMs, forceActive = false) {
  const chatId = String(row?.id || '').trim();
  if (!chatId) return null;
  const identity = chatIdentity(chatId);
  const model = String(row?.model_name || '').trim();
  const title = cleanSessionTitle(row?.title);
  const updatedAt = rowActivityMs(row) || nowMs;
  const awaitingApproval = Boolean(row?.awaiting_approval)
    && !Boolean(row?.message_stream)
    && !forceActive;
  const active = !awaitingApproval && (
    rowIsActive(row, nowMs)
    || (forceActive && nowMs - updatedAt <= MAX_INCOMPLETE_ASSISTANT_MS)
  );
  const task = title || (model ? `Chat with ${model}` : 'Ollama Desktop chat');
  return {
    id: identity.id,
    name: title ? `Ollama · ${title}` : model ? `Ollama · ${model}` : 'Ollama',
    role: `Ollama Desktop${model ? ` · ${model}` : ''}`,
    status: awaitingApproval ? 'blocked' : active ? 'active' : 'idle',
    task: task.slice(0, 240),
    lastSeen: new Date(awaitingApproval || active ? nowMs : updatedAt).toISOString(),
    workspacePath: null,
    source: 'ollama-desktop',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: awaitingApproval ? 'Needs approval' : active ? 'Working' : 'Idle',
    pose: awaitingApproval ? 'approval' : active ? 'working' : null,
    activity: {
      provider: 'ollama-desktop',
      status: awaitingApproval ? 'approval' : active ? 'streaming' : 'idle',
      derivedStatus: awaitingApproval ? 'blocked' : active ? 'active' : 'idle',
      updatedAt,
      sessionLabel: task.slice(0, 120),
      sessionKeyShort: chatId,
      client: 'desktop',
      model: model || null
    }
  };
}

function agentsFromRows(rows, nowMs, maxAgents = 24, grouping = 'chat', serverBusy = false) {
  const agents = rows.map((row, index) => agentFromRow(row, nowMs, serverBusy && index === 0)).filter(Boolean);
  const approvals = agents.filter((agent) => agent.pose === 'approval');
  const active = agents.filter((agent) => agent.status === 'active');
  const selected = (approvals.length ? approvals : active.length ? active : agents.slice(0, 1)).slice(0, maxAgents);
  if (grouping === 'single' && selected[0]) {
    return [{
      ...selected[0],
      id: 'ollama-all-chats',
      name: 'Ollama',
      avatarAssignmentKey: 'runtime:ollama-single'
    }];
  }
  return selected;
}

async function fetchOllamaDesktopAgents({
  dbPath = defaultOllamaDbPath(),
  DatabaseSyncImpl,
  processRunning,
  serverLogPath = defaultOllamaServerLogPath(),
  readServerLogTail = readFileTail,
  maxAgents = 24,
  grouping = 'chat',
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isOllamaDesktopRunning() : Boolean(processRunning);
  if (!running) return [];
  const db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
  try {
    const limit = Math.max(1, Math.min(Number(maxAgents) || 24, 24));
    const nowMs = now();
    const serverBusy = serverLogHasActiveTask(readServerLogTail(serverLogPath));
    return agentsFromRows(chatRows(db, Math.max(100, limit * 10)), nowMs, limit, grouping, serverBusy);
  } finally {
    db.close();
  }
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  MAX_INCOMPLETE_ASSISTANT_MS,
  UNCHANGED_TIMESTAMP_TOLERANCE_MS,
  agentFromRow,
  agentsFromRows,
  chatIdentity,
  cleanSessionTitle,
  defaultOllamaDbPath,
  defaultOllamaPidPath,
  defaultOllamaServerLogPath,
  fetchOllamaDesktopAgents,
  chatRows,
  isOllamaDesktopRunning,
  pidFileIsLive,
  rowActivityMs,
  rowIsActive,
  serverLogHasActiveTask
};
