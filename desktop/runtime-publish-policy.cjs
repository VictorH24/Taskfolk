const DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS = 60_000;

function runtimePublishDue(
  previous,
  signature,
  nowMs = Date.now(),
  heartbeatMs = DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS
) {
  if (!previous || previous.signature !== signature) return true;
  return nowMs - previous.publishedAtMs >= Math.max(1_000, Number(heartbeatMs) || DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS);
}

function runtimeRosterMissingFromCache(availableAgents = [], publishedAgents = []) {
  const availableIds = new Set(availableAgents.map((agent) => String(agent?.id || '')).filter(Boolean));
  return publishedAgents.some((agent) => {
    const id = String(agent?.id || '');
    return Boolean(id) && !availableIds.has(id);
  });
}

function runtimeRosterRefreshMs(refreshMs, pollingAllowed, hasCachedAgents, heartbeatMs = DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS) {
  return !pollingAllowed && hasCachedAgents
    ? Math.min(refreshMs, heartbeatMs)
    : refreshMs;
}

module.exports = {
  DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS,
  runtimePublishDue,
  runtimeRosterMissingFromCache,
  runtimeRosterRefreshMs
};
