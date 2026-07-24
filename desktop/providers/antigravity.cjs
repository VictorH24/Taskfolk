const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 60_000;
const DEFAULT_MAX_AGENTS = 24;
const MAX_SESSIONS_SCANNED = 500;
const ANTIGRAVITY_GROUPING_PROJECT = 'project';
const ANTIGRAVITY_GROUPING_SINGLE = 'single';

function normalizeAntigravityGrouping(value) {
  return value === ANTIGRAVITY_GROUPING_PROJECT ? ANTIGRAVITY_GROUPING_PROJECT : ANTIGRAVITY_GROUPING_SINGLE;
}

function antigravityHome({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.ANTIGRAVITY_HOME || path.join(home, '.gemini', 'antigravity'));
}

function defaultAntigravityBrainRoot(options = {}) {
  return path.join(antigravityHome(options), 'brain');
}

function defaultAntigravitySummaryPath(options = {}) {
  return path.join(antigravityHome(options), 'agyhub_summaries_proto.pb');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

function parseAntigravityProcesses(output) {
  const pids = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const command = match[2];
    if (/[\\/]Antigravity(?:\.app[\\/]Contents[\\/]MacOS[\\/]Antigravity|\.exe)(?:\s|$)/i.test(command)
      || /[\\/]Antigravity\.app[\\/]Contents[\\/]Resources[\\/]bin[\\/]language_server(?:\s|$)/i.test(command)) {
      pids.push(Number(match[1]));
    }
  }
  return [...new Set(pids)];
}

async function detectAntigravityRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('wmic.exe', ['process', 'get', 'ProcessId,CommandLine', '/FORMAT:LIST']);
      const normalized = output.replace(/\r?\nProcessId=/g, ' ').replace(/^ProcessId=/, '');
      return parseAntigravityProcesses(normalized).length > 0;
    }
    const output = await run('ps', ['-ax', '-o', 'pid=,command=']);
    return parseAntigravityProcesses(output).length > 0;
  } catch {
    return false;
  }
}

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  for (let index = offset; index < buffer.length && index < offset + 10; index += 1) {
    const byte = buffer[index];
    value += (byte & 0x7f) * (2 ** shift);
    if (!(byte & 0x80)) return { value, offset: index + 1 };
    shift += 7;
  }
  throw new Error('Invalid protobuf varint.');
}

function protobufFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (!field) throw new Error('Invalid protobuf field.');
    if (wire === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      fields.push({ field, wire, value: value.value });
      continue;
    }
    const fixedLength = wire === 1 ? 8 : wire === 5 ? 4 : 0;
    if (fixedLength) {
      if (offset + fixedLength > buffer.length) throw new Error('Truncated protobuf field.');
      fields.push({ field, wire, bytes: buffer.subarray(offset, offset + fixedLength) });
      offset += fixedLength;
      continue;
    }
    if (wire !== 2) throw new Error('Unsupported protobuf wire type.');
    const length = readVarint(buffer, offset);
    offset = length.offset;
    if (length.value < 0 || offset + length.value > buffer.length) throw new Error('Truncated protobuf field.');
    fields.push({ field, wire, bytes: buffer.subarray(offset, offset + length.value) });
    offset += length.value;
  }
  return fields;
}

function textField(fields, number) {
  const value = fields.find((entry) => entry.field === number && entry.wire === 2)?.bytes;
  return value ? value.toString('utf8').trim() : '';
}

function fileUriPath(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'file:') return '';
    let pathname = decodeURIComponent(url.pathname);
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return path.resolve(pathname);
  } catch {
    return '';
  }
}

function readSummaryMetadata(summaryPath) {
  const summaries = new Map();
  try {
    const topLevel = protobufFields(fs.readFileSync(summaryPath));
    for (const encodedEntry of topLevel.filter((entry) => entry.field === 1 && entry.wire === 2)) {
      const entry = protobufFields(encodedEntry.bytes);
      const sessionId = textField(entry, 1);
      const encodedMetadata = entry.find((value) => value.field === 2 && value.wire === 2)?.bytes;
      if (!sessionId || !encodedMetadata) continue;
      const metadata = protobufFields(encodedMetadata);
      const title = textField(metadata, 1).replace(/\s+/g, ' ').slice(0, 160);
      const encodedWorkspace = metadata.find((value) => value.field === 9 && value.wire === 2)?.bytes;
      const workspacePath = encodedWorkspace ? fileUriPath(textField(protobufFields(encodedWorkspace), 1)) : '';
      const encodedTrajectory = metadata.find((value) => value.field === 17 && value.wire === 2)?.bytes;
      const projectId = encodedTrajectory ? textField(protobufFields(encodedTrajectory), 18) : '';
      summaries.set(sessionId, { title, projectId, workspacePath });
    }
  } catch {}
  return summaries;
}

