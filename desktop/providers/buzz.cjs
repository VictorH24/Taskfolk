const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_LOG_MS = 90_000;
const DEFAULT_MAX_AGENTS = 24;
const LOG_TAIL_BYTES = 256 * 1024;
const BUZZ_GROUPING_AGENT = 'agent';
const BUZZ_GROUPING_SINGLE = 'single';

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

function buzzLogSignal(source) {
  let latest = '';
  const patterns = [
    ['approval', /(?:approval|permission).{0,32}(?:required|requested|pending|waiting)/i],
    ['blocked', /(?:turn|prompt|agent).{0,40}(?:failed|error|timed out|timeout|stalled)/i],
    ['idle', /(?:turn|prompt|session).{0,40}(?:completed|complete|finished|cancelled|canceled)/i],
    ['active', /(?:turn.{0,24}(?:started|starting|dispatch)|session\/prompt|dispatching.{0,24}(?:message|mention|job)|tool.?call)/i],
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

function createBuzzAgent(config, pidSnapshot, logActivity, nowMs) {
  const identity = agentIdentity(config.pubkey);
  const updatedAt = Math.max(config.updatedAt, pidSnapshot?.startedAt || 0, logActivity.updatedAt || 0) || nowMs;
  const recentSignal = nowMs - (logActivity.updatedAt || 0) <= ACTIVE_LOG_MS ? logActivity.signal : '';
  const blocked = Boolean(config.lastError) || recentSignal === 'blocked' || recentSignal === 'approval';
  const working = !blocked && recentSignal === 'active';
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

function agentsFromManaged({ agents, pids, logRoot, processAlive = defaultProcessAlive, nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = BUZZ_GROUPING_AGENT }) {
  const livePids = new Map(pids.filter((entry) => processAlive(entry.pid)).map((entry) => [entry.pubkey, entry]));
  for (const agent of agents) {
    if (!livePids.has(agent.pubkey) && processAlive(agent.runtimePid)) {
      livePids.set(agent.pubkey, { pubkey: agent.pubkey, pid: agent.runtimePid, startedAt: agent.updatedAt });
    }
  }
  const result = agents.filter((agent) => livePids.has(agent.pubkey)).map((agent) => {
    const logPath = findAgentLog(logRoot, agent.pubkey);
    return createBuzzAgent(agent, livePids.get(agent.pubkey), logPath ? readLogActivity(logPath) : { signal: '', updatedAt: 0 }, nowMs);
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
  maxAgents = DEFAULT_MAX_AGENTS, grouping = BUZZ_GROUPING_AGENT, now = Date.now
} = {}) {
  const agentRoot = path.join(dataRoot, 'agents');
  return agentsFromManaged({
    agents: readManagedAgents(path.join(agentRoot, 'managed-agents.json')),
    pids: readPidSnapshots(path.join(agentRoot, 'agent-pids')),
    logRoot: path.join(agentRoot, 'logs'), processAlive, nowMs: now(), maxAgents, grouping
  });
}

module.exports = {
  ACTIVE_LOG_MS, BUZZ_GROUPING_AGENT, BUZZ_GROUPING_SINGLE, agentIdentity,
  agentsFromManaged, buzzDataRoot, buzzLogSignal, createBuzzAgent, fetchBuzzAgents,
  findAgentLog, normalizeBuzzGrouping, readLogActivity, readManagedAgents, readPidSnapshots
};
