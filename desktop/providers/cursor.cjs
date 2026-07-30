const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MAX_AGENTS = 24;
const CURSOR_GROUPING_PROJECT = 'project';
const CURSOR_GROUPING_SINGLE = 'single';
const LOCAL_PROJECTS_KEY = 'glass.localAgentProjects.v1';

function normalizeCursorGrouping(value) {
  return value === CURSOR_GROUPING_PROJECT ? CURSOR_GROUPING_PROJECT : CURSOR_GROUPING_SINGLE;
}

function defaultCursorUserDataRoot({
  platform = process.platform,
  env = process.env,
  home = os.homedir()
} = {}) {
  if (env.CURSOR_USER_DATA_DIR) {
    const configured = path.resolve(env.CURSOR_USER_DATA_DIR);
    return path.basename(configured).toLowerCase() === 'user'
      ? configured
      : path.join(configured, 'User');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User');
  }
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor', 'User');
}

function defaultCursorDbPath(options = {}) {
  return path.join(defaultCursorUserDataRoot(options), 'globalStorage', 'state.vscdb');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isCursorRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Cursor.exe', '/FO', 'CSV', '/NH']);
      return /"Cursor\.exe"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin') {
      return /\/Cursor\.app\/Contents\/MacOS\/Cursor\s*$/im.test(output);
    }
    return /(^|\/)cursor\s*$/im.test(output);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function cursorTablesAvailable(db) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('composerHeaders', 'cursorDiskKV')"
  ).all();
  return new Set(rows.map((row) => String(row.name))).size === 2;
}

function readLocalProjectNames(db) {
  try {
    const rows = db.prepare(`
      SELECT
        json_extract(project.value, '$.workspace.id') AS workspaceId,
        json_extract(project.value, '$.name') AS projectName
      FROM ItemTable
      JOIN json_each(
        CASE WHEN json_valid(ItemTable.value) THEN ItemTable.value ELSE '[]' END
      ) AS project
      WHERE ItemTable.key = ?
    `).all(LOCAL_PROJECTS_KEY);
    return new Map(rows
      .map((row) => [String(row.workspaceId || '').trim(), String(row.projectName || '').trim()])
      .filter(([workspaceId]) => workspaceId));
  } catch {
    return new Map();
  }
}

function readCursorRows(db, limit = 500) {
  if (!cursorTablesAvailable(db)) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1_200));
  // This is deliberately a field whitelist. Cursor's composerData records also
  // contain prompts, responses, previews, context, credentials, and encryption
  // material; none of those values may be selected or retained by Taskfolk.
  return db.prepare(`
    SELECT
      h.composerId AS sessionId,
      COALESCE(
        NULLIF(json_extract(h.value, '$.workspaceIdentifier.id'), ''),
        NULLIF(h.workspaceId, ''),
        'empty-window'
      ) AS workspaceId,
      COALESCE(NULLIF(json_extract(h.value, '$.name'), ''), 'Cursor task') AS title,
      COALESCE(h.createdAt, json_extract(h.value, '$.createdAt'), 0) AS createdAt,
      COALESCE(h.lastUpdatedAt, json_extract(h.value, '$.lastUpdatedAt'), 0) AS updatedAt,
      COALESCE(json_extract(h.value, '$.isDraft'), 0) AS isDraft,
      COALESCE(json_extract(h.value, '$.hasBlockingPendingActions'), 0) AS awaitingApproval,
      COALESCE(json_extract(h.value, '$.hasPendingPlan'), 0) AS hasPendingPlan,
      COALESCE(json_extract(h.value, '$.agentLocation.type'), 'local') AS locationType,
      COALESCE(json_extract(h.value, '$.filesChangedCount'), 0) AS filesChangedCount,
      CASE WHEN json_valid(d.value)
        THEN COALESCE(json_extract(d.value, '$.status'), 'none')
        ELSE 'none'
      END AS composerStatus,
      CASE WHEN json_valid(d.value)
        THEN COALESCE(json_array_length(json_extract(d.value, '$.generatingBubbleIds')), 0)
        ELSE 0
      END AS generatingCount,
      CASE WHEN json_valid(d.value)
        THEN COALESCE(json_array_length(json_extract(d.value, '$.queueItems')), 0)
        ELSE 0
      END AS queueCount,
      CASE WHEN json_valid(d.value)
        THEN COALESCE(json_extract(d.value, '$.isContinuationInProgress'), 0)
        ELSE 0
      END AS continuationInProgress,
      CASE WHEN json_valid(d.value)
        THEN CASE
          WHEN NULLIF(json_extract(d.value, '$.chatGenerationUUID'), '') IS NOT NULL THEN 1
          ELSE 0
        END
        ELSE 0
      END AS chatGenerationInProgress,
      CASE WHEN json_valid(d.value)
        THEN COALESCE(
          NULLIF(json_extract(d.value, '$.modelConfig.modelName'), ''),
          NULLIF(json_extract(d.value, '$.modelConfig.selectedModels[0].modelId'), '')
        )
        ELSE NULL
      END AS model
    FROM composerHeaders AS h
    LEFT JOIN cursorDiskKV AS d ON d.key = 'composerData:' || h.composerId
    WHERE COALESCE(h.isArchived, 0) = 0
      AND COALESCE(h.isSubagent, 0) = 0
      AND COALESCE(json_extract(h.value, '$.isArchived'), 0) = 0
      AND COALESCE(json_extract(h.value, '$.isDraft'), 0) = 0
      AND COALESCE(h.lastUpdatedAt, json_extract(h.value, '$.lastUpdatedAt'), 0) > 0
    ORDER BY
      COALESCE(json_extract(h.value, '$.hasBlockingPendingActions'), 0) DESC,
      CASE WHEN json_valid(d.value) AND json_extract(d.value, '$.status') = 'generating' THEN 1 ELSE 0 END DESC,
      COALESCE(h.lastUpdatedAt, json_extract(h.value, '$.lastUpdatedAt'), 0) DESC
    LIMIT ?
  `).all(safeLimit);
}

