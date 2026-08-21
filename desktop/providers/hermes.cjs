const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 90_000;
const DEFAULT_MAX_AGENTS = 24;
const HERMES_GROUPING_PROJECT = 'project';
const HERMES_GROUPING_SINGLE = 'single';

function normalizeHermesGrouping(value) {
  return value === HERMES_GROUPING_PROJECT ? HERMES_GROUPING_PROJECT : HERMES_GROUPING_SINGLE;
}

function hermesRoot({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.HERMES_HOME || path.join(home, '.hermes'));
}

function hermesDatabaseCandidates(options = {}) {
  const root = hermesRoot(options);
  const candidates = [path.join(root, 'state.db')];
  const profilesRoot = path.join(root, 'profiles');
  let profiles = [];
  try { profiles = fs.readdirSync(profilesRoot, { withFileTypes: true }); } catch {}
  for (const profile of profiles) {
    if (profile.isDirectory()) candidates.push(path.join(profilesRoot, profile.name, 'state.db'));
  }
  return candidates.map((candidate) => path.resolve(candidate));
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isHermesRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('wmic.exe', ['process', 'get', 'CommandLine', '/FORMAT:LIST']);
      return /(?:^|[\\/\s])hermes(?:\.exe)?(?:\s|$)/im.test(output)
        || /Hermes(?: Agent)?\.exe/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'command=']);
    return /\/Hermes(?: Agent)?\.app\/Contents\/MacOS\/Hermes(?:\s|$)/im.test(output)
      || /(?:^|[\/\s])hermes(?:\s|$)/im.test(output)
      || /(?:^|[\/\s])hermes-agent(?:\s|$)/im.test(output);
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
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = 'sessions'").get();
  if (!table?.name) return [];
  const columns = db.prepare(`PRAGMA table_info(${safeIdentifier(table.name)})`).all();
  const fields = {
    id: findColumn(columns, ['id', 'session_id']),
    source: findColumn(columns, ['source', 'session_type']),
    cwd: findColumn(columns, ['cwd', 'working_directory', 'working_dir']),
    repoRoot: findColumn(columns, ['git_repo_root']),
    title: findColumn(columns, ['title', 'display_name', 'name']),
    model: findColumn(columns, ['model', 'model_name']),
    provider: findColumn(columns, ['billing_provider', 'provider']),
    started: findColumn(columns, ['started_at', 'created_at']),
    ended: findColumn(columns, ['ended_at']),
    activity: findColumn(columns, ['last_activity_at', 'updated_at']),
    activityDescription: findColumn(columns, ['last_activity_description']),
    profileName: findColumn(columns, ['profile_name']),
    parent: findColumn(columns, ['parent_session_id']),
    archived: findColumn(columns, ['archived'])
  };
  if (!fields.id) return [];
  const expression = (field, alias) => field ? `${safeIdentifier(field)} AS ${alias}` : `NULL AS ${alias}`;
  const filters = [];
  if (fields.parent) filters.push(`${safeIdentifier(fields.parent)} IS NULL`);
  if (fields.archived) filters.push(`COALESCE(${safeIdentifier(fields.archived)}, 0) = 0`);
  if (fields.source) filters.push(`LOWER(COALESCE(${safeIdentifier(fields.source)}, '')) NOT IN ('tool', 'kanban')`);
  const order = fields.activity || fields.started || fields.id;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1_200));
  // Deliberately select session metadata only. Hermes messages, prompts, tool
  // calls, system prompts, credentials, and routing records are never queried.
  // Hidden sessions remain eligible: Hermes uses that flag for profile/Bot
  // sessions owned by another UI surface, not as an inactivity marker.
  return db.prepare(`
    SELECT ${expression(fields.id, 'id')}, ${expression(fields.source, 'source')},
      ${expression(fields.cwd, 'cwd')}, ${expression(fields.repoRoot, 'repo_root')},
      ${expression(fields.title, 'title')}, ${expression(fields.model, 'model')},
      ${expression(fields.provider, 'provider')},
      ${expression(fields.started, 'started_at')}, ${expression(fields.ended, 'ended_at')},
      ${expression(fields.activity, 'last_activity_at')},
      ${expression(fields.activityDescription, 'last_activity_description')},
      ${expression(fields.profileName, 'profile_name')},
      ${fields.activityDescription ? '1' : '0'} AS activity_state_available
    FROM ${safeIdentifier(table.name)}
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY ${safeIdentifier(order)} DESC
    LIMIT ?
  `).all(safeLimit);
}

