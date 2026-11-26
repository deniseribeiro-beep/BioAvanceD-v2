/**
 * RNF025 AC6 (#1520): "Detectar desvio de relógio acima do limite
 * configurado". The one source of the telemetry clock-drift limit, the
 * security configuration's `telemetry.clockDriftLimitMinutes`, which both
 * telemetry screening (telemetryReadingContract) and the ingestion
 * timeliness metric (dataQualityAssessment) read. It changes through a
 * ConfigurationRelease, like every other key of that configuration.
 *
 * `[inference]` Reads the document directly, as session.service's
 * resolveSessionPolicy does: securityService.getConfig inserts a default
 * document when none exists, a write that has no place in an ingestion.
 *
 * `[inference]` Fails open to the catalog's default, getDefaultConfig()'s
 * own value, for the reason session.service gives: an unreadable policy
 * falls back to the documented default, not an invented one. Every failure
 * returns the default and never throws.
 */
const { SECURITY_SETTING_CATALOG } = require('../governance/securitySettingCatalog');
const logger = require('../utils/logger');

const ENTRY = SECURITY_SETTING_CATALOG['telemetry.clockDriftLimitMinutes'];
const DEFAULT_CLOCK_DRIFT_LIMIT_MS = ENTRY.default * 60 * 1000;

// The catalog's range, the one configFindings enforces on every write, so a
// value only a direct write could store (1e-12, 1441, Number.MAX_VALUE)
// reads as the default rather than as no limit or an endless one.
function withinCatalogRange(minutes) {
  const { min, max } = ENTRY.allowedValues;
  return Number.isInteger(minutes) && minutes >= min && minutes <= max;
}

/** The limit, in milliseconds, a security configuration document sets. */
function clockDriftLimitMsOf(config) {
  const minutes = config?.telemetry?.clockDriftLimitMinutes;
  return withinCatalogRange(minutes) ? minutes * 60 * 1000 : DEFAULT_CLOCK_DRIFT_LIMIT_MS;
}

/** `db` may be a function resolving it. */
async function resolveClockDriftLimitMs(db) {
  try {
    const store = typeof db === 'function' ? await db() : db;
    const config = await store.collection('security_config').findOne({ _id: 'main' });
    return clockDriftLimitMsOf(config);
  } catch (error) {
    logger.warn(`#1520: limite de desvio de relógio ilegível, usando o padrão (${DEFAULT_CLOCK_DRIFT_LIMIT_MS / 60000} min): ${error.message || error}`);
    return DEFAULT_CLOCK_DRIFT_LIMIT_MS;
  }
}

module.exports = { DEFAULT_CLOCK_DRIFT_LIMIT_MS, clockDriftLimitMsOf, resolveClockDriftLimitMs };
