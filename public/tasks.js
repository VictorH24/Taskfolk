const TASK_STATUSES = ['backlog', 'ready', 'assigned', 'in_progress', 'blocked', 'review', 'done', 'failed'];
const STATUS_LABELS = {
  backlog: 'Backlog',
  ready: 'Ready',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  failed: 'Failed'
};
const themeOptions = ['system', 'light', 'dark'];
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };
const themeIcons = { system: '💻', light: '☀️', dark: '🌙' };

const board = document.querySelector('#kanbanBoard');
const agentList = document.querySelector('#agentList');
const taskForm = document.querySelector('#taskForm');
const taskDescription = document.querySelector('#taskDescription');
const refreshTasksBtn = document.querySelector('#refreshTasksBtn');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
const toast = document.querySelector('#toast');
const folderViewNavBtn = document.querySelector('#folderViewNavBtn');

let state = { enabled: true, tasks: [], agents: [], statuses: TASK_STATUSES };
let refreshTimer = null;
let editingTaskId = null;
const expandedTaskIds = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function applyTheme(theme) {
  const nextTheme = themeOptions.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = nextTheme;
  themeToggleBtn.innerHTML = `<span aria-hidden="true">${themeIcons[nextTheme]}</span><span>${themeLabels[nextTheme]}</span>`;
  themeToggleBtn.setAttribute('aria-label', `Color theme: ${themeLabels[nextTheme]}. Click to switch theme.`);
}

function setTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem('theme', theme); } catch {}
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || 'system';
  const nextTheme = themeOptions[(themeOptions.indexOf(currentTheme) + 1) % themeOptions.length];
  setTheme(nextTheme);
}

function commaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function loadModuleConfig() {
  const data = await requestJson('/api/config');
  folderViewNavBtn?.classList.toggle('hidden', data.modules?.folderView?.enabled === false);
}

function agentName(agentId) {
  const agent = state.agents.find((item) => item.id === agentId);
  return agent ? agent.name : agentId || 'Unassigned';
}

function renderTaskNotes(task) {
  const notes = Array.isArray(task.notes) ? task.notes : [];
  if (!notes.length && !task.lastNote) return '';
  const noteItems = notes.length ? notes : [{ note: task.lastNote, agentId: task.lastNoteAgentId, createdAt: task.updatedAt }];
  return `
    <div class="taskNotes">
      ${noteItems.map((note) => `
        <blockquote>
          ${escapeHtml(note.note)}
          <cite>${escapeHtml(note.agentId ? agentName(note.agentId) : 'Mission Control')}${note.createdAt ? ` · ${escapeHtml(new Date(note.createdAt).toLocaleString())}` : ''}</cite>
        </blockquote>
      `).join('')}
    </div>
  `;
}

function renderAgents() {
  if (!state.agents.length) {
    agentList.innerHTML = '<div class="emptyOffice">No task agents yet.</div>';
    return;
  }
  agentList.innerHTML = state.agents.map((agent) => `
    <article class="taskAgent">
      <div>
        <strong>${escapeHtml(agent.name)}</strong>
        <span>${escapeHtml(agent.id)} · ${escapeHtml(agent.role || 'agent')}</span>
        <small>${escapeHtml(agent.workspacePath || 'No workspace')}</small>
      </div>
      <div class="taskAgentMeta">
        <span>${escapeHtml(agent.status || 'idle')}</span>
        ${agent.currentTaskId ? `<span>${escapeHtml(agent.currentTaskId)}</span>` : ''}
      </div>
    </article>
  `).join('');
}

