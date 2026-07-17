const logoutBtn = document.querySelector('#logoutBtn');

async function initGatewaySessionUi() {
  const response = await fetch('/api/auth/status');
  if (!response.ok) return;
  const status = await response.json();
  if (!status.enabled || !status.authenticated || !logoutBtn) return;
  logoutBtn.classList.remove('hidden');
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login.html');
  });
}

initGatewaySessionUi().catch(() => {});