function readWorkspaceReferences(userDataRoot) {
  const workspaceStorageRoot = path.join(userDataRoot, 'workspaceStorage');
  const references = new Map();
  let entries = [];
  try { entries = fs.readdirSync(workspaceStorageRoot, { withFileTypes: true }); } catch { return references; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(workspaceStorageRoot, entry.name, 'workspace.json'), 'utf8')
      );
      const reference = String(value.folder || value.workspace || '').trim();
      if (reference) references.set(entry.name, reference);
    } catch {}
  }
  return references;
}

function workspaceDetails(reference) {
  const normalized = String(reference || '').trim();
  if (!normalized) return { name: 'Workspace', workspacePath: null };
  let parsed;
  try { parsed = new URL(normalized); } catch { parsed = null; }
  const localPath = parsed?.protocol === 'file:' ? decodeURIComponent(parsed.pathname) : '';
  const displayPath = localPath || decodeURIComponent(parsed?.pathname || normalized).replace(/\/+$/, '');
  let name = path.basename(displayPath) || 'Workspace';
  if (/\.code-workspace$/i.test(name)) name = name.replace(/\.code-workspace$/i, '');
  return { name, workspacePath: localPath || null };
}

function projectIdentity(projectKey) {
  const normalized = String(projectKey || 'empty-window').trim();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `cursor-project:${digest}`,
    assignmentKey: `runtime:cursor-project:${digest}`
  };
}

function numericTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1_000 : numeric;
}

function cursorLifecycle(row) {
  const awaitingApproval = Boolean(row.awaitingApproval);
  const needsPlanReview = Boolean(row.hasPendingPlan);
  const composerStatus = String(row.composerStatus || '').trim().toLowerCase();
  const active = !awaitingApproval && !needsPlanReview && (
    ['generating', 'pending', 'loading', 'running', 'streaming', 'processing', 'in_progress'].includes(composerStatus)
    || Number(row.generatingCount) > 0
    || Number(row.queueCount) > 0
    || Boolean(row.continuationInProgress)
    || Boolean(row.chatGenerationInProgress)
  );
  if (awaitingApproval) {
    return { status: 'blocked', displayState: 'Needs approval', pose: 'approval', activityStatus: 'approval' };
  }
  if (needsPlanReview) {
    return { status: 'blocked', displayState: 'Needs plan review', pose: 'approval', activityStatus: 'approval' };
  }
  if (active) {
    return { status: 'active', displayState: 'Working', pose: 'working', activityStatus: 'busy' };
  }
  return { status: 'idle', displayState: 'Idle', pose: null, activityStatus: 'idle' };
}

