const { getCollection } = require('../utils/collectionResolver');
const MedicationExposureModel = require('../models/MedicationExposure');

/** Persists one MedicationExposure (dict-02 ELM-0233..0241, #692). */
async function createMedicationExposure(db, data) {
  const collection = await getCollection(db, 'medicationExposures');
  const exposure = MedicationExposureModel.create(data);
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