function renderTask(task) {
  if (editingTaskId === task.id) return renderTaskEditor(task);
  const isExpanded = expandedTaskIds.has(task.id);
  const agentOptions = [
    '<option value="">Unassigned</option>',
    ...state.agents.map((agent) => `<option value="${escapeHtml(agent.id)}" ${agent.id === task.assignedAgentId ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`)
  ].join('');
  const statusOptions = state.statuses.map((status) => `<option value="${status}" ${status === task.status ? 'selected' : ''}>${STATUS_LABELS[status] || status}</option>`).join('');
  const tags = Array.isArray(task.tags) && task.tags.length
    ? `<div class="taskTags">${task.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  return `
    <article class="taskCard ${isExpanded ? 'expanded' : 'collapsed'}" draggable="true" data-task-id="${escapeHtml(task.id)}">
      <div class="taskCardTop">
        <strong>${escapeHtml(task.title)}</strong>
        <button class="secondary taskExpandBtn" type="button" data-task-toggle="${escapeHtml(task.id)}" aria-expanded="${isExpanded}">${isExpanded ? 'Collapse' : 'Expand'}</button>
      </div>
      ${isExpanded ? `
        <div class="taskCardDetails">
          <span class="priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority || 'normal')}</span>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
          ${renderTaskNotes(task)}
          ${tags}
          <div class="taskMeta">
            <span>${escapeHtml(agentName(task.assignedAgentId))}</span>
            <span>${escapeHtml(new Date(task.updatedAt || task.createdAt || Date.now()).toLocaleString())}</span>
          </div>
          <div class="taskControls">
            <select data-task-agent="${escapeHtml(task.id)}" aria-label="Assign agent">${agentOptions}</select>
            <select data-task-status="${escapeHtml(task.id)}" aria-label="Task status">${statusOptions}</select>
          </div>
          <div class="taskActions">
            <button class="secondary" type="button" data-task-edit="${escapeHtml(task.id)}">Edit</button>
            <button class="secondary" type="button" data-task-note="${escapeHtml(task.id)}">Note</button>
            <button class="secondary" type="button" data-task-archive="${escapeHtml(task.id)}">Archive</button>
            <button class="secondary" type="button" data-task-delete="${escapeHtml(task.id)}">Delete</button>
          </div>
        </div>
      ` : ''}
    </article>
  `;
}

function renderTaskEditor(task) {
  return `
    <article class="taskCard taskEditCard" data-task-id="${escapeHtml(task.id)}">
      <form class="taskEditForm" data-task-edit-form="${escapeHtml(task.id)}">
        <label>
          <span>Title</span>
          <input name="title" type="text" required value="${escapeHtml(task.title)}" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="7">${escapeHtml(task.description || '')}</textarea>
        </label>
        <div class="taskActions">
          <button type="submit">Save</button>
          <button class="secondary" type="button" data-task-cancel-edit="${escapeHtml(task.id)}">Cancel</button>
        </div>
      </form>
    </article>
  `;
}

function renderBoard() {
  const statuses = state.statuses.length ? state.statuses : TASK_STATUSES;
  board.innerHTML = statuses.map((status) => {
    const tasks = state.tasks.filter((task) => task.status === status);
    return `
      <section class="kanbanColumn" data-status="${status}">
        <header>
          <h2>${STATUS_LABELS[status] || status}</h2>
          <span>${tasks.length}</span>
        </header>
        <div class="kanbanDropZone" data-drop-status="${status}">
          ${tasks.map(renderTask).join('') || '<div class="taskEmpty">No tasks</div>'}
        </div>
      </section>
    `;
  }).join('');
}

function render() {
  if (state.enabled === false) {
    taskForm.closest('.taskToolbar')?.classList.add('hidden');
    agentList.closest('.agentPanel')?.classList.add('hidden');
    board.innerHTML = '<section class="taskEmpty taskModuleDisabled">The task module is disabled. Enable it in Config to use the Kanban board.</section>';
    return;
  }
  taskForm.closest('.taskToolbar')?.classList.remove('hidden');
  agentList.closest('.agentPanel')?.classList.remove('hidden');
  renderAgents();
  renderBoard();
}

async function loadTasks({ force = false } = {}) {
  if (editingTaskId && !force) return false;
  const data = await requestJson('/api/tasks');
  state = {
    enabled: data.enabled !== false,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    agents: Array.isArray(data.agents) ? data.agents : [],
    statuses: Array.isArray(data.statuses) ? data.statuses : TASK_STATUSES
  };
  render();
  return true;
}

async function createTask(event) {
  event.preventDefault();
  const formData = new FormData(taskForm);
  const payload = {
    title: formData.get('title'),
    priority: formData.get('priority'),
    tags: commaList(formData.get('tags')),
    description: taskDescription.value
  };
  await requestJson('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  taskForm.reset();
  taskDescription.value = '';
  showToast('Task created');
  await loadTasks();
}

async function updateTask(taskId, payload) {
  await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  await loadTasks({ force: true });
}

async function assignTask(taskId, agentId) {
  if (!agentId) {
    await updateTask(taskId, { assignedAgentId: null, status: 'ready' });
    return;
  }
  const data = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/assign`, { method: 'POST', body: JSON.stringify({ agentId }) });
  showToast(data.wroteCurrentTask ? 'Task assigned' : 'Assigned, but current-task.json was not written');
  await loadTasks();
}

