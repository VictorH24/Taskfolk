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
const showOnAllDesktopsField = document.querySelector('#showOnAllDesktopsField');
const showOnAllDesktopsInput = document.querySelector('#showOnAllDesktops');
const hideDockIconField = document.querySelector('#hideDockIconField');
const hideDockIconInput = document.querySelector('#hideDockIcon');
const openCodeEnabledInput = document.querySelector('#openCodeEnabled');
const openCodeGroupingField = document.querySelector('#openCodeGroupingField');
const openCodeGroupingInput = document.querySelector('#openCodeGrouping');
const openCodeUrlField = document.querySelector('#openCodeUrlField');
const openCodeUrlInput = document.querySelector('#openCodeUrl');
const openCodeAuthFields = document.querySelector('#openCodeAuthFields');
const openCodeUsernameInput = document.querySelector('#openCodeUsername');
const openCodePasswordInput = document.querySelector('#openCodePassword');
const openClawEnabledInput = document.querySelector('#openClawEnabled');
const openClawUrlField = document.querySelector('#openClawUrlField');
const openClawUrlInput = document.querySelector('#openClawUrl');
const openClawAuthFields = document.querySelector('#openClawAuthFields');
const openClawTokenInput = document.querySelector('#openClawToken');
const openClawPasswordInput = document.querySelector('#openClawPassword');
const testOpenClawButton = document.querySelector('#testOpenClawButton');
const openClawTestStatus = document.querySelector('#openClawTestStatus');
const vsCodeCopilotEnabledInput = document.querySelector('#vsCodeCopilotEnabled');
const vsCodeCopilotGroupingField = document.querySelector('#vsCodeCopilotGroupingField');
const vsCodeCopilotGroupingInput = document.querySelector('#vsCodeCopilotGrouping');
const codexEnabledInput = document.querySelector('#codexEnabled');
const codexGroupingField = document.querySelector('#codexGroupingField');
const codexGroupingInput = document.querySelector('#codexGrouping');
const claudeEnabledInput = document.querySelector('#claudeEnabled');
const claudeGroupingField = document.querySelector('#claudeGroupingField');
const claudeGroupingInput = document.querySelector('#claudeGrouping');
const geminiEnabledInput = document.querySelector('#geminiEnabled');
const geminiGroupingField = document.querySelector('#geminiGroupingField');
const geminiGroupingInput = document.querySelector('#geminiGrouping');
const antigravityEnabledInput = document.querySelector('#antigravityEnabled');
const antigravityGroupingField = document.querySelector('#antigravityGroupingField');
const antigravityGroupingInput = document.querySelector('#antigravityGrouping');
const ollamaEnabledInput = document.querySelector('#ollamaEnabled');
const ollamaGroupingField = document.querySelector('#ollamaGroupingField');
const ollamaGroupingInput = document.querySelector('#ollamaGrouping');
const ollamaUrlField = document.querySelector('#ollamaUrlField');
const ollamaUrlInput = document.querySelector('#ollamaUrl');
const lmStudioEnabledInput = document.querySelector('#lmStudioEnabled');
const lmStudioGroupingField = document.querySelector('#lmStudioGroupingField');
const lmStudioGroupingInput = document.querySelector('#lmStudioGrouping');
const lmStudioUrlField = document.querySelector('#lmStudioUrlField');
const lmStudioUrlInput = document.querySelector('#lmStudioUrl');
const lmStudioTokenField = document.querySelector('#lmStudioTokenField');
const lmStudioApiTokenInput = document.querySelector('#lmStudioApiToken');
const importConfigButton = document.querySelector('#importConfigButton');
const exportConfigButton = document.querySelector('#exportConfigButton');
const resetConfigButton = document.querySelector('#resetConfigButton');
const configStatus = document.querySelector('#configStatus');
const connectButton = document.querySelector('#connectButton');
const message = document.querySelector('#message');
const securityNote = document.querySelector('#securityNote');
let encryptionAvailable = false;

