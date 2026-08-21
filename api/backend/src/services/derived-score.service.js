const { getCollection } = require('../utils/collectionResolver');
const DerivedScoreModel = require('../models/DerivedScore');

/** Persists one DerivedScore (dict-02 ELM-0255..0259, #691). */
async function createDerivedScore(db, data) {
  const collection = await getCollection(db, 'derivedScores');
  const score = DerivedScoreModel.create(data);
  await collection.insertOne(score);
  return score;
}

/** One derived score by its own derivedScoreId (not Mongo's _id). */
async function getDerivedScoreById(db, derivedScoreId) {
  if (!derivedScoreId) return null;
  const collection = await getCollection(db, 'derivedScores');
  return collection.findOne({ derivedScoreId: String(derivedScoreId) });
}

module.exports = {
  createDerivedScore,
  getDerivedScoreById,
};
