const legendGrid = document.querySelector('#legendGrid');
const variantButtons = document.querySelector('#variantButtons');
const floorButtons = document.querySelector('#floorButtons');
const windowButtons = document.querySelector('#windowButtons');
const posterButtons = document.querySelector('#posterButtons');
const emptyDesksInput = document.querySelector('#emptyDesksInput');
const assignmentList = document.querySelector('#assignmentList');
const assignmentStatus = document.querySelector('#assignmentStatus');
const reloadAssignmentsBtn = document.querySelector('#reloadAssignmentsBtn');
const addAgentBtn = document.querySelector('#addAgentBtn');
const agentApiUrl = document.querySelector('#agentApiUrl');
const agentApiCurl = document.querySelector('#agentApiCurl');
const folderViewNavBtn = document.querySelector('#folderViewNavBtn');
const tasksNavBtn = document.querySelector('#tasksNavBtn');
const tasksModuleToggleBtn = document.querySelector('#tasksModuleToggleBtn');
const tasksModuleStatus = document.querySelector('#tasksModuleStatus');
const folderViewModuleToggleBtn = document.querySelector('#folderViewModuleToggleBtn');
const folderViewModuleStatus = document.querySelector('#folderViewModuleStatus');

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
const AVATAR_VARIANTS = [
  { value: 0, label: 'Variant 0(GIF)', versionLabel: 'v0 gif' },
  { value: 'v0', label: 'Variant 0', versionLabel: 'v0' },
  { value: 'v1_gif', label: 'Variant 1(GIF)', versionLabel: 'v1 gif' },
  { value: 1, label: 'Variant 1' },
  { value: 'v2_gif', label: 'Variant 2(GIF)', versionLabel: 'v2 gif' },
  { value: 2, label: 'Variant 2' },
  { value: 'v3_gif', label: 'Variant 3(GIF)', versionLabel: 'v3 gif' },
  { value: 3, label: 'Variant 3' },
  { value: 'v4_gif', label: 'Variant 4(GIF)', versionLabel: 'v4 gif' },
  { value: 4, label: 'Variant 4' },
  { value: 'v5_gif', label: 'Variant 5(GIF)', versionLabel: 'v5 gif' },
  { value: 5, label: 'Variant 5' },
  { value: 'v6_gif', label: 'Variant 6(GIF)', versionLabel: 'v6 gif' },
  { value: 6, label: 'Variant 6' },
  { value: 'v7_gif', label: 'Variant 7(GIF)', versionLabel: 'v7 gif' },
  { value: 7, label: 'Variant 7' }
];
const OFFICE_FLOORS = [
  { value: 'wood', label: 'Wood' },
  { value: 'wood2', label: 'Wood2' },
  { value: 'carpet', label: 'Carpet' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'tile', label: 'Tile' },
  { value: 'darkwood', label: 'Dark Wood' }
];
const OFFICE_WINDOWS = [
  { value: 'sf', label: 'San Francisco' },
  { value: 'newyork', label: 'New York' },
  { value: 'beach', label: 'Beach' },
  { value: 'tahoe', label: 'Tahoe Lake' }
];
const OFFICE_POSTER_COUNT = 50;

const LEGEND_CARDS = [
  {
    title: 'Working',
    note: 'Agent is Working.',
    status: 'Working',
    className: 'working',
    label: 'Working',
    // role: 'Working',
    pose: 'working'
  },
  {
    title: 'Blocked',
    note: 'Agent is Blocked he nay need helps.',
    status: 'Blocked',
    className: 'blocked',
    label: 'blocked',
    // role: 'coder',
    pose: 'blocked'
  },
  {
    title: 'Sleeping',
    note: 'Agent is Sleeping, idle for more than 15 minutes.',
    status: 'Sleeping',
    className: 'sleeping',
    label: 'sleeping',
    // role: 'reviewer',
    pose: 'sleeping'
  },
  {
    title: 'Reading',
    note: 'Agent is Reading, idle for less than 2 minutes.',
    status: 'Reading',
    className: 'reading',
    label: 'Reading',
    // role: 'analyst',
    pose: 'reading'
  },
  {
    title: 'Gaming',
    note: 'Agent is Gaming idle for less than 15 minutes.',
    status: 'Gaming',
    className: 'gaming',
    label: 'Builder',
    // role: 'builder',
    pose: 'gaming'
  },
  {
    title: 'Coffee',
    note: 'Coffee break, agent idle for less than 15 minutes.',
    status: 'Coffee break',
    className: 'coffee',
    label: 'Ops',
    // role: 'ops',
    pose: 'coffee'
  },
  {
    title: 'Music',
    note: 'Agent listening to music, idle for less than 2 minutes.',
    status: 'Listening',
    className: 'headphones',
    label: 'Music',
    // role: 'writer',
    pose: 'headphones'
  },
  {
    title: 'Walker',
    note: 'Agent is aalking, idle for less than 2 minutes..',
    status: 'Walking',
    className: 'walking',
    label: 'Walker',
    // role: 'walker',
    pose: 'walking'
  }
];

