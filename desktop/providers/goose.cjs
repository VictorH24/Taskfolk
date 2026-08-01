const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 90_000;
const DEFAULT_MAX_AGENTS = 24;
const GOOSE_GROUPING_PROJECT = 'project';
const GOOSE_GROUPING_SINGLE = 'single';

function normalizeGooseGrouping(value) {
  return value === GOOSE_GROUPING_PROJECT ? GOOSE_GROUPING_PROJECT : GOOSE_GROUPING_SINGLE;
}

function gooseRoot({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (env.GOOSE_PATH_ROOT) return path.resolve(env.GOOSE_PATH_ROOT);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Block', 'goose');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Block', 'goose');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'goose');
}

function gooseDatabaseCandidates(options = {}) {
  const root = gooseRoot(options);
  const home = options.home || os.homedir();
  const candidates = [
    path.join(root, 'data', 'sessions', 'sessions.db'),
    path.join(root, 'sessions', 'sessions.db'),
    path.join(root, 'sessions.db')
  ];
  if (!options.env?.GOOSE_PATH_ROOT && !process.env.GOOSE_PATH_ROOT) {
    candidates.push(
      path.join(home, '.config', 'goose', 'sessions.db'),
      path.join(home, '.local', 'share', 'goose', 'sessions', 'sessions.db'),
      path.join(home, 'Library', 'Application Support', 'goose', 'sessions', 'sessions.db')
    );
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function defaultGooseDbPath(options = {}) {
  return gooseDatabaseCandidates(options).find((candidate) => fs.existsSync(candidate))
    || gooseDatabaseCandidates(options)[0];
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isGooseRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('wmic.exe', ['process', 'get', 'CommandLine', '/FORMAT:LIST']);
      return /(?:^|[\\/\s])goose(?:\.exe)?(?:\s|$)/im.test(output)
        || /Goose\.app[\\/]Contents[\\/]MacOS[\\/]goose/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'command=']);
    return /(?:^|[\/\s])goose(?:\s+(?:session|run|acp|recipe|schedule|web|server|info|configure)\b|\s*$)/im.test(output)
      || /[\/]Goose\.app[\/]Contents[\/]MacOS[\/]goose(?:\s|$)/im.test(output)
      || /(?:^|[\/\s])goosed(?:\s|$)/im.test(output);
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
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const table = tables.find((entry) => String(entry.name).toLowerCase() === 'sessions')?.name;
  if (!table) return [];
  const columns = db.prepare(`PRAGMA table_info(${safeIdentifier(table)})`).all();
  const fields = {
    id: findColumn(columns, ['id', 'session_id']),
    cwd: findColumn(columns, ['working_dir', 'working_directory', 'cwd', 'project_path']),
    title: findColumn(columns, ['name', 'title', 'session_name']),
    updated: findColumn(columns, ['updated_at', 'last_updated', 'modified_at']),
    lastMessage: findColumn(columns, ['last_message_timestamp', 'last_message_at']),
    created: findColumn(columns, ['created_at', 'started_at']),
    provider: findColumn(columns, ['provider_name', 'provider']),
    model: findColumn(columns, ['model_config_json', 'model_config', 'model', 'model_name']),
    sessionType: findColumn(columns, ['session_type', 'type']),
    archived: findColumn(columns, ['archived_at'])
  };
  if (!fields.id || !fields.cwd) return [];
  const expression = (field, alias) => field ? `${safeIdentifier(field)} AS ${alias}` : `NULL AS ${alias}`;
  const order = fields.updated || fields.created || fields.id;
  return db.prepare(`
    SELECT ${expression(fields.id, 'id')}, ${expression(fields.cwd, 'cwd')},
      ${expression(fields.title, 'title')}, ${expression(fields.updated, 'updated_at')},
      ${expression(fields.lastMessage, 'last_message_at')}, ${expression(fields.created, 'created_at')},
      ${expression(fields.provider, 'provider')},
      ${expression(fields.model, 'model')}, ${expression(fields.sessionType, 'session_type')}
    FROM ${safeIdentifier(table)}
    ${fields.archived ? `WHERE ${safeIdentifier(fields.archived)} IS NULL` : ''}
    ORDER BY ${safeIdentifier(order)} DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit) || 500));
}

function timestampMs(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function modelLabel(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const parsed = JSON.parse(source);
    return cleanText(parsed?.model_name || parsed?.model || parsed?.id || parsed?.name, 100);
  } catch {
    return cleanText(source, 100);
  }
}

function projectIdentity(cwd) {
  const normalized = path.resolve(String(cwd || '.'));
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return { id: `goose-project:${digest}`, assignmentKey: `runtime:goose-project:${digest}` };
}

function agentFromRow(row, nowMs) {
  const cwd = String(row?.cwd || '').trim();
  const sessionId = cleanText(row?.id, 160);
  if (!cwd || !sessionId) return null;
  if (/^(?:hidden|sub_?agent)$/i.test(String(row?.session_type || '').trim())) return null;
  const project = projectIdentity(cwd);
  const projectName = path.basename(path.resolve(cwd)) || 'Workspace';
  const updatedAt = timestampMs(row.last_message_at, row.updated_at, row.created_at) || nowMs;
  const active = nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const title = cleanText(row.title, 240) || `Goose session in ${projectName}`;
  const provider = cleanText(row.provider, 80);
  const model = modelLabel(row.model);
  return {
    id: project.id,
    name: `Goose · ${projectName}`,
    role: ['Goose', provider, model].filter(Boolean).join(' · '),
    status: active ? 'active' : 'idle',
    task: title,
    lastSeen: new Date(updatedAt).toISOString(),
    workspacePath: path.resolve(cwd),
    source: 'goose',
    avatarAssignmentKey: project.assignmentKey,
    displayState: active ? 'Working' : 'Idle',
    pose: active ? 'working' : null,
    activity: {
      provider: 'goose', status: active ? 'busy' : 'idle', derivedStatus: active ? 'active' : 'idle',
      updatedAt, sessionLabel: title.slice(0, 120), sessionKeyShort: sessionId,
      client: cleanText(row.session_type, 40) || 'goose', model: model || null,
      modelProvider: provider || null
    }
  };
}

function agentsFromRows(rows, nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = GOOSE_GROUPING_PROJECT) {
  const byProject = new Map();
  for (const row of rows) {
    const agent = agentFromRow(row, nowMs);
    if (agent && !byProject.has(agent.id)) byProject.set(agent.id, agent);
  }
  const agents = [...byProject.values()].sort((left, right) =>
    Number(right.status === 'active') - Number(left.status === 'active')
      || Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
  if (normalizeGooseGrouping(grouping) === GOOSE_GROUPING_SINGLE) {
    return agents[0] ? [{ ...agents[0], id: 'goose-all-projects', name: 'Goose', avatarAssignmentKey: 'runtime:goose-single' }] : [];
  }
  return agents.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
}

async function fetchGooseAgents({
  dbPath = defaultGooseDbPath(), DatabaseSyncImpl, processRunning,
  maxAgents = DEFAULT_MAX_AGENTS, grouping = GOOSE_GROUPING_PROJECT, now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isGooseRunning() : Boolean(processRunning);
  if (!running || !fs.existsSync(dbPath)) return [];
  const db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
  try {
    return agentsFromRows(sessionRows(db, Math.max(500, maxAgents * 30)), now(), maxAgents, grouping);
  } finally {
    db.close();
  }
}

module.exports = {
  ACTIVE_ACTIVITY_MS, GOOSE_GROUPING_PROJECT, GOOSE_GROUPING_SINGLE, agentFromRow,
  agentsFromRows, defaultGooseDbPath, fetchGooseAgents, gooseDatabaseCandidates,
  gooseRoot, isGooseRunning, modelLabel, normalizeGooseGrouping, projectIdentity,
  sessionRows, timestampMs
};
