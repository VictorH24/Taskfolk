let currentPath = '';
const pageParams = new URLSearchParams(window.location.search);
const companionMode = pageParams.get('companion') === '1';
const companionView = companionMode && pageParams.get('companionView') === 'avatar' ? 'avatar' : 'office';
const randomStatusMode = companionMode && pageParams.get('randomStatuses') === '1';
const companionAgentId = pageParams.get('agent') || '';
const MOST_RECENT_AGENT_ID = '__latest__';
const themeOptions = ['system', 'light', 'dark'];
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };
const themeIcons = {
  system: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>',
  light: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>',
  dark: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8a8.5 8.5 0 1 0 11.5 11.5Z"></path></svg>'
};
const AVATAR_VARIANT_FALLBACK = 'v0';
let avatarVariantIds = new Set([AVATAR_VARIANT_FALLBACK]);
const OFFICE_FLOORS = ['wood','wood2','carpet', 'concrete', 'tile', 'darkwood'];
const OFFICE_WINDOWS = ['sf', 'newyork', 'beach', 'tahoe'];
const OFFICE_POSTER_COUNT = 50;
const SUCCESS_STATE_MS = 2 * 60 * 1000;
const IDLE_POSE_STORAGE_KEY = 'taskfolk-idle-pose-history-v1';
const AGENT_REFRESH_MS = 8_000;
const AGENT_REQUEST_TIMEOUT_MS = 12_000;
const AGENT_DISCOVERY_GRACE_MS = 12_000;
const AGENT_DISCOVERY_RETRY_MS = 2_000;
const RANDOM_STATUS_MIN_MS = 30_000;
const RANDOM_STATUS_MAX_MS = 60_000;
const rows = document.querySelector('#fileRows');
const missionControl = document.querySelector('#missionControl');
const folderView = document.querySelector('#folderView');
const officeMap = document.querySelector('#officeMap');
const agentSummary = document.querySelector('#agentSummary');
const viewToggleBtn = document.querySelector('#viewToggleBtn');
const avatarLegendBtn = document.querySelector('#avatarLegendBtn');
const agentDisplayToggleBtn = document.querySelector('#agentDisplayToggleBtn');
const pixelFullscreenBtn = document.querySelector('#pixelFullscreenBtn');
const agentAutoRefreshBtn = document.querySelector('#agentAutoRefreshBtn');
const sessionDebugToggleBtn = document.querySelector('#sessionDebugToggleBtn');
const sessionDebugPanel = document.querySelector('#sessionDebugPanel');
const cronJobsToggleBtn = document.querySelector('#cronJobsToggleBtn');
const cronJobsPanel = document.querySelector('#cronJobsPanel');
const pageSubtitle = document.querySelector('#pageSubtitle');
let currentView = 'agents';
const breadcrumbs = document.querySelector('#breadcrumbs');
const previewPanel = document.querySelector('#previewPanel');
const previewName = document.querySelector('#previewName');
const previewBody = document.querySelector('#previewBody');
const toast = document.querySelector('#toast');
const editPreviewBtn = document.querySelector('#editPreviewBtn');
const fullscreenPreviewBtn = document.querySelector('#fullscreenPreviewBtn');
const newTextFileBtn = document.querySelector('#newTextFileBtn');
const newFolderBtn = document.querySelector('#newFolderBtn');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
let currentPreview = null;
let agentDisplayMode = companionMode ? 'pixel' : getSavedAgentDisplayMode();
let agentAutoRefresh = companionMode ? true : getSavedAgentAutoRefresh();
let sessionDebugVisible = getSavedSessionDebugVisible();
let cronJobsVisible = getSavedCronJobsVisible();
let selectedCronJobId = null;
let latestCronJobs = [];
let agentRefreshTimer = null;
let agentRefreshInFlight = false;
let agentRequestController = null;
let agentRequestGeneration = 0;
let agentDiscoveryStartedAt = 0;
let agentDiscoveryRetryTimer = null;
let preserveAgentsDuringWakeRecovery = false;
let officeSceneConfig = { floor: 'wood', windowView: 'sf', poster: 0, emptyDesks: 0 };
let modulesConfig = { folderView: { enabled: false } };
let renderedCompanionAgentId = '';
let renderedCompanionAgentSignature = '';
let renderedAgentSummarySignature = '';
let renderedSessionDebugSignature = '';
let renderedCronJobsSignature = '';
let renderedPixelOfficeSignature = '';
let renderedPixelLatestSessionSignature = '';
let latestAgentSnapshotData = {};
let latestRawAgentSnapshotData = {};
let desktopSnapshotUnsubscribe = null;
let latestDesktopSnapshotVersion = -1;
const randomizedStatusByAgent = new Map();
const randomizedVariantByAgent = new Map();
let randomStatusTimer = null;

function usesDesktopAgentSnapshots() {
  return companionMode
    && typeof window.taskfolkDesktop?.getAgentSnapshot === 'function'
    && typeof window.taskfolkDesktop?.subscribeAgentSnapshots === 'function';
}

function applyTheme(theme) {
  const nextTheme = themeOptions.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = nextTheme;
  themeToggleBtn.innerHTML = `${themeIcons[nextTheme]}<span>${themeLabels[nextTheme]}</span>`;
  themeToggleBtn.setAttribute('aria-label', `Color theme: ${themeLabels[nextTheme]}. Click to switch theme.`);
}

function getSavedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}

function setTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem('theme', theme); } catch {}
  if (currentView === 'agents' && agentDisplayMode === 'pixel') loadAgents();
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || 'system';
  const nextTheme = themeOptions[(themeOptions.indexOf(currentTheme) + 1) % themeOptions.length];
  setTheme(nextTheme);
}

applyTheme(getSavedTheme() || 'system');
document.body.classList.toggle('companion-mode', companionMode);
document.body.classList.toggle('companion-avatar-mode', companionMode && companionView === 'avatar');

function getSavedAgentDisplayMode() {
  try {
    const value = localStorage.getItem('agentDisplayMode');
    return value === 'pixel' ? 'pixel' : 'cards';
  } catch {
    return 'cards';
  }
}

