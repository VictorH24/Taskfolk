import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const require = createRequire(import.meta.url);
const {
  DEFAULT_OPENCLAW_URL,
  fetchOpenClawCronRuns,
  fetchOpenClawSnapshot,
  normalizeOpenClawUrl
} = require('./desktop/providers/openclaw.cjs');

const app = express();
app.use(express.json({ limit: '2mb' }));
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '0.0.0.0');
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.resolve(process.env.SHARED_DIR || '/shared');
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || '/config');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const MAX_TEXT_PREVIEW_BYTES = Number(process.env.MAX_TEXT_PREVIEW_BYTES || 512 * 1024);
const OPENCLAW_CONFIG_PATH = path.resolve(process.env.OPENCLAW_CONFIG_PATH || '/config/openclaw.json');
const OPENCLAW_LOG_DIR = path.resolve(process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw');
const OPENCLAW_SESSIONS_DIR = path.resolve(process.env.OPENCLAW_SESSIONS_DIR || '/openclaw-agents');
const OPENCLAW_CRON_DIR = path.resolve(process.env.OPENCLAW_CRON_DIR || path.join(CONFIG_DIR, 'cron'));
const OPENCLAW_STATE_DB_PATH = path.resolve(process.env.OPENCLAW_STATE_DB_PATH || path.join(CONFIG_DIR, 'state', 'openclaw.sqlite'));
const OPENCLAW_CONNECTION_MODE = String(process.env.OPENCLAW_CONNECTION_MODE || '').trim().toLowerCase() || 'none';
if (!['none', 'files', 'gateway'].includes(OPENCLAW_CONNECTION_MODE)) {
  throw new Error('OPENCLAW_CONNECTION_MODE must be "none", "files", or "gateway".');
}
const OPENCLAW_GATEWAY_URL = normalizeOpenClawUrl(process.env.OPENCLAW_GATEWAY_URL || DEFAULT_OPENCLAW_URL);
const OPENCLAW_GATEWAY_TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
const OPENCLAW_GATEWAY_PASSWORD = String(process.env.OPENCLAW_GATEWAY_PASSWORD || '');
const OPENCLAW_GATEWAY_TIMEOUT_MS = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS || 8_000);
const OPENCLAW_GATEWAY_CACHE_MS = Number(process.env.OPENCLAW_GATEWAY_CACHE_MS || 4_000);
const AVATAR_ASSIGNMENTS_PATH = path.resolve(process.env.AVATAR_ASSIGNMENTS_PATH || path.join(CONFIG_DIR, 'avatar-assignments.json'));
const AGENT_STATE_PATH = path.resolve(process.env.AGENT_STATE_PATH || path.join(CONFIG_DIR, 'state.json'));
const OFFICE_FIXTURE_PATH = path.resolve(process.env.OFFICE_FIXTURE_PATH || path.join(SERVER_DIR, 'public', 'test-agents.json'));
const LOCAL_DESKTOP_MODE = String(process.env.LOCAL_DESKTOP_MODE || '').trim().toLowerCase() === 'true';
const FOLDER_VIEW_ENABLED = !LOCAL_DESKTOP_MODE
  && String(process.env.FOLDER_VIEW_ENABLED || '').trim().toLowerCase() === 'true';
const OFFICE_FLOORS = ['wood','wood2','carpet', 'concrete', 'tile', 'darkwood'];
const OFFICE_WINDOWS = ['sf', 'newyork', 'beach', 'tahoe'];
const OFFICE_POSTERS = Array.from({ length: 50 }, (_, index) => index);
const MANUAL_AGENT_STATES = ['Working', 'Success', 'Blocked', 'Sleeping', 'Reading', 'Gaming', 'Coffee break', 'Listening', 'Walking'];
const MANUAL_AGENT_STATE_LOOKUP = new Map(MANUAL_AGENT_STATES.map((state) => [agentKey(state), state]));
const MANUAL_AGENT_POSES = {
  Working: 'working',
  Success: 'success',
  Blocked: 'blocked',
  Sleeping: 'sleeping',
  Reading: 'reading',
  Gaming: 'gaming',
  'Coffee break': 'coffee',
  Listening: 'headphones',
  Walking: 'walking'
};
const DEFAULT_OFFICE_SCENE = { floor: 'wood', windowView: 'sf', poster: 0, emptyDesks: 0 };
const DEFAULT_MODULES = { folderView: { enabled: FOLDER_VIEW_ENABLED } };
const AGENT_ACTIVE_MS = Number(process.env.AGENT_ACTIVE_MS || 2 * 60 * 1000);
const AGENT_SUCCESS_MS = Number(process.env.AGENT_SUCCESS_MS || 2 * 60 * 1000);
const AGENT_IDLE_MS = Number(process.env.AGENT_IDLE_MS || 30 * 60 * 1000);
const RUNTIME_AGENT_TTL_MS = Number(process.env.RUNTIME_AGENT_TTL_MS || 90 * 1000);
const GATEWAY_AUTH_TOKEN_ENV = String(process.env.GATEWAY_AUTH_TOKEN || '').trim();
const GATEWAY_AUTH_PASSWORD_ENV = String(process.env.GATEWAY_AUTH_PASSWORD || '').trim();
const GATEWAY_AUTH_SECURE_COOKIE = String(process.env.GATEWAY_AUTH_SECURE_COOKIE || '').trim().toLowerCase() === 'true';
const AUTH_COOKIE_NAME = 'taskfolk_gateway_auth';
const PUBLIC_DIR = path.join(SERVER_DIR, 'public');
const AVATAR_VARIANTS_DIR = path.join(PUBLIC_DIR, 'avatar-scenes', 'variants');
const CUSTOM_AVATAR_VARIANTS_DIR = String(process.env.CUSTOM_AVATAR_VARIANTS_DIR || '').trim()
  ? path.resolve(process.env.CUSTOM_AVATAR_VARIANTS_DIR)
  : '';
const AVATAR_VARIANT_FALLBACK = 'v0';

function normalizeAvatarScreen(value, fieldName) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`avatar.json "${fieldName}" must be an object`);
  }
  const layout = {};
  for (const key of ['left', 'top', 'width', 'height']) {
    layout[key] = Number(value[key]);
    if (!Number.isFinite(layout[key]) || layout[key] < 0) {
      throw new Error(`avatar.json "${fieldName}.${key}" must be a non-negative number`);
    }
  }
  if (!layout.width || !layout.height) {
    throw new Error(`avatar.json "${fieldName}" must have positive width and height`);
  }
  return Object.freeze(layout);
}

