const form = document.querySelector('#settingsForm');
const appVersion = document.querySelector('#appVersion');
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
const lowEnergyModeInput = document.querySelector('#lowEnergyMode');
const lowEnergyOptions = document.querySelector('#lowEnergyOptions');
const lowEnergyRefreshOverrideEnabledInput = document.querySelector('#lowEnergyRefreshOverrideEnabled');
const lowEnergyRefreshField = document.querySelector('#lowEnergyRefreshField');
const lowEnergyRefreshMsInput = document.querySelector('#lowEnergyRefreshMs');
const lowEnergyVisibleProvidersOnlyInput = document.querySelector('#lowEnergyVisibleProvidersOnly');
const lowEnergyStaticAllPosesInput = document.querySelector('#lowEnergyStaticAllPoses');
const lowEnergyStaticIdleField = document.querySelector('#lowEnergyStaticIdleField');
const lowEnergyStaticIdlePosesInput = document.querySelector('#lowEnergyStaticIdlePoses');
const showOnAllDesktopsField = document.querySelector('#showOnAllDesktopsField');
const showOnAllDesktopsInput = document.querySelector('#showOnAllDesktops');
const hideDockIconField = document.querySelector('#hideDockIconField');
const hideDockIconInput = document.querySelector('#hideDockIcon');
const showMenuBarIconField = document.querySelector('#showMenuBarIconField');
const showMenuBarIconInput = document.querySelector('#showMenuBarIcon');
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
const cursorEnabledInput = document.querySelector('#cursorEnabled');
const cursorGroupingField = document.querySelector('#cursorGroupingField');
const cursorGroupingInput = document.querySelector('#cursorGrouping');
const codexEnabledInput = document.querySelector('#codexEnabled');
const codexGroupingField = document.querySelector('#codexGroupingField');
const codexGroupingInput = document.querySelector('#codexGrouping');
const gooseEnabledInput = document.querySelector('#gooseEnabled');
const gooseGroupingField = document.querySelector('#gooseGroupingField');
const gooseGroupingInput = document.querySelector('#gooseGrouping');
const hermesEnabledInput = document.querySelector('#hermesEnabled');
const hermesGroupingField = document.querySelector('#hermesGroupingField');
const hermesGroupingInput = document.querySelector('#hermesGrouping');
const hermesConnectionModeField = document.querySelector('#hermesConnectionModeField');
const hermesConnectionModeInput = document.querySelector('#hermesConnectionMode');
const hermesGatewayUrlField = document.querySelector('#hermesGatewayUrlField');
const hermesGatewayUrlInput = document.querySelector('#hermesGatewayUrl');
const hermesGatewayTokenField = document.querySelector('#hermesGatewayTokenField');
const hermesGatewayTokenInput = document.querySelector('#hermesGatewayToken');
const testHermesButton = document.querySelector('#testHermesButton');
const hermesTestStatus = document.querySelector('#hermesTestStatus');
const buzzEnabledInput = document.querySelector('#buzzEnabled');
const buzzGroupingField = document.querySelector('#buzzGroupingField');
const buzzGroupingInput = document.querySelector('#buzzGrouping');
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
const integrationRefreshDefaults = Object.freeze({
  openCode: 5_000,
  openClaw: 5_000,
  vsCodeCopilot: 5_000,
  cursor: 5_000,
  codex: 5_000,
  goose: 5_000,
  hermes: 5_000,
  buzz: 5_000,
  claude: 5_000,
  gemini: 5_000,
  antigravity: 5_000,
  ollama: 5_000,
  lmStudio: 5_000
});
const integrationRefreshChoices = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const integrationRefreshInputs = {};
let encryptionAvailable = false;