function getSavedAgentAutoRefresh() {
  try {
    const saved = localStorage.getItem('agentAutoRefresh');
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function getSavedSessionDebugVisible() {
  try {
    return localStorage.getItem('sessionDebugVisible') === 'true';
  } catch {
    return false;
  }
}

function getSavedCronJobsVisible() {
  try {
    return localStorage.getItem('cronJobsVisible') === 'true';
  } catch {
    return false;
  }
}

function setAgentDisplayMode(mode) {
  agentDisplayMode = mode === 'pixel' ? 'pixel' : 'cards';
  try { localStorage.setItem('agentDisplayMode', agentDisplayMode); } catch {}
  agentDisplayToggleBtn.textContent = agentDisplayMode === 'pixel' ? 'Card view' : 'Pixel office';
  agentDisplayToggleBtn.setAttribute('aria-pressed', String(agentDisplayMode === 'pixel'));
  pixelFullscreenBtn.classList.toggle('hidden', agentDisplayMode !== 'pixel');
  if (agentDisplayMode !== 'pixel') setPixelFullscreen(false);
}

function setPixelFullscreen(enabled) {
  const active = (companionMode || Boolean(enabled)) && currentView === 'agents' && agentDisplayMode === 'pixel';
  document.body.classList.toggle('pixel-office-fullscreen', active);
  pixelFullscreenBtn.textContent = active ? 'Exit full page' : 'Full page';
  pixelFullscreenBtn.setAttribute('aria-pressed', String(active));
}

function togglePixelFullscreen() {
  setPixelFullscreen(!document.body.classList.contains('pixel-office-fullscreen'));
}

function setAgentAutoRefresh(enabled) {
  agentAutoRefresh = Boolean(enabled);
  try { localStorage.setItem('agentAutoRefresh', String(agentAutoRefresh)); } catch {}
  agentAutoRefreshBtn.textContent = agentAutoRefresh ? 'Auto refresh on' : 'Auto refresh off';
  agentAutoRefreshBtn.setAttribute('aria-pressed', String(agentAutoRefresh));
  scheduleAgentRefresh();
}

function setSessionDebugVisible(visible) {
  sessionDebugVisible = Boolean(visible);
  try { localStorage.setItem('sessionDebugVisible', String(sessionDebugVisible)); } catch {}
  sessionDebugToggleBtn.setAttribute('aria-pressed', String(sessionDebugVisible));
  sessionDebugToggleBtn.textContent = sessionDebugVisible ? 'Hide debug' : 'Session debug';
  sessionDebugPanel.classList.toggle('hidden', !sessionDebugVisible);
  if (sessionDebugVisible) renderSessionDebugPanel(latestAgentSnapshotData);
}

function setCronJobsVisible(visible) {
  cronJobsVisible = Boolean(visible);
  try { localStorage.setItem('cronJobsVisible', String(cronJobsVisible)); } catch {}
  cronJobsToggleBtn.setAttribute('aria-pressed', String(cronJobsVisible));
  cronJobsToggleBtn.textContent = cronJobsVisible ? 'Hide cron jobs' : 'Cron jobs';
  cronJobsPanel.classList.toggle('hidden', !cronJobsVisible);
  if (cronJobsVisible) renderCronJobsPanel(latestCronJobs);
}

function normalizeOfficeSceneConfig(value = {}) {
  const poster = Number(value.poster);
  return {
    floor: OFFICE_FLOORS.includes(value.floor) ? value.floor : 'wood',
    windowView: OFFICE_WINDOWS.includes(value.windowView) ? value.windowView : 'sf',
    poster: Number.isInteger(poster) && poster >= 0 && poster < OFFICE_POSTER_COUNT ? poster : 0,
    emptyDesks: Math.max(0, Math.min(24, Math.trunc(Number(value.emptyDesks) || 0)))
  };
}

function scheduleAgentRefresh() {
  if (agentRefreshTimer) {
    clearTimeout(agentRefreshTimer);
    agentRefreshTimer = null;
  }
  if (document.hidden || usesDesktopAgentSnapshots() || !agentAutoRefresh || currentView !== 'agents') return;
  agentRefreshTimer = setTimeout(() => {
    agentRefreshTimer = null;
    if (currentView === 'agents') loadAgents();
  }, AGENT_REFRESH_MS);
}

function clearAgentDiscoveryRetry() {
  if (!agentDiscoveryRetryTimer) return;
  clearTimeout(agentDiscoveryRetryTimer);
  agentDiscoveryRetryTimer = null;
}

function resetAgentDiscovery() {
  agentDiscoveryStartedAt = 0;
  preserveAgentsDuringWakeRecovery = false;
  clearAgentDiscoveryRetry();
}

function scheduleAgentDiscoveryRetry(delayMs) {
  clearAgentDiscoveryRetry();
  agentDiscoveryRetryTimer = setTimeout(() => {
    agentDiscoveryRetryTimer = null;
    if (currentView === 'agents') loadAgents();
  }, delayMs);
}

function renderAgentDiscoveryLoading() {
  const avatarCompanion = companionMode && companionView === 'avatar';
  officeMap.className = avatarCompanion
    ? 'companionAvatarStage'
    : companionMode ? 'officeMap pixelOfficeWrap agentDiscoveryState' : 'officeMap agentDiscoveryState';
  officeMap.dataset.renderState = 'loading';
  officeMap.innerHTML = `
    <div class="agentDiscoveryLoading" role="status" aria-live="polite">
      <span class="agentDiscoverySpinner" aria-hidden="true"></span>
      <span>Looking for agents…</span>
      <button class="agentForceReloadBtn" type="button" data-companion-interactive>Force reload</button>
    </div>`;
  officeMap.querySelector('.agentForceReloadBtn')?.addEventListener('click', forceReloadAgents);
}

function renderNoAgentsAvailable() {
  const avatarCompanion = companionMode && companionView === 'avatar';
  if (officeMap.dataset.renderState === 'no-agents') return;
  renderedCompanionAgentId = '';
  renderedCompanionAgentSignature = '';
  officeMap.className = avatarCompanion
    ? 'companionAvatarStage'
    : companionMode ? 'officeMap pixelOfficeWrap agentLoadError' : 'officeMap agentLoadError';
  officeMap.dataset.renderState = 'no-agents';
  officeMap.innerHTML = `
    <div class="${avatarCompanion ? 'companionAvatarEmpty' : 'emptyOffice'} agentLoadFailure">
      <span>No agents are available.</span>
      <button class="agentLoadRefreshBtn" type="button" data-companion-interactive>Refresh</button>
    </div>`;
  officeMap.querySelector('.agentLoadRefreshBtn')?.addEventListener('click', () => {
    resetAgentDiscovery();
    renderAgentDiscoveryLoading();
    refreshAgents();
  });
}

function waitForAgentDiscovery() {
  const now = Date.now();
  if (!agentDiscoveryStartedAt) agentDiscoveryStartedAt = now;
  const remainingMs = AGENT_DISCOVERY_GRACE_MS - (now - agentDiscoveryStartedAt);
  if (remainingMs <= 0) {
    clearAgentDiscoveryRetry();
    return false;
  }
  const hasRenderedAgents = officeMap.querySelector('.companionAvatar, .pixelOfficeScene, .agentDesk');
  if (!preserveAgentsDuringWakeRecovery || !hasRenderedAgents) renderAgentDiscoveryLoading();
  scheduleAgentDiscoveryRetry(Math.min(AGENT_DISCOVERY_RETRY_MS, remainingMs));
  return true;
}

function effectiveOfficeTimeClass() {
  const theme = document.documentElement.dataset.theme || 'system';
  if (theme === 'dark') return 'night';
  if (theme === 'light') return 'day';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  } catch {
    return 'day';
  }
}

setAgentDisplayMode(agentDisplayMode);
setAgentAutoRefresh(agentAutoRefresh);
if (companionMode) setPixelFullscreen(true);

function setView(view) {
  currentView = view === 'files' && modulesConfig.folderView.enabled ? 'files' : 'agents';
  const showingFiles = currentView === 'files';
  if (showingFiles) setPixelFullscreen(false);
  missionControl.classList.toggle('hidden', showingFiles);
  folderView.classList.toggle('hidden', !showingFiles);
  avatarLegendBtn?.classList.toggle('hidden', showingFiles);
  viewToggleBtn.textContent = showingFiles ? 'Agent view' : 'Folder view';
  pageSubtitle.textContent = showingFiles
    ? 'Browse, upload, download, and preview files in the shared folder.'
    : 'Watch your AI team at work.';
  if (showingFiles) {
    clearAgentDiscoveryRetry();
    loadDir(currentPath);
  }
  else { hidePreviewPanel(); loadAgents(); }
  scheduleAgentRefresh();
}

function agentBadge(status) {
  return { active: 'Working', success: 'Success', idle: 'Idle', blocked: 'Blocked' }[status] || 'Idle';
}

function agentStateLabel(agent) {
  return agent.displayState || agentBadge(agent.status);
}

function relativeTime(value) {
  if (!value) return 'No recent log timestamp';
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'No recent log timestamp';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function durationLabel(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '';
  const seconds = Math.round(Number(ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function runDuration(agent) {
  const activity = agent.activity || {};
  if (activity.startedAt && !activity.endedAt) return Date.now() - Number(activity.startedAt);
  return activity.runtimeMs;
}

function compactModel(model = '') {
  return String(model || '').replace(/^openai\//i, '').replace(/^gpt-/, 'gpt-').slice(0, 12);
}

function activityLevel(agent) {
  const tokens = Number(agent.activity?.totalTokens || 0);
  if (tokens >= 50000) return 'heat3';
  if (tokens >= 15000) return 'heat2';
  if (tokens > 0) return 'heat1';
  return 'heat0';
}

function agentAgeClass(agent) {
  const updatedAt = Number(agent.activity?.updatedAt || (agent.lastSeen ? new Date(agent.lastSeen).getTime() : 0));
  const rawAgeMs = Number.isFinite(updatedAt) && updatedAt > 0 ? Date.now() - updatedAt : Infinity;
  const successAt = Number(agent.activity?.successAt || 0);
  const completed = Boolean(agent.activity?.endedAt)
    || /\b(done|complete|completed|finished|success|succeeded)\b/i.test(String(agent.activity?.status || ''));
  const ageMs = successAt > 0
    ? Math.max(0, Date.now() - successAt - SUCCESS_STATE_MS)
    : completed ? Math.max(0, rawAgeMs - SUCCESS_STATE_MS) : rawAgeMs;
  if (ageMs < 2 * 60 * 1000) return 'fresh';
  if (ageMs < 15 * 60 * 1000) return 'warm';
  return 'cool';
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function idleEpisodeKey(agent, age) {
  const activity = agent.activity || {};
  const marker = activity.successAt
    || activity.updatedAt
    || activity.lastInteractionAt
    || activity.lastMessageAt
    || activity.timestamp
    || agent.lastSeen
    || agent.updatedAt
    || 'unknown';
  return `${marker}:${age}`;
}

function idlePoseHistory() {
  try {
    return JSON.parse(localStorage.getItem(IDLE_POSE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function rememberIdlePose(identity, episode, pose, history) {
  history[identity] = { episode, pose };
  try {
    localStorage.setItem(IDLE_POSE_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // The deterministic episode seed still prevents flicker if storage is unavailable.
  }
}

function idlePose(agent) {
  const age = agentAgeClass(agent);
  const role = pixelRole(agent);
  const identity = `${agent.id || ''}:${agent.name || ''}:${role}`;

  if (age !== 'fresh' && age !== 'warm') {
    return 'sleeping';
  }

  const poses = age === 'fresh'
    ? ['reading', 'walking', 'coffee', 'headphones', 'gaming']
    : ['coffee', 'reading', 'gaming'];
  const episode = idleEpisodeKey(agent, age);
  const history = idlePoseHistory();
  const previous = history[identity];

  if (previous?.episode === episode && poses.includes(previous.pose)) {
    return previous.pose;
  }

  // Office and companion views run in separate renderer windows. Deriving the
  // first choice from shared episode data keeps both views on the same animation.
  // If this agent used that pose last time, rotate to another valid idle pose.
  let poseIndex = hashString(`${identity}:${episode}`) % poses.length;
  if (poses[poseIndex] === previous?.pose && poses.length > 1) {
    poseIndex = (poseIndex + 1 + (hashString(`${episode}:${identity}`) % (poses.length - 1))) % poses.length;
  }
  const pose = poses[poseIndex];
  rememberIdlePose(identity, episode, pose, history);
  return pose;
}

function sanitizeCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function officeMetrics(agents) {
  const activity = agents.map((agent) => agent.activity || {});
  const totalTokens = activity.reduce((sum, item) => sum + sanitizeCount(item.totalTokens), 0);
  const estimatedCostUsd = activity.reduce((sum, item) => sum + sanitizeCount(item.estimatedCostUsd), 0);
  const latestMs = agents.reduce((max, agent) => Math.max(
    max,
    Number(agent.activity?.updatedAt || 0),
    Number(agent.lastSeen ? new Date(agent.lastSeen).getTime() : 0)
  ), 0);
  const avgRuntime = activity.length ? activity.reduce((sum, item) => sum + sanitizeCount(item.runtimeMs), 0) / activity.length : 0;
  const activeSkills = [...new Set(activity.flatMap((item) => item.skills || []))].slice(0, 6);
  return {
    totalTokens,
    estimatedCostUsd,
    latestMs,
    avgRuntime,
    activeSkills
  };
}

function formatCost(value) {
  const num = Number(value || 0);
  if (!num) return '$0';
  return `$${num.toFixed(num >= 1 ? 2 : 3)}`;
}

function formatTimestamp(ms) {
  if (!ms) return 'no live activity';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatExactTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}

function tokenCostLine(activity = {}) {
  const total = Number(activity.totalTokens || 0);
  const input = Number(activity.inputTokens || 0);
  const output = Number(activity.outputTokens || 0);
  const cost = Number(activity.estimatedCostUsd || 0);
  if (!total && !input && !output && !cost) return '';
  const tokens = total ? `${formatNumber(total)} tok` : `${formatNumber(input)} in / ${formatNumber(output)} out`;
  return cost ? `${tokens} · ${formatCost(cost)}` : tokens;
}

function latestSessionWinner(data = {}) {
  const latest = Array.isArray(data.latestSessions) ? data.latestSessions[0] : null;
  if (!latest) return 'No latest session';
  const key = String(latest.displayKey || latest.shortKey || latest.key || 'session').replaceAll(':', ' ');
  return `Latest: ${key} on ${compactModel(latest.model || '') || 'unknown'}`;
}

function groupedSessionLine(groups = {}) {
  const preferred = ['discord', 'cron', 'main', 'heartbeat', 'dreaming'];
  const keys = [...preferred, ...Object.keys(groups).filter((key) => !preferred.includes(key)).sort()];
  const parts = keys
    .filter((key) => Number(groups[key] || 0) > 0)
    .map((key) => `${key} ${formatNumber(groups[key])}`);
  return parts.length ? parts.join(' · ') : 'no grouped sessions';
}

function weeklyCostLine(weeklyCost = {}) {
  const sessions = Number(weeklyCost.sessionCount || 0);
  const tokens = Number(weeklyCost.totalTokens || 0);
  if (!sessions && !tokens) return 'last 7 days';
  const parts = [];
  if (sessions) parts.push(`${formatNumber(sessions)} session${sessions === 1 ? '' : 's'}`);
  if (tokens) parts.push(`${formatNumber(Math.round(tokens / 1000))}k tok`);
  return `last 7 days · ${parts.join(' · ')}`;
}

function renderSessionDebugPanel(data = {}) {
  const latest = Array.isArray(data.latestSessions) ? data.latestSessions.slice(0, 3) : [];
  const stores = Array.isArray(data.sessionDebug) ? data.sessionDebug : [];
  const warnings = stores.filter((item) => item.mtimeNewerThanLatestEntry);
  const signature = JSON.stringify({ latest, stores: stores.slice(0, 3), groups: data.sessionGroupedCounts || {} });
  sessionDebugPanel.classList.toggle('hidden', !sessionDebugVisible);
  if (signature === renderedSessionDebugSignature) return;
  renderedSessionDebugSignature = signature;
  sessionDebugPanel.innerHTML = `
    <div class="sessionDebugHeader">
      <strong>${esc(latestSessionWinner(data))}</strong>
      ${warnings.length ? `<span class="sessionWarning">${warnings.length} mtime warning${warnings.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="sessionDebugGrid">
      <article>
        <h3>Top Sessions</h3>
        ${latest.length ? latest.map((item) => `
          <p><b>${esc(item.displayKey || item.shortKey || item.key)}</b><span>${esc(compactModel(item.model || '') || 'unknown')} · ${esc(item.status || 'no raw status')} · ${esc(item.derivedStatus || 'idle')}</span><small>${esc(item.timestampSource || 'timestamp')} · ${esc(formatExactTime(item.timestampMs))}</small></p>
        `).join('') : '<p><span>No session entries found</span></p>'}
      </article>
      <article>
        <h3>Stores</h3>
        ${stores.length ? stores.slice(0, 3).map((item) => `
          <p><b>${esc(item.file || 'sessions.json')}</b><span>${formatNumber(item.entryCount)} entries · latest ${esc(item.latestEntryMs ? relativeTime(item.latestEntryMs) : 'unknown')}</span><small>mtime ${esc(formatExactTime(item.mtimeMs))}${item.mtimeNewerThanLatestEntry ? ' · newer than latest entry' : ''}</small></p>
        `).join('') : '<p><span>No session stores found</span></p>'}
      </article>
      <article>
        <h3>Groups</h3>
        <p><span>${esc(groupedSessionLine(data.sessionGroupedCounts || {}))}</span></p>
      </article>
    </div>`;
}

function statusClass(status = '') {
  const value = String(status || '').toLowerCase();
  if (/\b(error|failed|failure|blocked|fatal)\b/.test(value)) return 'blocked';
  if (/\b(ok|success|delivered|done|finished)\b/.test(value)) return 'active';
  return 'idle';
}

function renderCronJobsPanel(jobs = latestCronJobs) {
  latestCronJobs = Array.isArray(jobs) ? jobs : [];
  if (!latestCronJobs.length) selectedCronJobId = null;
  if (selectedCronJobId && !latestCronJobs.some((job) => job.id === selectedCronJobId)) selectedCronJobId = null;
  const selected = latestCronJobs.find((job) => job.id === selectedCronJobId) || latestCronJobs[0] || null;
  selectedCronJobId = selected?.id || null;
  const signature = JSON.stringify({ jobs: latestCronJobs, selectedCronJobId, visible: cronJobsVisible });
  cronJobsPanel.classList.toggle('hidden', !cronJobsVisible);
  if (signature === renderedCronJobsSignature) return;
  renderedCronJobsSignature = signature;
  cronJobsPanel.innerHTML = `
    <div class="sessionDebugHeader">
      <strong>${formatNumber(latestCronJobs.length)} cron job${latestCronJobs.length === 1 ? '' : 's'}</strong>
      ${selected ? `<span class="sessionWarning ${statusClass(selected.lastRunStatus)}">${esc(selected.lastRunStatus || 'no status')}</span>` : ''}
    </div>
    <div class="cronJobsLayout">
      <article class="cronJobsList">
        <h3>Jobs</h3>
        ${latestCronJobs.length ? latestCronJobs.map((job) => `
          <button class="cronJobButton ${job.id === selectedCronJobId ? 'selected' : ''}" type="button" data-cron-job-id="${esc(job.id)}">
            <b>${esc(job.name)}</b>
            <span>${esc(job.scheduleLabel || 'schedule')} · ${job.enabled ? 'enabled' : 'disabled'}</span>
            <small>last ${esc(job.lastRunAtMs ? relativeTime(job.lastRunAtMs) : 'never')} · next ${esc(job.nextRunAtMs ? formatExactTime(job.nextRunAtMs) : 'unknown')}</small>
          </button>
        `).join('') : '<p><span>No cron jobs found</span></p>'}
      </article>
      <article class="cronJobDetails" id="cronJobDetails">
        ${selected ? renderCronJobDetails(selected) : '<h3>Runs</h3><p><span>No cron job selected</span></p>'}
      </article>
    </div>`;
  cronJobsPanel.querySelectorAll('[data-cron-job-id]').forEach((button) => {
    button.onclick = () => selectCronJob(button.dataset.cronJobId);
  });
  if (selected && cronJobsVisible) loadCronJobRuns(selected.id);
}

function renderCronJobDetails(job, runsData = null) {
  const runs = Array.isArray(runsData?.runs) ? runsData.runs : [];
  const status = job.lastRunStatus || 'no status';
  const delivery = job.lastDeliveryStatus || job.deliveryMode || 'none';
  return `
    <h3>${esc(job.name)}</h3>
    <p><b>${esc(status)}</b><span>${esc(job.id)}</span><small>${esc(job.scheduleLabel || '')}</small></p>
    <p><span>Agent ${esc(job.agentId || 'unknown')} · delivery ${esc(delivery)}${job.lastDurationMs ? ` · ${esc(durationLabel(job.lastDurationMs))}` : ''}</span></p>
    ${job.payloadMessage ? `<p><span>${esc(job.payloadMessage)}</span></p>` : ''}
    ${job.lastError || job.lastDiagnosticSummary ? `<p><b>Latest issue</b><span>${esc(job.lastError || job.lastDiagnosticSummary)}</span></p>` : ''}
    <h3>Recent Runs</h3>
    <div class="cronRuns" id="cronRuns">
      ${runs.length ? runs.map(renderCronRun).join('') : `<p><span>${runsData ? 'No run entries found' : 'Loading runs...'}</span></p>`}
    </div>`;
}

function renderCronRun(run) {
  const usage = run.usage || {};
  const tokenLine = Number(usage.total_tokens || 0)
    ? `${formatNumber(usage.total_tokens)} tok`
    : '';
  const status = run.status || run.action || 'run';
  const detail = [
    run.runAtMs ? formatExactTime(run.runAtMs) : null,
    run.durationMs ? durationLabel(run.durationMs) : null,
    run.deliveryStatus,
    tokenLine,
    compactModel(run.model || '')
  ].filter(Boolean).join(' · ');
  return `
    <p class="cronRun ${statusClass(status)}">
      <b>${esc(status)}</b>
      <span>${esc(run.summary || run.error || 'No summary')}</span>
      <small>${esc(detail || 'no run details')}${run.sessionId ? ` · ${esc(run.sessionId)}` : ''}</small>
    </p>`;
}

async function selectCronJob(jobId) {
  selectedCronJobId = jobId;
  renderCronJobsPanel(latestCronJobs);
}

async function loadCronJobRuns(jobId) {
  const details = cronJobsPanel.querySelector('#cronJobDetails');
  const job = latestCronJobs.find((item) => item.id === jobId);
  if (!details || !job) return;
  try {
    const runsData = await api(`/api/cron-jobs/${encodeURIComponent(jobId)}/runs?limit=24`);
    if (selectedCronJobId !== jobId) return;
    details.innerHTML = renderCronJobDetails(job, runsData);
  } catch (err) {
    if (selectedCronJobId !== jobId) return;
    details.innerHTML = `${renderCronJobDetails(job, { runs: [] })}<p><span>Unable to load runs: ${esc(err.message)}</span></p>`;
  }
}

function meetingPosition(index) {
  const seats = [
    { left: 35, top: 41 },
    { left: 65, top: 41 },
    { left: 35, top: 61 },
    { left: 65, top: 61 },
    { left: 50, top: 34 }
  ];
  return seats[index] || { left: 50 + ((index % 2) ? 18 : -18), top: 46 + Math.floor(index / 2) * 7 };
}

function updateAgentSummary(data) {
  const weeklyCost = data.weeklyCost || {};
  const signature = JSON.stringify({
    summary: data.summary,
    source: data.source,
    sessionStores: data.sessionStores || 0,
    latest: latestSessionWinner(data),
    groups: data.sessionGroupedCounts || {},
    cronJobCount: latestCronJobs.length,
    weeklyCost: {
      estimatedCostUsd: weeklyCost.estimatedCostUsd || 0,
      sessionCount: weeklyCost.sessionCount || 0,
      totalTokens: weeklyCost.totalTokens || 0
    }
  });
  if (signature === renderedAgentSummarySignature) return;
  renderedAgentSummarySignature = signature;
  agentSummary.innerHTML = `
    <article><strong>${data.summary.total}</strong><span>Total agents</span></article>
    <article><strong>${data.summary.active}</strong><span>Working</span></article>
    <article><strong>${data.summary.success || 0}</strong><span>Success</span></article>
    <article><strong>${data.summary.idle}</strong><span>Idle</span></article>
    <article><strong>${data.summary.blocked}</strong><span>Blocked</span></article>
    <article><strong>${data.source === 'sample' ? 'Sample' : 'Live'}</strong><span>${data.sessionStores || 0} session source(s)</span></article>
    <article><strong>Latest</strong><span>${esc(latestSessionWinner(data))}</span></article>
    <article><strong>Groups</strong><span>${esc(groupedSessionLine(data.sessionGroupedCounts || {}))}</span></article>
    <article><strong>${formatNumber(latestCronJobs.length)}</strong><span>Cron jobs</span></article>
    <article><strong>${formatCost(weeklyCost.estimatedCostUsd)}</strong><span>Weekly cost · ${esc(weeklyCostLine(weeklyCost))}</span></article>`;
}

function applyAgentSnapshotData(data, { randomTick = false } = {}) {
  if (randomStatusMode) {
    if (!randomTick) latestRawAgentSnapshotData = data;
    data = randomizeAgentPresentation(data);
  }
  latestAgentSnapshotData = data;
  setAvatarVariantRegistry(data.avatarVariants);
  latestCronJobs = Array.isArray(data.cronJobs) ? data.cronJobs : [];
  updateAgentSummary(data);
  if (sessionDebugVisible) renderSessionDebugPanel(data);
  if (cronJobsVisible) renderCronJobsPanel(latestCronJobs);
  officeSceneConfig = normalizeOfficeSceneConfig(data.officeScene);
  const agents = Array.isArray(data.agents) ? data.agents : [];
  if (!agents.length && !data.openClawWarning && waitForAgentDiscovery()) return;
  if (!agents.length) renderNoAgentsAvailable();
  else {
    resetAgentDiscovery();
    if (companionMode && companionView === 'avatar') renderCompanionAvatar(agents);
    else if (agentDisplayMode === 'pixel') renderPixelOffice(agents, data.latestSessions?.[0]);
    else renderAgentCards(agents);
  }
}

function randomizeAgentPresentation(data = {}) {
  const statuses = [
    { status: 'active', displayState: 'Working' },
    { status: 'success', displayState: 'Success' },
    { status: 'idle', displayState: 'Idle' },
    { status: 'blocked', displayState: 'Blocked' }
  ];
  const variants = (Array.isArray(data.avatarVariants) ? data.avatarVariants : [])
    .map((variant) => String(variant?.id || '').trim())
    .filter(Boolean);
  const configuredAgents = data.source === 'sample'
    ? []
    : Array.isArray(data.agents) ? data.agents : [];
  let agents = configuredAgents;
  if (!agents.length) {
    const id = 'random-showcase-agent';
    let avatarVariant = randomizedVariantByAgent.get(id);
    if (!avatarVariant || !variants.includes(avatarVariant)) {
      avatarVariant = variants[Math.floor(Math.random() * variants.length)] || AVATAR_VARIANT_FALLBACK;
      randomizedVariantByAgent.set(id, avatarVariant);
    }
    agents = [{
      id,
      name: 'Random Folk',
      role: 'Showcase agent',
      source: 'random',
      status: 'idle',
      displayState: 'Idle',
      task: 'Random status showcase',
      avatarVariant,
      lastSeen: new Date().toISOString(),
      activity: { status: 'idle', derivedStatus: 'idle', updatedAt: Date.now() }
    }];
  }
  const now = Date.now();
  const visibleAgentIds = new Set(agents.map((agent, index) => String(agent.id || index)));
  for (const agentId of randomizedStatusByAgent.keys()) {
    if (!visibleAgentIds.has(agentId)) randomizedStatusByAgent.delete(agentId);
  }
  const randomizedAgents = agents.map((agent, index) => {
    const agentId = String(agent.id || index);
    let next = randomizedStatusByAgent.get(agentId);
    if (!next || now >= next.nextChangeAt) {
      const previousStatus = next?.status || agent.status;
      const statusChoices = statuses.filter((candidate) => candidate.status !== previousStatus);
      const selected = statusChoices[Math.floor(Math.random() * statusChoices.length)] || statuses[0];
      next = {
        ...selected,
        nextChangeAt: now + RANDOM_STATUS_MIN_MS
          + Math.floor(Math.random() * (RANDOM_STATUS_MAX_MS - RANDOM_STATUS_MIN_MS + 1))
      };
      randomizedStatusByAgent.set(agentId, next);
    }
    return {
      ...agent,
      status: next.status,
      displayState: next.displayState,
      pose: undefined,
      activity: agent.activity ? {
        ...agent.activity,
        status: next.displayState.toLowerCase(),
        derivedStatus: next.status
      } : agent.activity
    };
  });
  scheduleRandomStatusRefresh();
  return {
    ...data,
    agents: randomizedAgents
  };
}

function scheduleRandomStatusRefresh() {
  clearTimeout(randomStatusTimer);
  const nextChangeAt = Math.min(
    ...[...randomizedStatusByAgent.values()].map((entry) => entry.nextChangeAt)
  );
  if (!Number.isFinite(nextChangeAt)) return;
  randomStatusTimer = setTimeout(() => {
    applyAgentSnapshotData(latestRawAgentSnapshotData, { randomTick: true });
  }, Math.max(0, nextChangeAt - Date.now()));
}

function renderAgentLoadError(error) {
  resetAgentDiscovery();
  const avatarCompanion = companionMode && companionView === 'avatar';
  if (avatarCompanion) {
    renderedCompanionAgentId = '';
    renderedCompanionAgentSignature = '';
  }
  officeMap.className = avatarCompanion
    ? 'companionAvatarStage'
    : companionMode ? 'officeMap pixelOfficeWrap agentLoadError' : 'officeMap agentLoadError';
  officeMap.dataset.renderState = 'error';
  officeMap.innerHTML = `
    <div class="${avatarCompanion ? 'companionAvatarEmpty' : 'emptyOffice'} agentLoadFailure">
      <span>Unable to load agents: ${esc(error.message || error)}</span>
      <button class="agentLoadRefreshBtn" type="button" data-companion-interactive>Refresh</button>
    </div>`;
  officeMap.querySelector('.agentLoadRefreshBtn')?.addEventListener('click', refreshAgents);
}

function applyDesktopAgentSnapshot(snapshot) {
  if (!snapshot) return;
  const version = Number(snapshot.version) || 0;
  if (snapshot.data && version <= latestDesktopSnapshotVersion) return;
  if (snapshot.data) {
    latestDesktopSnapshotVersion = version;
    applyAgentSnapshotData(snapshot.data);
  } else if (snapshot.error) {
    renderAgentLoadError(snapshot.error);
  }
}

async function loadAgents() {
  if (agentRefreshInFlight) return;
  agentRefreshInFlight = true;
  const requestGeneration = ++agentRequestGeneration;
  if (!officeMap.firstElementChild) renderAgentDiscoveryLoading();
  let requestController = null;
  let requestTimeout = null;
  try {
    if (usesDesktopAgentSnapshots()) {
      const snapshot = await window.taskfolkDesktop.getAgentSnapshot();
      if (requestGeneration !== agentRequestGeneration) return;
      applyDesktopAgentSnapshot(snapshot);
      return;
    }
    requestController = new AbortController();
    agentRequestController = requestController;
    requestTimeout = setTimeout(() => requestController.abort(), AGENT_REQUEST_TIMEOUT_MS);
    const data = await api(`/api/agents?t=${Date.now()}`, {
      cache: 'no-store',
      signal: requestController.signal
    });
    if (requestGeneration !== agentRequestGeneration) return;
    applyAgentSnapshotData(data);
  } catch (err) {
    if (requestGeneration !== agentRequestGeneration) return;
    renderAgentLoadError(err);
  } finally {
    if (requestTimeout) clearTimeout(requestTimeout);
    if (requestGeneration === agentRequestGeneration) {
      agentRequestController = null;
      agentRefreshInFlight = false;
      scheduleAgentRefresh();
    }
  }
}

async function refreshAgents() {
  if (!usesDesktopAgentSnapshots()) return loadAgents();
  try {
    const snapshot = await window.taskfolkDesktop.refreshAgentSnapshot();
    applyDesktopAgentSnapshot(snapshot);
  } catch (error) {
    renderAgentLoadError(error);
  }
}

function forceReloadAgents() {
  if (companionMode) {
    window.dispatchEvent(new Event('taskfolk:force-reload'));
    return;
  }
  agentRequestGeneration += 1;
  agentRequestController?.abort();
  agentRequestController = null;
  agentRefreshInFlight = false;
  resetAgentDiscovery();
  renderAgentDiscoveryLoading();
  loadAgents();
}

function refreshAgentsAfterSystemResume() {
  agentRequestGeneration += 1;
  agentRequestController?.abort();
  agentRequestController = null;
  agentRefreshInFlight = false;
  agentDiscoveryStartedAt = Date.now();
  preserveAgentsDuringWakeRecovery = true;
  clearAgentDiscoveryRetry();
  if (currentView !== 'agents') return;
  loadAgents();
}

function agentMeta(agent) {
  return `${relativeTime(agent.lastSeen)}${agent.sessionFile ? ` · ${agent.sessionFile}` : ''}${agent.logFile ? ` · ${agent.logFile}` : ''}`;
}

function agentCardSignature(agent) {
  const activity = agent.activity || {};
  return JSON.stringify({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    displayState: agent.displayState,
    task: agent.task,
    sessions: agent.sessions,
    workspacePath: agent.workspacePath,
    sessionFile: agent.sessionFile,
    logFile: agent.logFile,
    activity: {
      channelBadge: activity.channelBadge,
      status: activity.status,
      derivedStatus: activity.derivedStatus,
      sessionKeyShort: activity.sessionKeyShort,
      startedAt: activity.startedAt,
      endedAt: activity.endedAt,
      runtimeMs: activity.startedAt && !activity.endedAt ? null : activity.runtimeMs,
      totalTokens: activity.totalTokens,
      inputTokens: activity.inputTokens,
      outputTokens: activity.outputTokens,
      estimatedCostUsd: activity.estimatedCostUsd,
      agentHarnessId: activity.agentHarnessId,
      sandboxed: activity.sandboxed,
      sandboxMode: activity.sandboxMode,
      timestampSource: activity.timestampSource,
      skills: activity.skills
    }
  });
}

function updateAgentCard(desk, agent, signature) {
  const activity = agent.activity || {};
  const tokenLine = tokenCostLine(activity);
  const runtime = durationLabel(runDuration(agent));
  const skills = Array.isArray(activity.skills) ? activity.skills.slice(0, 4) : [];
  const extraBadges = [
    activity.channelBadge,
    activity.status ? `raw ${activity.status}` : null,
    activity.derivedStatus ? `ui ${activity.derivedStatus}` : null,
    agent.sessions ? `${agent.sessions} sessions` : null
  ].filter(Boolean);
  const detailRows = [
    agent.workspacePath ? { label: 'Workspace', value: agent.workspacePath } : null,
    activity.sessionKeyShort ? { label: 'Session', value: activity.sessionKeyShort } : null,
    runtime ? { label: 'Runtime', value: runtime, live: 'runtime' } : null,
    tokenLine ? { label: 'Tokens', value: tokenLine } : null,
    activity.agentHarnessId ? { label: 'Harness', value: activity.agentHarnessId } : null,
    activity.sandboxed || activity.sandboxMode ? { label: 'Sandbox', value: activity.sandboxMode || 'sandboxed' } : null,
    activity.timestampSource ? { label: 'Timestamp source', value: activity.timestampSource } : null
  ].filter(Boolean);
  desk.className = `agentDesk ${agent.status}`;
  desk.dataset.agentId = String(agent.id || '');
  desk.dataset.renderSignature = signature;
  desk.innerHTML = `
    <div class="agentAvatar">${esc(agent.name).slice(0, 1).toUpperCase()}</div>
    <div>
      <h3>${esc(agent.name)}</h3>
      <p>${esc(agent.role)}</p>
      <div class="agentBadges">
        <span>${esc(agentStateLabel(agent))}</span>
        ${extraBadges.map((badge) => `<span>${esc(badge)}</span>`).join('')}
      </div>
      <small>${esc(agent.task)}</small>
      ${detailRows.length ? `<dl class="agentDetails">${detailRows.map(({ label, value, live }) => `<div><dt>${esc(label)}</dt><dd${live ? ` data-agent-live="${live}"` : ''}>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
      ${skills.length ? `<div class="agentSkills">${skills.map((skill) => `<span>${esc(skill)}</span>`).join('')}</div>` : ''}
      <small class="agentMeta">${esc(agentMeta(agent))}</small>
    </div>`;
}

function updateAgentCardLiveText(desk, agent) {
  const meta = desk.querySelector('.agentMeta');
  if (meta) meta.textContent = agentMeta(agent);
  const runtime = desk.querySelector('[data-agent-live="runtime"]');
  if (runtime) runtime.textContent = durationLabel(runDuration(agent));
}

function renderAgentCards(agents) {
  officeMap.className = 'officeMap';
  officeMap.dataset.renderState = 'cards';
  if ([...officeMap.children].some((child) => !child.classList.contains('agentDesk'))) {
    officeMap.replaceChildren();
  }
  const existing = new Map(
    [...officeMap.querySelectorAll('.agentDesk[data-agent-id]')]
      .map((desk) => [desk.dataset.agentId, desk])
  );
  agents.forEach((agent, index) => {
    const agentId = String(agent.id || '');
    const signature = agentCardSignature(agent);
    const desk = existing.get(agentId) || document.createElement('article');
    if (desk.dataset.renderSignature !== signature) updateAgentCard(desk, agent, signature);
    else updateAgentCardLiveText(desk, agent);
    const currentAtIndex = officeMap.children[index];
    if (currentAtIndex !== desk) officeMap.insertBefore(desk, currentAtIndex || null);
    existing.delete(agentId);
  });
  for (const desk of existing.values()) desk.remove();
}

function pixelPosition(index, total) {
  if (total === 1) return { left: 50, top: 56 };
  if (total === 2) {
    return [
      { left: 38, top: 56 },
      { left: 62, top: 56 }
    ][index];
  }
  if (total > 8) {
    const columns = Math.min(8, Math.max(4, Math.ceil(total / 3)));
    const rows = Math.ceil(total / columns);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const leftStep = columns > 1 ? 80 / (columns - 1) : 0;
    const topStep = rows > 1 ? 60 / (rows - 1) : 0;
    return {
      left: columns > 1 ? 10 + col * leftStep : 50,
      top: rows > 1 ? 25 + row * topStep : 58
    };
  }
  const slots = [
    { left: 16, top: 32 },
    { left: 38, top: 32 },
    { left: 62, top: 32 },
    { left: 84, top: 32 },
    { left: 16, top: 76 },
    { left: 38, top: 76 },
    { left: 62, top: 76 },
    { left: 84, top: 76 }
  ];
  if (index < slots.length) return slots[index];
  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  return {
    left: 50 + Math.cos(angle) * 32,
    top: 56 + Math.sin(angle) * 22
  };
}

function rectsOverlap(a, b) {
  return Math.abs(a.left - b.left) * 2 < (a.width + b.width)
    && Math.abs(a.top - b.top) * 2 < (a.height + b.height);
}

function decorStyle(item) {
  const size = item.sizeStyle ? `width:${item.width}%;height:${item.height}%;` : '';
  return `left:${item.left}%;right:auto;top:${item.top}%;${size}`;
}

function renderPixelFloorDecor(agents, roomState, sceneConfig) {
  const agentCount = agents.length;
  const totalOccupants = agentCount + sceneConfig.emptyDesks;
  if (totalOccupants > 8) return '';
  const occupied = Array.from({ length: totalOccupants }, (_, index) => {
    const position = pixelPosition(index, totalOccupants);
    return { ...position, width: 18, height: 22 };
  });
  const placed = [];
  const addDecor = (item) => {
    const box = { left: item.left + item.width / 2, top: item.top + item.height / 2, width: item.width, height: item.height };
    if ([...occupied, ...placed].some((other) => rectsOverlap(box, other))) return '';
    placed.push(box);
    return item.markup(decorStyle(item));
  };
  if (agentCount > 6) {
    return [
      addDecor({ left: 5, top: 10, width: 7, height: 18, sizeStyle: true, markup: (style) => `<div class="pixelPlant" style="${style}" aria-hidden="true"></div>` }),
      addDecor({ left: 88, top: 10, width: 7, height: 18, sizeStyle: true, markup: (style) => `<div class="pixelPlant" style="${style}" aria-hidden="true"></div>` })
    ].join('');
  }
  const decor = [
    { left: 5, top: 10, width: 7, height: 18, sizeStyle: true, markup: (style) => `<div class="pixelPlant" style="${style}" aria-hidden="true"></div>` },
    { left: 88, top: 10, width: 7, height: 18, sizeStyle: true, markup: (style) => `<div class="pixelPlant" style="${style}" aria-hidden="true"></div>` },
    { left: 37, top: 5, width: 26, height: 17, sizeStyle: true, markup: (style) => `<div class="pixelCouch pixelLoungeCouch" style="${style}" aria-hidden="true"></div>` },
    { left: 5, top: 31, width: 5, height: 13, markup: (style) => `<div class="pixelFloorFurniture pixelFloorCoffeeMachine" style="${style}" aria-hidden="true"></div>` },
    { left: 86, top: 31, width: 8, height: 32, markup: (style) => `<div class="pixelFloorFurniture pixelFloorServerRack" style="${style}" aria-hidden="true"></div>` },
    { left: 86, top: 58, width: 7, height: 16, sizeStyle: true, markup: (style) => `<div class="pixelPlant loungePlant" style="${style}" aria-hidden="true"></div>` }
  ];
  return decor.map(addDecor).join('');
}

function pixelRole(agent) {
  const text = `${agent.id || ''} ${agent.name || ''} ${agent.role || ''}`.toLowerCase();
  if (/review|qa|quality|check/.test(text)) return 'reviewer';
  if (/ops|monitor|deploy|infra|health/.test(text)) return 'ops';
  if (/code|coder|build|dev|engineer/.test(text)) return 'coder';
  if (/main|coord|lead|manager/.test(text)) return 'main';
  return 'agent';
}

function avatarVariant(agent) {
  const raw = String(agent.avatarVariant ?? '').trim();
  return avatarVariantIds.has(raw) ? raw : AVATAR_VARIANT_FALLBACK;
}

function setAvatarVariantRegistry(value) {
  const ids = Array.isArray(value)
    ? value.map((variant) => String(variant?.id || '').trim()).filter(Boolean)
    : [];
  avatarVariantIds = new Set(ids.includes(AVATAR_VARIANT_FALLBACK) ? ids : [AVATAR_VARIANT_FALLBACK]);
}

function pixelRoomState(agents) {
  const active = agents.filter((agent) => agent.status === 'active').length;
  const success = agents.filter((agent) => agent.status === 'success').length;
  const blocked = agents.filter((agent) => agent.status === 'blocked').length;
  const idle = agents.filter((agent) => agent.status === 'idle').length;
  const meetingMode = active > 1;
  return {
    active,
    success,
    blocked,
    idle,
    meetingMode,
    timeClass: effectiveOfficeTimeClass(),
    officeClass: [
      active === agents.length && agents.length ? 'allActive' : '',
      idle === agents.length && agents.length ? 'allIdle' : '',
      meetingMode ? 'meetingMode' : '',
      blocked ? 'errorMode' : ''
    ].filter(Boolean).join(' ')
  };
}

function posterImagePath(index) {
  const poster = Math.max(0, Math.min(OFFICE_POSTER_COUNT - 1, Number(index) || 0));
  return `office-scenes/posters/poster${poster + 1}.jpeg`;
}

function renderPixelPoster(sceneConfig) {
  const posterSrc = posterImagePath(sceneConfig.poster);
  return `
    <div class="pixelWallPoster" aria-hidden="true">
      <img src="${posterSrc}" alt="" draggable="false" />
    </div>`;
}

function pixelLatestSessionState(latest = {}) {
  const statusText = `${latest.status || ''} ${latest.derivedStatus || ''}`.toLowerCase();
  if (/\b(error|failed|failure|exception|blocked|fatal|aborted|cancelled|canceled)\b/.test(statusText)) return 'blocked';
  if (/\b(active|running|working|busy|streaming|processing|in[-_ ]?progress|started)\b/.test(statusText)) return 'active';
  if (/\b(done|complete|completed|finished|success|succeeded)\b/.test(statusText)) return 'done';
  return latest.derivedStatus === 'active' ? 'active' : 'done';
}

function renderPixelLatestSession(latest) {
  if (!latest) {
    return `
      <div class="pixelLatestSession empty">
        <span class="pixelLatestDot done" aria-hidden="true"></span>
        <div><strong>Latest session</strong><em>standby</em></div>
      </div>`;
  }
  const state = pixelLatestSessionState(latest);
  const name = latest.shortKey || latest.key || 'session';
  const model = compactModel(latest.model || '') || 'unknown';
  const status = latest.status || latest.derivedStatus || 'unknown';
  return `
    <div class="pixelLatestSession ${esc(state)}" title="${esc(name)}">
      <span class="pixelLatestDot ${esc(state)}" aria-hidden="true"></span>
      <div>
        <strong>Latest session</strong>
        <em>${esc(name)}</em>
        <small>${esc(latest.channelBadge || 'session')} · ${esc(status)} · ${esc(model)}</small>
      </div>
    </div>`;
}

function pixelAgentPresentation(agent, index, agents, sceneConfig, roomState) {
  const useMeetingPose = roomState.meetingMode && agent.status === 'active';
  const position = pixelPosition(index, agents.length + sceneConfig.emptyDesks);
  const thoughtId = `pixel-agent-thought-${index}`;
  const signature = JSON.stringify({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    stateLabel: agentStateLabel(agent),
    task: agent.task,
    role: pixelRole(agent),
    activityLevel: activityLevel(agent),
    ageClass: agentAgeClass(agent),
    pose: pixelAgentPose(agent, useMeetingPose),
    variant: avatarVariant(agent),
    useMeetingPose
  });
  return { useMeetingPose, position, thoughtId, signature };
}

function pixelOfficeLayoutSignature(agents, sceneConfig) {
  return JSON.stringify({
    sceneConfig,
    agentIds: agents.map((agent) => String(agent.id || ''))
  });
}

function pixelLatestSessionSignature(latestSession) {
  if (!latestSession) return 'empty';
  return JSON.stringify({
    key: latestSession.key,
    shortKey: latestSession.shortKey,
    status: latestSession.status,
    derivedStatus: latestSession.derivedStatus,
    channelBadge: latestSession.channelBadge,
    model: latestSession.model
  });
}

function updatePixelOfficeState(agents, latestSession, roomState, metrics, sceneConfig) {
  const scene = officeMap.querySelector('.pixelOfficeScene');
  if (scene) {
    scene.className = `pixelOfficeScene ${roomState.timeClass} floor-${sceneConfig.floor} window-${sceneConfig.windowView} ${agents.length > 8 ? 'crowdedOffice' : ''} ${agents.length > 14 ? 'denseOffice' : ''} ${agents.length > 20 ? 'packedOffice' : ''} ${roomState.officeClass}`;
  }
  const roomCounts = {
    working: roomState.active,
    success: roomState.success,
    idle: roomState.idle,
    blocked: roomState.blocked
  };
  for (const [state, count] of Object.entries(roomCounts)) {
    const element = officeMap.querySelector(`[data-office-state="${state}"]`);
    if (element) element.textContent = String(count);
  }
  const agentCount = officeMap.querySelector('[data-office-agent-count]');
  if (agentCount) agentCount.textContent = String(agents.length);

  const latestSignature = pixelLatestSessionSignature(latestSession);
  if (latestSignature !== renderedPixelLatestSessionSignature) {
    const currentLatest = officeMap.querySelector('.pixelLatestSession');
    if (currentLatest) currentLatest.outerHTML = renderPixelLatestSession(latestSession);
    renderedPixelLatestSessionSignature = latestSignature;
  }

  const latestTime = officeMap.querySelector('[data-office-latest-time]');
  if (latestTime) latestTime.textContent = formatTimestamp(metrics.latestMs);
  const latestRelative = officeMap.querySelector('[data-office-latest-relative]');
  if (latestRelative) latestRelative.textContent = `updated ${relativeTime(metrics.latestMs)}`;
  const freshness = officeMap.querySelector('[data-office-freshness]');
  if (freshness) {
    freshness.style.width = `${Math.max(12, Math.min(100, Math.round(((Date.now() - (metrics.latestMs || Date.now())) / 1000 / 60) * 10))) % 100}%`;
  }
  const cost = officeMap.querySelector('[data-office-cost]');
  if (cost) cost.textContent = formatCost(metrics.estimatedCostUsd);
  const tokens = officeMap.querySelector('[data-office-tokens]');
  if (tokens) tokens.textContent = `${Math.round(metrics.totalTokens / 1000)}k`;
  const runtime = officeMap.querySelector('[data-office-runtime]');
  if (runtime) runtime.textContent = durationLabel(metrics.avgRuntime);
}

function bindPixelAgentInteractions(agentElement) {
  agentElement.addEventListener('pointerenter', () => fitPixelThoughtBubble(agentElement));
  agentElement.addEventListener('focus', () => fitPixelThoughtBubble(agentElement));
}

function updatePixelAgentElement(agentElement, labelElement, agent, presentation) {
  const { useMeetingPose, position, thoughtId, signature } = presentation;
  agentElement.className = `pixelAgent ${agent.status} ${useMeetingPose ? 'meeting' : ''} role-${pixelRole(agent)} ${activityLevel(agent)} ${agentAgeClass(agent)}`;
  agentElement.style.left = `${position.left}%`;
  agentElement.style.top = `${position.top}%`;
  agentElement.setAttribute('aria-label', `${agent.name} is ${agentStateLabel(agent)}`);
  agentElement.setAttribute('aria-describedby', thoughtId);
  agentElement.dataset.renderSignature = signature;
  agentElement.innerHTML = `
    <div class="pixelAgentThought" id="${thoughtId}" role="tooltip">${esc(agent.task)}</div>
    ${pixelAgentScene(agent, useMeetingPose)}`;
  if (labelElement) {
    labelElement.className = `pixelAgentName ${agent.status}`;
    labelElement.style.left = `${position.left}%`;
    labelElement.style.top = `${position.top + 3}%`;
    labelElement.textContent = agent.name;
  }
  bindPixelAgentInteractions(agentElement);
}

function updateChangedPixelAgents(agents, sceneConfig, roomState) {
  const agentElements = new Map(
    [...officeMap.querySelectorAll('.pixelAgent[data-agent-id]')]
      .map((element) => [element.dataset.agentId, element])
  );
  const labelElements = new Map(
    [...officeMap.querySelectorAll('.pixelAgentName[data-agent-id]')]
      .map((element) => [element.dataset.agentId, element])
  );
  agents.forEach((agent, index) => {
    const agentId = String(agent.id || '');
    const agentElement = agentElements.get(agentId);
    if (!agentElement) return;
    const presentation = pixelAgentPresentation(agent, index, agents, sceneConfig, roomState);
    if (agentElement.dataset.renderSignature === presentation.signature) return;
    updatePixelAgentElement(agentElement, labelElements.get(agentId), agent, presentation);
  });
}

function fitPixelThoughtBubble(agentElement) {
  const bubble = agentElement.querySelector('.pixelAgentThought');
  const scene = agentElement.closest('.pixelOfficeScene');
  if (!bubble || !scene) return;

  const agentRect = agentElement.getBoundingClientRect();
  const sceneRect = scene.getBoundingClientRect();
  const bubbleWidth = bubble.offsetWidth;
  const pageInset = 12;
  const boundaryLeft = Math.max(pageInset, sceneRect.left + pageInset);
  const boundaryRight = Math.min(window.innerWidth - pageInset, sceneRect.right - pageInset);
  const centeredLeft = agentRect.left + agentRect.width / 2 - bubbleWidth / 2;
  let shift = 0;

  if (centeredLeft < boundaryLeft) shift = boundaryLeft - centeredLeft;
  if (centeredLeft + bubbleWidth + shift > boundaryRight) {
    shift += boundaryRight - (centeredLeft + bubbleWidth + shift);
  }

  const tailPosition = Math.max(18, Math.min(bubbleWidth - 18, bubbleWidth / 2 - shift));
  bubble.style.setProperty('--thought-shift', `${Math.round(shift)}px`);
  bubble.style.setProperty('--thought-tail', `${Math.round(tailPosition)}px`);
}

function fitCompanionThoughtBubble(agentElement) {
  const bubble = agentElement.querySelector('.companionAgentThought');
  const stage = agentElement.closest('.companionAvatarStage');
  if (!bubble || !stage) return;

  const minimumFontSize = 7;
  const stageInset = 6;
  const thoughtTailHeight = 23;
  bubble.style.removeProperty('--companion-thought-font-size');

  const stageRect = stage.getBoundingClientRect();
  let fontSize = Number.parseFloat(window.getComputedStyle(bubble).fontSize);
  if (!Number.isFinite(fontSize)) return;

  const bubbleFits = () => {
    const bubbleRect = bubble.getBoundingClientRect();
    return bubbleRect.left >= stageRect.left + stageInset
      && bubbleRect.right <= stageRect.right - stageInset
      && bubbleRect.top >= stageRect.top + stageInset
      && bubbleRect.bottom + thoughtTailHeight <= stageRect.bottom - stageInset;
  };

  while (fontSize > minimumFontSize && !bubbleFits()) {
    fontSize = Math.max(minimumFontSize, fontSize - 0.5);
    bubble.style.setProperty('--companion-thought-font-size', `${fontSize}px`);
  }
}

function renderPixelOffice(agents, latestSession = null) {
  officeMap.className = 'officeMap pixelOfficeWrap';
  officeMap.dataset.renderState = 'pixel';
  const roomState = pixelRoomState(agents);
  const metrics = officeMetrics(agents);
  const sceneConfig = normalizeOfficeSceneConfig(officeSceneConfig);
  const signature = pixelOfficeLayoutSignature(agents, sceneConfig);
  if (signature === renderedPixelOfficeSignature && officeMap.querySelector('.pixelOfficeScene')) {
    updateChangedPixelAgents(agents, sceneConfig, roomState);
    updatePixelOfficeState(agents, latestSession, roomState, metrics, sceneConfig);
    return;
  }
  renderedPixelOfficeSignature = signature;
  renderedPixelLatestSessionSignature = pixelLatestSessionSignature(latestSession);
  const emptyDesks = Array.from({ length: sceneConfig.emptyDesks }, (_, index) => {
    const position = pixelPosition(agents.length + index, agents.length + sceneConfig.emptyDesks);
    return `
      <article class="pixelEmptyDesk" style="left:${position.left}%;top:${position.top}%;" aria-label="Empty desk">
        <div class="pixelFloorFurniture pixelFloorDesk"></div>
      </article>`;
  }).join('');
  const labels = [];
  const people = agents.map((agent, index) => {
    const { useMeetingPose, position, thoughtId, signature: agentSignature } = pixelAgentPresentation(
      agent,
      index,
      agents,
      sceneConfig,
      roomState
    );
    labels.push(`
      <span class="pixelAgentName ${esc(agent.status)}" data-agent-id="${esc(agent.id || '')}" style="left:${position.left}%;top:${position.top + 3}%;">${esc(agent.name)}</span>`);
    return `
      <article class="pixelAgent ${esc(agent.status)} ${useMeetingPose ? 'meeting' : ''} role-${pixelRole(agent)} ${activityLevel(agent)} ${agentAgeClass(agent)}" data-agent-id="${esc(agent.id || '')}" data-render-signature="${esc(agentSignature)}" style="left:${position.left}%;top:${position.top}%;" tabindex="0" aria-label="${esc(agent.name)} is ${esc(agentStateLabel(agent))}" aria-describedby="${thoughtId}">
        <div class="pixelAgentThought" id="${thoughtId}" role="tooltip">${esc(agent.task)}</div>
        ${pixelAgentScene(agent, useMeetingPose)}
      </article>`;
  }).join('');

  officeMap.innerHTML = `
    <div class="pixelOfficeScene ${roomState.timeClass} floor-${sceneConfig.floor} window-${sceneConfig.windowView} ${agents.length > 8 ? 'crowdedOffice' : ''} ${agents.length > 14 ? 'denseOffice' : ''} ${agents.length > 20 ? 'packedOffice' : ''} ${roomState.officeClass}">
      <div class="pixelWall">
        <div class="pixelWindow"></div>
        ${renderPixelPoster(sceneConfig)}
        <div class="pixelStatusBoard">
          <div class="pixelStatusBoardHeader">
            <span>Wall status board</span>
            <strong data-office-latest-time>${formatTimestamp(metrics.latestMs)}</strong>
          </div>
          <div class="pixelStatusLights">
            <span class="working" data-office-state="working" title="Working">${roomState.active}</span>
            <span class="success" data-office-state="success" title="Success">${roomState.success}</span>
            <span class="idle" data-office-state="idle" title="Idle">${roomState.idle}</span>
            <span class="blocked" data-office-state="blocked" title="Blocked">${roomState.blocked}</span>
          </div>
          ${renderPixelLatestSession(latestSession)}
          <div class="pixelStatusBoardStats">
            <div><strong data-office-agent-count>${agents.length}</strong><span>Agents</span></div>
            <div><strong data-office-cost>${formatCost(metrics.estimatedCostUsd)}</strong><span>Cost</span></div>
            <div><strong data-office-tokens>${Math.round(metrics.totalTokens / 1000)}k</strong><span>Tokens</span></div>
            <div><strong data-office-runtime>${durationLabel(metrics.avgRuntime)}</strong><span>Avg run</span></div>
          </div>
          <div class="pixelStatusStrip">
            <span class="fill" data-office-freshness style="width:${Math.max(12, Math.min(100, Math.round(((Date.now() - (metrics.latestMs || Date.now())) / 1000 / 60) * 10))) % 100}%"></span>
            <em data-office-latest-relative>updated ${relativeTime(metrics.latestMs)}</em>
          </div>
        </div>
        <div class="pixelCabinet"></div>
      </div>
      <div class="pixelFloor">
        <div class="pixelFoodDistributor" aria-hidden="true"></div>
        <div class="pixelFloorBookcase" aria-hidden="true"></div>
        ${renderPixelFloorDecor(agents, roomState, sceneConfig)}
        ${emptyDesks}
        ${people}
        ${labels.join('')}
      </div>
    </div>`;

  for (const agentElement of officeMap.querySelectorAll('.pixelAgent')) {
    bindPixelAgentInteractions(agentElement);
  }
}

function renderCompanionAvatar(agents) {
  officeMap.className = 'companionAvatarStage';
  officeMap.dataset.renderState = 'companion';
  const agent = companionAgentId === MOST_RECENT_AGENT_ID
    ? [...agents].sort((left, right) => agentRecencyMs(right) - agentRecencyMs(left))[0]
    : agents.find((candidate) => String(candidate.id) === companionAgentId) || agents[0];
  if (!agent) {
    renderedCompanionAgentId = '';
    renderedCompanionAgentSignature = '';
    officeMap.innerHTML = `
      <div class="companionAvatarEmpty agentLoadFailure">
        <span>No agents are available.</span>
        <button class="agentLoadRefreshBtn" type="button" data-companion-interactive>Refresh</button>
      </div>`;
    officeMap.querySelector('.agentLoadRefreshBtn')?.addEventListener('click', loadAgents);
    return;
  }
  const agentId = String(agent.id || '');
  const scenePose = pixelAgentPose(agent, false);
  const signature = [
    agentId,
    agent.name,
    agent.status,
    scenePose,
    agent.displayState,
    agent.avatarVariant,
    agent.task
  ].join(':');
  if (signature === renderedCompanionAgentSignature) return;
  const switchedAgent = Boolean(renderedCompanionAgentId && renderedCompanionAgentId !== agentId);
  renderedCompanionAgentId = agentId;
  renderedCompanionAgentSignature = signature;
  const showWorkingThought = agent.status === 'active';
  officeMap.innerHTML = `
    <article class="companionAvatar ${switchedAgent ? 'companionAvatar--enter' : ''} ${esc(agent.status)}" tabindex="0" aria-label="${esc(agent.name)} is ${esc(agentStateLabel(agent))}"${showWorkingThought ? ' aria-describedby="companion-agent-thought"' : ''}>
      ${showWorkingThought ? `<div class="companionAgentThought" id="companion-agent-thought" role="tooltip">${esc(agent.task)}</div>` : ''}
      ${pixelAgentScene(agent, false)}
      <div class="companionAvatarName">${esc(agent.name || agent.id || 'Agent')}</div>
    </article>`;

  const companionAvatar = officeMap.querySelector('.companionAvatar');
  if (showWorkingThought && companionAvatar) {
    const fitThoughtBubble = () => window.requestAnimationFrame(
      () => fitCompanionThoughtBubble(companionAvatar)
    );
    companionAvatar.addEventListener('pointerenter', fitThoughtBubble);
    companionAvatar.addEventListener('focus', fitThoughtBubble);
  }
}

function timestampCandidateMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function agentRecencyMs(agent = {}) {
  const activity = agent.activity || {};
  return Math.max(
    timestampCandidateMs(agent.lastSeen),
    timestampCandidateMs(agent.updatedAt),
    timestampCandidateMs(activity.updatedAt),
    timestampCandidateMs(activity.lastInteractionAt),
    timestampCandidateMs(activity.lastMessageAt),
    timestampCandidateMs(activity.timestamp)
  );
}

function pixelAgentPose(agent, meetingMode = false) {
  // Runtime agents share the same recency-based idle animation policy. Manual
  // agents keep their explicitly selected states (Reading, Sleeping, etc.).
  if (agent.status === 'success') return 'success';
  if (agent.status === 'idle' && agent.source !== 'manual') return idlePose(agent);
  if (agent.pose && !meetingMode) return agent.pose;
  if (agent.status === 'idle') return idlePose(agent);
  if (meetingMode) return 'meeting';
  return agent.status === 'blocked' ? 'blocked' : 'working';
}

function pixelAgentScene(agent, meetingMode = false) {
  const name = esc(agent.name);
  const role = pixelRole(agent);
  const variant = avatarVariant(agent);
  return window.SceneArt.sceneMarkup({
    pose: pixelAgentPose(agent, meetingMode),
    role,
    label: name,
    variant,
    animationKey: agent.id,
    showLabel: false
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function fmtSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function esc(text) {
  return String(text).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function setPreviewEmpty(message = 'Select a text or image file.') {
  currentPreview = null;
  editPreviewBtn.classList.add('hidden');
  previewName.textContent = 'No file selected';
  previewBody.className = 'previewBody empty';
  previewBody.textContent = message;
}

function showPreviewPanel() {
  previewPanel.classList.remove('hidden');
  previewPanel.setAttribute('aria-hidden', 'false');
}

function hidePreviewPanel() {
  setPreviewFullscreen(false);
  previewPanel.classList.add('hidden');
  previewPanel.setAttribute('aria-hidden', 'true');
  setPreviewEmpty();
}

function setPreviewFullscreen(enabled) {
  document.body.classList.toggle('preview-fullscreen', enabled);
  fullscreenPreviewBtn.textContent = enabled ? 'Exit full page' : 'Full page';
  fullscreenPreviewBtn.setAttribute('aria-pressed', String(enabled));
}

function togglePreviewFullscreen() {
  setPreviewFullscreen(!document.body.classList.contains('preview-fullscreen'));
}

function applyModulesConfig(config = {}) {
  const folderViewWasEnabled = modulesConfig.folderView.enabled;
  const hasFolderViewEnabled = Object.prototype.hasOwnProperty.call(config.folderView || {}, 'enabled');
  modulesConfig = {
    folderView: {
      enabled: hasFolderViewEnabled ? config.folderView.enabled !== false : false
    }
  };
  viewToggleBtn?.classList.toggle('hidden', !modulesConfig.folderView.enabled);
  if (!modulesConfig.folderView.enabled && currentView === 'files') setView('agents');
  if (!folderViewWasEnabled && modulesConfig.folderView.enabled) setView(currentView);
}

async function loadAppConfig() {
  try {
    const config = await api('/api/config');
    applyModulesConfig(config.modules || {});
  } catch (err) {
    showToast(err.message);
  }
}

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let error = response.statusText;
    try { error = (await response.json()).error || error; } catch {}
    throw new Error(error);
  }
  return response.json();
}

function renderBreadcrumbs(path) {
  breadcrumbs.innerHTML = '';
  const root = document.createElement('button');
  root.className = 'crumb';
  root.textContent = 'Shared folder';
  root.onclick = () => loadDir('');
  breadcrumbs.append(root);

  const parts = path ? path.split('/').filter(Boolean) : [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const crumbPath = acc;
    const btn = document.createElement('button');
    btn.className = 'crumb';
    btn.textContent = part;
    btn.onclick = () => loadDir(crumbPath);
    breadcrumbs.append(btn);
  }
}

async function loadDir(path = currentPath) {
  try {
    const data = await api(`/api/list?path=${encodeURIComponent(path)}`);
    currentPath = data.path;
    renderBreadcrumbs(data.path);
    rows.innerHTML = '';

    if (data.path) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4"><button class="nameBtn"><span class="icon">↩</span>Parent folder</button></td>`;
      tr.querySelector('button').onclick = () => loadDir(data.parent);
      rows.append(tr);
    }

    for (const item of data.items) {
      const tr = document.createElement('tr');
      const isDir = item.type === 'directory';
      tr.innerHTML = `
        <td><button class="nameBtn"><span class="icon">${isDir ? '📁' : '📄'}</span>${esc(item.name)}</button></td>
        <td>${fmtSize(item.size)}</td>
        <td>${new Date(item.modified).toLocaleString()}</td>
        <td><div class="actions"></div></td>`;
      tr.querySelector('.nameBtn').onclick = () => isDir ? loadDir(item.path) : previewFile(item);
      const actions = tr.querySelector('.actions');
      const canRenameHere = Boolean(data.path);
      if (isDir) {
        const open = document.createElement('button');
        open.className = 'secondary';
        open.textContent = 'Open';
        open.onclick = () => loadDir(item.path);
        const rename = document.createElement('button');
        rename.className = 'secondary';
        rename.textContent = 'Rename';
        rename.onclick = () => renameEntry(item);
        const download = document.createElement('a');
        download.className = 'button';
        download.textContent = 'Download tar';
        download.href = `/api/download-folder?path=${encodeURIComponent(item.path)}`;
        actions.append(open);
        if (canRenameHere) actions.append(rename);
        actions.append(download);
      } else {
        const preview = document.createElement('button');
        preview.className = 'secondary';
        preview.textContent = 'Preview';
        preview.onclick = () => previewFile(item);
        const rename = document.createElement('button');
        rename.className = 'secondary';
        rename.textContent = 'Rename';
        rename.onclick = () => renameEntry(item);
        const download = document.createElement('a');
        download.className = 'button';
        download.textContent = 'Download';
        download.href = `/api/download?path=${encodeURIComponent(item.path)}`;
        actions.append(preview);
        if (canRenameHere) actions.append(rename);
        actions.append(download);
      }
      rows.append(tr);
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function previewFile(item) {
  showPreviewPanel();
  previewPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  currentPreview = { item, data: null };
  editPreviewBtn.classList.add('hidden');
  previewName.textContent = item.path;
  previewBody.className = 'previewBody';
  previewBody.textContent = 'Loading…';
  previewBody.scrollTop = 0;
  try {
    const data = await api(`/api/preview?path=${encodeURIComponent(item.path)}`);
    currentPreview = { item, data };
    if (data.kind === 'image') {
      previewBody.innerHTML = `<img alt="${esc(item.name)}" src="${data.url}">`;
    } else if (data.kind === 'text') {
      editPreviewBtn.classList.remove('hidden');
      previewBody.innerHTML = `<pre>${esc(data.text)}</pre>${data.truncated ? '<p class="error">Preview truncated.</p>' : ''}`;
    } else {
      previewBody.className = 'previewBody empty';
      previewBody.textContent = data.message;
    }
    previewBody.scrollTop = 0;
  } catch (err) {
    currentPreview = null;
    previewBody.className = 'previewBody empty error';
    previewBody.textContent = err.message;
  }
}

function showEditor() {
  if (!currentPreview || currentPreview.data?.kind !== 'text') return;
  const text = currentPreview.data.text || '';
  previewBody.className = 'previewBody editor';
  previewBody.innerHTML = `
    <textarea id="previewEditor" spellcheck="false">${esc(text)}</textarea>
    <div class="editorActions">
      <button id="savePreviewBtn" type="button">Save</button>
      <button id="cancelEditBtn" class="secondary" type="button">Cancel</button>
    </div>`;
  const editor = document.querySelector('#previewEditor');
  editor.focus();
  document.querySelector('#cancelEditBtn').onclick = () => previewFile(currentPreview.item);
  document.querySelector('#savePreviewBtn').onclick = async () => {
    try {
      await api('/api/text-file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPreview.item.path, text: editor.value })
      });
      showToast('Saved file.');
      await loadDir();
      await previewFile(currentPreview.item);
    } catch (err) {
      showToast(err.message);
    }
  };
}

async function createTextFile() {
  const name = prompt('New text file name');
  if (name === null) return;
  try {
    const item = await api('/api/text-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, name })
    });
    showToast(`Created ${item.name}.`);
    await loadDir();
    await previewFile({ ...item, type: 'file' });
    showEditor();
  } catch (err) {
    showToast(err.message);
  }
}

async function createFolder() {
  const name = prompt('New folder name');
  if (name === null) return;
  try {
    const item = await api('/api/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, name })
    });
    showToast(`Created ${item.name}.`);
    await loadDir(item.path);
  } catch (err) {
    showToast(err.message);
  }
}

async function renameEntry(item) {
  const name = prompt(`Rename ${item.name}`, item.name);
  if (name === null) return;
  try {
    const renamed = await api('/api/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path, name })
    });
    showToast(`Renamed to ${renamed.name}.`);
    await loadDir(parentOfPath(renamed.path));
    if (currentPreview?.item?.path === item.path) {
      currentPreview = null;
      hidePreviewPanel();
    }
  } catch (err) {
    showToast(err.message);
  }
}

function parentOfPath(value = '') {
  const parts = String(value || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

themeToggleBtn.onclick = toggleTheme;
viewToggleBtn.onclick = () => setView(currentView === 'files' ? 'agents' : 'files');
agentDisplayToggleBtn.onclick = () => {
  setAgentDisplayMode(agentDisplayMode === 'pixel' ? 'cards' : 'pixel');
  if (currentView === 'agents') loadAgents();
};
pixelFullscreenBtn.onclick = togglePixelFullscreen;
agentAutoRefreshBtn.onclick = () => setAgentAutoRefresh(!agentAutoRefresh);
sessionDebugToggleBtn.onclick = () => setSessionDebugVisible(!sessionDebugVisible);
cronJobsToggleBtn.onclick = () => setCronJobsVisible(!cronJobsVisible);
document.querySelector('#refreshBtn').onclick = () => currentView === 'files' ? loadDir() : refreshAgents();
document.querySelector('#closePreviewBtn').onclick = hidePreviewPanel;
fullscreenPreviewBtn.onclick = togglePreviewFullscreen;
editPreviewBtn.onclick = showEditor;
newTextFileBtn.onclick = createTextFile;
newFolderBtn.onclick = createFolder;
window.addEventListener('focus', () => {
  if (currentView === 'agents' && agentAutoRefresh) loadAgents();
});
window.addEventListener('taskfolk:system-resume', refreshAgentsAfterSystemResume);
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((document.documentElement.dataset.theme || 'system') === 'system' && currentView === 'agents' && agentDisplayMode === 'pixel') {
      loadAgents();
    }
  });
} catch {}
function applyResourceVisibility() {
  const suspended = document.hidden;
  document.documentElement.classList.toggle('resource-suspended', suspended);
  if (suspended) {
    clearTimeout(agentRefreshTimer);
    agentRefreshTimer = null;
    clearAgentDiscoveryRetry();
    return;
  }
  if (currentView === 'agents' && agentAutoRefresh) loadAgents();
}

document.addEventListener('visibilitychange', applyResourceVisibility);
applyResourceVisibility();
document.addEventListener('keydown', (event) => {
  if (!companionMode && event.key === 'Escape' && document.body.classList.contains('pixel-office-fullscreen')) {
    setPixelFullscreen(false);
  }
});
document.querySelector('#uploadForm').onsubmit = async (event) => {
  event.preventDefault();
  const input = document.querySelector('#fileInput');
  if (!input.files.length) return showToast('Choose one or more files first.');
  const form = new FormData();
  for (const file of input.files) form.append('files', file);
  try {
    const result = await api(`/api/upload?path=${encodeURIComponent(currentPath)}`, { method: 'POST', body: form });
    input.value = '';
    showToast(`Uploaded ${result.uploaded.length} file(s).`);
    loadDir();
  } catch (err) {
    showToast(err.message);
  }
};

setPreviewEmpty();
setSessionDebugVisible(sessionDebugVisible);
setCronJobsVisible(cronJobsVisible);
if (usesDesktopAgentSnapshots()) {
  desktopSnapshotUnsubscribe = window.taskfolkDesktop.subscribeAgentSnapshots(applyDesktopAgentSnapshot);
  window.addEventListener('unload', () => desktopSnapshotUnsubscribe?.(), { once: true });
}
async function initApp() {
  await loadAppConfig();
  const initialView = !companionMode && pageParams.get('view') === 'files' ? 'files' : 'agents';
  setView(initialView);
}
initApp();