async function discoverAvatarVariants() {
  const directories = new Map();
  const variants = new Map();
  const roots = [AVATAR_VARIANTS_DIR, ...(CUSTOM_AVATAR_VARIANTS_DIR ? [CUSTOM_AVATAR_VARIANTS_DIR] : [])];
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
      if (root === CUSTOM_AVATAR_VARIANTS_DIR && error?.code === 'ENOENT') return [];
      throw error;
    });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && entry.name !== '.' && entry.name !== '..')
      .map((entry) => {
        const numericMatch = entry.name.match(/^v(\d+)$/);
        return {
          id: entry.name,
          ...(numericMatch ? { version: Number(numericMatch[1]) } : {}),
          ...(root === CUSTOM_AVATAR_VARIANTS_DIR ? { custom: true } : {})
        };
      });
    for (const candidate of candidates) {
      const directory = path.join(root, candidate.id);
      try {
        const [metadataText, workingStat] = await Promise.all([
          fs.readFile(path.join(directory, 'avatar.json'), 'utf8'),
          fs.stat(path.join(directory, 'working.gif'))
        ]);
        const metadata = JSON.parse(metadataText);
        const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
        if (!name) throw new Error('avatar.json must contain a non-empty "name"');
        if (!workingStat.isFile()) throw new Error('working.gif is not a file');
        const workingScreen = normalizeAvatarScreen(metadata.workingScreen, 'workingScreen');
        const gaminScreen = normalizeAvatarScreen(metadata.gaminScreen, 'gaminScreen');
        variants.set(candidate.id, Object.freeze({
          ...candidate,
          name,
          ...(workingScreen ? { workingScreen } : {}),
          ...(gaminScreen ? { gaminScreen } : {})
        }));
        directories.set(candidate.id, directory);
      } catch (error) {
        console.warn(`Skipping avatar variant ${candidate.id} from ${directory}: ${error.message}`);
      }
    }
  }
  const registry = [...variants.values()].sort((left, right) => {
    const leftNumeric = Number.isInteger(left.version);
    const rightNumeric = Number.isInteger(right.version);
    if (leftNumeric && rightNumeric) return left.version - right.version;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  if (!registry.some((variant) => variant.id === AVATAR_VARIANT_FALLBACK)) {
    throw new Error(`Required fallback avatar ${AVATAR_VARIANT_FALLBACK} is missing or invalid`);
  }
  return { registry: Object.freeze(registry), directories };
}

const AVATAR_VARIANT_DISCOVERY = await discoverAvatarVariants();
const AVATAR_VARIANT_REGISTRY = AVATAR_VARIANT_DISCOVERY.registry;
const AVATAR_VARIANT_DIRECTORIES = AVATAR_VARIANT_DISCOVERY.directories;
const AVATAR_VARIANTS = Object.freeze(AVATAR_VARIANT_REGISTRY.map((variant) => variant.id));
const AVATAR_VARIANT_IDS = new Set(AVATAR_VARIANTS);
const PROTECTED_NAMES = new Set(
  String(process.env.PROTECTED_NAMES || '.git,.env')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
);

await fs.mkdir(SHARED_DIR, { recursive: true });

const DEFAULT_AGENTS = [
  { id: 'main', name: 'Main Agent', role: 'Coordinator', status: 'active', task: 'Watching heartbeat checks', x: 18, y: 58 },
  { id: 'builder', name: 'Builder', role: 'Implementation', status: 'idle', task: 'Ready for the next work item', x: 42, y: 34 },
  { id: 'reviewer', name: 'Reviewer', role: 'Quality gate', status: 'idle', task: 'Waiting for a branch to review', x: 66, y: 54 },
  { id: 'ops', name: 'Ops Monitor', role: 'Health checks', status: 'active', task: 'Checking production endpoints', x: 82, y: 30 }
];
const CONFIGURED_AGENT_IDLE_TASK = 'Configured in OpenClaw; no session activity yet';
const runtimeAgentSources = new Map();
let openClawGatewayCache = null;
let openClawGatewayRequest = null;
let openClawGatewayLastWarning = '';

function cleanRuntimeText(value, maxLength = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeRuntimeAgent(agent, provider, index, previousAgent = null) {
  const rawId = cleanRuntimeText(agent?.id, 160);
  if (!rawId) return null;
  const id = rawId.startsWith(`${provider}:`) ? rawId : `${provider}:${rawId}`;
  const nowMs = Date.now();
  const reportedLastSeenMs = timestampMs(agent?.lastSeen, agent?.activity?.updatedAt);
  const configuredWithoutActivity = provider === 'openclaw'
    && cleanRuntimeText(agent?.activity?.status, 80).toLowerCase() === 'configured'
    && !reportedLastSeenMs;
  const lastSeenMs = reportedLastSeenMs || (configuredWithoutActivity ? 0 : nowMs);
  const reportedStatus = ['active', 'success', 'idle', 'blocked'].includes(agent?.status) ? agent.status : 'idle';
  const completed = /\b(done|complete|completed|finished|success|succeeded)\b/i.test(String(agent?.activity?.status || ''));
  const previousSuccessAt = timestampMs(previousAgent?.activity?.successAt);
  const transitionedToIdle = previousAgent?.status === 'active' && reportedStatus === 'idle';
  const successAt = transitionedToIdle
    ? nowMs
    : previousSuccessAt || ((reportedStatus === 'success' || completed) ? lastSeenMs : 0);
  const successIsCurrent = successAt > 0 && nowMs - successAt <= AGENT_SUCCESS_MS;
  const status = ['active', 'blocked'].includes(reportedStatus)
    ? reportedStatus
    : successIsCurrent ? 'success' : 'idle';
  const activity = agent?.activity && typeof agent.activity === 'object' && !Array.isArray(agent.activity)
    ? {
        provider,
        status: cleanRuntimeText(agent.activity.status, 80) || null,
        derivedStatus: status,
        updatedAt: timestampMs(agent.activity.updatedAt) || lastSeenMs || null,
        successAt: successAt || null,
        sessionLabel: cleanRuntimeText(agent.activity.sessionLabel, 120) || null,
        sessionKeyShort: cleanRuntimeText(agent.activity.sessionKeyShort, 160) || null,
        model: cleanRuntimeText(agent.activity.model, 120) || null,
        agent: cleanRuntimeText(agent.activity.agent, 120) || null
      }
    : { provider, derivedStatus: status, updatedAt: lastSeenMs || null, successAt: successAt || null };
  return normalizeAgent({
    id,
    name: cleanRuntimeText(agent?.name, 120) || provider,
    role: cleanRuntimeText(agent?.role, 160) || provider,
    status,
    task: cleanRuntimeText(agent?.task) || `${provider} session`,
    lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
    source: provider,
    workspacePath: cleanRuntimeText(agent?.workspacePath, 1024) || null,
    activity,
    avatarAssignmentKey: cleanRuntimeText(agent?.avatarAssignmentKey, 160) || null,
    displayState: cleanRuntimeText(agent?.displayState, 40) || null,
    pose: cleanRuntimeText(agent?.pose, 40) || null
  }, index);
}

function runtimeAgentsSnapshot(nowMs = Date.now()) {
  const merged = new Map();
  for (const [sourceId, source] of runtimeAgentSources) {
    if (nowMs - source.updatedAtMs > RUNTIME_AGENT_TTL_MS) {
      runtimeAgentSources.delete(sourceId);
      continue;
    }
    for (const agent of source.agents) {
      const existing = merged.get(agent.id);
      if (!existing || timestampMs(agent.lastSeen) >= timestampMs(existing.lastSeen)) merged.set(agent.id, agent);
    }
  }
  return [...merged.values()];
}

function workspacePathFromValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const workspacePath = workspacePathFromValue(item);
      if (workspacePath) return workspacePath;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  return workspacePathFromValue(
    value.workspacePath ||
    value.workspace_path ||
    value.workspaceDir ||
    value.workspace_dir ||
    value.workspace ||
    value.cwd ||
    value.workingDirectory ||
    value.working_directory ||
    value.worktreePath ||
    value.worktree_path ||
    value.repoPath ||
    value.repo_path ||
    value.projectPath ||
    value.project_path ||
    value.path ||
    value.root
  );
}

function normalizeAgent(agent, index) {
  const status = ['active', 'success', 'idle', 'blocked'].includes(agent.status) ? agent.status : 'idle';
  return {
    id: String(agent.id || `agent-${index + 1}`),
    name: String(agent.name || agent.label || `Agent ${index + 1}`),
    role: String(agent.role || agent.model || agent.kind || 'OpenClaw agent'),
    status,
    task: String(agent.task || agent.message || 'No current task'),
    lastSeen: agent.lastSeen || null,
    source: agent.source || 'configured',
    logFile: agent.logFile || null,
    sessionFile: agent.sessionFile || null,
    sessions: Number.isFinite(Number(agent.sessions)) ? Number(agent.sessions) : null,
    workspacePath: workspacePathFromValue(agent),
    activity: agent.activity || null,
    avatarAssignmentKey: agent.avatarAssignmentKey || null,
    displayState: agent.displayState || null,
    pose: agent.pose || null,
    x: Number.isFinite(Number(agent.x)) ? Number(agent.x) : 20 + (index * 18) % 70,
    y: Number.isFinite(Number(agent.y)) ? Number(agent.y) : 30 + (index * 14) % 45
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return parseJsonWithComments(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    console.warn(`Unable to read OpenClaw config at ${filePath}: ${err.message}`);
    return null;
  }
}

function parseJsonWithComments(text) {
  return JSON.parse(stripJsonComments(text));
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index += 1;
      index -= 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      if (index < text.length) index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

async function gatewayAuthConfig() {
  const config = OPENCLAW_CONNECTION_MODE === 'files'
    ? await readJsonIfPresent(OPENCLAW_CONFIG_PATH)
    : null;
  const fileAuth = config?.gateway?.auth && typeof config.gateway.auth === 'object'
    ? config.gateway.auth
    : {};
  const token = GATEWAY_AUTH_TOKEN_ENV || String(fileAuth.token || '').trim();
  const password = GATEWAY_AUTH_PASSWORD_ENV || String(fileAuth.password || '').trim();
  return {
    enabled: Boolean(token),
    token,
    password,
    passwordRequired: Boolean(token && password)
  };
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authCookieValue(auth) {
  return crypto
    .createHash('sha256')
    .update(`${auth.token}\u0000${auth.password}`)
    .digest('base64url');
}

function readCookie(req, name) {
  const source = String(req.get('cookie') || '');
  for (const entry of source.split(';')) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function hasGatewaySession(req) {
  const auth = await gatewayAuthConfig();
  if (!auth.enabled) return { auth, authenticated: true };
  const cookie = readCookie(req, AUTH_COOKIE_NAME);
  return { auth, authenticated: timingSafeEqualText(cookie, authCookieValue(auth)) };
}

function setGatewaySessionCookie(res, auth) {
  res.cookie(AUTH_COOKIE_NAME, authCookieValue(auth), {
    httpOnly: true,
    sameSite: 'lax',
    secure: GATEWAY_AUTH_SECURE_COOKIE,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

async function requireGatewayAuth(req, res, next) {
  try {
    const { auth, authenticated } = await hasGatewaySession(req);
    if (!auth.enabled || authenticated) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Gateway login required' });
    return res.redirect(302, '/login.html');
  } catch (err) {
    next(err);
  }
}

function normalizeAvatarVariant(value) {
  const raw = String(value ?? '').trim();
  return AVATAR_VARIANT_IDS.has(raw) ? raw : AVATAR_VARIANT_FALLBACK;
}

function randomAvatarVariant() {
  return AVATAR_VARIANTS[crypto.randomInt(AVATAR_VARIANTS.length)];
}

function normalizeAvatarAssignments(value) {
  const source = value?.assignments && typeof value.assignments === 'object' ? value.assignments : value;
  const assignments = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return assignments;
  for (const [agentId, variant] of Object.entries(source)) {
    const id = String(agentId || '').trim();
    if (!id) continue;
    assignments[id] = normalizeAvatarVariant(variant);
  }
  return assignments;
}

function normalizeCustomAgentNames(value) {
  const source = value?.customNames && typeof value.customNames === 'object' ? value.customNames : value;
  const customNames = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return customNames;
  for (const [agentKeyValue, customName] of Object.entries(source)) {
    const key = String(agentKeyValue || '')
      .trim()
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 160);
    const name = String(customName || '')
      .trim()
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 80);
    if (key && name) customNames[key] = name;
  }
  return customNames;
}

function normalizeHiddenAgents(value) {
  const source = Array.isArray(value?.hiddenAgents) ? value.hiddenAgents : Array.isArray(value) ? value : [];
  return [...new Set(source.map((entry) => String(entry || '')
    .trim()
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[^a-zA-Z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160))
    .filter(Boolean))]
    .slice(0, 200);
}

function randomAgentToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeManualAgent(agent, index = 0, existing = null) {
  const id = String(agent?.id || existing?.id || `manual-${crypto.randomUUID()}`)
    .trim()
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 80);
  const fallbackName = `Agent ${index + 1}`;
  const name = String(agent?.name || agent?.label || existing?.name || fallbackName)
    .trim()
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 80) || fallbackName;
  const token = String(agent?.token || existing?.token || randomAgentToken())
    .trim()
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 160) || randomAgentToken();
  const enabled = typeof agent?.enabled === 'boolean'
    ? agent.enabled
    : typeof existing?.enabled === 'boolean' ? existing.enabled : true;
  return { id, name, token, enabled };
}

function normalizeManualAgents(value) {
  const source = Array.isArray(value?.manualAgents) ? value.manualAgents : Array.isArray(value?.agents) ? value.agents : [];
  const byId = new Map();
  source.forEach((agent, index) => {
    if (!agent || typeof agent !== 'object') return;
    const normalized = normalizeManualAgent(agent, index, byId.get(String(agent.id || '').trim()));
    if (!normalized.id) return;
    byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

function normalizeModules(value) {
  const source = value?.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)
    ? value.modules
    : {};
  const folderView = source.folderView && typeof source.folderView === 'object' && !Array.isArray(source.folderView)
    ? source.folderView
    : {};
  const hasFolderViewEnabled = Object.prototype.hasOwnProperty.call(folderView, 'enabled');
  return {
    folderView: {
      enabled: hasFolderViewEnabled ? folderView.enabled !== false : DEFAULT_MODULES.folderView.enabled
    }
  };
}

function normalizeOfficeScene(value) {
  const source = value?.officeScene && typeof value.officeScene === 'object' ? value.officeScene : value;
  const floor = OFFICE_FLOORS.includes(source?.floor) ? source.floor : DEFAULT_OFFICE_SCENE.floor;
  const windowView = OFFICE_WINDOWS.includes(source?.windowView) ? source.windowView : DEFAULT_OFFICE_SCENE.windowView;
  const poster = OFFICE_POSTERS.includes(Number(source?.poster)) ? Number(source.poster) : DEFAULT_OFFICE_SCENE.poster;
  const emptyDesks = Math.max(0, Math.min(24, Math.trunc(Number(source?.emptyDesks) || 0)));
  return { floor, windowView, poster, emptyDesks };
}

async function readAvatarConfig() {
  const data = await readJsonIfPresent(AVATAR_ASSIGNMENTS_PATH);
  const sceneSource = data?.officeScene && typeof data.officeScene === 'object' ? data.officeScene : data;
  const officeSceneKeys = sceneSource && typeof sceneSource === 'object' && !Array.isArray(sceneSource)
    ? ['floor', 'windowView', 'poster', 'emptyDesks'].filter((key) => Object.prototype.hasOwnProperty.call(sceneSource, key))
    : [];
  return {
    assignments: normalizeAvatarAssignments(data),
    customNames: normalizeCustomAgentNames(data?.customNames || {}),
    hiddenAgents: normalizeHiddenAgents(data),
    manualAgents: normalizeManualAgents(data),
    modules: normalizeModules(data),
    officeScene: normalizeOfficeScene(data),
    officeSceneKeys
  };
}

async function writeAvatarConfig(value) {
  const current = await readAvatarConfig();
  const existingById = new Map(current.manualAgents.map((agent) => [agent.id, agent]));
  const manualAgents = Array.isArray(value?.manualAgents)
    ? value.manualAgents
      .filter((agent) => agent && typeof agent === 'object')
      .map((agent, index) => normalizeManualAgent(agent, index, existingById.get(String(agent.id || '').trim())))
      .filter((agent, index, agents) => agents.findIndex((candidate) => candidate.id === agent.id) === index)
    : current.manualAgents;
  const normalized = {
    assignments: normalizeAvatarAssignments(value?.assignments || value),
    customNames: value?.customNames && typeof value.customNames === 'object' && !Array.isArray(value.customNames)
      ? normalizeCustomAgentNames(value.customNames)
      : current.customNames,
    hiddenAgents: Array.isArray(value?.hiddenAgents) ? normalizeHiddenAgents(value.hiddenAgents) : current.hiddenAgents,
    manualAgents,
    modules: value?.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)
      ? normalizeModules(value)
      : current.modules,
    officeScene: normalizeOfficeScene(value)
  };
  await fs.mkdir(path.dirname(AVATAR_ASSIGNMENTS_PATH), { recursive: true });
  await fs.writeFile(
    AVATAR_ASSIGNMENTS_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...normalized }, null, 2)}\n`,
    'utf8'
  );
  return normalized;
}

function configuredAgentsFromEnv() {
  const raw = process.env.OPENCLAW_AGENTS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeAgent) : [];
  } catch (err) {
    console.warn(`Unable to parse OPENCLAW_AGENTS_JSON: ${err.message}`);
    return [];
  }
}

function agentKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueAgentId(baseId, usedIds, index = 0) {
  const root = agentKey(baseId) || `agent-${index + 1}`;
  let candidate = root;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function looksLikeAgentContainer(key = '') {
  return /agents?|agentprofiles?|agentconfigs?|assistants?|sessions?/i.test(key);
}


function configDefaultWorkspace(config) {
  return workspacePathFromValue(config?.agents?.defaults) || workspacePathFromValue(config?.defaults);
}

function agentFromConfigEntry(entry, index, defaultWorkspacePath = null) {
  const name = entry.name || entry.label || entry.title || entry.displayName || entry.id || `Agent ${index + 1}`;
  const workspacePath = workspacePathFromValue(entry) || defaultWorkspacePath;
  return normalizeAgent({
    id: entry.id || entry.agentId || agentKey(name),
    name,
    role: entry.role || entry.model || entry.provider || entry.runtime || entry.tools?.profile || (workspacePath ? 'Workspace agent' : 'Configured agent'),
    status: 'idle',
    task: CONFIGURED_AGENT_IDLE_TASK,
    source: 'config',
    workspacePath,
    x: entry.x,
    y: entry.y
  }, index);
}

function agentsFromConfiguredList(config) {
  const list = config?.agents?.list;
  if (!Array.isArray(list)) return [];
  const defaultWorkspacePath = configDefaultWorkspace(config);
  const usedIds = new Set(
    list
      .map((entry) => entry && typeof entry === 'object' ? entry.id || entry.agentId : null)
      .filter(Boolean)
      .map(String)
  );
  return list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const agent = agentFromConfigEntry(entry, index, defaultWorkspacePath);
      agent.id = entry.id || entry.agentId ? String(agent.id) : uniqueAgentId(agent.id, usedIds, index);
      if (entry.id || entry.agentId) usedIds.add(String(agent.id));
      return agent;
    })
    .filter((agent, index, agents) => agents.findIndex((candidate) => candidate.id === agent.id) === index);
}

function collectConfigAgents(value, agents = [], seen = new WeakSet(), keyName = '', parentKey = '', defaultWorkspacePath = null) {
  if (!value || typeof value !== 'object') return agents;
  if (seen.has(value)) return agents;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemKey = looksLikeAgentContainer(keyName) ? `${keyName}-${index + 1}` : '';
      collectConfigAgents(item, agents, seen, itemKey, keyName, defaultWorkspacePath);
    });
    return agents;
  }

  const possibleName = value.name || value.label || value.title || value.displayName || value.id || value.agentId || keyName;
  const hasAgentShape = Boolean(possibleName) && (
    looksLikeAgentContainer(parentKey) ||
    value.agentId || value.agent || value.model || value.runtime || value.provider || value.channel ||
    value.kind === 'agent' || value.type === 'agent'
  );

  if (hasAgentShape) {
    const explicitId = value.id || value.agentId;
    const id = explicitId || uniqueAgentId(possibleName, new Set(agents.map((agent) => agent.id)), agents.length);
    if (!agents.some((agent) => agent.id === String(id))) {
      agents.push(normalizeAgent({
        id,
        name: possibleName,
        role: value.role || value.model || value.provider || value.runtime || value.type || 'Configured agent',
        status: 'idle',
        task: CONFIGURED_AGENT_IDLE_TASK,
        source: 'config',
        workspacePath: workspacePathFromValue(value) || defaultWorkspacePath
      }, agents.length));
    }
  }

  for (const [childKey, item] of Object.entries(value)) collectConfigAgents(item, agents, seen, childKey, keyName, defaultWorkspacePath);
  return agents;
}

async function readTail(filePath, maxBytes = 96 * 1024) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function safeLogLine(line) {
  return String(line || '')
    .replace(/(pat|token|secret|password|authorization)(["'\s:=]+)[^\s,"'}]+/ig, '$1$2[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/ig, 'Bearer [redacted]')
    .slice(0, 180);
}

function agentIdFromSessionKey(key = '') {
  const match = String(key).match(/(?:^|:)agent:([^:]+)/i);
  return match ? match[1] : null;
}

function agentIdFromSessionPath(filePath) {
  const relative = path.relative(OPENCLAW_SESSIONS_DIR, filePath).split(path.sep);
  const sessionsIndex = relative.lastIndexOf('sessions');
  if (sessionsIndex > 0) return relative[sessionsIndex - 1];
  if (relative.length === 1) return path.basename(relative[0], path.extname(relative[0]));
  return relative[0] || null;
}

function sessionEntriesFromStore(store) {
  if (!store || typeof store !== 'object') return [];
  if (Array.isArray(store)) {
    return store
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => [entry.key || entry.sessionKey || entry.id || String(index), entry]);
  }
  const candidates = Array.isArray(store.sessions)
    ? store.sessions.map((entry, index) => [entry.key || entry.sessionKey || entry.id || String(index), entry])
    : Object.entries(store.sessions && typeof store.sessions === 'object' ? store.sessions : store);
  return candidates.filter(([, entry]) => entry && typeof entry === 'object');
}

function timestampMs(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    if (value instanceof Date) {
      const parsed = value.getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      continue;
    }
    const parsed = typeof value === 'number' ? value : Date.parse(String(value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function nestedTimestampCandidates(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => nestedTimestampCandidates(item, seen));
  }

  const direct = [
    value.updatedAt,
    value.updated_at,
    value.lastUpdatedAt,
    value.lastUpdateAt,
    value.modifiedAt,
    value.lastModifiedAt,
    value.lastActivityAt,
    value.lastActiveAt,
    value.lastMessageAt,
    value.lastInteractionAt,
    value.lastHeartbeatSentAt,
    value.lastRunAt,
    value.lastUsedAt,
    value.lastSeen,
    value.completedAt,
    value.finishedAt,
    value.endedAt,
    value.timestamp,
    value.time,
    value.createdAt
  ];

  const nested = ['lastMessage', 'latestMessage', 'lastRun', 'currentRun', 'activity', 'lastActivity', 'metadata']
    .flatMap((key) => nestedTimestampCandidates(value[key], seen));
  return [...direct, ...nested];
}

function nestedTimestampSources(value, prefix = '', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => nestedTimestampSources(item, `${prefix}[${index}]`, seen));
  }

  const timestampKeys = [
    'updatedAt',
    'updated_at',
    'lastUpdatedAt',
    'lastUpdateAt',
    'modifiedAt',
    'lastModifiedAt',
    'lastActivityAt',
    'lastActiveAt',
    'lastMessageAt',
    'lastInteractionAt',
    'lastHeartbeatSentAt',
    'lastRunAt',
    'lastUsedAt',
    'lastSeen',
    'completedAt',
    'finishedAt',
    'endedAt',
    'timestamp',
    'time',
    'createdAt'
  ];
  const direct = timestampKeys
    .map((key) => ({ source: prefix ? `${prefix}.${key}` : key, ms: timestampMs(value[key]) }))
    .filter((candidate) => candidate.ms);
  const nested = ['lastMessage', 'latestMessage', 'lastRun', 'currentRun', 'activity', 'lastActivity', 'metadata']
    .flatMap((key) => nestedTimestampSources(value[key], prefix ? `${prefix}.${key}` : key, seen));
  return [...direct, ...nested];
}

function sessionTimestampInfo(entry, fallbackMs) {
  const best = nestedTimestampSources(entry).sort((a, b) => b.ms - a.ms)[0];
  if (best) return { ms: best.ms, source: best.source, usedFileMtime: false };
  return { ms: timestampMs(fallbackMs), source: 'file mtime', usedFileMtime: true };
}

function statusFromSessionEntry(entry, lastSeenMs) {
  const rawStatus = String(entry.status || entry.state || '').trim().toLowerCase();
  if (entry.abortedLastRun || /\b(error|failed|failure|exception|blocked|fatal|aborted|cancelled|canceled)\b/i.test(rawStatus)) {
    return 'blocked';
  }
  if (/\b(active|running|working|busy|streaming|processing|in[-_ ]?progress|started)\b/i.test(rawStatus)) {
    return 'active';
  }
  const completed = Boolean(entry.endedAt) || /\b(done|complete|completed|finished|idle|success|succeeded)\b/i.test(rawStatus);
  if (completed) {
    return Date.now() - (lastSeenMs || 0) <= AGENT_SUCCESS_MS ? 'success' : 'idle';
  }
  if (entry.startedAt && !entry.endedAt && !/\b(done|complete|completed|idle|finished|success|succeeded)\b/i.test(rawStatus)) {
    return 'active';
  }
  return statusFromActivity(lastSeenMs || 0, rawStatus);
}

function sessionLabel(key, entry) {
  if (entry.displayName || entry.subject || entry.room || entry.space || entry.provider || entry.chatType) {
    return entry.displayName || entry.subject || entry.room || entry.space || entry.provider || entry.chatType;
  }
  const parts = String(key || '').split(':').filter(Boolean);
  return parts.length > 2 ? parts[2] : key;
}

function sessionTask(key, entry) {
  const label = sessionLabel(key, entry);
  const rawStatus = entry.status ? ` · ${entry.status}` : '';
  const model = entry.model || entry.modelOverride || entry.modelProvider || entry.providerOverride || entry.provider;
  return safeLogLine(`Session ${label}${rawStatus}${model ? ` on ${model}` : ''}`);
}

function sessionKeyParts(key = '') {
  return String(key || '').split(':').filter(Boolean);
}

function sessionChannelType(key = '', entry = {}) {
  const parts = sessionKeyParts(key);
  return entry.chatType || parts[2] || entry.origin?.chatType || null;
}

function sessionShortKey(key = '') {
  const parts = sessionKeyParts(key);
  return parts[0] === 'agent' && parts.length > 2 ? parts.slice(2).join(':') : String(key || '');
}

function sessionChannelBadge(key = '', entry = {}) {
  const shortKey = sessionShortKey(key).toLowerCase();
  if (shortKey.includes('heartbeat')) return 'heartbeat';
  if (shortKey.startsWith('discord:')) return 'discord';
  if (shortKey.startsWith('cron:')) return 'cron';
  if (shortKey.startsWith('main')) return 'main';
  if (shortKey.startsWith('dreaming-')) return 'dreaming';
  return sessionChannelType(key, entry) || 'session';
}

function cronJobIdFromSessionKey(key = '') {
  const match = String(key || '').match(/(?:^|:)cron:([^:]+)/i);
  return match ? match[1] : null;
}

function cronSessionLabel(key = '', cronJobs = new Map()) {
  const jobId = cronJobIdFromSessionKey(key);
  if (!jobId) return null;
  const job = cronJobs.get(jobId);
  return {
    id: jobId,
    name: job?.name || jobId,
    label: job?.name ? `cron:${job.name}` : `cron:${jobId}`
  };
}

function safeSessionActivity(key, entry, status, lastSeenMs, timestampInfo = {}, cronJobs = new Map()) {
  const cron = cronSessionLabel(key, cronJobs);
  const skills = [
    ...(entry.skillsSnapshot?.skills || []),
    ...(entry.skillsSnapshot?.resolvedSkills || [])
  ]
    .map((skill) => skill?.name)
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index)
    .slice(0, 4);
  const startedAt = timestampMs(entry.startedAt, entry.sessionStartedAt);
  const endedAt = timestampMs(entry.endedAt);
  const runtimeMs = Number.isFinite(Number(entry.runtimeMs))
    ? Number(entry.runtimeMs)
    : startedAt && endedAt ? endedAt - startedAt : null;
  return {
    sessionKey: String(key || ''),
    sessionKeyShort: sessionShortKey(key),
    status: entry.status || null,
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    runtimeMs,
    lastInteractionAt: timestampMs(entry.lastInteractionAt, entry.lastHeartbeatSentAt) || null,
    updatedAt: lastSeenMs || null,
    successAt: (entry.endedAt || /\b(done|complete|completed|finished|idle|success|succeeded)\b/i.test(String(entry.status || '')))
      ? lastSeenMs || null
      : null,
    chatType: sessionChannelType(key, entry),
    channelType: sessionKeyParts(key)[3] || null,
    channelBadge: sessionChannelBadge(key, entry),
    cronJobId: cron?.id || null,
    cronJobName: cron?.name || null,
    model: entry.model || entry.modelOverride || null,
    modelProvider: entry.modelProvider || entry.providerOverride || entry.provider || null,
    totalTokens: Number.isFinite(Number(entry.totalTokens)) ? Number(entry.totalTokens) : null,
    inputTokens: Number.isFinite(Number(entry.inputTokens)) ? Number(entry.inputTokens) : null,
    outputTokens: Number.isFinite(Number(entry.outputTokens)) ? Number(entry.outputTokens) : null,
    estimatedCostUsd: Number.isFinite(Number(entry.estimatedCostUsd)) ? Number(entry.estimatedCostUsd) : null,
    skills,
    sandboxed: Boolean(entry.systemPromptReport?.sandbox?.sandboxed),
    sandboxMode: entry.systemPromptReport?.sandbox?.mode || null,
    abortedLastRun: Boolean(entry.abortedLastRun),
    agentHarnessId: entry.agentHarnessId || null,
    sessionLabel: cron?.label || sessionLabel(key, entry),
    derivedStatus: status,
    timestampSource: timestampInfo.source || null,
    timestampUsedFileMtime: Boolean(timestampInfo.usedFileMtime)
  };
}

async function listSessionStoreFiles(rootDir) {
  const files = [];
  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(abs, depth + 1);
      if (!entry.isFile()) return;
      const parent = path.basename(path.dirname(abs));
      if (entry.name !== 'sessions.json' || parent !== 'sessions') return;
      try {
        const stat = await fs.stat(abs);
        files.push({ abs, stat });
      } catch {}
    }));
  }
  await walk(rootDir);
  return files;
}

function cronJobsFromStore(store) {
  if (!store || typeof store !== 'object') return [];
  if (Array.isArray(store)) return store.filter((job) => job && typeof job === 'object');
  if (Array.isArray(store.jobs)) return store.jobs.filter((job) => job && typeof job === 'object');
  const source = store.jobs && typeof store.jobs === 'object' ? store.jobs : store;
  return Object.entries(source)
    .filter(([, job]) => job && typeof job === 'object')
    .map(([id, job]) => ({ id, ...job }));
}

function parseMaybeJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function firstPresent(source, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name) && source[name] !== null && source[name] !== undefined && source[name] !== '') {
      return source[name];
    }
  }
  return null;
}

function boolFromDb(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function withoutNullishFields(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function runSqliteJson(dbPath, sql, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const child = spawn('sqlite3', ['-json', dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`sqlite3 timed out reading ${dbPath}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `sqlite3 exited with ${code}`));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (err) {
        reject(new Error(`Unable to parse sqlite3 JSON output: ${err.message}`));
      }
    });
  });
}

