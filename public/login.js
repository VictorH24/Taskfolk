const form = document.querySelector('#gatewayLoginForm');
const tokenInput = document.querySelector('#gatewayToken');
const passwordInput = document.querySelector('#gatewayPassword');
const passwordRow = document.querySelector('#gatewayPasswordRow');
const loginMessage = document.querySelector('#loginMessage');
const loginError = document.querySelector('#loginError');

async function authRequest(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function initLogin() {
  const status = await authRequest('/api/auth/status');
  if (!status.enabled || status.authenticated) {
    window.location.replace('/');
    return;
  }
  passwordRow.classList.toggle('hidden', !status.passwordRequired);
  passwordInput.required = status.passwordRequired;
  loginMessage.textContent = status.passwordRequired
    ? 'Enter the configured gateway token and password to continue.'
    : 'Enter the configured gateway token to continue.';
  tokenInput.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await authRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.value, password: passwordInput.value })
    });
    window.location.replace('/');
  } catch (err) {
    loginError.textContent = err.message;
  }
});

initLogin().catch((err) => {
  loginError.textContent = err.message;
});
