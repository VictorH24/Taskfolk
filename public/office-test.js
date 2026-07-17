const themeOptions = ['system', 'light', 'dark'];
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };
const themeIcons = { system: '💻', light: '☀️', dark: '🌙' };
const OFFICE_FLOORS = ['wood', 'wood2', 'carpet', 'concrete', 'tile', 'darkwood'];
const OFFICE_WINDOWS = ['sf', 'newyork', 'beach', 'tahoe'];
const OFFICE_POSTER_COUNT = 50;
const SUCCESS_STATE_MS = 2 * 60 * 1000;
const IDLE_POSE_STORAGE_KEY = 'taskfolk-idle-pose-history-v1';
const AVATAR_VARIANT_COUNT = 24;
const ASSIGNABLE_AVATAR_VARIANTS = [0, ...Array.from({ length: 23 }, (_, index) => `v${index + 1}_gif`)];

const officeMap = document.querySelector('#officeMap');
const agentSummary = document.querySelector('#agentSummary');
const simStatus = document.querySelector('#simStatus');
const reloadSimBtn = document.querySelector('#reloadSimBtn');
const editSimJsonBtn = document.querySelector('#editSimJsonBtn');
const simEditor = document.querySelector('#simEditor');
const closeSimEditorBtn = document.querySelector('#closeSimEditorBtn');
const simJsonEditor = document.querySelector('#simJsonEditor');
const simEditorStatus = document.querySelector('#simEditorStatus');
const applySimJsonBtn = document.querySelector('#applySimJsonBtn');
const saveSimJsonBtn = document.querySelector('#saveSimJsonBtn');
const themeToggleBtn = document.querySelector('#themeToggleBtn');

let officeSceneConfig = { floor: 'wood', windowView: 'sf', poster: 0, emptyDesks: 0 };
let previewTimer = null;

function esc(text) {
  return String(text).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function applyTheme(theme) {
  const nextTheme = themeOptions.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = nextTheme;
  themeToggleBtn.innerHTML = `<span aria-hidden="true">${themeIcons[nextTheme]}</span><span>${themeLabels[nextTheme]}</span>`;
  themeToggleBtn.setAttribute('aria-label', `Color theme: ${themeLabels[nextTheme]}. Click to switch theme.`);
}

function getSavedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}

function setTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem('theme', theme); } catch {}
  loadFixture();
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || 'system';
  const nextTheme = themeOptions[(themeOptions.indexOf(currentTheme) + 1) % themeOptions.length];
  setTheme(nextTheme);
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

function normalizeOfficeSceneConfig(value = {}) {
  const poster = Number(value.poster);
  return {
    floor: OFFICE_FLOORS.includes(value.floor) ? value.floor : 'wood',
    windowView: OFFICE_WINDOWS.includes(value.windowView) ? value.windowView : 'sf',
    poster: Number.isInteger(poster) && poster >= 0 && poster < OFFICE_POSTER_COUNT ? poster : 0,
    emptyDesks: Math.max(0, Math.min(24, Math.trunc(Number(value.emptyDesks) || 0)))
  };
}

function resolveTimestamp(value, offsetMs) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (value) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  if (Number.isFinite(Number(offsetMs))) return Date.now() - Number(offsetMs);
  return null;
}

