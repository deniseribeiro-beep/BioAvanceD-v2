const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const SampleGraphValidator = require('./SampleGraphValidator');

async function revalidateSamplesByParticipantId(db, participantId) {
  const normalizedParticipantId = String(participantId || '').trim();
  if (!normalizedParticipantId) {
    return { total: 0, validated: 0, failed: 0 };
  }

  const samplesCollection = await getCollection(db, 'samples');
  const samples = await samplesCollection
    .find({ participantId: normalizedParticipantId }, { projection: { specimenId: 1 } })
    .toArray();

  if (!samples.length) {
    return { total: 0, validated: 0, failed: 0 };
  }

  const validator = new SampleGraphValidator(db);
  let validated = 0;
  let failed = 0;

  for (const sample of samples) {
    try {
      await validator.validateSampleCompliance(String(sample.specimenId || ''));
      validated += 1;
    } catch (error) {
      failed += 1;
      logger.warn('[SAMPLE_COMPLIANCE_SYNC] Falha ao revalidar amostra vinculada ao paciente', {
        participantId: normalizedParticipantId,
        specimenId: String(sample.specimenId || ''),
        error: error?.message || String(error),
      });
    }
  }

  logger.info('[SAMPLE_COMPLIANCE_SYNC] Revalidação ética concluída para paciente', {
    participantId: normalizedParticipantId,
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
  revalidateSamplesByParticipantId,
};
