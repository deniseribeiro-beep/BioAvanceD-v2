const { getCollection } = require('../utils/collectionResolver');
const AllergyIntoleranceModel = require('../models/AllergyIntolerance');

/** Persists one AllergyIntolerance (dict-02 ELM-0246..0248, #692). */
async function createAllergyIntolerance(db, data) {
  const collection = await getCollection(db, 'allergyIntolerances');
  const allergy = AllergyIntoleranceModel.create(data);
  await collection.insertOne(allergy);
  return allergy;
}

/** One allergy/intolerance record by its own allergyId (not Mongo's _id). */
async function getAllergyIntoleranceById(db, allergyId) {
  if (!allergyId) return null;
  const collection = await getCollection(db, 'allergyIntolerances');
  return collection.findOne({ allergyId: String(allergyId) });
}

module.exports = {
  createAllergyIntolerance,
  getAllergyIntoleranceById,
};