function timestampMs(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function modelProvider(row) {
  const explicit = cleanText(row?.provider, 80);
  if (explicit) return explicit;
  const model = cleanText(row?.model, 120);
  if (model.includes('/')) return cleanText(model.split('/')[0], 80);
  return '';
}

function projectIdentity(workspacePath) {
  const normalized = path.resolve(String(workspacePath || '.'));
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return { id: `hermes-project:${digest}`, assignmentKey: `runtime:hermes-project:${digest}` };
}

function profileIdentity(profileName) {
  const normalized = cleanText(profileName, 120).toLowerCase() || 'default';
  const digest = crypto.createHash('sha256').update(`profile:${normalized}`).digest('hex').slice(0, 20);
  return { id: `hermes-profile:${digest}`, assignmentKey: `runtime:hermes-profile:${digest}` };
}

function databaseProfileName(dbPath) {
  const profileRoot = path.dirname(dbPath);
  return path.basename(path.dirname(profileRoot)).toLowerCase() === 'profiles'
    ? path.basename(profileRoot)
    : 'default';
}

function hermesLifecycle(row, nowMs) {
  const updatedAt = timestampMs(row?.last_activity_at, row?.started_at) || nowMs;
  const recent = nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const open = row?.ended_at === null || row?.ended_at === undefined || row?.ended_at === '';
  const description = cleanText(row?.last_activity_description, 160).toLowerCase();
  const activityStateAvailable = Boolean(row?.activity_state_available);
  const awaitingApproval = open && recent && /approval|permission|confirm|waiting for user/.test(description);
  // Modern Hermes clears last_activity_description in the turn's finally
  // block. That is a stronger live/idle boundary than a recency window. Older
  // schemas without the column retain the timestamp-only compatibility path.
  const active = open && recent && !awaitingApproval && (!activityStateAvailable || Boolean(description));
  if (awaitingApproval) {
    return { status: 'blocked', displayState: 'Needs approval', pose: 'approval', activityStatus: 'approval', updatedAt };
  }
  if (active) return { status: 'active', displayState: 'Working', pose: 'working', activityStatus: 'busy', updatedAt };
  return { status: 'idle', displayState: 'Idle', pose: null, activityStatus: 'idle', updatedAt };
}

function agentFromRow(row, nowMs) {
  const sessionId = cleanText(row?.id, 160);
  if (!sessionId) return null;
  const workspacePath = cleanText(row?.repo_root || row?.cwd, 1_024);
  const hasWorkspace = Boolean(workspacePath && path.isAbsolute(workspacePath));
  const profileName = cleanText(row?.profile_name || row?.database_profile, 120) || 'default';
  const identity = hasWorkspace ? projectIdentity(workspacePath) : profileIdentity(profileName);
  const projectName = hasWorkspace
    ? path.basename(path.resolve(workspacePath)) || 'Workspace'
    : profileName === 'default' ? 'Default' : profileName;
  const lifecycle = hermesLifecycle(row, nowMs);
  const model = cleanText(row?.model, 120);
  const provider = modelProvider(row);
  const source = cleanText(row?.source, 40) || 'local';
  const title = cleanText(row?.title, 240) || `Hermes session in ${projectName}`;
  return {
    id: identity.id,
    name: `Hermes · ${projectName}`.slice(0, 180),
    role: ['Hermes Agent', !hasWorkspace && profileName !== 'default' ? profileName : '', provider, model]
      .filter(Boolean).join(' · '),
    status: lifecycle.status,
    task: title,
    lastSeen: new Date(lifecycle.updatedAt).toISOString(),
    workspacePath: hasWorkspace ? path.resolve(workspacePath) : null,
    source: 'hermes',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: lifecycle.displayState,
    pose: lifecycle.pose,
    activity: {
      provider: 'hermes', status: lifecycle.activityStatus, derivedStatus: lifecycle.status,
      updatedAt: lifecycle.updatedAt, sessionLabel: title.slice(0, 120), sessionKeyShort: sessionId,
      client: source, model: model || null, modelProvider: provider || null,
      profile: profileName
    }
  };
}

function agentsFromRows(rows, nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = HERMES_GROUPING_PROJECT) {
  const candidates = rows.map((row) => agentFromRow(row, nowMs)).filter(Boolean).sort((left, right) => {
    const rank = (agent) => agent.pose === 'approval' ? 2 : Number(agent.status === 'active');
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  const projects = new Map();
  for (const agent of candidates) {
    if (!projects.has(agent.id)) projects.set(agent.id, agent);
  }
  const agents = [...projects.values()];
  if (normalizeHermesGrouping(grouping) === HERMES_GROUPING_SINGLE) {
    return agents[0] ? [{ ...agents[0], id: 'hermes-all-projects', name: 'Hermes', avatarAssignmentKey: 'runtime:hermes-single' }] : [];
  }
  return agents.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
}

async function fetchHermesAgents({
  dbPaths,
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = HERMES_GROUPING_PROJECT,
  now = Date.now,
  ...pathOptions
} = {}) {
  const running = processRunning === undefined ? await isHermesRunning() : Boolean(processRunning);
  if (!running) return [];
  const candidates = dbPaths || hermesDatabaseCandidates(pathOptions);
  const rows = [];
  for (const dbPath of candidates) {
    if (!fs.existsSync(dbPath)) continue;
    let db;
    try {
      db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
      const databaseProfile = databaseProfileName(dbPath);
      rows.push(...sessionRows(db, Math.max(500, maxAgents * 30)).map((row) => ({
        ...row,
        database_profile: databaseProfile
      })));
    } finally {
      try { db?.close(); } catch {}
    }
  }
  return agentsFromRows(rows, now(), maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  HERMES_GROUPING_PROJECT,
  HERMES_GROUPING_SINGLE,
  agentFromRow,
  agentsFromRows,
  databaseProfileName,
  fetchHermesAgents,
  hermesDatabaseCandidates,
  hermesLifecycle,
  hermesRoot,
  isHermesRunning,
  modelProvider,
  normalizeHermesGrouping,
  profileIdentity,
  projectIdentity,
  sessionRows,
  timestampMs
};