let previewVariant = savedPreviewVariant();
let agents = [];
let assignments = {};
let manualAgents = [];
let taskAgents = {};
let modules = { tasks: { enabled: false }, folderView: { enabled: true } };
let officeScene = { floor: 'wood', windowView: 'sf', poster: 0, emptyDesks: 0 };
let savingAssignments = false;

function normalizeAvatarVariant(value) {
  const raw = String(value ?? 0);
  const numeric = Number(value);
  const normalized = raw === 'v0' || /^v[1-7]_gif$/.test(raw)
    ? raw
    : Number.isInteger(numeric) ? numeric : value;
  return AVATAR_VARIANTS.some((variant) => variant.value === normalized) ? normalized : 0;
}

function savedPreviewVariant() {
  try {
    return normalizeAvatarVariant(localStorage.getItem('avatarLegendVariant'));
  } catch {
    return 0;
  }
}

function esc(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const message = await response.json().catch(() => ({}));
    throw new Error(message.error || response.statusText);
  }
  return response.json();
}

function scene(label, role, pose, variant = previewVariant) {
  return SceneArt.sceneMarkup({ pose, role, label, variant, showLabel: false });
}

function card({ title, note, status, className = '', label, role, pose }) {
  return `
    <article class="legendCard ${className}">
      <div class="legendStage ${className}">
        ${scene(label, role, pose)}
      </div>
      <div class="legendMeta">
        <h3>${title}</h3>
        <p>${note}</p>
        <div class="legendStatus">${status}</div>
      </div>
    </article>`;
}

function renderVariantButtons() {
  variantButtons.innerHTML = AVATAR_VARIANTS.map((variant) => `
    <button
      class="variantButton ${variant.value === previewVariant ? 'active' : ''}"
      type="button"
      data-variant="${variant.value}"
      aria-pressed="${variant.value === previewVariant}"
    >
      <span>${variant.label}</span>
      <small>${variant.versionLabel || `v${variant.value}`}</small>
    </button>
  `).join('');
}

function renderOfficeSceneButtons() {
  floorButtons.innerHTML = OFFICE_FLOORS.map((floor) => `
    <button
      class="variantButton sceneThumbButton floorThumb ${floor.value === officeScene.floor ? 'active' : ''}"
      type="button"
      data-floor="${floor.value}"
      aria-pressed="${floor.value === officeScene.floor}"
    >
      <span class="sceneThumb" style="background-image:url('./office-scenes/floor-${floor.value}.png');"></span>
      <span>${floor.label}</span>
      <small>floor</small>
    </button>
  `).join('');
  windowButtons.innerHTML = OFFICE_WINDOWS.map((view, index) => {
    const x = index * 33.3333;
    return `
      <button
        class="variantButton sceneThumbButton windowThumb ${view.value === officeScene.windowView ? 'active' : ''}"
        type="button"
        data-window-view="${view.value}"
        aria-pressed="${view.value === officeScene.windowView}"
      >
        <span class="sceneThumb" style="--window-x:${x}%;"></span>
        <span>${view.label}</span>
        <small>day/night</small>
      </button>
    `;
  }).join('');
  posterButtons.innerHTML = `
    <div class="posterPicker">
      <div class="posterPickerHeader">
        <span class="posterPickerLabel">Poster ${officeScene.poster + 1} / ${OFFICE_POSTER_COUNT}</span>
        <div class="posterPickerControls">
          <button class="posterNavButton" type="button" data-poster-step="-1" aria-label="Previous poster">&lsaquo;</button>
          <button class="posterNavButton" type="button" data-poster-step="1" aria-label="Next poster">&rsaquo;</button>
        </div>
      </div>
      <div class="posterPickerStage">
        <img src="office-scenes/posters/poster${officeScene.poster + 1}.jpeg" alt="" draggable="false" />
      </div>
      <div class="posterFilmstrip" aria-label="Poster thumbnails">
        ${Array.from({ length: OFFICE_POSTER_COUNT }, (_, index) => `
          <button
            class="posterButton ${index === officeScene.poster ? 'active' : ''}"
            type="button"
            data-poster="${index}"
            aria-label="Poster ${index + 1}"
            aria-pressed="${index === officeScene.poster}"
          >
            <span class="posterThumb">
              <img src="office-scenes/posters/poster${index + 1}.jpeg" alt="" draggable="false" />
            </span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  emptyDesksInput.value = String(officeScene.emptyDesks);
}

