/**
 * #1402 (ELM-0275): the index of BiomarkerAssociation, one row per
 * `biomarkerId`, a helper taking the collection, like
 * `utils/telemetryExposureSummaryIndexes.js`. It neither latches nor
 * catches: the Foundation job builds it before the APIs start.
 */
function canIndex(collection) {
  return Boolean(collection) && typeof collection.createIndex === 'function';
}

async function ensureBiomarkerAssociationIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ biomarkerId: 1 }, { unique: true, name: 'uniq_biomarkerId' });
}

module.exports = { ensureBiomarkerAssociationIndexes };
