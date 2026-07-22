const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeOpenCodeGrouping,
  normalizeProjectDirectory,
  normalizeSession,
  singleOpenCodeAgent
} = require('./opencode.cjs');

function defaultOpenCodeDbPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.OPENCODE_DB && env.OPENCODE_DB !== ':memory:') return path.resolve(env.OPENCODE_DB);
  if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, 'opencode', 'opencode.db');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || env.APPDATA || path.join(home, 'AppData', 'Local'), 'opencode', 'opencode.db');
  }
  return path.join(home, '.local', 'share', 'opencode', 'opencode.db');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isOpenCodeDesktopRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FI', 'IMAGENAME eq OpenCode.exe', '/FO', 'CSV', '/NH']);
      return /"OpenCode\.exe"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin') return /\/OpenCode\.app\/Contents\/MacOS\/OpenCode\s*$/im.test(output);
    return /(^|\/)opencode-desktop\s*$/im.test(output) || /\/OpenCode\s*$/m.test(output);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function sessionRows(db, limit) {
  return db.prepare(`
    SELECT
      s.id,
      s.title,
      s.directory,
      s.agent,
      s.model,
      s.time_updated AS session_updated,
      (
        SELECT json_extract(m.data, '$.role')
        FROM message m
        WHERE m.session_id = s.id
        ORDER BY CAST(json_extract(m.data, '$.time.created') AS INTEGER) DESC, m.time_created DESC
        LIMIT 1
      ) AS message_role,
      (
        SELECT CAST(json_extract(m.data, '$.time.completed') AS INTEGER)
        FROM message m
        WHERE m.session_id = s.id
        ORDER BY CAST(json_extract(m.data, '$.time.created') AS INTEGER) DESC, m.time_created DESC
        LIMIT 1
      ) AS message_completed,
      (
        SELECT json_type(m.data, '$.error')
        FROM message m
        WHERE m.session_id = s.id
        ORDER BY CAST(json_extract(m.data, '$.time.created') AS INTEGER) DESC, m.time_created DESC
        LIMIT 1
      ) AS message_error,
      COALESCE((SELECT MAX(m.time_updated) FROM message m WHERE m.session_id = s.id), 0) AS message_updated,
      COALESCE((SELECT MAX(p.time_updated) FROM part p WHERE p.session_id = s.id), 0) AS part_updated,
      (
        SELECT json_extract(p.data, '$.state.status')
        FROM part p
        WHERE p.session_id = s.id AND json_extract(p.data, '$.type') = 'tool'
        ORDER BY p.time_updated DESC
        LIMIT 1
      ) AS tool_status
    FROM session s
    WHERE s.time_archived IS NULL
    ORDER BY s.time_updated DESC
    LIMIT ?
  `).all(limit);
}

function rowActivityMs(row) {
  return Math.max(Number(row.session_updated) || 0, Number(row.message_updated) || 0, Number(row.part_updated) || 0);
}

function rowStatus(row, nowMs) {
  if (row.message_error) return 'error';
  const toolStatus = String(row.tool_status || '').toLowerCase();
  if (/error|failed|rejected/.test(toolStatus)) return 'error';
  // OpenCode persists a tool's lifecycle state while the tool is in flight.
  // A quiet shell command may not update its part for minutes, so its age is
  // not evidence that the agent is idle. Keep the agent busy until OpenCode
  // replaces this state with completed/error.
  if (/pending|running/.test(toolStatus)) return 'busy';
  const incompleteAssistant = row.message_role === 'assistant' && !row.message_completed;
  const waitingForAssistant = row.message_role === 'user';
  // Model inference can be quiet for much longer than 30 seconds. The missing
  // completion timestamp is OpenCode's durable lifecycle signal, so keep the
  // session busy until it records completion or an error. A user message has
  // the same meaning: OpenCode is still expected to produce its reply.
  if (incompleteAssistant || waitingForAssistant) return 'busy';
  return 'idle';
}

function modelFromRow(row) {
  if (!row.model) return null;
  if (typeof row.model === 'object') return row.model;
  try { return JSON.parse(row.model); } catch { return String(row.model); }
}

function agentFromRow(row, nowMs, rawStatus = rowStatus(row, nowMs)) {
  const agent = normalizeSession({
    id: row.id,
    title: row.title,
    directory: row.directory,
    agent: row.agent,
    model: modelFromRow(row),
    time: { updated: rowActivityMs(row) }
  }, { type: rawStatus }, nowMs);
  return {
    ...agent,
    role: agent.role.replace(/^OpenCode/, 'OpenCode Desktop'),
    source: 'opencode-desktop',
    activity: { ...agent.activity, provider: 'opencode-desktop', client: 'desktop' }
  };
}

function agentsFromRows(rows, nowMs, maxAgents, grouping = 'project') {
  if (normalizeOpenCodeGrouping(grouping) === 'single') {
    const latestRow = [...rows].sort((left, right) => rowActivityMs(right) - rowActivityMs(left))[0];
    return latestRow ? [singleOpenCodeAgent(agentFromRow(latestRow, nowMs))] : [];
  }
  const projects = new Map();
  for (const row of rows) {
    const projectKey = normalizeProjectDirectory(row.directory) || `session:${row.id}`;
    const candidate = { row, rawStatus: rowStatus(row, nowMs) };
    const existing = projects.get(projectKey);
    if (!existing || rowActivityMs(candidate.row) > rowActivityMs(existing.row)) projects.set(projectKey, candidate);
  }
  const selected = [...projects.values()]
    .sort((left, right) => {
      const rank = (entry) => entry.rawStatus === 'error' ? 2 : entry.rawStatus === 'busy' ? 1 : 0;
      return rank(right) - rank(left) || rowActivityMs(right.row) - rowActivityMs(left.row);
    })
    .slice(0, maxAgents);
  return selected.map(({ row, rawStatus }) => agentFromRow(row, nowMs, rawStatus));
}

async function fetchOpenCodeDesktopAgents({
  dbPath = defaultOpenCodeDbPath(),
  DatabaseSyncImpl,
  processRunning,
  maxAgents = 24,
  grouping = 'project',
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isOpenCodeDesktopRunning() : Boolean(processRunning);
  if (!running) return [];
  const db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
  try {
    const limit = Math.max(1, Math.min(Number(maxAgents) || 24, 24));
    return agentsFromRows(sessionRows(db, Math.max(500, limit * 50)), now(), limit, grouping);
  } finally {
    db.close();
  }
}

module.exports = {
  agentsFromRows,
  defaultOpenCodeDbPath,
  fetchOpenCodeDesktopAgents,
  isOpenCodeDesktopRunning,
  rowStatus
};