function readSummaryTitles(summaryPath) {
  return new Map([...readSummaryMetadata(summaryPath)].map(([sessionId, metadata]) => [sessionId, metadata.title]));
}

function sessionFiles(brainRoot, maxFiles = MAX_SESSIONS_SCANNED, summaries = new Map()) {
  let entries = [];
  try { entries = fs.readdirSync(brainRoot, { withFileTypes: true }); } catch { return []; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcriptPath = path.join(brainRoot, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
    try {
      const stat = fs.statSync(transcriptPath);
      const summary = summaries.get(entry.name) || {};
      candidates.push({
        sessionId: entry.name,
        title: String(summary.title || ''),
        projectId: String(summary.projectId || ''),
        workspacePath: String(summary.workspacePath || ''),
        transcriptPath,
        conversationPath: path.join(path.dirname(brainRoot), 'conversations', `${entry.name}.db`),
        mtimeMs: stat.mtimeMs
      });
    } catch {}
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, Math.max(1, Number(maxFiles) || MAX_SESSIONS_SCANNED));
}

function readConversationApproval(conversationPath, DatabaseSyncImpl) {
  if (!conversationPath || !fs.existsSync(conversationPath)) return false;
  let db;
  try {
    const DatabaseSync = DatabaseSyncImpl || require('node:sqlite').DatabaseSync;
    db = new DatabaseSync(conversationPath, { readOnly: true });
    const row = db.prepare(
      'SELECT status, length(permissions) AS permissionBytes FROM steps ORDER BY idx DESC LIMIT 1'
    ).get();
    // CORTEX_STEP_STATUS_WAITING = 9. A permissions payload distinguishes a
    // user authorization prompt from other internal waiting states.
    return Number(row?.status) === 9 && Number(row?.permissionBytes) > 0;
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch {}
  }
}

function readSessionMetadata(candidate) {
  try {
    const lines = fs.readFileSync(candidate.transcriptPath, 'utf8').trim().split(/\r?\n/);
    let latest = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      const timestamp = Date.parse(String(record?.created_at || ''));
      // Conversation content is intentionally neither retained nor returned.
      const safe = {
        source: String(record?.source || ''),
        type: String(record?.type || ''),
        status: String(record?.status || ''),
        updatedAt: Number.isFinite(timestamp) ? timestamp : 0
      };
      if (!latest || safe.updatedAt >= latest.updatedAt) latest = safe;
    }
    return latest ? {
      sessionId: String(candidate.sessionId),
      title: String(candidate.title || ''),
      projectId: String(candidate.projectId || ''),
      workspacePath: String(candidate.workspacePath || ''),
      source: latest.source,
      type: latest.type,
      status: latest.status,
      awaitingApproval: readConversationApproval(candidate.conversationPath),
      updatedAt: Math.max(candidate.mtimeMs || 0, latest.updatedAt)
    } : null;
  } catch {
    return null;
  }
}

function groupIdentity(groupKey) {
  const normalized = String(groupKey || 'conversations');
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `antigravity-group:${digest}`,
    assignmentKey: `runtime:antigravity-group:${digest}`
  };
}

function sessionIdentity(sessionId) {
  return groupIdentity(`session:${String(sessionId || 'unknown')}`);
}

function sessionGroup(metadata) {
  if (metadata.workspacePath) {
    return {
      key: `workspace:${path.resolve(metadata.workspacePath)}`,
      label: path.basename(path.resolve(metadata.workspacePath)) || 'Project',
      workspacePath: path.resolve(metadata.workspacePath)
    };
  }
  if (metadata.projectId && metadata.projectId !== 'outside-of-project') {
    return { key: `project:${metadata.projectId}`, label: `Project ${metadata.projectId.slice(0, 8)}`, workspacePath: null };
  }
  return { key: 'conversations', label: 'Conversations', workspacePath: null };
}

