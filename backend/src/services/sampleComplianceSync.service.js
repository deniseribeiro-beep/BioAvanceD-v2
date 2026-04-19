const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const SampleGraphValidator = require('./SampleGraphValidator');

async function revalidateSamplesByPatientID(db, patientID) {
  const normalizedPatientID = String(patientID || '').trim();
  if (!normalizedPatientID) {
    return { total: 0, validated: 0, failed: 0 };
  }

  const samplesCollection = await getCollection(db, 'samples');
  const samples = await samplesCollection
    .find({ patientID: normalizedPatientID }, { projection: { _id: 1, sampleID: 1 } })
    .toArray();

  if (!samples.length) {
    return { total: 0, validated: 0, failed: 0 };
  }

  const validator = new SampleGraphValidator(db);
  let validated = 0;
  let failed = 0;

  for (const sample of samples) {
    try {
      await validator.validateSampleCompliance(String(sample._id || sample.sampleID || ''));
      validated += 1;
    } catch (error) {
      failed += 1;
      logger.warn('[SAMPLE_COMPLIANCE_SYNC] Falha ao revalidar amostra vinculada ao paciente', {
        patientID: normalizedPatientID,
        sampleId: String(sample._id || sample.sampleID || ''),
        error: error?.message || String(error),
      });
    }
  }

  logger.info('[SAMPLE_COMPLIANCE_SYNC] Revalidação ética concluída para paciente', {
    patientID: normalizedPatientID,
    total: samples.length,
    validated,
    failed,
  });

  return {
    total: samples.length,
    validated,
    failed,
  };
}

module.exports = {
  revalidateSamplesByPatientID,
};
