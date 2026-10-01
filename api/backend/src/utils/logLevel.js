/**
 * #1260: the backend logger's minimum level, set from security_config's
 * logging.level (dict-02 P1X-0301: "Nível mínimo: info, warning, error ou
 * critical").
 *
 * Kept apart from logger.js so the many test files that vi.mock the logger
 * still get the real level store when security.service sets it.
 *
 * The config vocabulary maps onto the logger's three methods. 'critical'
 * keeps error lines: the backend has no level above error, and dropping
 * errors would leave an incident with no trace at all. Debug lines also need
 * NODE_ENV=development, as before, and logger.js gates them as 'info'.
 */

const RANK = { info: 20, warn: 30, error: 40 };
const CONFIG_LEVELS = { info: 'info', warning: 'warn', error: 'error', critical: 'error' };

let current = 'info';
let minRank = RANK.info;

// Returns false, and changes nothing, for a value outside the vocabulary.
function setMinLevel(level) {
  const mapped = CONFIG_LEVELS[level];
  if (!mapped) return false;
  current = level;
  minRank = RANK[mapped];
  return true;
}

function getMinLevel() {
  return current;
}

function isEnabled(method) {
  return RANK[method] >= minRank;
}

module.exports = { setMinLevel, getMinLevel, isEnabled, CONFIG_LEVELS: Object.keys(CONFIG_LEVELS) };
