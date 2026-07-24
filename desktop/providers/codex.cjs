const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 60_000;
const DEFAULT_MAX_AGENTS = 24;
const CODEX_GROUPING_PROJECT = 'project';
const CODEX_GROUPING_SINGLE = 'single';
const ROLLOUT_TAIL_BYTES = 256 * 1024;

function normalizeCodexGrouping(value) {
  return value === CODEX_GROUPING_PROJECT ? CODEX_GROUPING_PROJECT : CODEX_GROUPING_SINGLE;
}

function codexHome({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
}

function defaultCodexDbPath(options = {}) {
  const home = codexHome(options);
  const direct = path.join(home, 'state_5.sqlite');
  if (fs.existsSync(direct)) return direct;
  const candidates = [];
  for (const root of [home, path.join(home, 'sqlite')]) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^state_\d+\.sqlite$/.test(entry.name)) continue;
      const candidate = path.join(root, entry.name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(candidate).mtimeMs; } catch {}
      candidates.push({ candidate, mtimeMs });
    }
  }
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.candidate || direct;
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isCodexRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FO', 'CSV', '/NH']);
      return /"(?:Codex|codex)(?:\.exe)?"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin' && /\/Codex\.app\/Contents\/MacOS\/(?:Codex|Electron)\s*$/im.test(output)) return true;
    return /(^|\/)codex\s*$/im.test(output);
  } catch {
    return false;
  }
}

function openReadOnlyDatabase(dbPath, DatabaseSyncImpl) {
  const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
  return new DatabaseSync(dbPath, { readOnly: true });
}

function threadRows(db, limit) {
  return db.prepare(`
    SELECT id, rollout_path, updated_at, updated_at_ms, recency_at, recency_at_ms,
      source, cwd, title, model
    FROM threads
    WHERE archived = 0 AND title <> ''
    ORDER BY COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000) DESC
    LIMIT ?
  `).all(limit);
}

function numericTimestampMs(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return 0;
}

