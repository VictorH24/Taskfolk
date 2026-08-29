const DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS = 60_000;
const DEFAULT_RUNTIME_WAKE_ROSTER_GRACE_MS = 20_000;

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

function runtimeWakeRosterShouldBePreserved(
  cachedAgents,
  nextAgents,
  wakeStartedAtMs,
  nowMs = Date.now(),
  graceMs = DEFAULT_RUNTIME_WAKE_ROSTER_GRACE_MS
) {
  if (!Array.isArray(cachedAgents) || cachedAgents.length === 0) return false;
  if (Array.isArray(nextAgents) && nextAgents.length > 0) return false;
  const wakeAt = Number(wakeStartedAtMs);
  const now = Number(nowMs);
  const grace = Math.max(0, Number(graceMs) || 0);
  return Number.isFinite(wakeAt)
    && wakeAt > 0
    && Number.isFinite(now)
    && now >= wakeAt
    && now - wakeAt <= grace;
}

module.exports = {
  DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS,
  DEFAULT_RUNTIME_WAKE_ROSTER_GRACE_MS,
  runtimePublishDue,
  runtimeRosterMissingFromCache,
  runtimeRosterRefreshMs,
  runtimeWakeRosterShouldBePreserved
};
