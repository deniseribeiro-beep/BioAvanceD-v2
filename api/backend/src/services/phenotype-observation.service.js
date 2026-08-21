const { getCollection } = require('../utils/collectionResolver');
const PhenotypeObservationModel = require('../models/PhenotypeObservation');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one PhenotypeObservation (dict-02 ELM-0211..0218 +
 * P1X-0074..0076, #690) referenced by participantId. Same RF005 AC#4
 * active-code reuse as condition.service.js#createCondition -- see that
 * function's doc comment for why this borrows activeCodeValidator rather
 * than ingestionGateway.js's broader envelope.
 */
async function createPhenotypeObservation(db, data) {
  const observation = PhenotypeObservationModel.create(data);

  const codeCheck = await validateActiveCodes(db, [
    {
      systemUri: observation.hpoCoding.systemUri,
      code: observation.hpoCoding.code,
      version: observation.hpoCoding.version || null,
      label: `hpoCoding[${observation.hpoCoding.systemUri}|${observation.hpoCoding.code}]`,
    },
  ]);
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  const collection = await getCollection(db, 'phenotypeObservations');
  await collection.insertOne(observation);
  return observation;
}

/** All phenotype observations for a participant. */
async function getPhenotypeObservationsForParticipant(db, participantId) {
  const collection = await getCollection(db, 'phenotypeObservations');
  const cursor = await collection.find({ participantId: String(participantId) });
  return cursor.toArray();
}

/** All phenotype observations recorded within a given encounter (P1X-0075). */
async function getPhenotypeObservationsForEncounter(db, encounterId) {
  if (!encounterId) return [];
  const collection = await getCollection(db, 'phenotypeObservations');
  const cursor = await collection.find({ encounterId: String(encounterId) });
  return cursor.toArray();
}

module.exports = {
  createPhenotypeObservation,
  getPhenotypeObservationsForParticipant,
  getPhenotypeObservationsForEncounter,
};
