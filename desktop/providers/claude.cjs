const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 60_000;
const DEFAULT_MAX_AGENTS = 24;
const CLAUDE_GROUPING_PROJECT = 'project';
const CLAUDE_GROUPING_SINGLE = 'single';
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_TRANSCRIPTS_SCANNED = 500;

function normalizeClaudeGrouping(value) {
  return value === CLAUDE_GROUPING_SINGLE ? CLAUDE_GROUPING_SINGLE : CLAUDE_GROUPING_PROJECT;
}

function claudeHome({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
}

function defaultClaudeProjectsRoot(options = {}) {
  return path.join(claudeHome(options), 'projects');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isClaudeRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FO', 'CSV', '/NH']);
      return /"Claude(?:\.exe)?"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'command=']);
    if (/\/Claude\.app\/Contents\/MacOS\/(?:Claude|Electron)(?:\s|$)/im.test(output)) return true;
    return /(?:^|[\s/])claude(?:\s|$)/im.test(output)
      || /@anthropic-ai\/claude-code(?:\/|\s|$)/im.test(output);
  } catch {
    return false;
  }
}

function transcriptFiles(projectsRoot, maxFiles = MAX_TRANSCRIPTS_SCANNED) {
  const candidates = [];
  let projects = [];
  try { projects = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch { return []; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectRoot = path.join(projectsRoot, project.name);
    let entries = [];
    try { entries = fs.readdirSync(projectRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const transcriptPath = path.join(projectRoot, entry.name);
      try {
        const stat = fs.statSync(transcriptPath);
        candidates.push({ transcriptPath, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, Math.max(1, Number(maxFiles) || MAX_TRANSCRIPTS_SCANNED));
}

function recordTimestampMs(record) {
  const parsed = Date.parse(String(record?.timestamp || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readTranscriptMetadata(transcriptPath) {
  let handle;
  try {
    handle = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    if (!length) return null;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    if (size > length) lines.shift();
    let cwd = '';
    let sessionId = path.basename(transcriptPath, '.jsonl');
    let title = '';
    let model = '';
    let updatedAt = 0;
    let signal = '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      cwd = String(record?.cwd || cwd).trim();
      sessionId = String(record?.sessionId || record?.session_id || sessionId).trim();
      updatedAt = Math.max(updatedAt, recordTimestampMs(record));
      if (record?.type === 'summary' && typeof record.summary === 'string') title = record.summary.trim();
      if (record?.type === 'custom-title' && typeof record.customTitle === 'string') title = record.customTitle.trim();
      if (record?.type === 'assistant') {
        model = String(record?.message?.model || model).trim();
        signal = record?.message?.stop_reason ? 'complete' : 'active';
      } else if (record?.type === 'user') {
        const content = record?.message?.content;
        const toolResultsOnly = Array.isArray(content) && content.length > 0
          && content.every((item) => item?.type === 'tool_result');
        if (!toolResultsOnly) signal = 'active';
      } else if (record?.type === 'result') {
        signal = record?.is_error || record?.subtype === 'error' ? 'error' : 'complete';
      } else if (record?.type === 'system' && record?.subtype === 'turn_duration') {
        signal = 'complete';
      } else if (record?.type === 'system' && /error/i.test(String(record?.subtype || ''))) {
        signal = 'error';
      }
    }
    return cwd ? { cwd, sessionId, title, model, updatedAt, signal } : null;
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
    id: `claude-project:${digest}`,
    assignmentKey: `runtime:claude-project:${digest}`
  };
}

function agentFromTranscript(candidate, nowMs) {
  const metadata = readTranscriptMetadata(candidate.transcriptPath);
  if (!metadata) return null;
  const updatedAt = Math.max(candidate.mtimeMs || 0, metadata.updatedAt || 0);
  const recent = updatedAt > 0 && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const blocked = recent && metadata.signal === 'error';
  const active = recent && metadata.signal === 'active';
  const status = blocked ? 'blocked' : active ? 'active' : 'idle';
  const project = projectIdentity(metadata.cwd);
  const projectName = path.basename(metadata.cwd) || 'Workspace';
  const task = metadata.title || `Claude task in ${projectName}`;
  return {
    id: project.id,
    name: `Claude · ${projectName}`,
    role: ['Claude Code / Cowork', metadata.model].filter(Boolean).join(' · '),
    status,
    task: task.slice(0, 240),
    lastSeen: new Date(updatedAt || nowMs).toISOString(),
    workspacePath: metadata.cwd,
    source: 'claude',
    avatarAssignmentKey: project.assignmentKey,
    displayState: blocked ? 'Blocked' : active ? 'Working' : 'Idle',
    pose: blocked ? 'blocked' : active ? 'working' : null,
    activity: {
      provider: 'claude',
      status: blocked ? 'error' : active ? 'busy' : 'idle',
      derivedStatus: status,
      updatedAt: updatedAt || nowMs,
      sessionLabel: task.slice(0, 120),
      sessionKeyShort: metadata.sessionId,
      client: 'local',
      model: metadata.model || null
    }
  };
}

function agentsFromTranscripts(candidates, nowMs, maxAgents, grouping = CLAUDE_GROUPING_PROJECT) {
  const agents = candidates.map((candidate) => agentFromTranscript(candidate, nowMs)).filter(Boolean);
  agents.sort((left, right) => {
    const rank = (agent) => agent.status === 'blocked' ? 2 : agent.status === 'active' ? 1 : 0;
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeClaudeGrouping(grouping) === CLAUDE_GROUPING_SINGLE) {
    if (!agents[0]) return [];
    return [{
      ...agents[0],
      id: 'claude-all-projects',
      name: 'Claude',
      avatarAssignmentKey: 'runtime:claude-single'
    }];
  }
  const projects = new Map();
  for (const agent of agents) {
    if (!projects.has(agent.id)) projects.set(agent.id, agent);
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return [...projects.values()].slice(0, limit);
}

async function fetchClaudeAgents({
  projectsRoot = defaultClaudeProjectsRoot(),
  processRunning,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = CLAUDE_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isClaudeRunning() : Boolean(processRunning);
  if (!running) return [];
  return agentsFromTranscripts(transcriptFiles(projectsRoot), now(), maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  CLAUDE_GROUPING_PROJECT,
  CLAUDE_GROUPING_SINGLE,
  agentsFromTranscripts,
  claudeHome,
  defaultClaudeProjectsRoot,
  fetchClaudeAgents,
  isClaudeRunning,
  normalizeClaudeGrouping,
  projectIdentity,
  readTranscriptMetadata,
  transcriptFiles
};
