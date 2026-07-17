function normalizeBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 120 || height < 150) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function normalizeAdditionalFolks(value) {
  if (!Array.isArray(value)) return [];
  const byAgentId = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const agentId = String(entry.agentId || '').trim().slice(0, 160);
    if (!agentId || byAgentId.has(agentId)) continue;
    const bounds = normalizeBounds(entry.bounds);
    byAgentId.set(agentId, bounds ? { agentId, bounds } : { agentId });
    if (byAgentId.size >= 24) break;
  }
  return [...byAgentId.values()];
}

module.exports = { normalizeAdditionalFolks, normalizeBounds };
