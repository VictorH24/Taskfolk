function normalizeLocalServerPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 0;
}

module.exports = { normalizeLocalServerPort };
