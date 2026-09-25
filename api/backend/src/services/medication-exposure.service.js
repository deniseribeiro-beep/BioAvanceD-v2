const { getCollection } = require('../utils/collectionResolver');
const MedicationExposureModel = require('../models/MedicationExposure');
const { validateActiveCodes } = require('../ingestion/activeCodeValidator');

/**
 * Persists one MedicationExposure (dict-02 ELM-0233..0241, #692).
 * #714: medicationCoding must pass the same RF005 AC#4 active-release gate
 * (ATC/DCB are on the expanded system allow-list).
 */
async function createMedicationExposure(db, data) {
  const exposure = MedicationExposureModel.create(data);

  const codeCheck = await validateActiveCodes(
    db,
    exposure.medicationCoding.map((coding) => ({
      systemUri: coding.systemUri,
      code: coding.code,
      version: coding.version || null,
      label: `medicationCoding[${coding.systemUri}|${coding.code}]`,
    }))
  );
  if (!codeCheck.valid) {
    throw new Error(codeCheck.violations.map((v) => v.message).join(', '));
  }

  exposure.medicationCoding.forEach((coding, index) => {
    if (!coding.version) {
      const resolvedVersion = codeCheck.results[index]?.concept?.version;
      if (resolvedVersion) {
        coding.version = resolvedVersion;
      }
    }
  });

  const collection = await getCollection(db, 'medicationExposures');
  await collection.insertOne(exposure);
  return exposure;
}

/** One medication exposure record by its own medicationRecordId (not Mongo's _id). */
async function getMedicationExposureById(db, medicationRecordId) {
  if (!medicationRecordId) return null;
  const collection = await getCollection(db, 'medicationExposures');
  return collection.findOne({ medicationRecordId: String(medicationRecordId) });
}

module.exports = {
  createMedicationExposure,
  getMedicationExposureById,
};
