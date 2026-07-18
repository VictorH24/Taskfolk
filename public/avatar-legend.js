const legendGrid = document.querySelector('#legendGrid');
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
const folderViewModuleToggleBtn = document.querySelector('#folderViewModuleToggleBtn');
const folderViewModuleStatus = document.querySelector('#folderViewModuleStatus');

const isDesktopConfig = new URLSearchParams(window.location.search).get('app') === 'desktop';
document.body.classList.toggle('desktopConfig', isDesktopConfig);

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
const AVATAR_VARIANT_NAMES = [
  'Blonde Man',
  'Black-Haired Man with Glasses',
  'Curly-Haired Woman with Glasses',
  'Silver-Haired Man with Glasses',
  'Curly-Haired Man with Glasses',
  'Braided Woman',
  'Silver-Haired Woman',
  'Blonde Woman',
  'White Robot',
  'Blue Robot',
  'Golden Dog',
  'Tuxedo Cat',
  'Gorilla',
  'Tiger',
  'Lion',
  'Green Robot',
  'Curly-Haired Woman',
  'Black-Haired Man',
  'Braided Woman',
  'Bearded Man',
  'Hijabi Woman',
  'Silver-Haired Man',
  'Blonde Woman',
  'African-American Man',
  'Hooded Hacker',
  'Extraterrestrial'
];
const AVATAR_VARIANTS = AVATAR_VARIANT_NAMES.map((name, index) => ({
  value: index === 0 ? 0 : `v${index}_gif`,
  label: `Variant ${index} ${name} (GIF)`,
  versionLabel: `v${index} ${name.toLowerCase()} gif`
}));
const AVATAR_SHEETS = AVATAR_VARIANT_NAMES.map((description, value) => ({
  value,
  label: `Variant ${value}`,
  description,
  src: `./avatar-scenes/generated-sheets/v${value}.png`
}));
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

let agents = [];
let assignments = {};
let hiddenAgents = [];
let manualAgents = [];
let modules = { folderView: { enabled: true } };
let officeScene = { floor: 'wood', windowView: 'sf', poster: 0, emptyDesks: 0 };
let savingAssignments = false;

function normalizeAvatarVariant(value) {
  const raw = String(value ?? 0);
  if (raw === 'v0_gif') return 0;
  if (/^v\d+_gif$/.test(raw) && AVATAR_VARIANTS.some((variant) => variant.value === raw)) return raw;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 25) return 0;
  return numeric === 0 ? 0 : `v${numeric}_gif`;
}

function randomAvatarVariant() {
  return AVATAR_VARIANTS[Math.floor(Math.random() * AVATAR_VARIANTS.length)].value;
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

function renderAvatarSheets() {
  legendGrid.innerHTML = AVATAR_SHEETS.map((sheet) => `
    <article class="avatarSheetCard">
      <span class="avatarSheetImage">
        <img src="${sheet.src}" alt="${sheet.label} generated avatar sheet" loading="lazy" draggable="false" />
        <canvas class="avatarSheetCanvas" role="img" aria-label="${sheet.label} generated avatar sheet with transparent background" hidden></canvas>
      </span>
      <span class="avatarSheetMeta">
        <strong>${sheet.label}</strong>
        <small>${sheet.description} · v${sheet.value}</small>
      </span>
    </article>
  `).join('');
  renderTransparentSheetBackgrounds();
}

function isPinkBackgroundPixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return red > 145
    && blue > 145
    && red > green * 1.55
    && blue > green * 1.45
    && Math.abs(red - blue) < 105;
}