function readRolloutActivity(rolloutPath) {
  let handle;
  try {
    handle = fs.openSync(rolloutPath, 'r');
    const size = fs.fstatSync(handle).size;
    if (!size) return null;
    let length = Math.min(size, ROLLOUT_TAIL_BYTES);
    while (length > 0) {
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split(/\r?\n/);
      let latestMs = 0;
      let latestSignal = '';
      const pendingApprovalCalls = new Set();
      for (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        const timestampMs = Date.parse(String(record?.timestamp || ''));
        if (Number.isFinite(timestampMs)) latestMs = Math.max(latestMs, timestampMs);
        if (record?.type === 'response_item') {
          const itemType = String(record?.payload?.type || '');
          const callId = String(record?.payload?.call_id || '');
          if (['custom_tool_call', 'function_call'].includes(itemType)) {
            const input = String(record?.payload?.input ?? record?.payload?.arguments ?? '');
            if (callId && /require_escalated/.test(input)) pendingApprovalCalls.add(callId);
          } else if (['custom_tool_call_output', 'function_call_output'].includes(itemType) && callId) {
            pendingApprovalCalls.delete(callId);
          }
          continue;
        }
        if (record?.type === 'event_msg') {
          const eventType = String(record?.payload?.type || '');
          if (['task_started', 'task_complete', 'turn_aborted', 'stream_error', 'error'].includes(eventType)) {
            latestSignal = eventType;
          }
        }
      }
      if (latestSignal || pendingApprovalCalls.size || length === size) {
        return { latestMs, latestSignal, awaitingApproval: pendingApprovalCalls.size > 0 };
      }
      length = Math.min(size, length * 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function projectIdentity(cwd) {
  const normalized = path.resolve(String(cwd || '.'));
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `codex-project:${digest}`,
    assignmentKey: `runtime:codex-project:${digest}`
  };
}

function clientLabel(source) {
  return String(source || '').toLowerCase() === 'vscode' ? 'Codex Desktop' : 'Codex';
}

function agentFromRow(row, nowMs) {
  const cwd = String(row.cwd || '').trim();
  if (!cwd) return null;
  const activity = readRolloutActivity(String(row.rollout_path || ''));
  const updatedAt = Math.max(
    numericTimestampMs(row.recency_at_ms, row.updated_at_ms, row.recency_at, row.updated_at),
    activity?.latestMs || 0
  );
  const recent = updatedAt > 0 && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const signal = activity?.latestSignal || '';
  const awaitingApproval = Boolean(activity?.awaitingApproval);
  const blocked = awaitingApproval || (recent && ['stream_error', 'error'].includes(signal));
  // A turn remains active until Codex writes an explicit terminal lifecycle
  // event. Long-running quiet tools must not become idle based on age alone.
  const active = signal === 'task_started'
    || (recent && !['task_complete', 'turn_aborted', 'stream_error', 'error'].includes(signal));
  const status = blocked ? 'blocked' : active ? 'active' : 'idle';
  const project = projectIdentity(cwd);
  const projectName = path.basename(cwd) || 'Workspace';
  const title = String(row.title || '').trim();
  const client = clientLabel(row.source);
  return {
    id: project.id,
    name: `Codex · ${projectName}`,
    role: [client, String(row.model || '').trim()].filter(Boolean).join(' · '),
    status,
    task: (title || `Codex task in ${projectName}`).slice(0, 240),
    lastSeen: new Date(updatedAt || nowMs).toISOString(),
    workspacePath: cwd,
    source: 'codex',
    avatarAssignmentKey: project.assignmentKey,
    displayState: awaitingApproval ? 'Needs approval' : blocked ? 'Blocked' : active ? 'Working' : 'Idle',
    pose: awaitingApproval ? 'approval' : blocked ? 'blocked' : active ? 'working' : null,
    activity: {
      provider: 'codex',
      status: awaitingApproval ? 'approval' : blocked ? 'error' : active ? 'busy' : 'idle',
      derivedStatus: status,
      updatedAt: updatedAt || nowMs,
      sessionLabel: title ? title.slice(0, 120) : 'Codex task',
      sessionKeyShort: String(row.id || ''),
      client: String(row.source || '').toLowerCase() === 'vscode' ? 'desktop' : 'cli',
      model: String(row.model || '').trim() || null
    }
  };
}

function singleCodexAgent(agent) {
  if (!agent) return null;
  return {
    ...agent,
    id: 'codex-all-projects',
    name: 'Codex',
    avatarAssignmentKey: 'runtime:codex-single'
  };
}

function agentsFromRows(rows, nowMs, maxAgents, grouping = CODEX_GROUPING_PROJECT) {
  const candidates = rows.map((row) => agentFromRow(row, nowMs)).filter(Boolean);
  candidates.sort((left, right) => {
    const rank = (agent) => agent.status === 'blocked' ? 2 : agent.status === 'active' ? 1 : 0;
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeCodexGrouping(grouping) === CODEX_GROUPING_SINGLE) {
    return candidates[0] ? [singleCodexAgent(candidates[0])] : [];
  }
  const projects = new Map();
  for (const agent of candidates) {
    if (!projects.has(agent.id)) projects.set(agent.id, agent);
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return [...projects.values()].slice(0, limit);
}

async function fetchCodexAgents({
  dbPath = defaultCodexDbPath(),
  DatabaseSyncImpl,
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = CODEX_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isCodexRunning() : Boolean(processRunning);
  if (!running || !fs.existsSync(dbPath)) return [];
  const db = openReadOnlyDatabase(dbPath, DatabaseSyncImpl);
  try {
    const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
    return agentsFromRows(threadRows(db, Math.max(500, limit * 50)), now(), limit, grouping);
  } finally {
    db.close();
  }
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  CODEX_GROUPING_PROJECT,
  CODEX_GROUPING_SINGLE,
  agentsFromRows,
  codexHome,
  defaultCodexDbPath,
  fetchCodexAgents,
  isCodexRunning,
  normalizeCodexGrouping,
  projectIdentity,
  readRolloutActivity,
  singleCodexAgent
};
