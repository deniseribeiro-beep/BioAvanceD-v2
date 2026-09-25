const { getCollection } = require('../utils/collectionResolver');
const AllergyIntoleranceModel = require('../models/AllergyIntolerance');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one AllergyIntolerance (dict-02 ELM-0246..0248, #692). RF005 AC#4
 * ("permitir codificação... somente quando houver ReferenceDatasetRelease
 * ativa e validada") -- reuses activeCodeValidator.validateActiveCodes the
 * same way family-history.service.js's createFamilyHistory does (#714).
 */
async function createAllergyIntolerance(db, data) {
  const allergy = AllergyIntoleranceModel.create(data);

  const codeCheck = await validateActiveCodes(db, [
    {
      systemUri: allergy.allergenCoding?.systemUri,
      code: allergy.allergenCoding?.code,
      version: allergy.allergenCoding?.version || null,
      label: `allergenCoding[${allergy.allergenCoding?.systemUri}|${allergy.allergenCoding?.code}]`,
    },
  ]);
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  // RF005 AC#5 ("preservar código, sistema, versão e descrição da
  // terminologia"): stamp the resolved TerminologyConcept version onto
  // allergenCoding when the caller didn't supply one, same treatment as
  // condition.service.js's createCondition/family-history.service.js's
  // createFamilyHistory.
  if (!allergy.allergenCoding.version) {
    const resolvedVersion = codeCheck.results[0]?.concept?.version;
    if (resolvedVersion) {
      allergy.allergenCoding.version = resolvedVersion;
    }
  }

  const collection = await getCollection(db, 'allergyIntolerances');
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
