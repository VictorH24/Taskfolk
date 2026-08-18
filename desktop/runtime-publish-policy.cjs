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

module.exports = {
  DEFAULT_RUNTIME_PUBLISH_HEARTBEAT_MS,
  runtimePublishDue
};