function showError(value) {
  message.textContent = value || '';
  message.classList.toggle('visible', Boolean(value));
}

function showConfigStatus(kind = '', value = '') {
  configStatus.textContent = value;
  configStatus.className = `integrationStatus${value ? ` visible ${kind}` : ''}`;
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

function updateCodexFields() {
  codexGroupingField.classList.toggle('hidden', !codexEnabledInput.checked);
}

function updateClaudeFields() {
  claudeGroupingField.classList.toggle('hidden', !claudeEnabledInput.checked);
}

function updateGeminiFields() {
  geminiGroupingField.classList.toggle('hidden', !geminiEnabledInput.checked);
}

function updateAntigravityFields() {
  antigravityGroupingField.classList.toggle('hidden', !antigravityEnabledInput.checked);
}

function updateOllamaFields() {
  ollamaGroupingField.classList.toggle('hidden', !ollamaEnabledInput.checked);
  ollamaUrlField.classList.toggle('hidden', !ollamaEnabledInput.checked);
  ollamaUrlInput.required = ollamaEnabledInput.checked;
}

function updateLmStudioFields() {
  lmStudioGroupingField.classList.toggle('hidden', !lmStudioEnabledInput.checked);
  lmStudioUrlField.classList.toggle('hidden', !lmStudioEnabledInput.checked);
  lmStudioTokenField.classList.toggle('hidden', !lmStudioEnabledInput.checked);
  lmStudioUrlInput.required = lmStudioEnabledInput.checked;
}

function updateOpenClawFields() {
  openClawUrlField.classList.toggle('hidden', !openClawEnabledInput.checked);
  openClawAuthFields.classList.toggle('hidden', !openClawEnabledInput.checked);
  testOpenClawButton.classList.toggle('hidden', !openClawEnabledInput.checked);
  openClawTestStatus.classList.toggle('hidden', !openClawEnabledInput.checked);
  openClawUrlInput.required = openClawEnabledInput.checked;
}

function showOpenClawTestStatus(kind = '', value = '') {
  openClawTestStatus.textContent = value;
  openClawTestStatus.className = `integrationStatus${value ? ` visible ${kind}` : ''}`;
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
  showOnAllDesktopsField.classList.toggle('hidden', !settings.showOnAllDesktopsSupported);
  showOnAllDesktopsInput.checked = Boolean(settings.showOnAllDesktops);
  hideDockIconField.classList.toggle('hidden', !settings.dockIconSupported);
  hideDockIconInput.checked = Boolean(settings.hideDockIcon);
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
  openClawEnabledInput.checked = Boolean(settings.openClawEnabled);
  openClawUrlInput.value = settings.openClawUrl || 'ws://127.0.0.1:18789';
  openClawTokenInput.placeholder = settings.openClawCredentialsStored
    ? 'Saved securely — enter to replace'
    : 'Only if gateway token auth is enabled';
  openClawPasswordInput.placeholder = settings.openClawCredentialsStored
    ? 'Saved securely — enter to replace'
    : 'Only if gateway password auth is enabled';
  vsCodeCopilotEnabledInput.checked = Boolean(settings.vsCodeCopilotEnabled);
  vsCodeCopilotGroupingInput.value = settings.vsCodeCopilotGrouping === 'single' ? 'single' : 'project';
  codexEnabledInput.checked = Boolean(settings.codexEnabled);
  codexGroupingInput.value = settings.codexGrouping === 'single' ? 'single' : 'project';
  claudeEnabledInput.checked = Boolean(settings.claudeEnabled);
  claudeGroupingInput.value = settings.claudeGrouping === 'single' ? 'single' : 'project';
  geminiEnabledInput.checked = Boolean(settings.geminiEnabled);
  geminiGroupingInput.value = settings.geminiGrouping === 'single' ? 'single' : 'project';
  antigravityEnabledInput.checked = Boolean(settings.antigravityEnabled);
  antigravityGroupingInput.value = settings.antigravityGrouping === 'single' ? 'single' : 'project';
  ollamaEnabledInput.checked = Boolean(settings.ollamaEnabled);
  ollamaGroupingInput.value = settings.ollamaGrouping === 'single' ? 'single' : 'chat';
  ollamaUrlInput.value = settings.ollamaUrl || 'http://127.0.0.1:11434';
  lmStudioEnabledInput.checked = Boolean(settings.lmStudioEnabled);
  lmStudioGroupingInput.value = settings.lmStudioGrouping === 'chat' ? 'chat' : 'single';
  lmStudioUrlInput.value = settings.lmStudioUrl || 'http://127.0.0.1:1234';
  lmStudioApiTokenInput.placeholder = settings.lmStudioCredentialsStored
    ? 'Saved securely — enter to replace'
    : 'Only if server authentication is enabled';
  while (selectedAgentInput.options.length > 2) selectedAgentInput.remove(2);
  for (const agent of settings.agents || []) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name;
    selectedAgentInput.append(option);
  }
  selectedAgentInput.value = settings.selectedAgent || '';
  exportConfigButton.classList.toggle('hidden', !settings.hasSavedConfiguration);
  resetConfigButton.classList.toggle('hidden', !settings.hasSavedConfiguration);
  updateDisplayFields();
  updateOpacityLabel();
  updateOpenCodeFields();
  updateOpenClawFields();
  updateVsCodeCopilotFields();
  updateCodexFields();
  updateClaudeFields();
  updateGeminiFields();
  updateAntigravityFields();
  updateOllamaFields();
  updateLmStudioFields();
  updateConnectionFields();
  tokenInput.placeholder = settings.credentialsStored
    ? 'Saved securely — enter a value to replace it'
    : 'Gateway token';
  showError(settings.error);
}