function renderLegend() {
  renderVariantButtons();
  renderOfficeSceneButtons();
  legendGrid.innerHTML = LEGEND_CARDS.map(card).join('');
}

function setPreviewVariant(variant) {
  previewVariant = variant;
  try { localStorage.setItem('avatarLegendVariant', String(variant)); } catch {}
  renderLegend();
}

function variantSelect(agent) {
  const assigned = Object.prototype.hasOwnProperty.call(assignments, agent.id) ? assignments[agent.id] : agent.avatarVariant;
  const value = normalizeAvatarVariant(assigned);
  return `
    <select data-agent-id="${esc(agent.id)}" aria-label="Avatar variant for ${esc(agent.name)}">
      ${AVATAR_VARIANTS.map((variant) => `
        <option value="${variant.value}" ${variant.value === value ? 'selected' : ''}>${variant.label}</option>
      `).join('')}
    </select>`;
}

function isManualAgent(agent) {
  return manualAgents.some((manualAgent) => manualAgent.id === agent.id);
}

function manualAgentToken(agentId) {
  return manualAgents.find((manualAgent) => manualAgent.id === agentId)?.token || '';
}

function manualAgentEnabled(agentId) {
  return manualAgents.find((manualAgent) => manualAgent.id === agentId)?.enabled !== false;
}

function taskAgentSettings(agent) {
  const saved = taskAgents[agent.id] || {};
  return {
    enabled: saved.enabled !== false,
    workspacePath: saved.workspacePath || agent.workspacePath || '',
    allowedTaskTags: Array.isArray(saved.allowedTaskTags) ? saved.allowedTaskTags : []
  };
}

function setTaskAgentSettings(agentId, nextSettings) {
  const current = taskAgents[agentId] || {};
  taskAgents = {
    ...taskAgents,
    [agentId]: {
      enabled: nextSettings.enabled !== undefined ? nextSettings.enabled : current.enabled !== false,
      workspacePath: nextSettings.workspacePath !== undefined ? nextSettings.workspacePath : current.workspacePath || '',
      allowedTaskTags: Array.isArray(nextSettings.allowedTaskTags) ? nextSettings.allowedTaskTags : current.allowedTaskTags || []
    }
  };
}

function normalizeModules(value = {}) {
  const hasTasksEnabled = Object.prototype.hasOwnProperty.call(value.tasks || {}, 'enabled');
  const hasFolderViewEnabled = Object.prototype.hasOwnProperty.call(value.folderView || {}, 'enabled');
  return {
    tasks: {
      enabled: hasTasksEnabled ? value.tasks.enabled !== false : false
    },
    folderView: {
      enabled: hasFolderViewEnabled ? value.folderView.enabled !== false : true
    }
  };
}

function renderModuleControls() {
  const tasksEnabled = modules.tasks.enabled !== false;
  const folderViewEnabled = modules.folderView.enabled !== false;
  tasksNavBtn?.classList.toggle('hidden', !tasksEnabled);
  folderViewNavBtn?.classList.toggle('hidden', !folderViewEnabled);
  if (tasksModuleToggleBtn) {
    tasksModuleToggleBtn.textContent = tasksEnabled ? 'Enabled' : 'Disabled';
    tasksModuleToggleBtn.setAttribute('aria-pressed', String(tasksEnabled));
  }
  if (folderViewModuleToggleBtn) {
    folderViewModuleToggleBtn.textContent = folderViewEnabled ? 'Enabled' : 'Disabled';
    folderViewModuleToggleBtn.setAttribute('aria-pressed', String(folderViewEnabled));
  }
  if (tasksModuleStatus) {
    tasksModuleStatus.textContent = tasksEnabled
      ? 'Tasks enabled'
      : 'Tasks disabled';
  }
  if (folderViewModuleStatus) {
    folderViewModuleStatus.textContent = folderViewEnabled
      ? 'Folder view enabled'
      : 'Folder view disabled';
  }
}

