const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { getCollection } = require('../utils/collectionResolver');
const ClinicalObservationModel = require('../models/ClinicalObservation');
const { assertReferencesExist } = require('../ingestion/canonicalGateway');
const { diagnosticReportReferenceChecks } = require('./diagnostic-report.service');

/**
 * Persists one ClinicalObservation (dict-02 ELM-0219..0232, #691)
 * referenced by participantId. #691's own scope calls for a hard
 * reference-check on `specimenId`/`deviceId` when supplied. #695 adds
 * the same check on `diagnosticReportId` (ELM-0232): every value, typed
 * `DiagnosticReport/<id>` or a bare id, must resolve to a real
 * DiagnosticReport, and an empty typed id is refused as malformed.
 * Reuses `assertReferencesExist`
 * (RF029 AC#2's own machinery, #669) rather than re-implementing a
 * findOne-and-check per field -- same reuse discipline
 * condition.service.js's activeCodeValidator use established for #690.
 */
async function createClinicalObservation(db, data) {
  const observation = ClinicalObservationModel.create(data);

  const reportCheck = diagnosticReportReferenceChecks(observation.diagnosticReportId, 'diagnosticReportId', {
    typedOnly: false,
  });
  const referenceCheck = await assertReferencesExist(db, [
    { collection: CANONICAL_COLLECTIONS.samples, field: 'specimenId', value: observation.specimenId, label: 'specimenId' },
    { collection: 'devices', field: 'deviceId', value: observation.deviceId, label: 'deviceId' },
    ...reportCheck.references,
  ]);
  if (reportCheck.malformed.length || !referenceCheck.valid) {
    throw new Error([...reportCheck.malformed, ...referenceCheck.violations.map((v) => v.message)].join(', '));
  }

  const collection = await getCollection(db, 'clinicalObservations');
  await collection.insertOne(observation);
  return observation;
}

/** All clinical observations for a participant. */
async function getClinicalObservationsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'clinicalObservations');
  const cursor = await collection.find({ participantId: String(participantId) });
  return cursor.toArray();
}

/** One clinical observation by its own observationId (not Mongo's _id). */
async function getClinicalObservationById(db, observationId) {
  if (!observationId) return null;
  const collection = await getCollection(db, 'clinicalObservations');
  return collection.findOne({ observationId: String(observationId) });
}

module.exports = {
  createClinicalObservation,
  getClinicalObservationsForParticipant,
  getClinicalObservationById,
};
