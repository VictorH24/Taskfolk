const form = document.querySelector('#settingsForm');
const connectionModeInput = document.querySelector('#connectionMode');
const localModeNote = document.querySelector('#localModeNote');
const remoteConnectionFields = document.querySelector('#remoteConnectionFields');
const urlInput = document.querySelector('#url');
const tokenInput = document.querySelector('#token');
const passwordInput = document.querySelector('#password');
const displayModeInput = document.querySelector('#displayMode');
const agentField = document.querySelector('#agentField');
const selectedAgentInput = document.querySelector('#selectedAgent');
const avatarSizeField = document.querySelector('#avatarSizeField');
const avatarWidthInput = document.querySelector('#avatarWidth');
const avatarHeightInput = document.querySelector('#avatarHeight');
const resetAvatarSizeButton = document.querySelector('#resetAvatarSize');
const opacityInput = document.querySelector('#opacity');
const opacityValue = document.querySelector('#opacityValue');
const alwaysOnTopInput = document.querySelector('#alwaysOnTop');
const openCodeEnabledInput = document.querySelector('#openCodeEnabled');
const openCodeGroupingField = document.querySelector('#openCodeGroupingField');
const openCodeGroupingInput = document.querySelector('#openCodeGrouping');
const openCodeUrlField = document.querySelector('#openCodeUrlField');
const openCodeUrlInput = document.querySelector('#openCodeUrl');
const openCodeAuthFields = document.querySelector('#openCodeAuthFields');
const openCodeUsernameInput = document.querySelector('#openCodeUsername');
const openCodePasswordInput = document.querySelector('#openCodePassword');
const vsCodeCopilotEnabledInput = document.querySelector('#vsCodeCopilotEnabled');
const vsCodeCopilotGroupingField = document.querySelector('#vsCodeCopilotGroupingField');
const vsCodeCopilotGroupingInput = document.querySelector('#vsCodeCopilotGrouping');
const connectButton = document.querySelector('#connectButton');
const message = document.querySelector('#message');
const securityNote = document.querySelector('#securityNote');
let encryptionAvailable = false;

function showError(value) {
  message.textContent = value || '';
  message.classList.toggle('visible', Boolean(value));
}

function updateDisplayFields() {
  const avatarVisible = displayModeInput.value === 'avatar';
  agentField.classList.toggle('hidden', !avatarVisible);
  avatarSizeField.classList.toggle('hidden', !avatarVisible);
}

function updateOpacityLabel() {
  opacityValue.value = `${opacityInput.value}%`;
  opacityValue.textContent = opacityValue.value;
}

function updateOpenCodeFields() {
  openCodeGroupingField.classList.toggle('hidden', !openCodeEnabledInput.checked);
  openCodeUrlField.classList.toggle('hidden', !openCodeEnabledInput.checked);
  openCodeAuthFields.classList.toggle('hidden', !openCodeEnabledInput.checked);
  openCodeUrlInput.required = openCodeEnabledInput.checked;
}

function updateVsCodeCopilotFields() {
  vsCodeCopilotGroupingField.classList.toggle('hidden', !vsCodeCopilotEnabledInput.checked);
}

function updateConnectionFields() {
  const local = connectionModeInput.value === 'local';
  localModeNote.classList.toggle('hidden', !local);
  remoteConnectionFields.classList.toggle('hidden', local);
  urlInput.required = !local;
  connectButton.textContent = local ? 'Run and open office' : 'Connect and open office';
  securityNote.textContent = local
    ? 'The local server listens only on this computer and uses a new private access token each time the app starts.'
    : encryptionAvailable
      ? 'Credentials are encrypted by your operating system and are never added to the URL.'
      : 'Secure credential storage is unavailable. Credentials will only be kept until this app exits.';
}

async function initialize() {
  const settings = await window.clawOffice.loadSettings();
  encryptionAvailable = Boolean(settings.encryptionAvailable);
  connectionModeInput.value = settings.connectionMode === 'remote' ? 'remote' : 'local';
  urlInput.value = settings.url || 'http://127.0.0.1:3000';
  alwaysOnTopInput.checked = settings.alwaysOnTop;
  displayModeInput.value = settings.displayMode || 'office';
  opacityInput.value = String(Math.round((settings.opacity || 1) * 100));
  avatarWidthInput.value = String(settings.avatarWidth || 300);
  avatarHeightInput.value = String(settings.avatarHeight || 380);
  openCodeEnabledInput.checked = Boolean(settings.openCodeEnabled);
  openCodeGroupingInput.value = settings.openCodeGrouping === 'single' ? 'single' : 'project';
  openCodeUrlInput.value = settings.openCodeUrl || 'http://127.0.0.1:4096';
  openCodeUsernameInput.value = settings.openCodeUsername || 'opencode';
  openCodePasswordInput.placeholder = settings.openCodeCredentialsStored
    ? 'Saved securely — enter to replace'
    : 'Only if server auth is enabled';
  vsCodeCopilotEnabledInput.checked = Boolean(settings.vsCodeCopilotEnabled);
  vsCodeCopilotGroupingInput.value = settings.vsCodeCopilotGrouping === 'single' ? 'single' : 'project';
  for (const agent of settings.agents || []) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name;
    selectedAgentInput.append(option);
  }
  selectedAgentInput.value = settings.selectedAgent || '';
  updateDisplayFields();
  updateOpacityLabel();
  updateOpenCodeFields();
  updateVsCodeCopilotFields();
  updateConnectionFields();
  tokenInput.placeholder = settings.credentialsStored
    ? 'Saved securely — enter a value to replace it'
    : 'Gateway token';
  showError(settings.error);
}

window.clawOffice.onError(showError);
connectionModeInput.addEventListener('change', updateConnectionFields);
displayModeInput.addEventListener('change', updateDisplayFields);
opacityInput.addEventListener('input', updateOpacityLabel);
openCodeEnabledInput.addEventListener('change', updateOpenCodeFields);
vsCodeCopilotEnabledInput.addEventListener('change', updateVsCodeCopilotFields);
resetAvatarSizeButton.addEventListener('click', () => {
  avatarWidthInput.value = '300';
  avatarHeightInput.value = '380';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  connectButton.disabled = true;
  connectButton.textContent = connectionModeInput.value === 'local' ? 'Starting…' : 'Connecting…';
  try {
    await window.clawOffice.connect({
      connectionMode: connectionModeInput.value,
      url: urlInput.value,
      token: tokenInput.value,
      password: passwordInput.value,
      alwaysOnTop: alwaysOnTopInput.checked,
      displayMode: displayModeInput.value,
      selectedAgent: selectedAgentInput.value,
      opacity: Number(opacityInput.value) / 100,
      avatarWidth: Number(avatarWidthInput.value),
      avatarHeight: Number(avatarHeightInput.value),
      openCodeEnabled: openCodeEnabledInput.checked,
      openCodeGrouping: openCodeGroupingInput.value,
      openCodeUrl: openCodeUrlInput.value,
      openCodeUsername: openCodeUsernameInput.value,
      openCodePassword: openCodePasswordInput.value,
      vsCodeCopilotEnabled: vsCodeCopilotEnabledInput.checked,
      vsCodeCopilotGrouping: vsCodeCopilotGroupingInput.value
    });
  } catch (error) {
    showError(error.message || 'Could not connect to Taskfolk.');
  } finally {
    connectButton.disabled = false;
    updateConnectionFields();
  }
});

initialize().catch((error) => showError(error.message));