async function sqliteTableExists(dbPath, tableName) {
  const safeName = String(tableName || '').replace(/'/g, "''");
  const rows = await runSqliteJson(dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name='${safeName}' LIMIT 1;`);
  return rows.length > 0;
}

function sqliteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function readCronJobsFromDb(dbPath = OPENCLAW_STATE_DB_PATH) {
  try {
    await fs.stat(dbPath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    throw err;
  }
  if (!(await sqliteTableExists(dbPath, 'cron_jobs'))) return null;
  const columns = await runSqliteJson(dbPath, 'PRAGMA table_info(cron_jobs);');
  const columnNames = columns.map((column) => column.name).filter(Boolean);
  if (!columnNames.length) return null;
  const orderColumn = columnNames.find((name) => ['last_run_at_ms', 'lastRunAtMs', 'next_run_at_ms', 'nextRunAtMs', 'created_at_ms', 'createdAtMs', 'updated_at_ms', 'updatedAtMs'].includes(name));
  const orderSql = orderColumn ? ` ORDER BY ${sqliteIdent(orderColumn)} DESC` : '';
  const rows = await runSqliteJson(dbPath, `SELECT * FROM cron_jobs${orderSql};`);
  return rows
    .map((row) => normalizeCronJobFromDbRow(row))
    .filter((job) => job.id)
    .sort((a, b) => Math.max(b.lastRunAtMs || 0, b.nextRunAtMs || 0, b.createdAtMs || 0, b.updatedAtMs || 0) - Math.max(a.lastRunAtMs || 0, a.nextRunAtMs || 0, a.createdAtMs || 0, a.updatedAtMs || 0));
}

async function cronJobRunsFromDb(jobId, limit = 24, dbPath = OPENCLAW_STATE_DB_PATH) {
  try {
    await fs.stat(dbPath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    throw err;
  }
  if (await sqliteTableExists(dbPath, 'cron_run_logs')) {
    const safeId = String(jobId).replace(/'/g, "''");
    const rowLimit = Math.max(1, Math.min(Number(limit) || 24, 100));
    const rows = await runSqliteJson(dbPath, `SELECT * FROM cron_run_logs WHERE job_id='${safeId}' ORDER BY ts DESC, seq DESC LIMIT ${rowLimit};`);
    return {
      jobId,
      file: null,
      dbPath,
      table: 'cron_run_logs',
      mtimeMs: null,
      runs: rows.map((run) => normalizeCronRunFromDbRow(run, jobId))
    };
  }
  const tableRows = await runSqliteJson(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cron_job_runs', 'cron_runs', 'cron_run_history');");
  const tableName = tableRows.map((row) => row.name).find(Boolean);
  if (!tableName) return null;
  const columns = await runSqliteJson(dbPath, `PRAGMA table_info(${sqliteIdent(tableName)});`);
  const columnNames = columns.map((column) => column.name).filter(Boolean);
  const jobIdColumn = columnNames.find((name) => ['job_id', 'jobId', 'cron_job_id', 'cronJobId'].includes(name));
  if (!jobIdColumn) return null;
  const orderColumn = columnNames.find((name) => ['ts', 'timestamp', 'run_at_ms', 'runAtMs', 'run_at', 'created_at_ms', 'createdAtMs', 'created_at'].includes(name));
  const safeId = String(jobId).replace(/'/g, "''");
  const rowLimit = Math.max(1, Math.min(Number(limit) || 24, 100));
  const orderSql = orderColumn ? ` ORDER BY ${sqliteIdent(orderColumn)} DESC` : '';
  const rows = await runSqliteJson(dbPath, `SELECT * FROM ${sqliteIdent(tableName)} WHERE ${sqliteIdent(jobIdColumn)}='${safeId}'${orderSql} LIMIT ${rowLimit};`);
  const runs = rows.map((run) => normalizeCronRunFromDbRow(run, jobId));
  return {
    jobId,
    file: null,
    dbPath,
    table: tableName,
    mtimeMs: null,
    runs
  };
}

function normalizeCronRunFromDbRow(row = {}, jobId = '') {
  const entry = parseMaybeJson(firstPresent(row, ['entry_json', 'entryJson', 'entry']), {});
  const diagnostics = parseMaybeJson(firstPresent(row, ['diagnostics', 'diagnostics_json']), null) || (entry.diagnostics && typeof entry.diagnostics === 'object' ? entry.diagnostics : null);
  const usage = parseMaybeJson(firstPresent(row, ['usage', 'usage_json']), null) || (entry.usage && typeof entry.usage === 'object' ? entry.usage : null);
  const totalTokens = Number(firstPresent(row, ['total_tokens', 'totalTokens']));
  const normalizedUsage = usage || (Number.isFinite(totalTokens) ? { total_tokens: totalTokens } : null);
  const ts = timestampMs(firstPresent(row, ['ts', 'timestamp', 'createdAtMs', 'created_at_ms', 'created_at']) ?? entry.ts);
  const runAtMs = timestampMs(firstPresent(row, ['runAtMs', 'run_at_ms', 'run_at']) ?? entry.runAtMs) || ts;
  const deliveredValue = firstPresent(row, ['delivered']);
  return {
    ts: ts || runAtMs || null,
    jobId: firstPresent(row, ['jobId', 'job_id', 'cronJobId', 'cron_job_id']) || entry.jobId || jobId,
    action: firstPresent(row, ['action', 'event']) || entry.action || 'finished',
    status: firstPresent(row, ['status', 'last_status']) || entry.status || null,
    summary: firstPresent(row, ['summary', 'message']) || entry.summary || null,
    error: firstPresent(row, ['error', 'last_error']) || entry.error || null,
    delivered: deliveredValue !== null ? boolFromDb(deliveredValue, null) : (typeof entry.delivered === 'boolean' ? entry.delivered : null),
    deliveryStatus: firstPresent(row, ['deliveryStatus', 'delivery_status']) || entry.deliveryStatus || null,
    deliveryError: firstPresent(row, ['deliveryError', 'delivery_error']) || entry.deliveryError || null,
    sessionId: firstPresent(row, ['sessionId', 'session_id']) || entry.sessionId || null,
    sessionKey: firstPresent(row, ['sessionKey', 'session_key']) || entry.sessionKey || null,
    runId: firstPresent(row, ['runId', 'run_id']) || entry.runId || null,
    runAtMs,
    durationMs: Number.isFinite(Number(firstPresent(row, ['durationMs', 'duration_ms']) ?? entry.durationMs)) ? Number(firstPresent(row, ['durationMs', 'duration_ms']) ?? entry.durationMs) : null,
    nextRunAtMs: timestampMs(firstPresent(row, ['nextRunAtMs', 'next_run_at_ms', 'next_run_at']) ?? entry.nextRunAtMs) || null,
    model: firstPresent(row, ['model']) || entry.model || null,
    provider: firstPresent(row, ['provider']) || entry.provider || null,
    usage: normalizedUsage,
    diagnostics
  };
}

function normalizeCronJobFromDbRow(row = {}) {
  const definition = parseMaybeJson(firstPresent(row, ['job', 'job_json', 'definition', 'definition_json', 'data', 'data_json', 'config', 'config_json']), {});
  const state = {
    ...parseMaybeJson(firstPresent(row, ['state', 'state_json', 'runtime_state', 'runtime_state_json']), {}),
    ...withoutNullishFields({
      nextRunAtMs: firstPresent(row, ['nextRunAtMs', 'next_run_at_ms', 'next_run_at', 'next_run']),
      lastRunAtMs: firstPresent(row, ['lastRunAtMs', 'last_run_at_ms', 'last_run_at', 'last_run']),
      lastRunStatus: firstPresent(row, ['lastRunStatus', 'last_run_status', 'last_status', 'status']),
      lastDurationMs: firstPresent(row, ['lastDurationMs', 'last_duration_ms', 'duration_ms']),
      lastDeliveryStatus: firstPresent(row, ['lastDeliveryStatus', 'last_delivery_status', 'delivery_status']),
      consecutiveErrors: firstPresent(row, ['consecutiveErrors', 'consecutive_errors']),
      consecutiveSkipped: firstPresent(row, ['consecutiveSkipped', 'consecutive_skipped']),
      lastError: firstPresent(row, ['lastError', 'last_error', 'error']),
      lastDiagnosticSummary: firstPresent(row, ['lastDiagnosticSummary', 'last_diagnostic_summary', 'diagnostic_summary'])
    })
  };
  const schedule = {
    ...parseMaybeJson(firstPresent(row, ['schedule', 'schedule_json']), {}),
    ...withoutNullishFields({
      kind: firstPresent(row, ['scheduleKind', 'schedule_kind', 'kind']),
      expr: firstPresent(row, ['scheduleExpr', 'schedule_expr', 'cron_expr', 'cronExpression', 'cron_expression', 'expr', 'expression']),
      tz: firstPresent(row, ['scheduleTz', 'schedule_tz', 'timezone', 'tz'])
    })
  };
  const payload = {
    ...parseMaybeJson(firstPresent(row, ['payload', 'payload_json']), {}),
    ...withoutNullishFields({
      kind: firstPresent(row, ['payloadKind', 'payload_kind']),
      message: firstPresent(row, ['payloadMessage', 'payload_message', 'message'])
    })
  };
  const delivery = {
    ...parseMaybeJson(firstPresent(row, ['delivery', 'delivery_json']), {}),
    ...withoutNullishFields({
      mode: firstPresent(row, ['deliveryMode', 'delivery_mode']),
      channel: firstPresent(row, ['deliveryChannel', 'delivery_channel', 'channel']),
      to: firstPresent(row, ['deliveryTo', 'delivery_to', 'to'])
    })
  };
  return normalizeCronJob({
    ...definition,
    id: firstPresent(row, ['id', 'job_id', 'cron_job_id']) || definition.id,
    agentId: firstPresent(row, ['agentId', 'agent_id']) || definition.agentId,
    name: firstPresent(row, ['name', 'label', 'title']) || definition.name,
    enabled: boolFromDb(firstPresent(row, ['enabled', 'is_enabled']), definition.enabled !== false),
    deleteAfterRun: boolFromDb(firstPresent(row, ['deleteAfterRun', 'delete_after_run']), Boolean(definition.deleteAfterRun)),
    createdAtMs: firstPresent(row, ['createdAtMs', 'created_at_ms', 'created_at']) || definition.createdAtMs,
    schedule,
    sessionTarget: firstPresent(row, ['sessionTarget', 'session_target']) || definition.sessionTarget,
    wakeMode: firstPresent(row, ['wakeMode', 'wake_mode']) || definition.wakeMode,
    payload,
    delivery
  }, {
    updatedAtMs: firstPresent(row, ['updatedAtMs', 'updated_at_ms', 'updated_at']),
    state
  });
}

function safeCronJobId(id = '') {
  const value = String(id || '').trim();
  return /^[a-zA-Z0-9._-]+$/.test(value) ? value : '';
}

function normalizeCronJob(job, stateRecord = {}) {
  const storedState = stateRecord?.state && typeof stateRecord.state === 'object' ? stateRecord.state : {};
  const state = {
    ...storedState,
    nextRunAtMs: job.nextRunAtMs ?? storedState.nextRunAtMs,
    lastRunAtMs: job.lastRunAtMs ?? storedState.lastRunAtMs,
    lastRunStatus: job.lastRunStatus ?? storedState.lastRunStatus,
    lastDurationMs: job.lastDurationMs ?? storedState.lastDurationMs,
    lastDeliveryStatus: job.lastDeliveryStatus ?? storedState.lastDeliveryStatus,
    consecutiveErrors: job.consecutiveErrors ?? storedState.consecutiveErrors,
    consecutiveSkipped: job.consecutiveSkipped ?? storedState.consecutiveSkipped,
    lastError: job.lastRunError ?? job.lastError ?? storedState.lastError,
    lastDiagnosticSummary: job.lastDiagnosticSummary ?? storedState.lastDiagnosticSummary
  };
  const schedule = job.schedule && typeof job.schedule === 'object' ? job.schedule : {};
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const delivery = job.delivery && typeof job.delivery === 'object' ? job.delivery : {};
  return {
    id: String(job.id || ''),
    agentId: job.agentId || null,
    name: String(job.name || job.id || 'Cron job'),
    enabled: job.enabled !== false,
    deleteAfterRun: Boolean(job.deleteAfterRun),
    createdAtMs: timestampMs(job.createdAtMs) || null,
    schedule,
    scheduleLabel: schedule.kind === 'cron'
      ? `${schedule.expr || 'cron'}${schedule.tz ? ` ${schedule.tz}` : ''}`
      : (schedule.kind || 'schedule'),
    sessionTarget: job.sessionTarget || null,
    wakeMode: job.wakeMode || null,
    payloadKind: payload.kind || null,
    payloadMessage: payload.message || null,
    deliveryMode: delivery.mode || null,
    deliveryChannel: delivery.channel || null,
    deliveryTo: delivery.to || null,
    updatedAtMs: timestampMs(stateRecord?.updatedAtMs) || null,
    nextRunAtMs: timestampMs(state.nextRunAtMs) || null,
    lastRunAtMs: timestampMs(state.lastRunAtMs) || null,
    lastRunStatus: state.lastRunStatus || state.lastStatus || null,
    lastDurationMs: Number.isFinite(Number(state.lastDurationMs)) ? Number(state.lastDurationMs) : null,
    lastDeliveryStatus: state.lastDeliveryStatus || null,
    consecutiveErrors: Number.isFinite(Number(state.consecutiveErrors)) ? Number(state.consecutiveErrors) : 0,
    consecutiveSkipped: Number.isFinite(Number(state.consecutiveSkipped)) ? Number(state.consecutiveSkipped) : 0,
    lastError: state.lastError || null,
    lastDiagnosticSummary: state.lastDiagnosticSummary || state.lastDiagnostics?.summary || null
  };
}

async function cronJobsSnapshot() {
  if (OPENCLAW_CONNECTION_MODE === 'none') {
    return { source: 'disabled', cronDir: null, dbPath: null, jobs: [], byId: new Map() };
  }
  if (OPENCLAW_CONNECTION_MODE === 'gateway') {
    let snapshot;
    try {
      snapshot = await configuredAgentsFromGateway();
    } catch {
      snapshot = openClawGatewayCache?.value;
    }
    return snapshot?.gatewayCron || {
      source: 'gateway-unavailable',
      cronDir: null,
      dbPath: null,
      jobs: [],
      byId: new Map()
    };
  }
  const dbJobs = await readCronJobsFromDb();
  if (dbJobs) {
    return {
      cronDir: OPENCLAW_CRON_DIR,
      dbPath: OPENCLAW_STATE_DB_PATH,
      jobs: dbJobs,
      byId: new Map(dbJobs.map((job) => [job.id, job]))
    };
  }
  const jobsPath = path.join(OPENCLAW_CRON_DIR, 'jobs.json');
  const statePath = path.join(OPENCLAW_CRON_DIR, 'jobs-state.json');
  const jobsStore = await readJsonIfPresent(jobsPath);
  const stateStore = await readJsonIfPresent(statePath) || {};
  const jobs = cronJobsFromStore(jobsStore)
    .filter((job) => job.id)
    .map((job) => normalizeCronJob(job, stateStore[job.id] || {}))
    .sort((a, b) => Math.max(b.lastRunAtMs || 0, b.nextRunAtMs || 0, b.createdAtMs || 0) - Math.max(a.lastRunAtMs || 0, a.nextRunAtMs || 0, a.createdAtMs || 0));
  return {
    cronDir: OPENCLAW_CRON_DIR,
    jobsPath,
    statePath,
    jobs,
    byId: new Map(jobs.map((job) => [job.id, job]))
  };
}

async function cronJobRuns(jobId, limit = 24) {
  const safeId = safeCronJobId(jobId);
  if (!safeId) {
    const error = new Error('Invalid cron job id');
    error.status = 400;
    throw error;
  }
  if (OPENCLAW_CONNECTION_MODE === 'none') {
    const error = new Error('OpenClaw integration is disabled');
    error.status = 404;
    throw error;
  }
  if (OPENCLAW_CONNECTION_MODE === 'gateway') {
    const payload = await fetchOpenClawCronRuns({
      id: safeId,
      limit,
      baseUrl: OPENCLAW_GATEWAY_URL,
      token: OPENCLAW_GATEWAY_TOKEN,
      password: OPENCLAW_GATEWAY_PASSWORD,
      timeoutMs: OPENCLAW_GATEWAY_TIMEOUT_MS
    });
    return {
      ...payload,
      source: 'gateway',
      runs: payload.runs.map((run) => normalizeCronRunFromDbRow(run, safeId))
    };
  }
  const dbRuns = await cronJobRunsFromDb(safeId, limit);
  if (dbRuns) return dbRuns;
  const filePath = path.join(OPENCLAW_CRON_DIR, 'runs', `${safeId}.jsonl`);
  let stat = null;
  let text = '';
  try {
    stat = await fs.stat(filePath);
    text = await readTail(filePath, 256 * 1024);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
  const runs = lines
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((run) => run && typeof run === 'object')
    .map((run) => ({
      ts: timestampMs(run.ts) || null,
      jobId: run.jobId || safeId,
      action: run.action || null,
      status: run.status || null,
      summary: run.summary || run.error || null,
      error: run.error || null,
      delivered: typeof run.delivered === 'boolean' ? run.delivered : null,
      deliveryStatus: run.deliveryStatus || null,
      sessionId: run.sessionId || null,
      sessionKey: run.sessionKey || null,
      runAtMs: timestampMs(run.runAtMs) || timestampMs(run.ts) || null,
      durationMs: Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : null,
      nextRunAtMs: timestampMs(run.nextRunAtMs) || null,
      model: run.model || null,
      provider: run.provider || null,
      usage: run.usage && typeof run.usage === 'object' ? run.usage : null,
      diagnostics: run.diagnostics && typeof run.diagnostics === 'object' ? run.diagnostics : null
    }))
    .sort((a, b) => (b.ts || b.runAtMs || 0) - (a.ts || a.runAtMs || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 24, 100)));
  return {
    jobId: safeId,
    file: path.relative(OPENCLAW_CRON_DIR, filePath),
    mtimeMs: stat ? stat.mtimeMs : null,
    runs
  };
}

async function sessionAgents() {
  const cron = await cronJobsSnapshot();
  const files = await listSessionStoreFiles(OPENCLAW_SESSIONS_DIR);
  const byId = new Map();
  const debug = [];
  const latestSessions = [];
  const groupedCounts = {};
  const weeklySinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyCost = {
    sinceMs: weeklySinceMs,
    estimatedCostUsd: 0,
    sessionCount: 0,
    totalTokens: 0
  };

  for (const { abs, stat } of files) {
    const store = await readJsonIfPresent(abs);
    if (!store) {
      debug.push({
        file: path.relative(OPENCLAW_SESSIONS_DIR, abs),
        mtimeMs: stat.mtimeMs,
        mtime: new Date(stat.mtimeMs).toISOString(),
        entryCount: 0,
        latestEntryMs: 0,
        latestEntry: null,
        latestMs: stat.mtimeMs,
        latest: new Date(stat.mtimeMs).toISOString(),
        mtimeNewerThanLatestEntry: false,
        empty: true
      });
      continue;
    }
    const pathAgentId = agentIdFromSessionPath(abs);
    let fileLatestMs = 0;
    let entryCount = 0;

    const entries = sessionEntriesFromStore(store);
    for (const [key, entry] of entries) {
      const id = String(entry.agentId || entry.agent_id || agentIdFromSessionKey(key) || pathAgentId || '').trim();
      if (!id) continue;
      const timestampInfo = sessionTimestampInfo(entry, stat.mtimeMs);
      const ts = timestampInfo.ms;
      const badge = sessionChannelBadge(key, entry);
      const cronSession = cronSessionLabel(key, cron.byId);
      groupedCounts[badge] = (groupedCounts[badge] || 0) + 1;
      if (ts >= weeklySinceMs) {
        weeklyCost.estimatedCostUsd += Number.isFinite(Number(entry.estimatedCostUsd)) ? Number(entry.estimatedCostUsd) : 0;
        weeklyCost.totalTokens += Number.isFinite(Number(entry.totalTokens)) ? Number(entry.totalTokens) : 0;
        weeklyCost.sessionCount += 1;
      }
      fileLatestMs = Math.max(fileLatestMs, ts);
      entryCount += 1;
      latestSessions.push({
        agentId: id,
        key: String(key || ''),
        shortKey: sessionShortKey(key),
        displayKey: cronSession?.label || sessionShortKey(key),
        cronJobId: cronSession?.id || null,
        cronJobName: cronSession?.name || null,
        channelBadge: badge,
        model: entry.model || entry.modelOverride || entry.modelProvider || entry.providerOverride || entry.provider || null,
        status: entry.status || null,
        derivedStatus: statusFromSessionEntry(entry, ts),
        timestampMs: ts,
        timestamp: ts ? new Date(ts).toISOString() : null,
        timestampSource: timestampInfo.source,
        timestampUsedFileMtime: timestampInfo.usedFileMtime,
        file: path.relative(OPENCLAW_SESSIONS_DIR, abs)
      });
      const existing = byId.get(id) || {
        id,
        name: id,
        role: entry.modelOverride || entry.model || entry.providerOverride || entry.provider || 'OpenClaw agent',
        task: 'No recent session activity',
        lastSeenMs: 0,
        source: 'sessions',
        sessionFile: path.relative(OPENCLAW_SESSIONS_DIR, abs),
        workspacePath: workspacePathFromValue(entry),
        sessions: 0
      };

      existing.sessions += 1;
      if (ts >= existing.lastSeenMs) {
        const model = entry.model || entry.modelOverride || entry.modelProvider || entry.providerOverride || entry.provider;
        existing.task = cronSession ? `Cron ${cronSession.name}${entry.status ? ` · ${entry.status}` : ''}` : sessionTask(key, entry);
        existing.lastSeenMs = ts;
        existing.lastSeen = new Date(ts).toISOString();
        existing.sessionFile = path.relative(OPENCLAW_SESSIONS_DIR, abs);
        existing.role = model || existing.role;
        existing.status = statusFromSessionEntry(entry, ts);
        existing.workspacePath = workspacePathFromValue(entry) || existing.workspacePath;
        existing.activity = safeSessionActivity(key, entry, existing.status, ts, timestampInfo, cron.byId);
      }
      byId.set(id, existing);
    }

    debug.push({
      file: path.relative(OPENCLAW_SESSIONS_DIR, abs),
      mtimeMs: stat.mtimeMs,
      mtime: new Date(stat.mtimeMs).toISOString(),
      entryCount,
      latestEntryMs: fileLatestMs || 0,
      latestEntry: fileLatestMs ? new Date(fileLatestMs).toISOString() : null,
      latestMs: fileLatestMs || stat.mtimeMs,
      latest: new Date(fileLatestMs || stat.mtimeMs).toISOString(),
      mtimeNewerThanLatestEntry: Boolean(fileLatestMs && stat.mtimeMs > fileLatestMs),
      empty: entries.length === 0
    });
  }

  return {
    agents: [...byId.values()]
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
    .slice(0, 24)
    .map((agent, index) => normalizeAgent({
      ...agent,
      status: agent.status
    }, index)),
    debug: debug.sort((a, b) => b.latestMs - a.latestMs),
    latestSessions: latestSessions.sort((a, b) => b.timestampMs - a.timestampMs).slice(0, 12),
    groupedCounts,
    storeCount: files.length,
    emptyStoreCount: debug.filter((item) => item.empty).length,
    weeklyCost: {
      ...weeklyCost,
      since: new Date(weeklySinceMs).toISOString()
    }
  };
}

function keyParts(value) {
  return agentKey(value).split('-').filter(Boolean);
}

function agentKeyMatches(candidate, configKey) {
  if (!candidate || !configKey) return false;
  if (candidate === configKey) return true;
  return keyParts(candidate).includes(configKey);
}

function findMatchingConfigAgent(logAgent, configAgents) {
  const candidates = [logAgent.id, logAgent.name, logAgent.label, logAgent.logFile]
    .filter(Boolean)
    .map(agentKey);
  return configAgents.find((agent) => {
    const configCandidates = [agent.id, agent.name].filter(Boolean).map(agentKey);
    return candidates.some((candidate) => configCandidates.some((configKey) => agentKeyMatches(candidate, configKey)));
  });
}

function mergeRuntimeAgent(runtimeAgent, configAgents, listedAgents, merged) {
  const match = findMatchingConfigAgent(runtimeAgent, configAgents);
  if (listedAgents.length && !match) return false;
  const id = match?.id || runtimeAgent.id;
  const existing = merged.get(id);
  const existingSeen = timestampMs(existing?.lastSeen);
  const runtimeSeen = timestampMs(runtimeAgent.lastSeen);
  const shouldPreferRuntime = !existing?.lastSeen || !runtimeAgent.lastSeen || runtimeSeen >= existingSeen || runtimeAgent.status === 'blocked';
  const existingActivitySeen = timestampMs(existing?.activity?.updatedAt, existing?.activity?.lastInteractionAt);
  const runtimeActivitySeen = timestampMs(runtimeAgent.activity?.updatedAt, runtimeAgent.activity?.lastInteractionAt, runtimeSeen);
  const activity = runtimeActivitySeen >= existingActivitySeen ? (runtimeAgent.activity || existing?.activity || null) : (existing?.activity || runtimeAgent.activity || null);
  merged.set(id, {
    ...existing,
    ...(shouldPreferRuntime ? runtimeAgent : {}),
    id,
    name: match?.name || existing?.name || runtimeAgent.name,
    role: (shouldPreferRuntime ? runtimeAgent.role : existing?.role) || runtimeAgent.role || existing?.role,
    workspacePath: runtimeAgent.workspacePath || match?.workspacePath || existing?.workspacePath || null,
    activity
  });
  return true;
}

function statusFromActivity(lastSeenMs, task = '') {
  if (/\b(error|failed|failure|exception|blocked|fatal)\b/i.test(task)) return 'blocked';
  const age = Date.now() - lastSeenMs;
  if (age <= AGENT_ACTIVE_MS) return 'active';
  if (age <= AGENT_IDLE_MS) return 'idle';
  return 'idle';
}

function normalizeManualAgentState(value) {
  return MANUAL_AGENT_STATE_LOOKUP.get(agentKey(value)) || null;
}

function statusFromManualState(state) {
  if (state === 'Working') return 'active';
  if (state === 'Success') return 'success';
  if (state === 'Blocked') return 'blocked';
  return 'idle';
}

function taskFromManualState(state) {
  return state === 'Coffee break' ? 'Taking a coffee break' : state;
}

async function readAgentState() {
  const data = await readJsonIfPresent(AGENT_STATE_PATH);
  const agents = data?.agents && typeof data.agents === 'object' && !Array.isArray(data.agents) ? data.agents : {};
  return {
    updatedAt: data?.updatedAt || null,
    agents
  };
}

async function writeAgentState(stateFile) {
  await fs.mkdir(path.dirname(AGENT_STATE_PATH), { recursive: true });
  const normalized = {
    updatedAt: new Date().toISOString(),
    agents: stateFile?.agents && typeof stateFile.agents === 'object' && !Array.isArray(stateFile.agents) ? stateFile.agents : {}
  };
  await fs.writeFile(AGENT_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function manualAgentsFromConfig(avatarConfig, stateFile) {
  const stateById = stateFile?.agents || {};
  return avatarConfig.manualAgents.filter((manualAgent) => manualAgent.enabled !== false).map((manualAgent, index) => {
    const stateEntry = stateById[manualAgent.id] && typeof stateById[manualAgent.id] === 'object' ? stateById[manualAgent.id] : {};
    const displayState = normalizeManualAgentState(stateEntry.state) || 'Sleeping';
    const updatedAt = timestampMs(stateEntry.updatedAt) || null;
    return normalizeAgent({
      id: manualAgent.id,
      name: manualAgent.name,
      role: 'Manual agent',
      status: statusFromManualState(displayState),
      task: stateEntry.task || taskFromManualState(displayState),
      lastSeen: updatedAt ? new Date(updatedAt).toISOString() : null,
      source: 'manual',
      activity: {
        status: displayState,
        updatedAt,
        sessionLabel: manualAgent.name,
        derivedStatus: statusFromManualState(displayState),
        skills: []
      },
      displayState,
      pose: MANUAL_AGENT_POSES[displayState]
    }, index);
  });
}

async function configuredAgents() {
  if (LOCAL_DESKTOP_MODE) {
    return {
      agents: [],
      source: 'desktop',
      configLoaded: false,
      logFiles: 0,
      sessionStores: 0,
      emptySessionStores: 0,
      sessionDebug: [],
      latestSessions: [],
      sessionGroupedCounts: {},
      weeklyCost: null
    };
  }
  const envAgents = configuredAgentsFromEnv();
  if (envAgents.length) return { agents: envAgents, source: 'env', configLoaded: false, logFiles: 0, weeklyCost: null };

  if (OPENCLAW_CONNECTION_MODE === 'none') {
    return {
      agents: [],
      source: 'none',
      configLoaded: false,
      logFiles: 0,
      sessionStores: 0,
      emptySessionStores: 0,
      sessionDebug: [],
      latestSessions: [],
      sessionGroupedCounts: {},
      weeklyCost: null
    };
  }

  if (OPENCLAW_CONNECTION_MODE === 'gateway') {
    try {
      const snapshot = await configuredAgentsFromGateway();
      openClawGatewayLastWarning = '';
      return snapshot;
    } catch (error) {
      const openClawWarning = openClawGatewayWarning(error);
      if (openClawWarning.message !== openClawGatewayLastWarning) {
        console.warn(`OpenClaw gateway: ${openClawWarning.message}`);
        openClawGatewayLastWarning = openClawWarning.message;
      }
      const stale = openClawGatewayCache?.value;
      return {
        ...(stale || {
          agents: [],
          configLoaded: false,
          logFiles: 0,
          sessionStores: 0,
          emptySessionStores: 0,
          sessionDebug: [],
          latestSessions: [],
          sessionGroupedCounts: {},
          weeklyCost: null
        }),
        source: stale ? 'gateway-stale' : 'gateway-unavailable',
        openClawWarning
      };
    }
  }

  const config = await readJsonIfPresent(OPENCLAW_CONFIG_PATH);
  const listedAgents = config ? agentsFromConfiguredList(config) : [];
  const configAgents = config ? (listedAgents.length ? listedAgents : collectConfigAgents(config, [], new WeakSet(), '', '', configDefaultWorkspace(config))).slice(0, 24) : [];
  const sessions = await sessionAgents();
  const merged = new Map();

  for (const agent of configAgents) merged.set(agent.id, agent);
  for (const sessionAgent of sessions.agents) mergeRuntimeAgent(sessionAgent, configAgents, listedAgents, merged);

  const agents = [...merged.values()];
  if (!agents.length) return { agents: DEFAULT_AGENTS.map(normalizeAgent), source: 'sample', configLoaded: Boolean(config), logFiles: 0, weeklyCost: sessions.weeklyCost };
  const hasSessionActivity = sessions.agents.length > 0;
  return {
    agents: agents.map((agent, index) => normalizeAgent({
      ...agent,
      status: hasSessionActivity && agent.source !== 'config' ? agent.status : agent.status || 'idle',
      task: agent.task || CONFIGURED_AGENT_IDLE_TASK
    }, index)),
    source: hasSessionActivity ? 'sessions' : 'config',
    configLoaded: Boolean(config),
    logFiles: 0,
    sessionStores: sessions.storeCount,
    emptySessionStores: sessions.emptyStoreCount,
    sessionDebug: sessions.debug,
    latestSessions: sessions.latestSessions,
    sessionGroupedCounts: sessions.groupedCounts,
    weeklyCost: sessions.weeklyCost
  };
}

function openClawGatewayWarning(error) {
  const pairingRequired = Boolean(error?.pairingRequired);
  const requestId = cleanRuntimeText(error?.requestId, 160);
  const approvalCommand = pairingRequired && requestId ? `openclaw devices approve ${requestId}` : '';
  return {
    code: pairingRequired ? 'pairing_required' : 'unavailable',
    message: cleanRuntimeText(error?.message, 500) || (pairingRequired
      ? 'Taskfolk is waiting for OpenClaw device approval.'
      : 'Taskfolk cannot currently connect to the OpenClaw gateway. Other features remain available.'),
    pairingRequired,
    requestId,
    approvalCommand,
    gatewayCode: cleanRuntimeText(error?.gatewayCode, 80),
    detailsCode: cleanRuntimeText(error?.detailsCode, 120)
  };
}

async function configuredAgentsFromGateway() {
  const nowMs = Date.now();
  if (openClawGatewayCache && openClawGatewayCache.expiresAt > nowMs) return openClawGatewayCache.value;
  if (openClawGatewayRequest) return openClawGatewayRequest;

  openClawGatewayRequest = fetchOpenClawSnapshot({
    baseUrl: OPENCLAW_GATEWAY_URL,
    token: OPENCLAW_GATEWAY_TOKEN,
    password: OPENCLAW_GATEWAY_PASSWORD,
    timeoutMs: OPENCLAW_GATEWAY_TIMEOUT_MS
  }).then((snapshot) => {
    const cronJobs = snapshot.cronJobs
      .filter((job) => job && typeof job === 'object' && job.id)
      .map((job) => normalizeCronJob(job, { updatedAtMs: job.updatedAtMs, state: job.state }))
      .sort((a, b) => Math.max(b.lastRunAtMs || 0, b.nextRunAtMs || 0, b.createdAtMs || 0, b.updatedAtMs || 0)
        - Math.max(a.lastRunAtMs || 0, a.nextRunAtMs || 0, a.createdAtMs || 0, a.updatedAtMs || 0));
    const cronById = new Map(cronJobs.map((job) => [job.id, job]));
    const latestSessions = [];
    const sessionGroupedCounts = {};
    const weeklySinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyCost = { sinceMs: weeklySinceMs, estimatedCostUsd: 0, sessionCount: 0, totalTokens: 0 };
    for (const entry of snapshot.sessions) {
      if (!entry || typeof entry !== 'object') continue;
      const key = String(entry.key || entry.sessionKey || entry.sessionId || '');
      const agentId = String(entry.agentId || entry.agent_id || agentIdFromSessionKey(key) || '').trim();
      const timestampInfo = sessionTimestampInfo(entry, 0);
      const ts = timestampInfo.ms;
      const badge = sessionChannelBadge(key, entry);
      const cronSession = cronSessionLabel(key, cronById);
      sessionGroupedCounts[badge] = (sessionGroupedCounts[badge] || 0) + 1;
      if (ts >= weeklySinceMs) {
        weeklyCost.estimatedCostUsd += Number.isFinite(Number(entry.estimatedCostUsd)) ? Number(entry.estimatedCostUsd) : 0;
        weeklyCost.totalTokens += Number.isFinite(Number(entry.totalTokens)) ? Number(entry.totalTokens) : 0;
        weeklyCost.sessionCount += 1;
      }
      latestSessions.push({
        agentId,
        key,
        shortKey: sessionShortKey(key),
        displayKey: cronSession?.label || sessionShortKey(key),
        cronJobId: cronSession?.id || null,
        cronJobName: cronSession?.name || null,
        channelBadge: badge,
        model: entry.model || entry.modelOverride || entry.modelProvider || entry.providerOverride || entry.provider || null,
        status: entry.status || entry.state || null,
        derivedStatus: statusFromSessionEntry(entry, ts),
        timestampMs: ts,
        timestamp: ts ? new Date(ts).toISOString() : null,
        timestampSource: timestampInfo.source,
        timestampUsedFileMtime: false,
        file: null
      });
    }
    latestSessions.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    const value = {
      agents: snapshot.agents.map((agent, index) => normalizeAgent(agent, index)),
      source: 'gateway',
      configLoaded: Boolean(snapshot.config),
      logFiles: 0,
      sessionStores: 0,
      emptySessionStores: 0,
      sessionDebug: [],
      latestSessions: latestSessions.slice(0, 50),
      sessionGroupedCounts,
      weeklyCost,
      openClawConfig: snapshot.config,
      gatewayCron: {
        source: 'gateway',
        cronDir: null,
        dbPath: null,
        jobs: cronJobs,
        byId: cronById
      }
    };
    openClawGatewayCache = { value, expiresAt: Date.now() + Math.max(0, OPENCLAW_GATEWAY_CACHE_MS) };
    return value;
  }).finally(() => {
    openClawGatewayRequest = null;
  });
  return openClawGatewayRequest;
}


function protectedPathError() {
  const error = new Error('This path is protected and cannot be accessed');
  error.status = 403;
  return error;
}

function isProtectedRelativePath(relativePath = '') {
  const normalized = path.posix.normalize(String(relativePath || '').split(path.sep).join('/'));
  if (!normalized || normalized === '.' || normalized === '/') return false;
  return normalized.split('/').some((part) => PROTECTED_NAMES.has(part));
}

function safeResolve(relativePath = '') {
  const decoded = String(relativePath || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(SHARED_DIR, decoded);
  const rootWithSep = SHARED_DIR.endsWith(path.sep) ? SHARED_DIR : `${SHARED_DIR}${path.sep}`;
  if (resolved !== SHARED_DIR && !resolved.startsWith(rootWithSep)) {
    const error = new Error('Path escapes the shared folder');
    error.status = 400;
    throw error;
  }
  if (isProtectedRelativePath(path.relative(SHARED_DIR, resolved))) {
    throw protectedPathError();
  }
  return resolved;
}

function toRelative(absPath) {
  return path.relative(SHARED_DIR, absPath).split(path.sep).join('/');
}

function parentOf(relativePath = '') {
  const normalized = path.posix.normalize(String(relativePath || '').split(path.sep).join('/'));
  if (!normalized || normalized === '.' || normalized === '/') return '';
  const parent = path.posix.dirname(normalized);
  return parent === '.' ? '' : parent;
}

function safeEntryName(rawValue, label = 'Name') {
  const rawName = String(rawValue || '').trim();
  const name = path.basename(rawName).replace(/[\u0000-\u001f]/g, '');
  if (!name) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  if (name !== rawName || name.includes('/') || name.includes('\\')) {
    const error = new Error(`${label} cannot include folders`);
    error.status = 400;
    throw error;
  }
  if (PROTECTED_NAMES.has(name)) throw protectedPathError();
  return name;
}

function contentKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'].includes(ext)) return 'image';
  if (['.txt', '.md', '.json', '.csv', '.log', '.xml', '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.env', '.ini', '.conf', '.sh', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'].includes(ext)) return 'text';
  return 'binary';
}

function tarNameFor(relativePath = '') {
  const base = path.basename(relativePath || 'shared-folder') || 'shared-folder';
  return `${base.replace(/[^a-zA-Z0-9._-]+/g, '-')}.tar`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      try {
        cb(null, safeResolve(req.query.path || ''));
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      const original = path.basename(file.originalname || 'upload.bin').replace(/[\u0000-\u001f]/g, '');
      const filename = original || `upload-${crypto.randomUUID()}`;
      if (PROTECTED_NAMES.has(filename)) return cb(protectedPathError());
      cb(null, filename);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

app.get('/api/auth/status', async (req, res, next) => {
  try {
    const { auth, authenticated } = await hasGatewaySession(req);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({ enabled: auth.enabled, passwordRequired: auth.passwordRequired, authenticated });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const auth = await gatewayAuthConfig();
    if (!auth.enabled) return res.json({ enabled: false, authenticated: true });
    const tokenMatches = timingSafeEqualText(req.body?.token, auth.token);
    const passwordMatches = !auth.passwordRequired || timingSafeEqualText(req.body?.password, auth.password);
    if (!tokenMatches || !passwordMatches) return res.status(403).json({ error: 'Invalid gateway credentials' });
    setGatewaySessionCookie(res, auth);
    res.json({ enabled: true, passwordRequired: auth.passwordRequired, authenticated: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get(['/login.js', '/styles.css', '/favicon.svg'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, path.basename(req.path)));
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/api/agent-state', updateAgentState);
app.put('/api/agent-state', updateAgentState);
app.post('/api/agent-status', updateAgentState);
app.put('/api/agent-status', updateAgentState);
app.use(requireGatewayAuth);

app.post('/api/runtime-agents', (req, res) => {
  const sourceId = cleanRuntimeText(req.body?.sourceId, 120);
  const provider = cleanRuntimeText(req.body?.provider, 40).toLowerCase();
  const publishedAtMs = Number(req.body?.publishedAtMs) || 0;
  const inputAgents = req.body?.agents;
  if (!sourceId || !/^[a-z0-9][a-z0-9._:-]*$/i.test(sourceId)) {
    return res.status(400).json({ error: 'A valid runtime sourceId is required.' });
  }
  if (!provider || !/^[a-z0-9][a-z0-9._-]*$/.test(provider)) {
    return res.status(400).json({ error: 'A valid runtime provider is required.' });
  }
  if (!Array.isArray(inputAgents)) return res.status(400).json({ error: 'agents must be an array.' });
  if (inputAgents.length > 24) return res.status(400).json({ error: 'A runtime source may publish at most 24 agents.' });

  const previousSource = runtimeAgentSources.get(sourceId);
  if (publishedAtMs && previousSource?.publishedAtMs && publishedAtMs < previousSource.publishedAtMs) {
    return res.json({ ok: true, provider, accepted: previousSource.agents.length, ignoredAsStale: true, ttlMs: RUNTIME_AGENT_TTL_MS });
  }
  const previousById = new Map((previousSource?.agents || []).map((agent) => [agent.id, agent]));
  const agents = inputAgents.map((agent, index) => {
    const rawId = cleanRuntimeText(agent?.id, 160);
    const normalizedId = rawId.startsWith(`${provider}:`) ? rawId : `${provider}:${rawId}`;
    return normalizeRuntimeAgent(agent, provider, index, previousById.get(normalizedId));
  }).filter(Boolean);
  if (agents.length || publishedAtMs) {
    runtimeAgentSources.set(sourceId, { provider, agents, updatedAtMs: Date.now(), publishedAtMs });
  } else {
    runtimeAgentSources.delete(sourceId);
  }
  return res.json({ ok: true, provider, accepted: agents.length, ttlMs: RUNTIME_AGENT_TTL_MS });
});

app.delete('/api/runtime-agents/:agentId', (req, res) => {
  const agentId = cleanRuntimeText(req.params.agentId, 200);
  if (!agentId) return res.status(400).json({ error: 'A runtime agent id is required.' });
  let removed = 0;
  for (const [sourceId, source] of runtimeAgentSources) {
    const agents = source.agents.filter((agent) => agent.id !== agentId);
    removed += source.agents.length - agents.length;
    if (!agents.length) runtimeAgentSources.delete(sourceId);
    else if (agents.length !== source.agents.length) runtimeAgentSources.set(sourceId, { ...source, agents });
  }
  return res.json({ ok: true, agentId, removed, rediscovery: 'next-publish' });
});

if (CUSTOM_AVATAR_VARIANTS_DIR) {
  const customVariantAssets = new Map();
  for (const variant of AVATAR_VARIANT_REGISTRY) {
    const directory = AVATAR_VARIANT_DIRECTORIES.get(variant.id);
    if (path.dirname(directory) === CUSTOM_AVATAR_VARIANTS_DIR) {
      customVariantAssets.set(variant.id, express.static(directory));
    }
  }
  app.use('/avatar-scenes/variants/:variantId', (req, res, next) => {
    const serveAssets = customVariantAssets.get(req.params.variantId);
    return serveAssets ? serveAssets(req, res, next) : next();
  });
}
app.use(express.static(PUBLIC_DIR));

app.get('/api/avatar-working-animations', async (_req, res, next) => {
  try {
    const sharedRoot = path.join(PUBLIC_DIR, 'avatar-scenes', 'working-screens');
    const gamingRoot = path.join(PUBLIC_DIR, 'avatar-scenes', 'gaming-screens');
    const variants = Object.create(null);
    await Promise.all(AVATAR_VARIANT_REGISTRY.map(async (variant) => {
      const files = await fs.readdir(AVATAR_VARIANT_DIRECTORIES.get(variant.id));
      const workingAnimations = files
        .filter((file) => /^working(?:\d+)?\.gif$/i.test(file))
        .sort((left, right) => {
          const leftNumber = Number(left.match(/\d+/)?.[0] || 0);
          const rightNumber = Number(right.match(/\d+/)?.[0] || 0);
          return leftNumber - rightNumber || left.localeCompare(right);
        });
      if (workingAnimations.length) variants[variant.id] = workingAnimations;
    }));
    const sharedScreens = (await fs.readdir(sharedRoot).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }))
      .filter((file) => /^working\d+\.gif$/i.test(file))
      .sort((left, right) => {
        const leftNumber = Number(left.match(/\d+/)?.[0] || 0);
        const rightNumber = Number(right.match(/\d+/)?.[0] || 0);
        return leftNumber - rightNumber || left.localeCompare(right);
      });
    const layouts = Object.fromEntries(
      AVATAR_VARIANT_REGISTRY
        .filter((variant) => variant.workingScreen)
        .map((variant) => [variant.id, variant.workingScreen])
    );
    const gamingScreens = (await fs.readdir(gamingRoot).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }))
      .filter((file) => /^gaming\d+\.gif$/i.test(file))
      .sort((left, right) => {
        const leftNumber = Number(left.match(/\d+/)?.[0] || 0);
        const rightNumber = Number(right.match(/\d+/)?.[0] || 0);
        return leftNumber - rightNumber || left.localeCompare(right);
      });
    const gamingLayouts = Object.fromEntries(
      AVATAR_VARIANT_REGISTRY
        .filter((variant) => variant.gaminScreen)
        .map((variant) => [variant.id, variant.gaminScreen])
    );
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
      variants,
      sharedScreens,
      gamingScreens,
      canvas: { width: 384, height: 512 },
      layouts,
      gamingLayouts
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/avatar-variants', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({ fallback: AVATAR_VARIANT_FALLBACK, variants: AVATAR_VARIANT_REGISTRY });
});

app.get('/api/config', async (req, res, next) => {
  try {
    const auth = await gatewayAuthConfig();
    const avatarConfig = await readAvatarConfig();
    res.json({
      maxUploadMb: MAX_UPLOAD_MB,
      gateway: { auth: { enabled: auth.enabled, passwordRequired: auth.passwordRequired } },
      modules: avatarConfig.modules
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/avatar-assignments', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    const config = await readAvatarConfig();
    res.json({
      path: AVATAR_ASSIGNMENTS_PATH,
      variants: AVATAR_VARIANTS,
      avatarVariants: AVATAR_VARIANT_REGISTRY,
      fallbackVariant: AVATAR_VARIANT_FALLBACK,
      floors: OFFICE_FLOORS,
      windows: OFFICE_WINDOWS,
      posters: OFFICE_POSTERS,
      ...config
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/avatar-assignments', async (req, res, next) => {
  try {
    const current = await readAvatarConfig();
    const config = await writeAvatarConfig({
      assignments: req.body?.assignments || {},
      customNames: req.body?.customNames && typeof req.body.customNames === 'object' && !Array.isArray(req.body.customNames)
        ? req.body.customNames
        : current.customNames,
      hiddenAgents: Array.isArray(req.body?.hiddenAgents) ? req.body.hiddenAgents : current.hiddenAgents,
      manualAgents: Array.isArray(req.body?.manualAgents) ? req.body.manualAgents : current.manualAgents,
      modules: req.body?.modules && typeof req.body.modules === 'object' && !Array.isArray(req.body.modules) ? req.body.modules : current.modules,
      officeScene: req.body?.officeScene || current.officeScene
    });
    res.json({
      path: AVATAR_ASSIGNMENTS_PATH,
      variants: AVATAR_VARIANTS,
      avatarVariants: AVATAR_VARIANT_REGISTRY,
      fallbackVariant: AVATAR_VARIANT_FALLBACK,
      floors: OFFICE_FLOORS,
      windows: OFFICE_WINDOWS,
      posters: OFFICE_POSTERS,
      ...config
    });
  } catch (err) {
    next(err);
  }
});

async function requireFolderViewModule(req, res, next) {
  try {
    const config = await readAvatarConfig();
    if (config.modules.folderView.enabled) return next();
    res.status(403).json({ enabled: false, error: 'Folder view module is disabled' });
  } catch (err) {
    next(err);
  }
}

async function updateAgentState(req, res, next) {
  try {
    const token = String(req.body?.token || req.get('x-agent-token') || '').trim();
    const state = normalizeManualAgentState(req.body?.state || req.body?.status);
    if (!token) return res.status(400).json({ error: 'Agent token is required' });
    if (!state) return res.status(400).json({ error: `State must be one of: ${MANUAL_AGENT_STATES.join(', ')}` });

    const avatarConfig = await readAvatarConfig();
    const manualAgent = avatarConfig.manualAgents.find((agent) => agent.token === token);
    if (!manualAgent) return res.status(403).json({ error: 'Invalid agent token' });
    if (manualAgent.enabled === false) return res.status(403).json({ error: 'Manual agent is disabled' });

    const stateFile = await readAgentState();
    const updatedAt = new Date().toISOString();
    stateFile.agents[manualAgent.id] = {
      id: manualAgent.id,
      name: manualAgent.name,
      state,
      status: statusFromManualState(state),
      pose: MANUAL_AGENT_POSES[state],
      task: String(req.body?.task || req.body?.message || taskFromManualState(state)).slice(0, 240),
      updatedAt
    };
    const written = await writeAgentState(stateFile);
    res.json({
      path: AGENT_STATE_PATH,
      acceptedStates: MANUAL_AGENT_STATES,
      updatedAt,
      agent: written.agents[manualAgent.id]
    });
  } catch (err) {
    next(err);
  }
}

app.get('/api/office-fixture', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    const text = await fs.readFile(OFFICE_FIXTURE_PATH, 'utf8');
    res.json({ path: 'public/test-agents.json', text });
  } catch (err) {
    next(err);
  }
});

app.put('/api/office-fixture', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return res.status(400).json({ error: `Invalid JSON: ${err.message}` });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(400).json({ error: 'Fixture must be a JSON object' });
    }
    await fs.writeFile(OFFICE_FIXTURE_PATH, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    const updated = await fs.stat(OFFICE_FIXTURE_PATH);
    res.json({ path: 'public/test-agents.json', size: updated.size, modified: updated.mtime.toISOString() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/agents', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    const { agents, source, configLoaded, logFiles, sessionStores, emptySessionStores, sessionDebug, latestSessions, sessionGroupedCounts, weeklyCost, openClawWarning, openClawConfig: gatewayOpenClawConfig } = await configuredAgents();
    const cron = await cronJobsSnapshot();
    const avatarConfig = await readAvatarConfig();
    const stateFile = await readAgentState();
    const openClawConfig = OPENCLAW_CONNECTION_MODE === 'gateway'
      ? gatewayOpenClawConfig
      : OPENCLAW_CONNECTION_MODE === 'files' ? await readJsonIfPresent(OPENCLAW_CONFIG_PATH) : null;
    const officeScene = normalizeOfficeScene(openClawConfig);
    for (const key of avatarConfig.officeSceneKeys) officeScene[key] = avatarConfig.officeScene[key];
    const avatarAssignments = avatarConfig.assignments;
    const runtimeAgents = runtimeAgentsSnapshot();
    const runtimeAgentIds = new Set(runtimeAgents.map((agent) => agent.id));
    const baseAgents = runtimeAgents.length && source === 'sample' ? [] : agents;
    const agentById = new Map(baseAgents.map((agent) => [agent.id, agent]));
    for (const runtimeAgent of runtimeAgents) agentById.set(runtimeAgent.id, runtimeAgent);
    for (const manualAgent of manualAgentsFromConfig(avatarConfig, stateFile)) agentById.set(manualAgent.id, manualAgent);
    const mergedAgents = [...agentById.values()];
    let discoveredAvatar = false;
    for (const agent of mergedAgents) {
      const assignmentKey = agent.avatarAssignmentKey || agent.id;
      if (Object.prototype.hasOwnProperty.call(avatarAssignments, assignmentKey)
        || Object.prototype.hasOwnProperty.call(avatarAssignments, agent.id)) continue;
      avatarAssignments[assignmentKey] = randomAvatarVariant();
      discoveredAvatar = true;
    }
    if (discoveredAvatar) {
      await writeAvatarConfig({ ...avatarConfig, assignments: avatarAssignments });
    }
    const hiddenAgentKeys = new Set(avatarConfig.hiddenAgents);
    const agentsWithAvatars = mergedAgents.map((agent) => {
      const assignmentKey = agent.avatarAssignmentKey || agent.id;
      const avatarVariant = Object.prototype.hasOwnProperty.call(avatarAssignments, assignmentKey)
        ? avatarAssignments[assignmentKey]
        : Object.prototype.hasOwnProperty.call(avatarAssignments, agent.id) ? avatarAssignments[agent.id] : null;
      const customName = avatarConfig.customNames[assignmentKey] || avatarConfig.customNames[agent.id] || '';
      return {
        ...agent,
        ...(customName ? { name: customName, automaticName: agent.name } : {}),
        runtime: runtimeAgentIds.has(agent.id),
        avatarAssignmentKey: assignmentKey,
        avatarVariant,
        hidden: hiddenAgentKeys.has(assignmentKey) || hiddenAgentKeys.has(agent.id)
      };
    });
    const responseAgents = req.query.includeHidden === '1'
      ? agentsWithAvatars
      : agentsWithAvatars.filter((agent) => !agent.hidden);
    res.json({
      generatedAt: new Date().toISOString(),
      source: runtimeAgents.length ? (source === 'sample' ? 'runtime' : `${source}+runtime`) : source,
      openClawConnection: {
        mode: OPENCLAW_CONNECTION_MODE,
        ...(OPENCLAW_CONNECTION_MODE === 'gateway' ? { gatewayUrl: OPENCLAW_GATEWAY_URL } : {})
      },
      openClawWarning: openClawWarning || null,
      configLoaded,
      logDir: OPENCLAW_CONNECTION_MODE === 'files' ? OPENCLAW_LOG_DIR : null,
      configPath: OPENCLAW_CONNECTION_MODE === 'files' ? OPENCLAW_CONFIG_PATH : null,
      sessionsDir: OPENCLAW_CONNECTION_MODE === 'files' ? OPENCLAW_SESSIONS_DIR : null,
      cronDir: OPENCLAW_CONNECTION_MODE === 'files' ? OPENCLAW_CRON_DIR : null,
      cronDbPath: OPENCLAW_CONNECTION_MODE === 'files' ? OPENCLAW_STATE_DB_PATH : null,
      logFiles,
      sessionStores: sessionStores || 0,
      emptySessionStores: emptySessionStores || 0,
      sessionDebug: sessionDebug || [],
      latestSessions: latestSessions || [],
      sessionGroupedCounts: sessionGroupedCounts || {},
      cronJobs: cron.jobs,
      weeklyCost: weeklyCost || null,
      avatarVariants: AVATAR_VARIANT_REGISTRY,
      fallbackVariant: AVATAR_VARIANT_FALLBACK,
      statusRules: { activeMs: AGENT_ACTIVE_MS, successMs: AGENT_SUCCESS_MS, idleMs: AGENT_IDLE_MS, blockedPattern: 'error|failed|failure|exception|blocked|fatal' },
      acceptedManualStates: MANUAL_AGENT_STATES,
      agentStatePath: AGENT_STATE_PATH,
      summary: {
        total: responseAgents.length,
        active: responseAgents.filter((agent) => agent.status === 'active').length,
        success: responseAgents.filter((agent) => agent.status === 'success').length,
        idle: responseAgents.filter((agent) => agent.status === 'idle').length,
        blocked: responseAgents.filter((agent) => agent.status === 'blocked').length
      },
      avatarAssignmentsPath: AVATAR_ASSIGNMENTS_PATH,
      officeScene,
      hiddenAgents: avatarConfig.hiddenAgents,
      agents: responseAgents
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/cron-jobs/:id/runs', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(await cronJobRuns(req.params.id, req.query.limit));
  } catch (err) {
    next(err);
  }
});

app.get('/api/list', requireFolderViewModule, async (req, res, next) => {
  try {
    const dir = safeResolve(req.query.path || '');
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => !PROTECTED_NAMES.has(entry.name));
    const items = await Promise.all(entries.map(async (entry) => {
      const abs = path.join(dir, entry.name);
      const st = await fs.stat(abs);
      return {
        name: entry.name,
        path: toRelative(abs),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? null : st.size,
        modified: st.mtime.toISOString(),
        preview: entry.isDirectory() ? null : contentKind(entry.name)
      };
    }));

    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    res.json({ path: toRelative(dir), parent: parentOf(toRelative(dir)), items });
  } catch (err) {
    next(err);
  }
});

app.get('/api/preview', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.query.path || '');
    const st = await fs.stat(abs);
    if (!st.isFile()) return res.status(400).json({ error: 'Path is not a file' });

    const kind = contentKind(abs);
    if (kind === 'image') return res.json({ kind, url: `/api/raw?path=${encodeURIComponent(toRelative(abs))}` });
    if (kind !== 'text') return res.json({ kind, message: 'Preview is available only for text and image files.' });

    const handle = await fs.open(abs, 'r');
    try {
      const size = Math.min(st.size, MAX_TEXT_PREVIEW_BYTES);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      res.json({ kind, text: buffer.toString('utf8'), truncated: st.size > MAX_TEXT_PREVIEW_BYTES, size: st.size });
    } finally {
      await handle.close();
    }
  } catch (err) {
    next(err);
  }
});

app.get('/api/raw', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.query.path || '');
    const st = await fs.stat(abs);
    if (!st.isFile()) return res.status(400).send('Path is not a file');
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

app.get('/api/download', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.query.path || '');
    const st = await fs.stat(abs);
    if (!st.isFile()) return res.status(400).send('Path is not a file');
    res.download(abs, path.basename(abs));
  } catch (err) {
    next(err);
  }
});

app.get('/api/download-folder', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.query.path || '');
    const st = await fs.stat(abs);
    if (!st.isDirectory()) return res.status(400).send('Path is not a directory');

    const relative = toRelative(abs);
    const entries = relative ? [relative] : ['.'];

    res.setHeader('Content-Type', 'application/x-tar');
    res.setHeader('Content-Disposition', `attachment; filename="${tarNameFor(relative)}"`);

    tar.c(
      {
        cwd: SHARED_DIR,
        portable: true,
        noMtime: false,
        filter: (entryPath) => !isProtectedRelativePath(entryPath)
      },
      entries
    ).on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.post('/api/upload', requireFolderViewModule, upload.array('files'), (req, res) => {
  res.json({ uploaded: (req.files || []).map((file) => ({ name: file.filename, size: file.size })) });
});

app.post('/api/text-file', requireFolderViewModule, async (req, res, next) => {
  try {
    const dir = safeResolve(req.body.path || '');
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const rawName = String(req.body.name || '').trim();
    const name = path.basename(rawName).replace(/[\u0000-\u001f]/g, '');
    if (!name) return res.status(400).json({ error: 'File name is required' });
    if (name !== rawName || name.includes('/') || name.includes('\\')) {
      return res.status(400).json({ error: 'File name cannot include folders' });
    }
    if (PROTECTED_NAMES.has(name)) throw protectedPathError();

    const abs = safeResolve(path.join(toRelative(dir), name));
    await fs.writeFile(abs, '', { flag: 'wx' });
    const created = await fs.stat(abs);
    res.status(201).json({ name, path: toRelative(abs), size: created.size, modified: created.mtime.toISOString() });
  } catch (err) {
    if (err.code === 'EEXIST') err.status = 409, err.message = 'A file with that name already exists';
    next(err);
  }
});

app.post('/api/folder', requireFolderViewModule, async (req, res, next) => {
  try {
    const dir = safeResolve(req.body.path || '');
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

    const rawName = String(req.body.name || '').trim();
    const name = path.basename(rawName).replace(/[\u0000-\u001f]/g, '');
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    if (name !== rawName || name.includes('/') || name.includes('\\')) {
      return res.status(400).json({ error: 'Folder name cannot include folders' });
    }
    if (PROTECTED_NAMES.has(name)) throw protectedPathError();

    const abs = safeResolve(path.join(toRelative(dir), name));
    await fs.mkdir(abs);
    const created = await fs.stat(abs);
    res.status(201).json({ name, path: toRelative(abs), type: 'directory', size: null, modified: created.mtime.toISOString() });
  } catch (err) {
    if (err.code === 'EEXIST') err.status = 409, err.message = 'A folder or file with that name already exists';
    next(err);
  }
});

app.patch('/api/rename', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.body.path || '');
    const stat = await fs.stat(abs);
    const oldRelative = toRelative(abs);
    if (!oldRelative) return res.status(400).json({ error: 'Cannot rename the shared folder root' });

    const name = safeEntryName(req.body.name, 'New name');
    const target = safeResolve(path.posix.join(parentOf(oldRelative), name));
    const targetRelative = toRelative(target);
    if (target === abs) {
      return res.json({
        name,
        path: oldRelative,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.isDirectory() ? null : stat.size,
        modified: stat.mtime.toISOString()
      });
    }

    try {
      await fs.stat(target);
      return res.status(409).json({ error: 'A file or folder with that name already exists' });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    await fs.rename(abs, target);
    const renamed = await fs.stat(target);
    res.json({
      name,
      path: targetRelative,
      type: renamed.isDirectory() ? 'directory' : 'file',
      size: renamed.isDirectory() ? null : renamed.size,
      modified: renamed.mtime.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/text-file', requireFolderViewModule, async (req, res, next) => {
  try {
    const abs = safeResolve(req.body.path || '');
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return res.status(400).json({ error: 'Path is not a file' });
    if (contentKind(abs) !== 'text') return res.status(400).json({ error: 'Only text files can be edited' });

    const text = String(req.body.text ?? '');
    await fs.writeFile(abs, text, 'utf8');
    const updated = await fs.stat(abs);
    res.json({ path: toRelative(abs), size: updated.size, modified: updated.mtime.toISOString() });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
});

const server = app.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Taskfolk listening on http://${HOST}:${listeningPort}`);
  console.log(`Sharing folder: ${SHARED_DIR}`);
});