window.clawOffice.onError(showError);
window.clawOffice.onDockVisibilityChanged((hidden) => {
  hideDockIconInput.checked = Boolean(hidden);
});
connectionModeInput.addEventListener('change', updateConnectionFields);
displayModeInput.addEventListener('change', updateDisplayFields);
opacityInput.addEventListener('input', updateOpacityLabel);
openCodeEnabledInput.addEventListener('change', updateOpenCodeFields);
openClawEnabledInput.addEventListener('change', updateOpenClawFields);
vsCodeCopilotEnabledInput.addEventListener('change', updateVsCodeCopilotFields);
codexEnabledInput.addEventListener('change', updateCodexFields);
claudeEnabledInput.addEventListener('change', updateClaudeFields);
geminiEnabledInput.addEventListener('change', updateGeminiFields);
antigravityEnabledInput.addEventListener('change', updateAntigravityFields);
ollamaEnabledInput.addEventListener('change', updateOllamaFields);
lmStudioEnabledInput.addEventListener('change', updateLmStudioFields);
resetAvatarSizeButton.addEventListener('click', () => {
  avatarWidthInput.value = '300';
  avatarHeightInput.value = '380';
});

importConfigButton.addEventListener('click', async () => {
  showConfigStatus();
  importConfigButton.disabled = true;
  try {
    const result = await window.clawOffice.importConfig();
    if (result.canceled) return;
    await initialize();
    showError('');
    showConfigStatus('success', 'Configuration imported. Review the settings, then open the office to apply them.');
  } catch (error) {
    showConfigStatus('error', error.message || 'Could not import the configuration.');
  } finally {
    importConfigButton.disabled = false;
  }
});

exportConfigButton.addEventListener('click', async () => {
  showConfigStatus();
  exportConfigButton.disabled = true;
  try {
    const result = await window.clawOffice.exportConfig();
    if (!result.canceled) {
      showConfigStatus('success', 'Configuration exported. Saved credentials remain encrypted and may need to be entered again on another computer.');
    }
  } catch (error) {
    showConfigStatus('error', error.message || 'Could not export the configuration.');
  } finally {
    exportConfigButton.disabled = false;
  }
});