function refreshChoiceLabel(milliseconds) {
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `Every ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = seconds / 60;
  return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function createIntegrationRefreshFields() {
  for (const [integration, defaultMs] of Object.entries(integrationRefreshDefaults)) {
    const enabledInput = document.querySelector(`#${integration}Enabled`);
    const checkRow = enabledInput?.closest('.checkRow');
    if (!checkRow) continue;
    const field = document.createElement('label');
    field.className = 'refreshSpeedField hidden';
    const label = document.createElement('span');
    label.textContent = 'Refresh speed';
    const select = document.createElement('select');
    select.id = `${integration}RefreshMs`;
    select.name = select.id;
    for (const milliseconds of integrationRefreshChoices) {
      const option = document.createElement('option');
      option.value = String(milliseconds);
      option.textContent = refreshChoiceLabel(milliseconds);
      select.append(option);
    }
    select.value = String(defaultMs);
    const note = document.createElement('small');
    note.textContent = 'Longer intervals reduce energy use, but status changes may appear later.';
    field.append(label, select, note);
    checkRow.after(field);
    integrationRefreshInputs[integration] = select;
    enabledInput.addEventListener('change', () => {
      field.classList.toggle('hidden', !enabledInput.checked);
    });
  }
}

function updateIntegrationRefreshFields() {
  for (const [integration, input] of Object.entries(integrationRefreshInputs)) {
    const enabled = document.querySelector(`#${integration}Enabled`)?.checked;
    input.closest('.refreshSpeedField')?.classList.toggle('hidden', !enabled);
  }
}

createIntegrationRefreshFields();

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

function updateLowEnergyFields() {
  lowEnergyOptions.classList.toggle('hidden', !lowEnergyModeInput.checked);
  lowEnergyRefreshField.classList.toggle(
    'hidden',
    !lowEnergyModeInput.checked || !lowEnergyRefreshOverrideEnabledInput.checked
  );
  const staticAllPoses = lowEnergyStaticAllPosesInput.checked;
  lowEnergyStaticIdlePosesInput.disabled = staticAllPoses;
  lowEnergyStaticIdleField.classList.toggle('optionDisabled', staticAllPoses);
}

