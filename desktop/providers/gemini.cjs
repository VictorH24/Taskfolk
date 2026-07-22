const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_ACTIVITY_MS = 60_000;
const DEFAULT_MAX_AGENTS = 24;
const GEMINI_GROUPING_PROJECT = 'project';
const GEMINI_GROUPING_SINGLE = 'single';
const MAX_SESSIONS_SCANNED = 500;

function normalizeGeminiGrouping(value) {
  return value === GEMINI_GROUPING_PROJECT ? GEMINI_GROUPING_PROJECT : GEMINI_GROUPING_SINGLE;
}

function geminiHome({ env = process.env, home = os.homedir() } = {}) {
  const cliHome = env.GEMINI_CLI_HOME ? path.resolve(env.GEMINI_CLI_HOME) : path.resolve(home);
  return path.join(cliHome, '.gemini');
}

function defaultGeminiTmpRoot(options = {}) {
  return path.join(geminiHome(options), 'tmp');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

function parseGeminiProcesses(output) {
  const cliPids = [];
  const codeAssistPids = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (/google\.geminicodeassist[^\s]*[\\/]agent[\\/]a2a-server\.mjs/i.test(command)) {
      codeAssistPids.push(pid);
      continue;
    }
    if (/(?:^|[\s/\\])gemini(?:\.cmd|\.exe)?(?:\s|$)/i.test(command)
      || /@google[\\/]gemini-cli(?:[\\/]|\s|$)/i.test(command)) {
      cliPids.push(pid);
    }
  }
  return { cliPids, codeAssistPids };
}

function parseLsofCwd(output) {
  const line = String(output || '').split(/\r?\n/).find((value) => value.startsWith('n'));
  return line ? line.slice(1).trim() : '';
}

async function detectGeminiProcesses({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('wmic.exe', ['process', 'get', 'ProcessId,CommandLine', '/FORMAT:LIST']);
      const normalized = output.replace(/\r?\nProcessId=/g, ' ').replace(/^ProcessId=/, '');
      const snapshot = parseGeminiProcesses(normalized);
      return { cliRunning: snapshot.cliPids.length > 0, codeAssistWorkspaces: [] };
    }
    const output = await run('ps', ['-ax', '-o', 'pid=,command=']);
    const snapshot = parseGeminiProcesses(output);
    const workspaces = [];
    for (const pid of snapshot.codeAssistPids) {
      try {
        const cwd = parseLsofCwd(await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']));
        if (cwd) workspaces.push(path.resolve(cwd));
      } catch {}
    }
    return { cliRunning: snapshot.cliPids.length > 0, codeAssistWorkspaces: [...new Set(workspaces)] };
  } catch {
    return { cliRunning: false, codeAssistWorkspaces: [] };
  }
}

