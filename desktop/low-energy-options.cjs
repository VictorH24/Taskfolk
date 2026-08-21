const {
  integrationRefreshMs,
  normalizeIntegrationRefreshMs
} = require('./refresh-intervals.cjs');

function lowEnergyVisibleProvidersOnly(config = {}) {
  return config.lowEnergyVisibleProvidersOnly === undefined
    ? true
    : Boolean(config.lowEnergyVisibleProvidersOnly);
}

function integrationKeyForProvider(value) {
  const provider = String(value || '').trim().toLowerCase().replace(/-desktop$/, '');
  return ({
    opencode: 'openCode',
    openclaw: 'openClaw',
    'vscode-copilot': 'vsCodeCopilot',
    cursor: 'cursor',
    codex: 'codex',
    goose: 'goose',
    hermes: 'hermes',
    buzz: 'buzz',
    claude: 'claude',
    gemini: 'gemini',
    antigravity: 'antigravity',
    ollama: 'ollama',
    lmstudio: 'lmStudio'
  })[provider] || '';
}

function integrationPollingRefreshMs(config, integration) {
  if (config?.lowEnergyMode && config.lowEnergyRefreshOverrideEnabled) {
    return normalizeIntegrationRefreshMs(config.lowEnergyRefreshMs, 30_000);
  }
  return integrationRefreshMs(config, integration);
}

function providerPollingAllowedForVisibleSet(config, integration, visibleIntegrations) {
  if (!config?.lowEnergyMode || !lowEnergyVisibleProvidersOnly(config)) return true;
  return visibleIntegrations === null
    || visibleIntegrations.size === 0
    || visibleIntegrations.has(integration);
}

module.exports = {
  integrationKeyForProvider,
  integrationPollingRefreshMs,
  lowEnergyVisibleProvidersOnly,
  providerPollingAllowedForVisibleSet
};