async function handleBoardChange(event) {
  const statusTaskId = event.target.dataset.taskStatus;
  const agentTaskId = event.target.dataset.taskAgent;
  if (statusTaskId) await updateTask(statusTaskId, { status: event.target.value });
  if (agentTaskId) await assignTask(agentTaskId, event.target.value);
}

async function handleBoardClick(event) {
  const toggleTaskId = event.target.dataset.taskToggle;
  const deleteTaskId = event.target.dataset.taskDelete;
  const archiveTaskId = event.target.dataset.taskArchive;
  const noteTaskId = event.target.dataset.taskNote;
  const editTaskId = event.target.dataset.taskEdit;
  const cancelEditTaskId = event.target.dataset.taskCancelEdit;
  if (toggleTaskId) {
    if (expandedTaskIds.has(toggleTaskId)) expandedTaskIds.delete(toggleTaskId);
    else expandedTaskIds.add(toggleTaskId);
    renderBoard();
  }
  if (cancelEditTaskId) {
    editingTaskId = null;
    renderBoard();
  }
  if (editTaskId) {
    editingTaskId = editTaskId;
    renderBoard();
  }
  if (deleteTaskId && confirm('Delete this task?')) {
    await requestJson(`/api/tasks/${encodeURIComponent(deleteTaskId)}`, { method: 'DELETE' });
    showToast('Task deleted');
    await loadTasks();
  }
  if (archiveTaskId && confirm('Archive this task?')) {
    await requestJson(`/api/tasks/${encodeURIComponent(archiveTaskId)}/archive`, { method: 'POST' });
    showToast('Task archived');
    await loadTasks();
  }
  if (noteTaskId) {
    const note = prompt('Task note');
    if (note !== null) await updateTask(noteTaskId, { lastNote: note });
  }
}

async function handleBoardSubmit(event) {
  const taskId = event.target.dataset.taskEditForm;
  if (!taskId) return;
  event.preventDefault();
  const formData = new FormData(event.target);
  await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: formData.get('title'),
      description: formData.get('description')
    })
  });
  editingTaskId = null;
  await loadTasks({ force: true });
  showToast('Task updated');
}

function handleDragStart(event) {
  const card = event.target.closest('.taskCard');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.taskId);
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
  if (event.target.closest('.kanbanDropZone')) event.preventDefault();
}

async function handleDrop(event) {
  const zone = event.target.closest('.kanbanDropZone');
  if (!zone) return;
  event.preventDefault();
  const taskId = event.dataTransfer.getData('text/plain');
  if (!taskId) return;
  await updateTask(taskId, { status: zone.dataset.dropStatus });
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadTasks().catch((err) => showToast(err.message));
  }, 5000);
}

taskForm.addEventListener('submit', (event) => createTask(event).catch((err) => showToast(err.message)));
refreshTasksBtn.addEventListener('click', () => loadTasks().then((refreshed) => {
  showToast(refreshed ? 'Tasks refreshed' : 'Save or cancel the edit before refreshing');
}).catch((err) => showToast(err.message)));
themeToggleBtn.addEventListener('click', toggleTheme);
board.addEventListener('change', (event) => handleBoardChange(event).catch((err) => showToast(err.message)));
board.addEventListener('click', (event) => handleBoardClick(event).catch((err) => showToast(err.message)));
board.addEventListener('submit', (event) => handleBoardSubmit(event).catch((err) => showToast(err.message)));
board.addEventListener('dragstart', handleDragStart);
board.addEventListener('dragover', handleDragOver);
board.addEventListener('drop', (event) => handleDrop(event).catch((err) => showToast(err.message)));

try { applyTheme(localStorage.getItem('theme') || 'system'); } catch { applyTheme('system'); }
loadModuleConfig().catch((err) => showToast(err.message));
loadTasks().catch((err) => showToast(err.message));
scheduleRefresh();
