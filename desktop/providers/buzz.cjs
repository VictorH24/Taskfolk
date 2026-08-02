const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_LOG_MS = 90_000;
const PROCESS_ACTIVITY_HOLD_MS = 15_000;
const PROCESS_CPU_DELTA_MS = 20;
const DEFAULT_MAX_AGENTS = 24;
const LOG_TAIL_BYTES = 256 * 1024;
const BUZZ_GROUPING_AGENT = 'agent';
const BUZZ_GROUPING_SINGLE = 'single';
const processActivitySamples = new Map();

function normalizeBuzzGrouping(value) {
  return value === BUZZ_GROUPING_AGENT ? BUZZ_GROUPING_AGENT : BUZZ_GROUPING_SINGLE;
}

function buzzDataRoot({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (env.BUZZ_DATA_DIR) return path.resolve(env.BUZZ_DATA_DIR);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'xyz.block.buzz.app');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'xyz.block.buzz.app');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'xyz.block.buzz.app');
}

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function readManagedAgents(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((agent) => ({
      pubkey: cleanText(agent?.pubkey, 128),
      name: cleanText(agent?.display_name || agent?.name, 120),
      runtime: cleanText(agent?.agent_command_override || agent?.agent_command || agent?.acp_command, 120),
      provider: cleanText(agent?.provider, 80),
      model: cleanText(agent?.model, 100),
      relayUrl: cleanText(agent?.relay_url, 240),
      active: agent?.is_active !== false,
      runtimePid: Number(agent?.runtime_pid) || 0,
      lastError: cleanText(agent?.last_error || agent?.last_error_code, 240),
      updatedAt: Date.parse(String(agent?.updated_at || agent?.created_at || '')) || 0
    })).filter((agent) => agent.pubkey && agent.name && agent.active);
  } catch {
    return [];
  }
}