function updateAppPresenceFields() {
  if (hideDockIconInput.checked) showMenuBarIconInput.checked = true;
  if (!showMenuBarIconInput.checked) hideDockIconInput.checked = false;
  hideDockIconInput.disabled = !showMenuBarIconInput.checked;
  showMenuBarIconInput.disabled = hideDockIconInput.checked;
  hideDockIconField.classList.toggle('optionDisabled', hideDockIconInput.disabled);
  showMenuBarIconField.classList.toggle('optionDisabled', showMenuBarIconInput.disabled);
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

function updateCursorFields() {
  cursorGroupingField.classList.toggle('hidden', !cursorEnabledInput.checked);
}

function updateCodexFields() {
  codexGroupingField.classList.toggle('hidden', !codexEnabledInput.checked);
}

function updateGooseFields() {
  gooseGroupingField.classList.toggle('hidden', !gooseEnabledInput.checked);
}

function updateHermesFields() {
  const enabled = hermesEnabledInput.checked;
  const remote = enabled && hermesConnectionModeInput.value === 'remote';
  hermesGroupingField.classList.toggle('hidden', !enabled);
  hermesConnectionModeField.classList.toggle('hidden', !enabled);
  hermesGatewayUrlField.classList.toggle('hidden', !remote);
  hermesGatewayTokenField.classList.toggle('hidden', !remote);
  testHermesButton.classList.toggle('hidden', !remote);
  hermesTestStatus.classList.toggle('hidden', !remote);
  hermesGatewayUrlInput.required = remote;
}

function showHermesTestStatus(kind = '', value = '') {
  hermesTestStatus.textContent = value;
  hermesTestStatus.className = `integrationStatus${value ? ` visible ${kind}` : ''}`;
}

function updateBuzzFields() {
  buzzGroupingField.classList.toggle('hidden', !buzzEnabledInput.checked);
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
  appVersion.textContent = settings.appVersion ? `Version ${settings.appVersion}` : '';
  encryptionAvailable = Boolean(settings.encryptionAvailable);
  connectionModeInput.value = settings.connectionMode === 'remote' ? 'remote' : 'local';
  urlInput.value = settings.url || 'http://127.0.0.1:3000';
  alwaysOnTopInput.checked = settings.alwaysOnTop;
  lowEnergyModeInput.checked = Boolean(settings.lowEnergyMode);
  lowEnergyRefreshOverrideEnabledInput.checked = Boolean(settings.lowEnergyRefreshOverrideEnabled);
  lowEnergyRefreshMsInput.value = String(settings.lowEnergyRefreshMs || 30_000);
  lowEnergyVisibleProvidersOnlyInput.checked = settings.lowEnergyVisibleProvidersOnly !== false;
  lowEnergyStaticAllPosesInput.checked = Boolean(settings.lowEnergyStaticAllPoses);
  lowEnergyStaticIdlePosesInput.checked = Boolean(settings.lowEnergyStaticIdlePoses);
  showOnAllDesktopsField.classList.toggle('hidden', !settings.showOnAllDesktopsSupported);
  showOnAllDesktopsInput.checked = Boolean(settings.showOnAllDesktops);
  hideDockIconField.classList.toggle('hidden', !settings.dockIconSupported);
  hideDockIconInput.checked = Boolean(settings.hideDockIcon);
  showMenuBarIconField.classList.toggle('hidden', !settings.menuBarIconSupported);
  showMenuBarIconInput.checked = Boolean(settings.showMenuBarIcon);
  displayModeInput.value = settings.displayMode || 'office';
  opacityInput.value = String(Math.round((settings.opacity || 1) * 100));
  avatarWidthInput.value = String(settings.avatarWidth || 300);
  avatarHeightInput.value = String(settings.avatarHeight || 380);
  for (const [integration, defaultMs] of Object.entries(integrationRefreshDefaults)) {
    const milliseconds = settings.integrationRefreshMs?.[integration] || defaultMs;
    integrationRefreshInputs[integration].value = String(milliseconds);
  }
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
  cursorEnabledInput.checked = Boolean(settings.cursorEnabled);
  cursorGroupingInput.value = settings.cursorGrouping === 'single' ? 'single' : 'project';
  codexEnabledInput.checked = Boolean(settings.codexEnabled);
  codexGroupingInput.value = settings.codexGrouping === 'single' ? 'single' : 'project';
  gooseEnabledInput.checked = Boolean(settings.gooseEnabled);
  gooseGroupingInput.value = settings.gooseGrouping === 'single' ? 'single' : 'project';
  hermesEnabledInput.checked = Boolean(settings.hermesEnabled);
  hermesGroupingInput.value = settings.hermesGrouping === 'single' ? 'single' : 'project';
  hermesConnectionModeInput.value = settings.hermesConnectionMode === 'remote' ? 'remote' : 'local';
  hermesGatewayUrlInput.value = settings.hermesGatewayUrl || 'http://127.0.0.1:9119';
  hermesGatewayTokenInput.placeholder = settings.hermesCredentialsStored
    ? 'Saved securely — enter to replace'
    : 'Hermes gateway session token';
  buzzEnabledInput.checked = Boolean(settings.buzzEnabled);
  buzzGroupingInput.value = settings.buzzGrouping === 'agent' ? 'agent' : 'single';
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
  updateLowEnergyFields();
  updateAppPresenceFields();
  updateOpenCodeFields();
  updateOpenClawFields();
  updateVsCodeCopilotFields();
  updateCursorFields();
  updateCodexFields();
  updateGooseFields();
  updateHermesFields();
  updateBuzzFields();
  updateClaudeFields();
  updateGeminiFields();
  updateAntigravityFields();
  updateOllamaFields();
  updateLmStudioFields();
  updateIntegrationRefreshFields();
  updateConnectionFields();
  tokenInput.placeholder = settings.credentialsStored
    ? 'Saved securely — enter a value to replace it'
    : 'Gateway token';
  showError(settings.error);
}

window.clawOffice.onError(showError);
window.clawOffice.onDockVisibilityChanged((hidden) => {
  hideDockIconInput.checked = Boolean(hidden);
  updateAppPresenceFields();
});
window.clawOffice.onMenuBarVisibilityChanged((visible) => {
  showMenuBarIconInput.checked = Boolean(visible);
  updateAppPresenceFields();
});
window.clawOffice.onLowEnergyModeChanged((enabled) => {
  lowEnergyModeInput.checked = Boolean(enabled);
  updateLowEnergyFields();
});
connectionModeInput.addEventListener('change', updateConnectionFields);
displayModeInput.addEventListener('change', updateDisplayFields);
opacityInput.addEventListener('input', updateOpacityLabel);
lowEnergyModeInput.addEventListener('change', updateLowEnergyFields);
lowEnergyRefreshOverrideEnabledInput.addEventListener('change', updateLowEnergyFields);
lowEnergyStaticAllPosesInput.addEventListener('change', updateLowEnergyFields);
hideDockIconInput.addEventListener('change', updateAppPresenceFields);
showMenuBarIconInput.addEventListener('change', updateAppPresenceFields);
openCodeEnabledInput.addEventListener('change', updateOpenCodeFields);
openClawEnabledInput.addEventListener('change', updateOpenClawFields);
vsCodeCopilotEnabledInput.addEventListener('change', updateVsCodeCopilotFields);
cursorEnabledInput.addEventListener('change', updateCursorFields);
codexEnabledInput.addEventListener('change', updateCodexFields);
gooseEnabledInput.addEventListener('change', updateGooseFields);
hermesEnabledInput.addEventListener('change', updateHermesFields);
hermesConnectionModeInput.addEventListener('change', updateHermesFields);
buzzEnabledInput.addEventListener('change', updateBuzzFields);
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
    showConfigStatus(
      'success',
      result.restoredLocalData
        ? 'Configuration, avatar assignments, and Rank Board data imported. Review the settings, then open the office to apply them.'
        : 'Configuration imported. Review the settings, then open the office to apply it.'
    );
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
      showConfigStatus('success', 'Configuration, avatar assignments, and Rank Board data exported. Saved credentials remain encrypted and may need to be entered again on another computer.');
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

testHermesButton.addEventListener('click', async () => {
  if (!hermesGatewayUrlInput.reportValidity()) return;
  showHermesTestStatus('pending', 'Connecting to the Hermes gateway…');
  testHermesButton.disabled = true;
  const previousLabel = testHermesButton.textContent;
  testHermesButton.textContent = 'Testing…';
  try {
    const result = await window.clawOffice.testHermes({
      hermesGatewayUrl: hermesGatewayUrlInput.value,
      hermesGatewayToken: hermesGatewayTokenInput.value,
      hermesGrouping: hermesGroupingInput.value
    });
    showHermesTestStatus(
      result.ok ? 'success' : 'error',
      `${result.message}${result.gatewayUrl ? `\nGateway: ${result.gatewayUrl}` : ''}`
    );
  } catch (error) {
    showHermesTestStatus('error', error.message || 'Could not test the Hermes gateway.');
  } finally {
    testHermesButton.disabled = false;
    testHermesButton.textContent = previousLabel;
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
      lowEnergyMode: lowEnergyModeInput.checked,
      lowEnergyRefreshOverrideEnabled: lowEnergyRefreshOverrideEnabledInput.checked,
      lowEnergyRefreshMs: Number(lowEnergyRefreshMsInput.value),
      lowEnergyVisibleProvidersOnly: lowEnergyVisibleProvidersOnlyInput.checked,
      lowEnergyStaticAllPoses: lowEnergyStaticAllPosesInput.checked,
      lowEnergyStaticIdlePoses: lowEnergyStaticIdlePosesInput.checked,
      showOnAllDesktops: showOnAllDesktopsInput.checked,
      hideDockIcon: hideDockIconInput.checked,
      showMenuBarIcon: showMenuBarIconInput.checked,
      displayMode: displayModeInput.value,
      selectedAgent: selectedAgentInput.value,
      opacity: Number(opacityInput.value) / 100,
      avatarWidth: Number(avatarWidthInput.value),
      avatarHeight: Number(avatarHeightInput.value),
      ...Object.fromEntries(Object.entries(integrationRefreshInputs).map(([integration, input]) => [
        `${integration}RefreshMs`,
        Number(input.value)
      ])),
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
      cursorEnabled: cursorEnabledInput.checked,
      cursorGrouping: cursorGroupingInput.value,
      codexEnabled: codexEnabledInput.checked,
      codexGrouping: codexGroupingInput.value,
      gooseEnabled: gooseEnabledInput.checked,
      gooseGrouping: gooseGroupingInput.value,
      hermesEnabled: hermesEnabledInput.checked,
      hermesGrouping: hermesGroupingInput.value,
      hermesConnectionMode: hermesConnectionModeInput.value,
      hermesGatewayUrl: hermesGatewayUrlInput.value,
      hermesGatewayToken: hermesGatewayTokenInput.value,
      buzzEnabled: buzzEnabledInput.checked,
      buzzGrouping: buzzGroupingInput.value,
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
