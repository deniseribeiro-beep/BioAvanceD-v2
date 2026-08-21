const { getCollection } = require('../utils/collectionResolver');
const FamilyHistoryModel = require('../models/FamilyHistory');

/** Persists one FamilyHistory (dict-02 ELM-0249..0251, #692). */
async function createFamilyHistory(db, data) {
  const collection = await getCollection(db, 'familyHistories');
  const familyHistory = FamilyHistoryModel.create(data);
  await collection.insertOne(familyHistory);
  return familyHistory;
}

/** One family history record by its own familyHistoryId (not Mongo's _id). */
async function getFamilyHistoryById(db, familyHistoryId) {
  if (!familyHistoryId) return null;
  const collection = await getCollection(db, 'familyHistories');
  return collection.findOne({ familyHistoryId: String(familyHistoryId) });
}

module.exports = {
  createFamilyHistory,
  getFamilyHistoryById,
};
