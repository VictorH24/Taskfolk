const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONVERSATION_HEADER_BYTES = 4 * 1024;
const DEFAULT_MAX_AGENTS = 24;

function lmStudioHome({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.LMSTUDIO_HOME || env.LM_STUDIO_HOME || path.join(home, '.lmstudio'));
}

function defaultLmStudioConversationsPath(options = {}) {
  return path.join(lmStudioHome(options), 'conversations');
}

function defaultLmStudioCliPath({ platform = process.platform, ...options } = {}) {
  return path.join(lmStudioHome(options), 'bin', platform === 'win32' ? 'lms.exe' : 'lms');
}

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) return reject(error);
      resolve(String(stdout || ''));
    });
  });
}

async function isLmStudioDesktopRunning({ platform = process.platform, run = runProcess } = {}) {
  try {
    if (platform === 'win32') {
      const output = await run('tasklist.exe', ['/FO', 'CSV', '/NH']);
      return /"LM Studio(?:\.exe)?"/i.test(output);
    }
    const output = await run('ps', ['-ax', '-o', 'comm=']);
    if (platform === 'darwin') return /\/LM Studio\.app\/Contents\/MacOS\/LM Studio\s*$/im.test(output);
    return /(^|\/)(?:lm-studio|lmstudio)\s*$/im.test(output);
  } catch {
    return false;
  }
}

function cleanSessionTitle(value, maxLength = 120) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function jsonStringField(source, key) {
  const match = String(source || '').match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match) return '';
  try { return JSON.parse(match[1]); } catch { return ''; }
}