function sessionFiles(tmpRoot, maxFiles = MAX_SESSIONS_SCANNED) {
  const candidates = [];
  let projects = [];
  try { projects = fs.readdirSync(tmpRoot, { withFileTypes: true }); } catch { return []; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectRoot = path.join(tmpRoot, project.name);
    const chatsRoot = path.join(projectRoot, 'chats');
    let workspacePath = '';
    try { workspacePath = fs.readFileSync(path.join(projectRoot, '.project_root'), 'utf8').trim(); } catch {}
    let chats = [];
    try { chats = fs.readdirSync(chatsRoot, { withFileTypes: true }); } catch { continue; }
    for (const chat of chats) {
      if (!chat.isFile() || !chat.name.endsWith('.json')) continue;
      const transcriptPath = path.join(chatsRoot, chat.name);
      try {
        const stat = fs.statSync(transcriptPath);
        candidates.push({ transcriptPath, workspacePath, projectHash: project.name, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, Math.max(1, Number(maxFiles) || MAX_SESSIONS_SCANNED));
}

function readSessionMetadata(candidate) {
  try {
    const record = JSON.parse(fs.readFileSync(candidate.transcriptPath, 'utf8'));
    const sessionId = String(record?.sessionId || path.basename(candidate.transcriptPath, '.json')).trim();
    const workspacePath = String(record?.projectRoot || record?.cwd || candidate.workspacePath || '').trim();
    const title = String(record?.summary || record?.title || '').trim();
    const model = String(record?.model || record?.metadata?.model || '').trim();
    const timestamp = Date.parse(String(record?.lastUpdated || record?.updateTime || record?.startTime || ''));
    return {
      sessionId,
      workspacePath,
      title,
      model,
      updatedAt: Math.max(candidate.mtimeMs || 0, Number.isFinite(timestamp) ? timestamp : 0)
    };
  } catch {
    return null;
  }
}

function projectIdentity(workspacePath) {
  const normalized = path.resolve(String(workspacePath || '.'));
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `gemini-project:${digest}`,
    assignmentKey: `runtime:gemini-project:${digest}`
  };
}

function createAgent({ workspacePath, metadata, client, nowMs }) {
  const resolvedPath = path.resolve(workspacePath);
  const projectName = path.basename(resolvedPath) || 'Workspace';
  const project = projectIdentity(resolvedPath);
  const updatedAt = metadata?.updatedAt || nowMs;
  const active = Boolean(metadata) && nowMs - updatedAt <= ACTIVE_ACTIVITY_MS;
  const isCodeAssist = client === 'vscode';
  const task = metadata?.title || `${isCodeAssist ? 'Gemini Code Assist' : 'Gemini'} session in ${projectName}`;
  return {
    id: project.id,
    name: `Gemini · ${projectName}`,
    role: isCodeAssist ? 'VS Code · Gemini Code Assist' : 'Gemini CLI',
    status: active ? 'active' : 'idle',
    task: task.slice(0, 240),
    lastSeen: new Date(updatedAt).toISOString(),
    workspacePath: resolvedPath,
    source: 'gemini',
    avatarAssignmentKey: project.assignmentKey,
    displayState: active ? 'Working' : 'Idle',
    pose: active ? 'working' : null,
    activity: {
      provider: 'gemini',
      status: active ? 'busy' : 'idle',
      derivedStatus: active ? 'active' : 'idle',
      updatedAt,
      sessionLabel: task.slice(0, 120),
      sessionKeyShort: metadata?.sessionId || project.id,
      client,
      model: metadata?.model || null
    }
  };
}

function agentsFromSessions(candidates, processes, nowMs, maxAgents, grouping = GEMINI_GROUPING_PROJECT) {
  if (!processes.cliRunning && processes.codeAssistWorkspaces.length === 0) return [];
  const codeAssistPaths = new Set(processes.codeAssistWorkspaces.map((value) => path.resolve(value)));
  const byProject = new Map();
  for (const candidate of candidates) {
    const metadata = readSessionMetadata(candidate);
    if (!metadata?.workspacePath) continue;
    const workspacePath = path.resolve(metadata.workspacePath);
    const client = codeAssistPaths.has(workspacePath) ? 'vscode' : 'cli';
    if (client === 'cli' && !processes.cliRunning) continue;
    const agent = createAgent({ workspacePath, metadata, client, nowMs });
    if (!byProject.has(agent.id)) byProject.set(agent.id, agent);
  }
  for (const workspacePath of codeAssistPaths) {
    const project = projectIdentity(workspacePath);
    if (!byProject.has(project.id)) {
      byProject.set(project.id, createAgent({ workspacePath, metadata: null, client: 'vscode', nowMs }));
    }
  }
  const agents = [...byProject.values()].sort((left, right) => {
    return Number(right.status === 'active') - Number(left.status === 'active')
      || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeGeminiGrouping(grouping) === GEMINI_GROUPING_SINGLE) {
    if (!agents[0]) return [];
    return [{ ...agents[0], id: 'gemini-all-projects', name: 'Gemini', avatarAssignmentKey: 'runtime:gemini-single' }];
  }
  const limit = Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS));
  return agents.slice(0, limit);
}

async function fetchGeminiAgents({
  tmpRoot = defaultGeminiTmpRoot(),
  processes,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = GEMINI_GROUPING_PROJECT,
  now = Date.now
} = {}) {
  const snapshot = processes || await detectGeminiProcesses();
  return agentsFromSessions(sessionFiles(tmpRoot), snapshot, now(), maxAgents, grouping);
}

module.exports = {
  ACTIVE_ACTIVITY_MS,
  GEMINI_GROUPING_PROJECT,
  GEMINI_GROUPING_SINGLE,
  agentsFromSessions,
  defaultGeminiTmpRoot,
  detectGeminiProcesses,
  fetchGeminiAgents,
  geminiHome,
  normalizeGeminiGrouping,
  parseGeminiProcesses,
  parseLsofCwd,
  projectIdentity,
  readSessionMetadata,
  sessionFiles
};