function mergeManualAgentsIntoAgentList(agentList) {
  const byId = new Map(agentList.map((agent) => [agent.id, agent]));
  for (const manualAgent of manualAgents) {
    if (byId.has(manualAgent.id)) continue;
    byId.set(manualAgent.id, {
      ...manualAgent,
      role: 'Manual agent',
      status: 'idle',
      displayState: manualAgent.enabled === false ? 'Disabled' : 'Sleeping',
      pose: 'sleeping',
      disabled: manualAgent.enabled === false
    });
  }
  return [...byId.values()];
}

function newManualAgent() {
  const browserCrypto = window.crypto || {};
  const id = `manual-${browserCrypto.randomUUID ? browserCrypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const tokenBytes = new Uint8Array(24);
  if (browserCrypto.getRandomValues) browserCrypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('') || `${Date.now()}${Math.random()}`;
  return {
    id,
    name: `Agent ${manualAgents.length + 1}`,
    token,
    enabled: true
  };
}

function renderAgentApiHelp() {
  const origin = window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin;
  const url = `${origin}/api/agent-state`;
  const token = manualAgents[0]?.token || 'AGENT_TOKEN';
  if (agentApiUrl) agentApiUrl.textContent = url;
  if (agentApiCurl) {
    agentApiCurl.textContent = `curl -X POST ${url} \\
  -H 'Content-Type: application/json' \\
  -d '{"token":"${token}","state":"Working","task":"Handling queue item 42"}'`;
  }
}

function renderAssignments() {
  renderAgentApiHelp();
  if (!agents.length) {
    assignmentList.innerHTML = '<div class="assignmentEmpty">No live agents found.</div>';
    return;
  }
  assignmentList.innerHTML = agents.map((agent) => `
    <article class="assignmentRow ${isManualAgent(agent) ? 'manual' : ''} ${manualAgentEnabled(agent.id) ? '' : 'disabled'}">
      <div class="assignmentAgent">
        ${isManualAgent(agent) ? `
          <label class="manualNameField">
            <span>Name</span>
            <input data-agent-name="${esc(agent.id)}" value="${esc(agent.name)}" aria-label="Name for ${esc(agent.name)}" />
          </label>
          <span>${esc(agent.id)} · manual agent · ${manualAgentEnabled(agent.id) ? 'enabled' : 'disabled'}</span>
          <code>${esc(manualAgentToken(agent.id))}</code>
        ` : `
          <strong>${esc(agent.name)}</strong>
          <span>${esc(agent.id)} · ${esc(agent.role || 'agent')}</span>
        `}
      </div>
      <div class="assignmentPreview">
        ${SceneArt.sceneMarkup({
          pose: agent.pose || (agent.status === 'blocked' ? 'blocked' : agent.status === 'active' ? 'working' : 'coffee'),
          role: agent.role || 'agent',
          label: agent.name,
          variant: Object.prototype.hasOwnProperty.call(assignments, agent.id) ? assignments[agent.id] : agent.avatarVariant,
          showLabel: false
        })}
      </div>
      <label>
        <span>Avatar</span>
        ${variantSelect(agent)}
      </label>
      <label class="workspaceField">
        <span>Workspace</span>
        <input data-agent-workspace="${esc(agent.id)}" value="${esc(taskAgentSettings(agent).workspacePath)}" placeholder="/shared/workspace" aria-label="Task workspace for ${esc(agent.name)}" />
      </label>
      <div class="taskAgentToggle">
        <span>Tasks</span>
        <button class="secondary" type="button" data-toggle-task-agent="${esc(agent.id)}">${taskAgentSettings(agent).enabled ? 'Active' : 'Inactive'}</button>
      </div>
      ${isManualAgent(agent) ? `
        <div class="manualAgentActions">
          <button class="secondary" type="button" data-toggle-agent="${esc(agent.id)}">${manualAgentEnabled(agent.id) ? 'Disable' : 'Enable'}</button>
          <button class="secondary dangerButton" type="button" data-delete-agent="${esc(agent.id)}">Delete</button>
        </div>
      ` : ''}
    </article>
  `).join('');
}

async function loadAssignments() {
  assignmentStatus.textContent = 'Loading agents…';
  try {
    const [agentData, assignmentData] = await Promise.all([
      api(`/api/agents?t=${Date.now()}`),
      api(`/api/avatar-assignments?t=${Date.now()}`)
    ]);
    assignments = assignmentData.assignments || {};
    manualAgents = Array.isArray(assignmentData.manualAgents) ? assignmentData.manualAgents : [];
    taskAgents = assignmentData.taskAgents && typeof assignmentData.taskAgents === 'object' ? assignmentData.taskAgents : {};
    modules = normalizeModules(assignmentData.modules);
    agents = mergeManualAgentsIntoAgentList(Array.isArray(agentData.agents) ? agentData.agents : []);
    officeScene = normalizeOfficeScene(assignmentData.officeScene || agentData.officeScene);
    const path = assignmentData.path ? ` · ${assignmentData.path}` : '';
    assignmentStatus.textContent = `Saved assignments${path}`;
    renderLegend();
    renderModuleControls();
    renderAssignments();
  } catch (err) {
    assignmentStatus.textContent = `Unable to load assignments: ${err.message}`;
    assignmentList.innerHTML = '<div class="assignmentEmpty">Open this page through http://localhost:3000/avatar-legend.html to save assignments.</div>';
  }
}

async function saveAssignments() {
  if (savingAssignments) return;
  savingAssignments = true;
  assignmentStatus.textContent = 'Saving assignments…';
  try {
    const data = await api('/api/avatar-assignments', {
      method: 'PUT',
      body: JSON.stringify({ assignments, manualAgents, taskAgents, modules, officeScene })
    });
    assignments = data.assignments || {};
    manualAgents = Array.isArray(data.manualAgents) ? data.manualAgents : manualAgents;
    taskAgents = data.taskAgents && typeof data.taskAgents === 'object' ? data.taskAgents : taskAgents;
    modules = normalizeModules(data.modules || modules);
    officeScene = normalizeOfficeScene(data.officeScene);
    assignmentStatus.textContent = `Saved assignments · ${data.path}`;
    await loadAssignments();
  } catch (err) {
    assignmentStatus.textContent = `Unable to save assignments: ${err.message}`;
  } finally {
    savingAssignments = false;
  }
}

function normalizeOfficeScene(value = {}) {
  const poster = Number(value.poster);
  return {
    floor: OFFICE_FLOORS.some((floor) => floor.value === value.floor) ? value.floor : 'wood',
    windowView: OFFICE_WINDOWS.some((view) => view.value === value.windowView) ? value.windowView : 'sf',
    poster: Number.isInteger(poster) && poster >= 0 && poster < OFFICE_POSTER_COUNT ? poster : 0,
    emptyDesks: Math.max(0, Math.min(24, Math.trunc(Number(value.emptyDesks) || 0)))
  };
}

variantButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-variant]');
  if (!button) return;
  setPreviewVariant(normalizeAvatarVariant(button.dataset.variant));
});

floorButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-floor]');
  if (!button) return;
  officeScene = normalizeOfficeScene({ ...officeScene, floor: button.dataset.floor });
  renderLegend();
  saveAssignments();
});

windowButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-window-view]');
  if (!button) return;
  officeScene = normalizeOfficeScene({ ...officeScene, windowView: button.dataset.windowView });
  renderLegend();
  saveAssignments();
});

posterButtons.addEventListener('click', (event) => {
  const stepButton = event.target.closest('[data-poster-step]');
  if (stepButton) {
    const step = Number(stepButton.dataset.posterStep);
    const poster = (officeScene.poster + step + OFFICE_POSTER_COUNT) % OFFICE_POSTER_COUNT;
    officeScene = normalizeOfficeScene({ ...officeScene, poster });
    renderLegend();
    saveAssignments();
    return;
  }

  const button = event.target.closest('[data-poster]');
  if (!button) return;
  officeScene = normalizeOfficeScene({ ...officeScene, poster: Number(button.dataset.poster) });
  renderLegend();
  saveAssignments();
});

emptyDesksInput.addEventListener('change', () => {
  officeScene = normalizeOfficeScene({ ...officeScene, emptyDesks: Number(emptyDesksInput.value) });
  renderLegend();
  saveAssignments();
});

tasksModuleToggleBtn?.addEventListener('click', () => {
  modules = normalizeModules({ ...modules, tasks: { enabled: modules.tasks.enabled === false } });
  renderModuleControls();
  saveAssignments();
});

folderViewModuleToggleBtn?.addEventListener('click', () => {
  modules = normalizeModules({ ...modules, folderView: { enabled: modules.folderView.enabled === false } });
  renderModuleControls();
  saveAssignments();
});

assignmentList.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-agent-id]');
  if (!select) return;
  assignments[select.dataset.agentId] = normalizeAvatarVariant(select.value);
  renderAssignments();
  saveAssignments();
});

assignmentList.addEventListener('input', (event) => {
  const nameInput = event.target.closest('input[data-agent-name]');
  if (nameInput) {
    const manualAgent = manualAgents.find((agent) => agent.id === nameInput.dataset.agentName);
    if (!manualAgent) return;
    manualAgent.name = nameInput.value;
    return;
  }
  const workspaceInput = event.target.closest('input[data-agent-workspace]');
  if (!workspaceInput) return;
  setTaskAgentSettings(workspaceInput.dataset.agentWorkspace, { workspacePath: workspaceInput.value });
});

assignmentList.addEventListener('focusout', (event) => {
  const nameInput = event.target.closest('input[data-agent-name]');
  if (nameInput) {
    const manualAgent = manualAgents.find((agent) => agent.id === nameInput.dataset.agentName);
    if (!manualAgent) return;
    manualAgent.name = nameInput.value.trim() || manualAgent.name || 'Agent';
    saveAssignments();
    return;
  }
  const workspaceInput = event.target.closest('input[data-agent-workspace]');
  if (!workspaceInput) return;
  setTaskAgentSettings(workspaceInput.dataset.agentWorkspace, { workspacePath: workspaceInput.value.trim() });
  saveAssignments();
});

assignmentList.addEventListener('click', (event) => {
  const taskToggleButton = event.target.closest('[data-toggle-task-agent]');
  if (taskToggleButton) {
    const agent = agents.find((item) => item.id === taskToggleButton.dataset.toggleTaskAgent);
    if (!agent) return;
    const current = taskAgentSettings(agent);
    setTaskAgentSettings(agent.id, { ...current, enabled: !current.enabled });
    renderAssignments();
    saveAssignments();
    return;
  }
  const toggleButton = event.target.closest('[data-toggle-agent]');
  if (toggleButton) {
    const manualAgent = manualAgents.find((agent) => agent.id === toggleButton.dataset.toggleAgent);
    if (!manualAgent) return;
    manualAgent.enabled = manualAgent.enabled === false;
    agents = agents.map((agent) => agent.id === manualAgent.id
      ? {
        ...agent,
        disabled: manualAgent.enabled === false,
        displayState: manualAgent.enabled === false ? 'Disabled' : 'Sleeping',
        pose: 'sleeping'
      }
      : agent);
    renderAssignments();
    saveAssignments();
    return;
  }
  const button = event.target.closest('[data-delete-agent]');
  if (!button) return;
  const id = button.dataset.deleteAgent;
  manualAgents = manualAgents.filter((agent) => agent.id !== id);
  delete assignments[id];
  agents = agents.filter((agent) => agent.id !== id);
  renderAssignments();
  saveAssignments();
});

reloadAssignmentsBtn.addEventListener('click', loadAssignments);
addAgentBtn.addEventListener('click', () => {
  const agent = newManualAgent();
  manualAgents = [...manualAgents, agent];
  assignments[agent.id] = previewVariant;
  agents = [...agents, { ...agent, role: 'Manual agent', status: 'idle', displayState: 'Sleeping', pose: 'sleeping', disabled: false }];
  renderAssignments();
  saveAssignments();
});

renderLegend();
renderModuleControls();
loadAssignments();