function lifecycle(metadata, nowMs) {
  const recent = nowMs - metadata.updatedAt <= ACTIVE_ACTIVITY_MS;
  const status = metadata.status.toUpperCase();
  if (metadata.awaitingApproval) return { status: 'blocked', displayState: 'Needs approval', pose: 'approval' };
  if (/ERROR|FAILED|CANCELLED|ABORTED/.test(status)) return { status: 'blocked', displayState: 'Blocked', pose: null };
  const awaitingModel = metadata.source.toUpperCase().startsWith('USER')
    || metadata.type.toUpperCase() === 'USER_INPUT';
  if (recent && (awaitingModel || !/DONE|COMPLETE|COMPLETED/.test(status))) {
    return { status: 'active', displayState: 'Working', pose: 'working' };
  }
  return { status: 'idle', displayState: 'Idle', pose: null };
}

function createAgent(metadata, group, nowMs) {
  const identity = groupIdentity(group.key);
  const state = lifecycle(metadata, nowMs);
  const shortId = metadata.sessionId.slice(0, 8);
  const title = metadata.title || `Conversation ${shortId}`;
  const task = state.status === 'active' ? `Working on: ${title}` : title;
  return {
    id: identity.id,
    name: `Antigravity · ${group.label}`.slice(0, 180),
    role: 'Google Antigravity',
    status: state.status,
    task,
    lastSeen: new Date(metadata.updatedAt).toISOString(),
    workspacePath: group.workspacePath,
    source: 'antigravity',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: state.displayState,
    pose: state.pose,
    activity: {
      provider: 'antigravity',
      status: state.pose === 'approval' ? 'approval' : state.status === 'active' ? 'busy' : state.status,
      derivedStatus: state.status,
      updatedAt: metadata.updatedAt,
      sessionLabel: task,
      sessionKeyShort: metadata.sessionId,
      client: 'antigravity',
      stepType: metadata.type || null,
      stepSource: metadata.source || null
    }
  };
}

function agentsFromSessions(candidates, nowMs, maxAgents, grouping = ANTIGRAVITY_GROUPING_PROJECT) {
  const sessions = candidates
    .map(readSessionMetadata)
    .filter(Boolean)
    .map((metadata) => ({ metadata, group: sessionGroup(metadata), state: lifecycle(metadata, nowMs) }))
    .sort((left, right) => {
      const priority = (entry) => entry.state.pose === 'approval' ? 2 : Number(entry.state.status === 'active');
      return priority(right) - priority(left)
        || right.metadata.updatedAt - left.metadata.updatedAt;
    });
  const byGroup = new Map();
  for (const session of sessions) {
    if (!byGroup.has(session.group.key)) {
      byGroup.set(session.group.key, createAgent(session.metadata, session.group, nowMs));
    }
  }
  const agents = [...byGroup.values()];
  if (normalizeAntigravityGrouping(grouping) === ANTIGRAVITY_GROUPING_SINGLE) {
    if (!agents[0]) return [];
    return [{
      ...agents[0],
      id: 'antigravity-all-sessions',
      name: 'Google Antigravity',
      avatarAssignmentKey: 'runtime:antigravity-single'
    }];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return agents.slice(0, limit);
}

async function fetchAntigravityAgents({
  brainRoot = defaultAntigravityBrainRoot(),
  summaryPath,
  running,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = ANTIGRAVITY_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const isRunning = running === undefined ? await detectAntigravityRunning() : Boolean(running);
  if (!isRunning) return [];
  const resolvedSummaryPath = summaryPath || path.join(path.dirname(brainRoot), 'agyhub_summaries_proto.pb');
  return agentsFromSessions(sessionFiles(brainRoot, MAX_SESSIONS_SCANNED, readSummaryMetadata(resolvedSummaryPath)), now(), maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  ANTIGRAVITY_GROUPING_PROJECT,
  ANTIGRAVITY_GROUPING_SINGLE,
  agentsFromSessions,
  antigravityHome,
  defaultAntigravityBrainRoot,
  defaultAntigravitySummaryPath,
  detectAntigravityRunning,
  fetchAntigravityAgents,
  groupIdentity,
  normalizeAntigravityGrouping,
  parseAntigravityProcesses,
  protobufFields,
  readConversationApproval,
  readSessionMetadata,
  readSummaryMetadata,
  readSummaryTitles,
  sessionFiles,
  sessionIdentity
};
