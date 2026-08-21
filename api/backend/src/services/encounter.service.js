const { getCollection } = require('../utils/collectionResolver');
const EncounterModel = require('../models/Encounter');

/**
 * Persists one Encounter (dict-02 ELM-0194..0199, #689) referenced by
 * participantId -- the foundational "visit/interaction context" entity
 * later RF005 slices (Condition/PhenotypeObservation/ClinicalObservation)
 * optionally join against via encounterId.
 */
async function createEncounter(db, data) {
  const collection = await getCollection(db, 'encounters');
  const encounter = EncounterModel.create(data);
  await collection.insertOne(encounter);
  return encounter;
}

/** All encounters for a participant, most recent first. */
async function getEncountersForParticipant(db, participantId) {
  const collection = await getCollection(db, 'encounters');
  return collection
    .find({ participantId: String(participantId) })
    .sort({ 'encounterPeriod.start': -1 })
    .toArray();
}

/** One encounter by its own encounterId (not Mongo's _id). */
async function getEncounterById(db, encounterId) {
  if (!encounterId) return null;
  const collection = await getCollection(db, 'encounters');
  return collection.findOne({ encounterId: String(encounterId) });
}

module.exports = {
  createEncounter,
  getEncountersForParticipant,
  getEncounterById,
};