function makeSheetBackgroundTransparent(image) {
  const canvas = image.nextElementSibling;
  if (!(canvas instanceof HTMLCanvasElement) || !image.naturalWidth || !image.naturalHeight) return;

  try {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    const enqueuePinkPixel = (pixel) => {
      if (visited[pixel]) return;
      visited[pixel] = 1;
      if (!isPinkBackgroundPixel(data, pixel * 4)) return;
      queue[tail] = pixel;
      tail += 1;
    };

    for (let x = 0; x < width; x += 1) {
      enqueuePinkPixel(x);
      enqueuePinkPixel((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueuePinkPixel(y * width);
      enqueuePinkPixel(y * width + width - 1);
    }

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      data[pixel * 4 + 3] = 0;
      const x = pixel % width;
      if (x > 0) enqueuePinkPixel(pixel - 1);
      if (x < width - 1) enqueuePinkPixel(pixel + 1);
      if (pixel >= width) enqueuePinkPixel(pixel - width);
      if (pixel < width * (height - 1)) enqueuePinkPixel(pixel + width);
    }

    context.putImageData(pixels, 0, 0);
    canvas.hidden = false;
    image.hidden = true;
  } catch {
    canvas.hidden = true;
    image.hidden = false;
  }
}

function renderTransparentSheetBackgrounds() {
  legendGrid.querySelectorAll('.avatarSheetImage img').forEach((image) => {
    if (image.complete) makeSheetBackgroundTransparent(image);
    else image.addEventListener('load', () => makeSheetBackgroundTransparent(image), { once: true });
  });
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
  renderOfficeSceneButtons();
  renderAvatarSheets();
}

function agentConfigKey(agent) {
  return String(agent?.avatarAssignmentKey || agent?.id || '');
}

function assignedAvatar(agent) {
  const key = agentConfigKey(agent);
  if (Object.prototype.hasOwnProperty.call(assignments, key)) return assignments[key];
  if (Object.prototype.hasOwnProperty.call(assignments, agent.id)) return assignments[agent.id];
  return agent.avatarVariant;
}

function variantSelect(agent) {
  const key = agentConfigKey(agent);
  const value = normalizeAvatarVariant(assignedAvatar(agent));
  return `
    <select data-agent-id="${esc(agent.id)}" data-assignment-key="${esc(key)}" aria-label="Avatar variant for ${esc(agent.name)}">
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

function normalizeModules(value = {}) {
  const hasFolderViewEnabled = Object.prototype.hasOwnProperty.call(value.folderView || {}, 'enabled');
  return {
    folderView: {
      enabled: hasFolderViewEnabled ? value.folderView.enabled !== false : true
    }
  };
}

function renderModuleControls() {
  const folderViewEnabled = modules.folderView.enabled !== false;
  folderViewNavBtn?.classList.toggle('hidden', !folderViewEnabled);
  if (folderViewModuleToggleBtn) {
    folderViewModuleToggleBtn.textContent = folderViewEnabled ? 'Enabled' : 'Disabled';
    folderViewModuleToggleBtn.setAttribute('aria-pressed', String(folderViewEnabled));
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
    <article class="assignmentRow ${isManualAgent(agent) ? 'manual' : ''} ${manualAgentEnabled(agent.id) && !agent.hidden ? '' : 'disabled'}">
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
          <span>${esc(agent.id)} · ${esc(agent.role || 'agent')}${agent.hidden ? ' · disabled in office' : ''}</span>
        `}
      </div>
      <div class="assignmentPreview">
        ${SceneArt.sceneMarkup({
          pose: agent.pose || (agent.status === 'blocked' ? 'blocked' : agent.status === 'active' ? 'working' : 'coffee'),
          role: agent.role || 'agent',
          label: agent.name,
          variant: assignedAvatar(agent),
          showLabel: false
        })}
      </div>
      <label>
        <span>Avatar</span>
        ${variantSelect(agent)}
      </label>
      ${isManualAgent(agent) ? `
        <div class="manualAgentActions">
          <button class="secondary" type="button" data-toggle-agent="${esc(agent.id)}">${manualAgentEnabled(agent.id) ? 'Disable' : 'Enable'}</button>
          <button class="secondary dangerButton" type="button" data-delete-agent="${esc(agent.id)}">Delete</button>
        </div>
      ` : `
        <div class="manualAgentActions">
          <button class="secondary" type="button" data-toggle-visible-agent="${esc(agentConfigKey(agent))}">${agent.hidden ? 'Restore' : 'Disable'}</button>
          ${agent.runtime ? `<button class="secondary dangerButton" type="button" data-remove-runtime-agent="${esc(agent.id)}" data-assignment-key="${esc(agentConfigKey(agent))}">Remove</button>` : ''}
        </div>
      `}
    </article>
  `).join('');
}

async function loadAssignments() {
  assignmentStatus.textContent = 'Loading agents…';
  try {
    const [agentData, assignmentData] = await Promise.all([
      api(`/api/agents?includeHidden=1&t=${Date.now()}`),
      api(`/api/avatar-assignments?t=${Date.now()}`)
    ]);
    assignments = assignmentData.assignments || {};
    hiddenAgents = Array.isArray(assignmentData.hiddenAgents) ? assignmentData.hiddenAgents : [];
    manualAgents = Array.isArray(assignmentData.manualAgents) ? assignmentData.manualAgents : [];
    modules = normalizeModules(assignmentData.modules);
    agents = mergeManualAgentsIntoAgentList(Array.isArray(agentData.agents) ? agentData.agents : []);
    let migratedAssignments = false;
    for (const agent of agents) {
      const key = agentConfigKey(agent);
      if (key === agent.id || Object.prototype.hasOwnProperty.call(assignments, key) || !Object.prototype.hasOwnProperty.call(assignments, agent.id)) continue;
      assignments[key] = assignments[agent.id];
      delete assignments[agent.id];
      migratedAssignments = true;
    }
    const openCodeProjectKeys = [...new Set(agents
      .map((agent) => agentConfigKey(agent))
      .filter((key) => key.startsWith('runtime:opencode-project:')))];
    const hasSingleOpenCodeAgent = agents.some((agent) => agentConfigKey(agent) === 'runtime:opencode-single');
    if (hasSingleOpenCodeAgent
      && !Object.prototype.hasOwnProperty.call(assignments, 'runtime:opencode-single')
      && Object.prototype.hasOwnProperty.call(assignments, 'runtime:opencode')) {
      assignments['runtime:opencode-single'] = assignments['runtime:opencode'];
      delete assignments['runtime:opencode'];
      migratedAssignments = true;
    }
    if (hasSingleOpenCodeAgent && hiddenAgents.includes('runtime:opencode')) {
      hiddenAgents = [...new Set([
        ...hiddenAgents.filter((key) => key !== 'runtime:opencode'),
        'runtime:opencode-single'
      ])];
      migratedAssignments = true;
    }
    if (openCodeProjectKeys.length) {
      const legacyOpenCodeKeys = Object.keys(assignments).filter((key) => key.startsWith('opencode:'));
      const legacyVariant = assignments['runtime:opencode'] ?? (legacyOpenCodeKeys.length
        ? assignments[legacyOpenCodeKeys.at(-1)]
        : undefined);
      if (legacyVariant !== undefined) {
        for (const key of openCodeProjectKeys) {
          if (!Object.prototype.hasOwnProperty.call(assignments, key)) assignments[key] = legacyVariant;
        }
      }
      if (Object.prototype.hasOwnProperty.call(assignments, 'runtime:opencode')) {
        delete assignments['runtime:opencode'];
        migratedAssignments = true;
      }
      for (const key of legacyOpenCodeKeys) delete assignments[key];
      migratedAssignments = migratedAssignments || legacyOpenCodeKeys.length > 0;

      const hadLegacyHiddenState = hiddenAgents.includes('runtime:opencode')
        || hiddenAgents.some((key) => key.startsWith('opencode:'));
      if (hadLegacyHiddenState) {
        hiddenAgents = [...new Set([
          ...hiddenAgents.filter((key) => key !== 'runtime:opencode' && !key.startsWith('opencode:')),
          ...openCodeProjectKeys
        ])];
        migratedAssignments = true;
      }
    }
    for (const agent of agents) {
      const key = agentConfigKey(agent);
      if (Object.prototype.hasOwnProperty.call(assignments, key)) continue;
      assignments[key] = agent.avatarVariant === null || agent.avatarVariant === undefined
        ? randomAvatarVariant()
        : normalizeAvatarVariant(agent.avatarVariant);
      migratedAssignments = true;
    }
    officeScene = normalizeOfficeScene(assignmentData.officeScene || agentData.officeScene);
    const path = assignmentData.path ? ` · ${assignmentData.path}` : '';
    assignmentStatus.textContent = `Saved assignments${path}`;
    renderLegend();
    renderModuleControls();
    renderAssignments();
    if (migratedAssignments) await saveAssignments();
  } catch (err) {
    assignmentStatus.textContent = `Unable to load assignments: ${err.message}`;
    assignmentList.innerHTML = '<div class="assignmentEmpty">Open this page through http://localhost:3000/avatar-legend.html to save assignments.</div>';
  }
}

async function saveAssignments(reload = true) {
  if (savingAssignments) return;
  savingAssignments = true;
  assignmentStatus.textContent = 'Saving assignments…';
  try {
    const data = await api('/api/avatar-assignments', {
      method: 'PUT',
      body: JSON.stringify({ assignments, hiddenAgents, manualAgents, modules, officeScene })
    });
    assignments = data.assignments || {};
    hiddenAgents = Array.isArray(data.hiddenAgents) ? data.hiddenAgents : hiddenAgents;
    manualAgents = Array.isArray(data.manualAgents) ? data.manualAgents : manualAgents;
    modules = normalizeModules(data.modules || modules);
    officeScene = normalizeOfficeScene(data.officeScene);
    assignmentStatus.textContent = `Saved assignments · ${data.path}`;
    if (isDesktopConfig) window.taskfolkDesktop?.configChanged();
    if (reload) await loadAssignments();
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

folderViewModuleToggleBtn?.addEventListener('click', () => {
  modules = normalizeModules({ ...modules, folderView: { enabled: modules.folderView.enabled === false } });
  renderModuleControls();
  saveAssignments();
});

assignmentList.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-agent-id]');
  if (!select) return;
  assignments[select.dataset.assignmentKey || select.dataset.agentId] = normalizeAvatarVariant(select.value);
  renderAssignments();
  saveAssignments();
});

assignmentList.addEventListener('input', (event) => {
  const nameInput = event.target.closest('input[data-agent-name]');
  if (!nameInput) return;
  const manualAgent = manualAgents.find((agent) => agent.id === nameInput.dataset.agentName);
  if (!manualAgent) return;
  manualAgent.name = nameInput.value;
});

assignmentList.addEventListener('focusout', (event) => {
  const nameInput = event.target.closest('input[data-agent-name]');
  if (nameInput) {
    const manualAgent = manualAgents.find((agent) => agent.id === nameInput.dataset.agentName);
    if (!manualAgent) return;
    manualAgent.name = nameInput.value.trim() || manualAgent.name || 'Agent';
    saveAssignments();
  }
});

assignmentList.addEventListener('click', async (event) => {
  const removeRuntimeButton = event.target.closest('[data-remove-runtime-agent]');
  if (removeRuntimeButton) {
    const id = removeRuntimeButton.dataset.removeRuntimeAgent;
    const key = removeRuntimeButton.dataset.assignmentKey || id;
    assignmentStatus.textContent = `Removing ${id}…`;
    try {
      await api(`/api/runtime-agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      delete assignments[key];
      delete assignments[id];
      hiddenAgents = hiddenAgents.filter((entry) => entry !== key && entry !== id);
      agents = agents.filter((agent) => agent.id !== id);
      renderAssignments();
      await saveAssignments(false);
    } catch (err) {
      assignmentStatus.textContent = `Unable to remove agent: ${err.message}`;
    }
    return;
  }
  const visibilityButton = event.target.closest('[data-toggle-visible-agent]');
  if (visibilityButton) {
    const key = visibilityButton.dataset.toggleVisibleAgent;
    const hidden = hiddenAgents.includes(key);
    hiddenAgents = hidden ? hiddenAgents.filter((entry) => entry !== key) : [...new Set([...hiddenAgents, key])];
    agents = agents.map((agent) => agentConfigKey(agent) === key ? { ...agent, hidden: !hidden } : agent);
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
  assignments[agent.id] = randomAvatarVariant();
  agents = [...agents, { ...agent, role: 'Manual agent', status: 'idle', displayState: 'Sleeping', pose: 'sleeping', disabled: false }];
  renderAssignments();
  saveAssignments();
});

renderLegend();
renderModuleControls();
loadAssignments();