function normalizeAgent(agent, index) {
  const session = agent.session || {};
  const activity = agent.activity || {};
  const updatedAt = resolveTimestamp(activity.updatedAt, activity.updatedAtOffsetMs);
  const lastSeenMs = resolveTimestamp(agent.lastSeen, agent.lastSeenOffsetMs) || updatedAt;
  return {
    id: String(agent.id || `sim-agent-${index + 1}`),
    name: String(agent.name || `Sim Agent ${index + 1}`),
    role: String(agent.role || 'Simulated agent'),
    status: ['active', 'success', 'idle', 'blocked'].includes(agent.status) ? agent.status : 'idle',
    task: String(agent.task || session.summary || 'No simulated task'),
    lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
    sessionFile: session.file || null,
    logFile: session.logFile || null,
    avatarVariant: agent.avatarVariant ?? null,
    activity: {
      ...activity,
      updatedAt,
      totalTokens: Number(activity.totalTokens || 0),
      estimatedCostUsd: Number(activity.estimatedCostUsd || 0),
      runtimeMs: Number(activity.runtimeMs || 0),
      skills: Array.isArray(activity.skills) ? activity.skills : []
    }
  };
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
  return { totalTokens, estimatedCostUsd, latestMs, avgRuntime };
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

function agentBadge(status) {
  return { active: 'Working', success: 'Success', idle: 'Idle', blocked: 'Blocked' }[status] || 'Idle';
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

function idlePose(agent) {
  const age = agentAgeClass(agent);
  if (age !== 'fresh' && age !== 'warm') return 'sleeping';
  const poses = age === 'fresh'
    ? ['reading', 'walking', 'coffee', 'headphones', 'gaming']
    : ['coffee', 'reading', 'gaming'];
  const identity = `${agent.id || ''}:${agent.name || ''}`;
  const activity = agent.activity || {};
  const marker = activity.successAt || activity.updatedAt || agent.lastSeen || agent.updatedAt || 'unknown';
  const episode = `${marker}:${age}`;
  let history = {};
  try {
    history = JSON.parse(localStorage.getItem(IDLE_POSE_STORAGE_KEY) || '{}');
  } catch {
    // Continue with the deterministic episode seed.
  }
  const previous = history[identity];
  if (previous?.episode === episode && poses.includes(previous.pose)) return previous.pose;
  let poseIndex = hashString(`${identity}:${episode}`) % poses.length;
  if (poses[poseIndex] === previous?.pose && poses.length > 1) {
    poseIndex = (poseIndex + 1 + (hashString(`${episode}:${identity}`) % (poses.length - 1))) % poses.length;
  }
  const pose = poses[poseIndex];
  history[identity] = { episode, pose };
  try {
    localStorage.setItem(IDLE_POSE_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage is optional in the simulator.
  }
  return pose;
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
  const ring = Math.floor((index - slots.length) / 8);
  const ringIndex = (index - slots.length) % 8;
  const angle = (Math.PI * 2 * ringIndex) / 8;
  const radiusX = Math.max(18, 34 - ring * 5);
  const radiusY = Math.max(12, 23 - ring * 3);
  return {
    left: 50 + Math.cos(angle) * radiusX,
    top: 58 + Math.sin(angle) * radiusY
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

function pixelRole(agent) {
  const text = `${agent.id || ''} ${agent.name || ''} ${agent.role || ''}`.toLowerCase();
  if (/review|qa|quality|check/.test(text)) return 'reviewer';
  if (/ops|monitor|deploy|infra|health/.test(text)) return 'ops';
  if (/code|coder|build|dev|engineer/.test(text)) return 'coder';
  if (/main|coord|lead|manager/.test(text)) return 'main';
  return 'agent';
}

function avatarVariant(agent) {
  const raw = String(agent.avatarVariant ?? '');
  if (raw === '0' || raw === 'v0' || raw === 'v0_gif') return 0;
  if (ASSIGNABLE_AVATAR_VARIANTS.includes(raw)) return raw;
  const assigned = Number(agent.avatarVariant);
  if (Number.isInteger(assigned) && assigned > 0 && assigned < AVATAR_VARIANT_COUNT) return `v${assigned}_gif`;
  const fallback = Math.abs(hashString(`${agent.id || ''}:${agent.name || ''}:${agent.role || ''}`)) % AVATAR_VARIANT_COUNT;
  return fallback === 0 ? 0 : `v${fallback}_gif`;
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

function pixelAgentScene(agent, meetingMode = false) {
  const role = pixelRole(agent);
  const variant = avatarVariant(agent);
  if (agent.status === 'success') {
    return window.SceneArt.sceneMarkup({ pose: 'success', role, label: agent.name, variant, showLabel: false });
  }
  if (agent.status === 'idle') {
    return window.SceneArt.sceneMarkup({ pose: idlePose(agent), role, label: agent.name, variant, showLabel: false });
  }
  if (meetingMode) {
    return window.SceneArt.sceneMarkup({ pose: 'meeting', role, label: agent.name, variant, showLabel: false });
  }
  return window.SceneArt.sceneMarkup({
    pose: agent.status === 'blocked' ? 'blocked' : 'working',
    role,
    label: agent.name,
    variant,
    showLabel: false
  });
}

function renderSummary(agents, metrics) {
  const active = agents.filter((agent) => agent.status === 'active').length;
  const success = agents.filter((agent) => agent.status === 'success').length;
  const idle = agents.filter((agent) => agent.status === 'idle').length;
  const blocked = agents.filter((agent) => agent.status === 'blocked').length;
  agentSummary.innerHTML = `
    <article><strong>${agents.length}</strong><span>Total agents</span></article>
    <article><strong>${active}</strong><span>Working</span></article>
    <article><strong>${success}</strong><span>Success</span></article>
    <article><strong>${idle}</strong><span>Idle</span></article>
    <article><strong>${blocked}</strong><span>Blocked</span></article>
    <article><strong>${formatCost(metrics.estimatedCostUsd)}</strong><span>Cost</span></article>
    <article><strong>${Math.round(metrics.totalTokens / 1000)}k</strong><span>Tokens</span></article>`;
}

function renderPixelOffice(agents) {
  officeMap.className = 'officeMap pixelOfficeWrap';
  const roomState = pixelRoomState(agents);
  const metrics = officeMetrics(agents);
  const sceneConfig = normalizeOfficeSceneConfig(officeSceneConfig);
  const emptyDesks = Array.from({ length: sceneConfig.emptyDesks }, (_, index) => {
    const position = pixelPosition(agents.length + index, agents.length + sceneConfig.emptyDesks);
    return `
      <article class="pixelEmptyDesk" style="left:${position.left}%;top:${position.top}%;" aria-label="Empty desk">
        <div class="pixelFloorFurniture pixelFloorDesk"></div>
      </article>`;
  }).join('');
  const labels = [];
  const people = agents.map((agent, index) => {
    const useMeetingPose = roomState.meetingMode && agent.status === 'active';
    const position = pixelPosition(index, agents.length + sceneConfig.emptyDesks);
    labels.push(`
      <span class="pixelAgentName ${esc(agent.status)}" style="left:${position.left}%;top:${position.top + 3}%;">${esc(agent.name)}</span>`);
    return `
      <article class="pixelAgent ${esc(agent.status)} ${useMeetingPose ? 'meeting' : ''} role-${pixelRole(agent)} ${activityLevel(agent)} ${agentAgeClass(agent)}" style="left:${position.left}%;top:${position.top}%;" aria-label="${esc(agent.name)} is ${esc(agentBadge(agent.status))}">
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
            <strong>${formatTimestamp(metrics.latestMs)}</strong>
          </div>
          <div class="pixelStatusLights">
            <span class="working" title="Working">${roomState.active}</span>
            <span class="success" title="Success">${roomState.success}</span>
            <span class="idle" title="Idle">${roomState.idle}</span>
            <span class="blocked" title="Blocked">${roomState.blocked}</span>
          </div>
          <div class="pixelStatusBoardStats">
            <div><strong>${agents.length}</strong><span>Agents</span></div>
            <div><strong>${formatCost(metrics.estimatedCostUsd)}</strong><span>Cost</span></div>
            <div><strong>${Math.round(metrics.totalTokens / 1000)}k</strong><span>Tokens</span></div>
            <div><strong>${durationLabel(metrics.avgRuntime)}</strong><span>Avg run</span></div>
          </div>
          <div class="pixelStatusStrip">
            <span class="fill" style="width:${Math.max(12, Math.min(100, Math.round(((Date.now() - (metrics.latestMs || Date.now())) / 1000 / 60) * 10))) % 100}%"></span>
            <em>updated ${relativeTime(metrics.latestMs)}</em>
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
  renderSummary(agents, metrics);
}

function renderFixtureData(data, statusLabel = 'public/test-agents.json') {
  const agents = Array.isArray(data.agents) ? data.agents.map(normalizeAgent) : [];
  officeSceneConfig = normalizeOfficeSceneConfig(data.officeScene);
  renderPixelOffice(agents);
  simStatus.textContent = `${agents.length} agents from ${statusLabel}`;
  return agents;
}

async function loadFixture() {
  simStatus.textContent = 'Loading fixture...';
  try {
    const response = await fetch(`./test-agents.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    renderFixtureData(data);
  } catch (err) {
    simStatus.textContent = `Unable to load fixture: ${err.message}`;
    officeMap.innerHTML = `<div class="emptyOffice">Unable to load fixture: ${esc(err.message)}</div>`;
  }
}

function setEditorStatus(message, isError = false) {
  simEditorStatus.textContent = message;
  simEditorStatus.classList.toggle('error', isError);
}

function parseEditorJson() {
  try {
    const data = JSON.parse(simJsonEditor.value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Fixture must be a JSON object.');
    }
    return { data };
  } catch (err) {
    return { error: err };
  }
}

function previewEditorJson() {
  const { data, error } = parseEditorJson();
  if (error) {
    setEditorStatus(`Invalid JSON: ${error.message}`, true);
    return false;
  }
  const agents = renderFixtureData(data, 'unsaved editor preview');
  setEditorStatus(`Previewing ${agents.length} agents. Unsaved changes are not on disk yet.`);
  return true;
}

async function openJsonEditor() {
  simEditor.classList.remove('hidden');
  setEditorStatus('Loading public/test-agents.json...');
  try {
    const response = await fetch(`/api/office-fixture?t=${Date.now()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || response.statusText);
    simJsonEditor.value = payload.text;
    setEditorStatus('Editing public/test-agents.json. Valid changes preview automatically.');
    simJsonEditor.focus();
    previewEditorJson();
  } catch (err) {
    setEditorStatus(`Unable to open fixture: ${err.message}`, true);
  }
}

function closeJsonEditor() {
  simEditor.classList.add('hidden');
}

async function saveEditorJson() {
  const { error } = parseEditorJson();
  if (error) {
    setEditorStatus(`Fix JSON before saving: ${error.message}`, true);
    return;
  }
  setEditorStatus('Saving public/test-agents.json...');
  saveSimJsonBtn.disabled = true;
  try {
    const response = await fetch('/api/office-fixture', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: simJsonEditor.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || response.statusText);
    setEditorStatus(`Saved ${payload.size} bytes. Reloaded from disk.`);
    await loadFixture();
  } catch (err) {
    setEditorStatus(`Unable to save fixture: ${err.message}`, true);
  } finally {
    saveSimJsonBtn.disabled = false;
  }
}

function scheduleEditorPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(previewEditorJson, 350);
}

applyTheme(getSavedTheme() || 'system');
themeToggleBtn.addEventListener('click', toggleTheme);
reloadSimBtn.addEventListener('click', loadFixture);
editSimJsonBtn.addEventListener('click', openJsonEditor);
closeSimEditorBtn.addEventListener('click', closeJsonEditor);
applySimJsonBtn.addEventListener('click', previewEditorJson);
saveSimJsonBtn.addEventListener('click', saveEditorJson);
simJsonEditor.addEventListener('input', scheduleEditorPreview);
simJsonEditor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault();
    saveEditorJson();
  }
  if (event.key === 'Escape') closeJsonEditor();
});
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((document.documentElement.dataset.theme || 'system') === 'system') loadFixture();
  });
} catch {}
loadFixture();