function numericField(source, key) {
  const match = String(source || '').match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseConversationHeader(source) {
  return {
    title: cleanSessionTitle(jsonStringField(source, 'name')),
    createdAt: numericField(source, 'createdAt'),
    userLastMessagedAt: numericField(source, 'userLastMessagedAt'),
    assistantLastMessagedAt: numericField(source, 'assistantLastMessagedAt')
  };
}

function readConversationHeader(filePath, {
  open = fs.openSync,
  fstat = fs.fstatSync,
  read = fs.readSync,
  close = fs.closeSync
} = {}) {
  let descriptor;
  try {
    descriptor = open(filePath, 'r');
    const size = fstat(descriptor).size;
    const length = Math.min(size, CONVERSATION_HEADER_BYTES);
    if (!length) return parseConversationHeader('');
    const buffer = Buffer.alloc(length);
    read(descriptor, buffer, 0, length, 0);
    return parseConversationHeader(buffer.toString('utf8'));
  } finally {
    if (descriptor !== undefined) close(descriptor);
  }
}

function conversationRows(conversationsPath = defaultLmStudioConversationsPath(), maxRows = 240) {
  let entries = [];
  try { entries = fs.readdirSync(conversationsPath, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.conversation.json'))
    .map((entry) => {
      const filePath = path.join(conversationsPath, entry.name);
      try {
        const stat = fs.statSync(filePath);
        return { entry, filePath, fileUpdatedAt: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.fileUpdatedAt - left.fileUpdatedAt)
    .slice(0, maxRows)
    .map(({ entry, filePath, fileUpdatedAt }) => {
      try {
        return {
          id: entry.name.replace(/\.conversation\.json$/, ''),
          ...readConversationHeader(filePath),
          fileUpdatedAt
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => conversationActivityMs(right) - conversationActivityMs(left));
}

function parseLmStudioModelStatuses(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((model) => ({
    identifier: String(model?.identifier || model?.modelKey || '').trim(),
    displayName: cleanSessionTitle(model?.displayName || model?.identifier || model?.modelKey),
    status: String(model?.status || '').trim().toLowerCase(),
    queued: Math.max(0, Number(model?.queued) || 0),
    lastUsedTime: Number(model?.lastUsedTime) || 0
  })).filter((model) => model.identifier);
}

async function readLmStudioModelStatuses({
  cliPath = defaultLmStudioCliPath(),
  run = runProcess
} = {}) {
  try {
    return parseLmStudioModelStatuses(await run(cliPath, ['ps', '--json']));
  } catch {
    return [];
  }
}

function modelIsBusy(model) {
  return Boolean(model) && (model.queued > 0 || (model.status && model.status !== 'idle'));
}

function conversationActivityMs(row) {
  return Math.max(
    Number(row?.userLastMessagedAt) || 0,
    Number(row?.assistantLastMessagedAt) || 0,
    Number(row?.fileUpdatedAt) || 0,
    Number(row?.createdAt) || 0
  );
}

function chatIdentity(chatId) {
  const normalized = String(chatId || '').trim();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return {
    id: `lmstudio-chat:${digest}`,
    assignmentKey: `runtime:lmstudio-chat:${digest}`
  };
}

function agentFromConversation(row, nowMs, active = false, activeModel = '') {
  const chatId = String(row?.id || '').trim();
  if (!chatId) return null;
  const identity = chatIdentity(chatId);
  const title = cleanSessionTitle(row?.title);
  const task = title || 'LM Studio Desktop chat';
  const updatedAt = conversationActivityMs(row) || nowMs;
  return {
    id: identity.id,
    name: title ? `LM Studio · ${title}` : 'LM Studio',
    role: `LM Studio Desktop${activeModel ? ` · ${activeModel}` : ''}`,
    status: active ? 'active' : 'idle',
    task,
    lastSeen: new Date(active ? nowMs : updatedAt).toISOString(),
    workspacePath: null,
    source: 'lmstudio-desktop',
    avatarAssignmentKey: identity.assignmentKey,
    displayState: active ? 'Working' : 'Idle',
    pose: active ? 'working' : null,
    activity: {
      provider: 'lmstudio-desktop',
      status: active ? 'streaming' : 'idle',
      derivedStatus: active ? 'active' : 'idle',
      updatedAt,
      sessionLabel: task,
      sessionKeyShort: chatId.slice(0, 160),
      client: 'desktop',
      model: activeModel || null
    }
  };
}

function agentsFromConversations(rows, modelStatuses, nowMs, maxAgents = DEFAULT_MAX_AGENTS, grouping = 'chat') {
  const busyModels = (Array.isArray(modelStatuses) ? modelStatuses : []).filter(modelIsBusy);
  const busy = busyModels.length > 0;
  const agents = rows
    .map((row, index) => agentFromConversation(row, nowMs, busy && index === 0, index === 0 ? busyModels[0]?.displayName : ''))
    .filter(Boolean);
  const active = agents.filter((agent) => agent.status === 'active');
  const selected = (active.length ? active : agents.slice(0, 1)).slice(0, Math.max(1, Math.min(Number(maxAgents) || DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS)));
  if (grouping === 'single' && selected[0]) {
    return [{
      ...selected[0],
      id: 'lmstudio-all-chats',
      name: 'LM Studio',
      avatarAssignmentKey: 'runtime:lmstudio-single'
    }];
  }
  return selected;
}

async function fetchLmStudioDesktopAgents({
  conversationsPath = defaultLmStudioConversationsPath(),
  processRunning,
  rows,
  modelStatuses,
  cliPath = defaultLmStudioCliPath(),
  run = runProcess,
  maxAgents = DEFAULT_MAX_AGENTS,
  grouping = 'chat',
  now = Date.now
} = {}) {
  const running = processRunning === undefined ? await isLmStudioDesktopRunning({ run }) : Boolean(processRunning);
  if (!running) return [];
  const conversationMetadata = Array.isArray(rows)
    ? rows
    : conversationRows(conversationsPath, Math.max(100, maxAgents * 10));
  if (!conversationMetadata.length) return [];
  const statuses = Array.isArray(modelStatuses)
    ? modelStatuses
    : await readLmStudioModelStatuses({ cliPath, run });
  return agentsFromConversations(conversationMetadata, statuses, now(), maxAgents, grouping);
}

module.exports = {
  CONVERSATION_HEADER_BYTES,
  agentFromConversation,
  agentsFromConversations,
  chatIdentity,
  cleanSessionTitle,
  conversationActivityMs,
  conversationRows,
  defaultLmStudioCliPath,
  defaultLmStudioConversationsPath,
  fetchLmStudioDesktopAgents,
  isLmStudioDesktopRunning,
  lmStudioHome,
  modelIsBusy,
  parseConversationHeader,
  parseLmStudioModelStatuses,
  readConversationHeader,
  readLmStudioModelStatuses
};
