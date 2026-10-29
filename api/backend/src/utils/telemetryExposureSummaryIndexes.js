/**
 * #1392 (RF009 AC5/AC6): the indexes of TelemetryExposureSummary, a helper
 * taking the collection, like `utils/physicalChainIndexes.js`. It neither
 * latches nor catches: telemetryExposure.service.js latches it per db, and
 * the Foundation job builds it before the APIs start.
 */
function canIndex(collection) {
  return Boolean(collection) && typeof collection.createIndex === 'function';
}

async function ensureTelemetryExposureSummaryIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ telemetryExposureSummaryId: 1 }, { unique: true, name: 'uniq_telemetryExposureSummaryId' });
  await collection.createIndex({ specimenId: 1, windowStart: 1 });
  await collection.createIndex({ exposurePathHash: 1 });
}

module.exports = { ensureTelemetryExposureSummaryIndexes };