function cursorAgentFromRow(row, {
  localProjectNames = new Map(),
  workspaceReferences = new Map(),
  nowMs = Date.now()
} = {}) {
  const sessionId = String(row.sessionId || '').trim();
  if (!sessionId) return null;
  const workspaceId = String(row.workspaceId || 'empty-window').trim() || 'empty-window';
  const reference = workspaceReferences.get(workspaceId) || '';
  const workspace = workspaceDetails(reference);
  const projectName = localProjectNames.get(workspaceId)
    || (workspaceId === 'empty-window' ? 'Agents' : workspace.name);
  const identity = projectIdentity(reference || workspaceId);
  const lifecycle = cursorLifecycle(row);
  const updatedAt = numericTimestampMs(row.updatedAt) || numericTimestampMs(row.createdAt) || nowMs;
  const title = String(row.title || '').trim() || `Cursor task in ${projectName}`;
  const model = String(row.model || '').trim();
  const location = String(row.locationType || 'local').trim().toLowerCase();
  return {
    id: identity.id,
    name: `Cursor · ${projectName}`.slice(0, 180),
    role: ['Cursor', model].filter(Boolean).join(' · '),
    status: lifecycle.status,
    task: title.slice(0, 240),
    lastSeen: new Date(updatedAt).toISOString(),
    workspacePath: workspace.workspacePath,
    source: 'cursor',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: lifecycle.displayState,
    pose: lifecycle.pose,
    activity: {
      provider: 'cursor',
      status: lifecycle.activityStatus,
      derivedStatus: lifecycle.status,
      updatedAt,
      sessionLabel: title.slice(0, 120),
      sessionKeyShort: sessionId,
      client: location === 'cloud' ? 'cloud' : 'desktop',
      model: model || null,
      queueCount: Math.max(0, Number(row.queueCount) || 0),
      filesChangedCount: Math.max(0, Number(row.filesChangedCount) || 0)
    }
  };
}

function agentsFromCursorRows(rows, {
  grouping = CURSOR_GROUPING_PROJECT,
  maxAgents = DEFAULT_MAX_AGENTS,
  localProjectNames = new Map(),
  workspaceReferences = new Map(),
  nowMs = Date.now()
} = {}) {
  const candidates = rows
    .map((row) => cursorAgentFromRow(row, { localProjectNames, workspaceReferences, nowMs }))
    .filter(Boolean)
    .sort((left, right) => {
      const rank = (agent) => agent.pose === 'approval' ? 2 : Number(agent.status === 'active');
      return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
    });
  if (normalizeCursorGrouping(grouping) === CURSOR_GROUPING_SINGLE) {
    if (!candidates[0]) return [];
    return [{
      ...candidates[0],
      id: 'cursor-all-projects',
      name: 'Cursor',
      avatarAssignmentKey: 'runtime:cursor-single'
    }];
  }
  const projects = new Map();
  for (const agent of candidates) {
    if (!projects.has(agent.id)) projects.set(agent.id, agent);
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return [...projects.values()].slice(0, limit);
}

async function fetchCursorAgents({
  userDataRoot = defaultCursorUserDataRoot(),
  dbPath = path.join(userDataRoot, 'globalStorage', 'state.vscdb'),
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = CURSOR_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isCursorRunning() : Boolean(processRunning);
  if (!running || !fs.existsSync(dbPath)) return [];
  let db;
  try {
    db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
    const rows = readCursorRows(db);
    return agentsFromCursorRows(rows, {
      grouping,
      maxAgents,
      localProjectNames: readLocalProjectNames(db),
      workspaceReferences: readWorkspaceReferences(userDataRoot),
      nowMs: now()
    });
  } finally {
    try { db?.close(); } catch {}
  }
}

module.exports = {
  CURSOR_GROUPING_PROJECT,
  CURSOR_GROUPING_SINGLE,
  LOCAL_PROJECTS_KEY,
  agentsFromCursorRows,
  cursorAgentFromRow,
  cursorLifecycle,
  defaultCursorDbPath,
  defaultCursorUserDataRoot,
  fetchCursorAgents,
  isCursorRunning,
  normalizeCursorGrouping,
  projectIdentity,
  readCursorRows,
  readLocalProjectNames,
  readWorkspaceReferences,
  workspaceDetails
};
