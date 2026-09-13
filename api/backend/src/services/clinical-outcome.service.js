const { getCollection } = require('../utils/collectionResolver');
const ClinicalOutcomeModel = require('../models/ClinicalOutcome');

/** Persists one ClinicalOutcome (dict-02 ELM-0252..0254, #691). */
async function createClinicalOutcome(db, data) {
  const collection = await getCollection(db, 'clinicalOutcomes');
  const outcome = ClinicalOutcomeModel.create(data);
  await collection.insertOne(outcome);
  return outcome;
}

/** One clinical outcome by its own outcomeId (not Mongo's _id). */
async function getClinicalOutcomeById(db, outcomeId) {
  if (!outcomeId) return null;
  const collection = await getCollection(db, 'clinicalOutcomes');
  return collection.findOne({ outcomeId: String(outcomeId) });
}

module.exports = {
  createClinicalOutcome,
  getClinicalOutcomeById,
};