resetConfigButton.addEventListener('click', async () => {
  showConfigStatus();
  resetConfigButton.disabled = true;
  try {
    const result = await window.clawOffice.resetConfig();
    if (result.canceled) return;
    await initialize();
    showError('');
    showConfigStatus('success', 'Configuration reset. Taskfolk is ready to be set up like a fresh install.');
  } catch (error) {
    showConfigStatus('error', error.message || 'Could not reset the configuration.');
  } finally {
    resetConfigButton.disabled = false;
  }
});

testOpenClawButton.addEventListener('click', async () => {
  if (!openClawUrlInput.reportValidity()) return;
  showOpenClawTestStatus('pending', 'Connecting to the OpenClaw gateway and signing its device challenge…');
  testOpenClawButton.disabled = true;
  const previousLabel = testOpenClawButton.textContent;
  testOpenClawButton.textContent = 'Testing…';
  try {
    const result = await window.clawOffice.testOpenClaw({
      openClawUrl: openClawUrlInput.value,
      openClawToken: openClawTokenInput.value,
      openClawPassword: openClawPasswordInput.value
    });
    const device = result.deviceId ? `\nDevice: ${result.deviceId}` : '';
    if (result.ok) {
      showOpenClawTestStatus('success', `${result.message}\nGateway: ${result.gatewayUrl}${device}`);
    } else if (result.pairingRequired) {
      const approval = result.requestId
        ? `openclaw devices approve ${result.requestId}`
        : 'openclaw devices list\nopenclaw devices approve <requestId>';
      showOpenClawTestStatus(
        'pending',
        `Pairing request created. On the OpenClaw host run:\n${approval}\n\nAfter approval, press this test button again.${device}`
      );
    } else {
      const diagnostic = [result.stage, result.gatewayCode, result.detailsCode].filter(Boolean).join(' / ');
      showOpenClawTestStatus(
        'error',
        `${result.message}${diagnostic ? `\nStage: ${diagnostic}` : ''}\nGateway: ${result.gatewayUrl || openClawUrlInput.value}${device}`
      );
    }
  } catch (error) {
    showOpenClawTestStatus('error', error.message || 'Could not test the OpenClaw connection.');
  } finally {
    testOpenClawButton.disabled = false;
    testOpenClawButton.textContent = previousLabel;
  }
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
      showOnAllDesktops: showOnAllDesktopsInput.checked,
      hideDockIcon: hideDockIconInput.checked,
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
      openClawEnabled: openClawEnabledInput.checked,
      openClawUrl: openClawUrlInput.value,
      openClawToken: openClawTokenInput.value,
      openClawPassword: openClawPasswordInput.value,
      vsCodeCopilotEnabled: vsCodeCopilotEnabledInput.checked,
      vsCodeCopilotGrouping: vsCodeCopilotGroupingInput.value,
      codexEnabled: codexEnabledInput.checked,
      codexGrouping: codexGroupingInput.value,
      claudeEnabled: claudeEnabledInput.checked,
      claudeGrouping: claudeGroupingInput.value,
      geminiEnabled: geminiEnabledInput.checked,
      geminiGrouping: geminiGroupingInput.value,
      antigravityEnabled: antigravityEnabledInput.checked,
      antigravityGrouping: antigravityGroupingInput.value,
      ollamaEnabled: ollamaEnabledInput.checked,
      ollamaGrouping: ollamaGroupingInput.value,
      ollamaUrl: ollamaUrlInput.value,
      lmStudioEnabled: lmStudioEnabledInput.checked,
      lmStudioGrouping: lmStudioGroupingInput.value,
      lmStudioUrl: lmStudioUrlInput.value,
      lmStudioApiToken: lmStudioApiTokenInput.value
    });
  } catch (error) {
    showError(error.message || 'Could not connect to Taskfolk.');
  } finally {
    connectButton.disabled = false;
    updateConnectionFields();
  }
});

initialize().catch((error) => showError(error.message));