function readPidSnapshots(pidRoot) {
  let entries = [];
  try { entries = fs.readdirSync(pidRoot, { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => {
    try {
      const filePath = path.join(pidRoot, entry.name);
      const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const filenameKey = entry.name.replace(/\.json$/, '');
      const pubkey = filenameKey.split('__')[0];
      return {
        pubkey: cleanText(pubkey, 128), pid: Number(record?.pid) || 0,
        startedAt: Date.parse(String(record?.startedAt || '')) || fs.statSync(filePath).mtimeMs
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

function processCpuTimeMs(value) {
  const parts = String(value || '').trim().split(/[:-]/).map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  let seconds = parts.pop() || 0;
  let minutes = parts.pop() || 0;
  let hours = parts.pop() || 0;
  const days = parts.pop() || 0;
  hours += days * 24;
  return Math.round((((hours * 60) + minutes) * 60 + seconds) * 1000);
}

function parsePsProcessTable(source) {
  return String(source || '').split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d:.-]+)(?:\s+.*)?$/);
    if (!match) return null;
    return {
      pid: Number(match[1]), ppid: Number(match[2]), cpuPercent: Number(match[3]) || 0,
      cpuTimeMs: processCpuTimeMs(match[4])
    };
  }).filter(Boolean);
}

function processTreeStats(records, rootPid) {
  const children = new Map();
  for (const record of records) {
    if (!children.has(record.ppid)) children.set(record.ppid, []);
    children.get(record.ppid).push(record);
  }
  const pending = [Number(rootPid)];
  const seen = new Set();
  let cpuTimeMs = 0;
  let cpuPercent = 0;
  while (pending.length) {
    const pid = pending.pop();
    if (!Number.isInteger(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const record = records.find((entry) => entry.pid === pid);
    if (record) {
      cpuTimeMs += record.cpuTimeMs;
      cpuPercent += record.cpuPercent;
    }
    for (const child of children.get(pid) || []) pending.push(child.pid);
  }
  return { cpuTimeMs, cpuPercent, pids: [...seen].sort((left, right) => left - right) };
}

async function sampleBuzzProcessActivity({
  rootPids, nowMs = Date.now(), platform = process.platform, run = runProcess,
  holdMs = PROCESS_ACTIVITY_HOLD_MS, samples = processActivitySamples
} = {}) {
  const result = new Map();
  const roots = [...new Set((rootPids || []).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (!roots.length || platform === 'win32') return result;
  let records = [];
  try {
    records = parsePsProcessTable(await run('ps', ['-axo', 'pid=,ppid=,%cpu=,time=']));
  } catch {
    return result;
  }
  for (const rootPid of roots) {
    const current = processTreeStats(records, rootPid);
    const previous = samples.get(rootPid);
    const newDescendant = Boolean(previous)
      && current.pids.some((pid) => !previous.pids.includes(pid));
    const cpuAdvanced = Boolean(previous)
      && current.cpuTimeMs - previous.cpuTimeMs >= PROCESS_CPU_DELTA_MS;
    const visiblyBusy = current.cpuPercent >= 1;
    const lastBusyAt = cpuAdvanced || newDescendant || visiblyBusy
      ? nowMs
      : previous?.lastBusyAt || 0;
    samples.set(rootPid, { ...current, lastBusyAt, seenAt: nowMs });
    result.set(rootPid, lastBusyAt > 0 && nowMs - lastBusyAt <= holdMs);
  }
  for (const [pid, sample] of samples) {
    if (!roots.includes(pid) && nowMs - sample.seenAt > holdMs) samples.delete(pid);
  }
  return result;
}

function buzzLogSignal(source) {
  let latest = '';
  const patterns = [
    ['approval', /(?:approval|permission).{0,32}(?:required|requested|pending|waiting)/i],
    ['blocked', /(?:turn|prompt|agent).{0,40}(?:failed|error|timed out|timeout|stalled)/i],
    ['idle', /(?:turn_completed|(?:turn|prompt|session).{0,40}(?:completed|complete|finished|cancelled|canceled))/i],
    ['active', /(?:turn_(?:started|liveness)|turn.{0,24}(?:started|starting|dispatch)|session\/prompt|dispatching.{0,24}(?:message|mention|job)|tool.?call)/i],
    ['idle', /(?:connected|online presence|waiting for events)/i]
  ];
  for (const line of String(source || '').split(/\r?\n/)) {
    // Ignore structured fields that can carry user or agent-authored text. The
    // adapter needs lifecycle markers only, never prompt or response content.
    if (/(?:content|message|body|text|system_prompt)\s*[=:]/i.test(line)) continue;
    for (const [signal, pattern] of patterns) {
      if (pattern.test(line)) { latest = signal; break; }
    }
  }
  return latest;
}

function readLogActivity(logPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(logPath, 'r');
    const stat = fs.fstatSync(descriptor);
    const length = Math.min(stat.size, LOG_TAIL_BYTES);
    if (!length) return { signal: '', updatedAt: stat.mtimeMs };
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, stat.size - length);
    return { signal: buzzLogSignal(buffer.toString('utf8')), updatedAt: stat.mtimeMs };
  } catch {
    return { signal: '', updatedAt: 0 };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function findAgentLog(logRoot, pubkey) {
  let entries = [];
  try { entries = fs.readdirSync(logRoot, { withFileTypes: true }); } catch { return ''; }
  const matches = entries.filter((entry) => entry.isFile() && entry.name.startsWith(`${pubkey}__`) && entry.name.endsWith('.log'));
  return matches.map((entry) => {
    const filePath = path.join(logRoot, entry.name);
    try { return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }; } catch { return null; }
  }).filter(Boolean).sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath || '';
}

function agentIdentity(pubkey) {
  const digest = crypto.createHash('sha256').update(String(pubkey || '')).digest('hex').slice(0, 20);
  return { id: `buzz-agent:${digest}`, assignmentKey: `runtime:buzz-agent:${digest}` };
}

function createBuzzAgent(config, pidSnapshot, logActivity, nowMs, processWorking = false) {
  const identity = agentIdentity(config.pubkey);
  const updatedAt = Math.max(config.updatedAt, pidSnapshot?.startedAt || 0, logActivity.updatedAt || 0) || nowMs;
  const recentSignal = nowMs - (logActivity.updatedAt || 0) <= ACTIVE_LOG_MS ? logActivity.signal : '';
  const blocked = Boolean(config.lastError) || recentSignal === 'blocked' || recentSignal === 'approval';
  const working = !blocked && (recentSignal === 'active' || processWorking);
  const approval = recentSignal === 'approval';
  const runtime = config.runtime || 'Buzz ACP';
  const relay = (() => { try { return new URL(config.relayUrl).hostname; } catch { return ''; } })();
  return {
    id: identity.id,
    name: `Buzz · ${config.name}`,
    role: [runtime, config.provider, config.model].filter(Boolean).join(' · '),
    status: blocked ? 'blocked' : working ? 'active' : 'idle',
    task: approval ? 'Waiting for approval' : blocked ? (config.lastError || 'Agent needs attention') : working ? 'Handling a Buzz task' : 'Connected to Buzz',
    lastSeen: new Date(updatedAt).toISOString(),
    workspacePath: null,
    source: 'buzz',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: approval ? 'Needs approval' : blocked ? 'Blocked' : working ? 'Working' : 'Idle',
    pose: approval ? 'approval' : working ? 'working' : null,
    activity: {
      provider: 'buzz', status: approval ? 'approval' : blocked ? 'error' : working ? 'busy' : 'idle',
      derivedStatus: blocked ? 'blocked' : working ? 'active' : 'idle', updatedAt,
      sessionLabel: config.name, sessionKeyShort: config.pubkey.slice(0, 16), client: 'buzz-acp',
      runtime, relay: relay || null, pid: pidSnapshot?.pid || null
    }
  };
}

function agentsFromManaged({
  agents, pids, logRoot, processAlive = defaultProcessAlive, processActivity = new Map(),
  nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = BUZZ_GROUPING_AGENT
}) {
  const livePids = new Map(pids.filter((entry) => processAlive(entry.pid)).map((entry) => [entry.pubkey, entry]));
  for (const agent of agents) {
    if (!livePids.has(agent.pubkey) && processAlive(agent.runtimePid)) {
      livePids.set(agent.pubkey, { pubkey: agent.pubkey, pid: agent.runtimePid, startedAt: agent.updatedAt });
    }
  }
  const result = agents.filter((agent) => livePids.has(agent.pubkey)).map((agent) => {
    const logPath = findAgentLog(logRoot, agent.pubkey);
    const pidSnapshot = livePids.get(agent.pubkey);
    return createBuzzAgent(
      agent, pidSnapshot, logPath ? readLogActivity(logPath) : { signal: '', updatedAt: 0 },
      nowMs, Boolean(processActivity.get(pidSnapshot.pid))
    );
  }).sort((left, right) => {
    const rank = (agent) => agent.status === 'blocked' ? 2 : agent.status === 'active' ? 1 : 0;
    return rank(right) - rank(left) || Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
  });
  if (normalizeBuzzGrouping(grouping) === BUZZ_GROUPING_SINGLE) {
    return result[0] ? [{ ...result[0], id: 'buzz-all-agents', name: 'Buzz', avatarAssignmentKey: 'runtime:buzz-single' }] : [];
  }
  return result.slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
}

async function fetchBuzzAgents({
  dataRoot = buzzDataRoot(), processAlive = defaultProcessAlive,
  processActivity, processActivitySampler = sampleBuzzProcessActivity,
  maxAgents = DEFAULT_MAX_AGENTS, grouping = BUZZ_GROUPING_AGENT, now = Date.now
} = {}) {
  const agentRoot = path.join(dataRoot, 'agents');
  const agents = readManagedAgents(path.join(agentRoot, 'managed-agents.json'));
  const pids = readPidSnapshots(path.join(agentRoot, 'agent-pids'));
  const nowMs = now();
  const sampledActivity = processActivity || await processActivitySampler({
    rootPids: [...pids.map((entry) => entry.pid), ...agents.map((agent) => agent.runtimePid)], nowMs
  });
  return agentsFromManaged({
    agents, pids, logRoot: path.join(agentRoot, 'logs'), processAlive,
    processActivity: sampledActivity, nowMs, maxAgents, grouping
  });
}

module.exports = {
  ACTIVE_LOG_MS, BUZZ_GROUPING_AGENT, BUZZ_GROUPING_SINGLE, PROCESS_ACTIVITY_HOLD_MS, agentIdentity,
  agentsFromManaged, buzzDataRoot, buzzLogSignal, createBuzzAgent, fetchBuzzAgents,
  findAgentLog, normalizeBuzzGrouping, parsePsProcessTable, processCpuTimeMs, processTreeStats,
  readLogActivity, readManagedAgents, readPidSnapshots, sampleBuzzProcessActivity
};
