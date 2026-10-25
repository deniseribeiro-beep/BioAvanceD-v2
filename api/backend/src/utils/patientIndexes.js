const { buildLookupIndex } = require('./lookupIndex');

/**
 * RNF002 C1 (#1324): a participant is looked up by its pseudonymised
 * participantId (`paciente.controller.js` and others), and the patients
 * collection had no index on that field, so every lookup was a collection
 * scan. Non-unique: a lookup index only, built by the Foundation job.
 */
async function ensurePatientLookupIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  await buildLookupIndex(collection, { participantId: 1 }, 'patients_participantid_idx_v1', 'PATIENTS');
}

module.exports = { ensurePatientLookupIndexes };
