const MIN_INTEGRATION_REFRESH_MS = 1_000;
const MAX_INTEGRATION_REFRESH_MS = 5 * 60_000;

const INTEGRATION_REFRESH_DEFAULTS = Object.freeze({
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

function refreshConfigKey(integration) {
  return `${integration}RefreshMs`;
}

function normalizeIntegrationRefreshMs(value, fallback = 5_000) {
  const fallbackMs = Math.min(
    MAX_INTEGRATION_REFRESH_MS,
    Math.max(MIN_INTEGRATION_REFRESH_MS, Math.round(Number(fallback) || 5_000))
  );
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallbackMs;
  return Math.min(MAX_INTEGRATION_REFRESH_MS, Math.max(MIN_INTEGRATION_REFRESH_MS, Math.round(numeric)));
}

function integrationRefreshMs(config, integration) {
  const fallback = INTEGRATION_REFRESH_DEFAULTS[integration] || 5_000;
  return normalizeIntegrationRefreshMs(config?.[refreshConfigKey(integration)], fallback);
}

function integrationRefreshSettings(config = {}) {
  return Object.fromEntries(
    Object.keys(INTEGRATION_REFRESH_DEFAULTS).map((integration) => [
      integration,
      integrationRefreshMs(config, integration)
    ])
  );
}

function integrationRefreshConfig(input = {}) {
  return Object.fromEntries(
    Object.keys(INTEGRATION_REFRESH_DEFAULTS).map((integration) => [
      refreshConfigKey(integration),
      integrationRefreshMs(input, integration)
    ])
  );
}

module.exports = {
  INTEGRATION_REFRESH_DEFAULTS,
  MAX_INTEGRATION_REFRESH_MS,
  MIN_INTEGRATION_REFRESH_MS,
  integrationRefreshConfig,
  integrationRefreshMs,
  integrationRefreshSettings,
  normalizeIntegrationRefreshMs,
  refreshConfigKey
};
