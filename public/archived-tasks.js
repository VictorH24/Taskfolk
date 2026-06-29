const themeOptions = ['system', 'light', 'dark'];
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };
const themeIcons = { system: '💻', light: '☀️', dark: '🌙' };
const archiveList = document.querySelector('#archiveList');
const refreshArchiveBtn = document.querySelector('#refreshArchiveBtn');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
const toast = document.querySelector('#toast');
const folderViewNavBtn = document.querySelector('#folderViewNavBtn');
let archivedTasks = [];

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

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || 'system';
  const nextTheme = themeOptions[(themeOptions.indexOf(currentTheme) + 1) % themeOptions.length];
  applyTheme(nextTheme);
  try { localStorage.setItem('theme', nextTheme); } catch {}
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

function renderArchive() {
  if (!archivedTasks.length) {
    archiveList.innerHTML = '<div class="taskEmpty archiveEmpty">No archived tasks.</div>';
    return;
  }
  archiveList.innerHTML = archivedTasks.map((record) => {
    const task = record.task || {};
    const notes = Array.isArray(task.notes) ? task.notes : [];
    return `
      <article class="archiveTask">
        <div>
          <span class="eyebrow">${escapeHtml(task.status || 'backlog')}</span>
          <h2>${escapeHtml(task.title || record.taskId)}</h2>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
          ${notes.length ? `
            <div class="taskNotes">
              ${notes.map((note) => `
                <blockquote>
                  ${escapeHtml(note.note)}
                  <cite>${escapeHtml(note.agentId || 'Mission Control')}${note.createdAt ? ` · ${escapeHtml(new Date(note.createdAt).toLocaleString())}` : ''}</cite>
                </blockquote>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <dl class="archiveMeta">
          <div><dt>Task</dt><dd>${escapeHtml(record.taskId)}</dd></div>
          <div><dt>Priority</dt><dd>${escapeHtml(task.priority || 'normal')}</dd></div>
          <div><dt>Archived</dt><dd>${escapeHtml(record.archivedAt ? new Date(record.archivedAt).toLocaleString() : 'Unknown')}</dd></div>
          <div><dt>Last note</dt><dd>${escapeHtml(task.lastNote || 'None')}${task.lastNoteAgentId ? ` · ${escapeHtml(task.lastNoteAgentId)}` : ''}</dd></div>
        </dl>
        <div class="taskActions">
          <button type="button" data-restore-task="${escapeHtml(record.taskId)}">Restore</button>
        </div>
      </article>
    `;
  }).join('');
}

async function loadArchive() {
  const data = await requestJson('/api/archived-tasks');
  archivedTasks = Array.isArray(data.archivedTasks) ? data.archivedTasks : [];
  renderArchive();
}

archiveList.addEventListener('click', async (event) => {
  const taskId = event.target.dataset.restoreTask;
  if (!taskId) return;
  await requestJson(`/api/archived-tasks/${encodeURIComponent(taskId)}/restore`, { method: 'POST' });
  showToast('Task restored');
  await loadArchive();
});

refreshArchiveBtn.addEventListener('click', () => loadArchive().then(() => showToast('Archive refreshed')).catch((err) => showToast(err.message)));
themeToggleBtn.addEventListener('click', toggleTheme);

try { applyTheme(localStorage.getItem('theme') || 'system'); } catch { applyTheme('system'); }
loadModuleConfig().catch((err) => showToast(err.message));
loadArchive().catch((err) => showToast(err.message));
