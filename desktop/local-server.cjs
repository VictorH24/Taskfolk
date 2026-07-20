function normalizeLocalServerPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 0;
}

function isLocalServerPortConflict(output) {
  return /(?:^|\s)(?:EADDRINUSE|address already in use)(?:\s|:|$)/i.test(String(output || ''));
}

module.exports = { isLocalServerPortConflict, normalizeLocalServerPort };
