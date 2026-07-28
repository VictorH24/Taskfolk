const rankBoardRows = document.querySelector('#rankBoardRows');
const rankBoardEmpty = document.querySelector('#rankBoardEmpty');
const rankBoardSummary = document.querySelector('#rankBoardSummary');
const rankBoardStatus = document.querySelector('#rankBoardStatus');
const rankBoardEyebrow = document.querySelector('#rankBoardEyebrow');
const rankBoardTitle = document.querySelector('#rankBoardTitle');
const refreshRankBoardBtn = document.querySelector('#refreshRankBoardBtn');
const folderViewNavBtn = document.querySelector('#folderViewNavBtn');
const rankPeriodButtons = [...document.querySelectorAll('[data-rank-period]')];
const isDesktopRankBoard = new URLSearchParams(window.location.search).get('app') === 'desktop';
let refreshTimer = null;
let refreshInFlight = false;
let latestRankBoardData = null;
let selectedRankPeriod = 'global';

document.body.classList.toggle('desktopRankBoard', isDesktopRankBoard);

async function loadNavigationConfig() {
  try {
    const config = await api('/api/config', { cache: 'no-store' });
    folderViewNavBtn?.classList.toggle('hidden', config.modules?.folderView?.enabled !== true);
  } catch {
    folderViewNavBtn?.classList.add('hidden');
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

function formatNumber(value) {
  return new Intl.NumberFormat().format(Math.max(0, Number(value) || 0));
}

function formatBooks(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.max(0, Number(value) || 0));
}

function achievementDuration(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (years) return `${years}y ${Math.floor((days % 365) / 30)}mo`;
  if (months) return `${months}mo ${days % 30}d`;
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes} min`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

function renderSummary(achievements) {
  const totals = achievements.reduce((summary, entry) => ({
    activeMs: summary.activeMs + (Number(entry.activeMs) || 0),
    successes: summary.successes + (Number(entry.successCount) || 0),
    approvals: summary.approvals + (Number(entry.approvalCount) || 0),
    blocked: summary.blocked + (Number(entry.blockedCount) || 0),
    coffees: summary.coffees + (Number(entry.coffeeCount) || 0),
    books: summary.books + (Number(entry.booksRead) || 0),
    games: summary.games + (Number(entry.gamesCompleted) || 0),
    music: summary.music + (Number(entry.musicCount) || 0),
    steps: summary.steps + (Number(entry.stepCount) || 0)
  }), { activeMs: 0, successes: 0, approvals: 0, blocked: 0, coffees: 0, books: 0, games: 0, music: 0, steps: 0 });
  rankBoardSummary.innerHTML = `
    <article><strong>${formatNumber(achievements.length)}</strong><span>Ranked agents</span></article>
    <article><strong>${esc(achievementDuration(totals.activeMs))}</strong><span>Total worked</span></article>
    <article><strong>${formatNumber(totals.successes)}</strong><span>Successful runs</span></article>
    <article><strong>${formatNumber(totals.approvals)}</strong><span>Approval requests</span></article>
    <article><strong>${formatNumber(totals.blocked)}</strong><span>Blocked events</span></article>
    <article><strong>☕ ${formatNumber(totals.coffees)}</strong><span>Coffees enjoyed</span></article>
    <article><strong>📚 ${formatBooks(totals.books)}</strong><span>Books read</span></article>
    <article><strong>🎮 ${formatBooks(totals.games)}</strong><span>Games completed</span></article>
    <article><strong>🎵 ${formatNumber(totals.music)}</strong><span>Music listened</span></article>
    <article><strong>👟 ${formatNumber(totals.steps)}</strong><span>Steps walked</span></article>`;
}

function selectedAchievements(data = {}) {
  return selectedRankPeriod === 'last7Days'
    ? (Array.isArray(data.weeklyAchievements) ? data.weeklyAchievements : [])
    : (Array.isArray(data.achievements) ? data.achievements : []);
}

function renderRankBoard(data = {}) {
  latestRankBoardData = data;
  const achievements = selectedAchievements(data);
  const weeklyWindow = data.achievementWindows?.last7Days || {};
  const weeklyDates = weeklyWindow.startDate && weeklyWindow.endDate
    ? `${weeklyWindow.startDate} to ${weeklyWindow.endDate} ${weeklyWindow.timezone || 'UTC'}`
    : 'today plus the previous 6 UTC dates';
  const weekly = selectedRankPeriod === 'last7Days';
  rankBoardEyebrow.textContent = weekly ? 'Recent activity' : 'All-time activity';
  rankBoardTitle.textContent = weekly ? 'Last 7 days rankings' : 'Global rankings';
  rankBoardStatus.dataset.periodDescription = weekly
    ? `Daily counters retained for ${weeklyDates}.`
    : 'Permanent cumulative achievement counters.';
  rankPeriodButtons.forEach((button) => {
    const selected = button.dataset.rankPeriod === selectedRankPeriod;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  renderSummary(achievements);
  rankBoardEmpty.classList.toggle('hidden', achievements.length > 0);
  rankBoardRows.innerHTML = achievements.map((entry) => `
    <tr>
      <td><strong>#${formatNumber(entry.rank)}</strong></td>
      <td class="rankBoardAgent"><strong>${esc(entry.name)}</strong><span>${esc(entry.source || 'agent')}</span></td>
      <td>${esc(achievementDuration(entry.activeMs))}</td>
      <td>${formatNumber(entry.successCount)}</td>
      <td>${formatNumber(entry.approvalCount)}</td>
      <td>${formatNumber(entry.blockedCount)}</td>
      <td><div class="rankBoardFunStats">
        <span title="Coffees enjoyed">☕ <b>${formatNumber(entry.coffeeCount)}</b></span>
        <span title="Books read">📚 <b>${formatBooks(entry.booksRead)}</b></span>
        <span title="Games completed">🎮 <b>${formatBooks(entry.gamesCompleted)}</b></span>
        <span title="Music listened">🎵 <b>${formatNumber(entry.musicCount)}</b></span>
        <span title="Steps walked">👟 <b>${formatNumber(entry.stepCount)}</b></span>
      </div></td>
      <td><button class="secondary dangerButton" type="button" data-reset-achievement="${esc(entry.key)}" data-agent-name="${esc(entry.name)}">Reset counters</button></td>
    </tr>
  `).join('');
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  if (document.hidden) return;
  refreshTimer = setTimeout(loadRankBoard, 5_000);
}

async function loadRankBoard() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  refreshRankBoardBtn.disabled = true;
  try {
    const data = await api(`/api/agents?includeHidden=1&t=${Date.now()}`, { cache: 'no-store' });
    renderRankBoard(data);
    rankBoardStatus.textContent = `Updated ${new Date(data.generatedAt || Date.now()).toLocaleTimeString()} · ${rankBoardStatus.dataset.periodDescription}`;
  } catch (error) {
    rankBoardStatus.textContent = `Unable to load counters: ${error.message}`;
  } finally {
    refreshInFlight = false;
    refreshRankBoardBtn.disabled = false;
    scheduleRefresh();
  }
}

rankBoardRows.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-reset-achievement]');
  if (!button) return;
  const key = button.dataset.resetAchievement;
  const name = button.dataset.agentName || key;
  const confirmed = window.confirm(
    `Reset achievement counters for ${name}?\n\nThis permanently resets worked time, successes, approvals, blocked events, coffees, books, games, music, and steps to zero. This action cannot be undone.`
  );
  if (!confirmed) return;
  button.disabled = true;
  rankBoardStatus.textContent = `Resetting counters for ${name}…`;
  try {
    await api(`/api/achievements/${encodeURIComponent(key)}/reset`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    });
    await loadRankBoard();
    rankBoardStatus.textContent = `Counters reset for ${name}.`;
  } catch (error) {
    rankBoardStatus.textContent = `Unable to reset counters: ${error.message}`;
    button.disabled = false;
  }
});

refreshRankBoardBtn.addEventListener('click', loadRankBoard);
rankPeriodButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedRankPeriod = button.dataset.rankPeriod === 'last7Days' ? 'last7Days' : 'global';
    if (latestRankBoardData) {
      renderRankBoard(latestRankBoardData);
      rankBoardStatus.textContent = `Updated ${new Date(latestRankBoardData.generatedAt || Date.now()).toLocaleTimeString()} · ${rankBoardStatus.dataset.periodDescription}`;
    }
  });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  } else {
    loadRankBoard();
  }
});

loadNavigationConfig();
loadRankBoard();
