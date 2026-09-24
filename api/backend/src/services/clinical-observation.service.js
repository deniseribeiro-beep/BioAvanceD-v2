const { getCanonicalCollectionName } = require('../config/canonicalEntityCollections.v2');
const { getCollection } = require('../utils/collectionResolver');
const ClinicalObservationModel = require('../models/ClinicalObservation');
const { assertReferencesExist } = require('../ingestion/canonicalGateway');

/**
 * Persists one ClinicalObservation (dict-02 ELM-0219..0232, #691)
 * referenced by participantId. #691's own scope calls for a hard
 * reference-check on `specimenId`/`deviceId` when supplied (unlike
 * diagnosticReportId, which stays unenforced -- no DiagnosticReport
 * entity exists in this repo). Reuses `assertReferencesExist`
 * (RF029 AC#2's own machinery, #669) rather than re-implementing a
 * findOne-and-check per field -- same reuse discipline
 * condition.service.js's activeCodeValidator use established for #690.
 */
async function createClinicalObservation(db, data) {
  const observation = ClinicalObservationModel.create(data);

  const referenceCheck = await assertReferencesExist(db, [
    { collection: getCanonicalCollectionName('Specimen'), field: 'specimenId', value: observation.specimenId, label: 'specimenId' },
    { collection: getCanonicalCollectionName('Device'), field: 'deviceId', value: observation.deviceId, label: 'deviceId' },
  ]);
  if (!referenceCheck.valid) {
    throw new Error(referenceCheck.violations.map((v) => v.message).join(', '));
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
