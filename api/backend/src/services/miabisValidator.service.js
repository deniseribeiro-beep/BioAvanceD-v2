// backend/src/services/miabisValidator.service.js
const logger = require('../utils/logger');
const collectionResolver = require('../utils/collectionResolver');

/**
 * MIABIS Compliance Validator
 * @param {string} specimenId
 * @param {import('mongodb').Db} db
 * @returns {Promise<{isCompliant: boolean, missingFields: string[], consentStatus: string, canBeShared: boolean}>}
 */
async function validateMiabisCompliance(specimenId, db) {
  // #830 follow-up: native driver (same connection as the rest of specimen I/O).
  const specimens = collectionResolver.getCollection(db, 'Specimen');
  const sample = await specimens.findOne({ specimenId: String(specimenId) });
  const missingFields = [];
  if (!sample) {
    return { isCompliant: false, missingFields: ['sampleNotFound'], consentStatus: 'sample_not_found', canBeShared: false };
  }
  if (!sample.sampleType) missingFields.push('sampleType');
  if (!sample.anatomicalSite) missingFields.push('anatomicalSite');
  if (!sample.storageTemperature) missingFields.push('storageTemperature');
  if (!sample.diagnosisCode) missingFields.push('diagnosisCode');

  // Fast fail: if required MIABIS fields are already missing,
  // there is no need to query Neo4j consent graph.
  if (missingFields.length > 0) {
    return { isCompliant: false, missingFields, consentStatus: 'not_evaluated', canBeShared: false };
  }

  let consentStatus = 'no_consent';
  let canBeShared = false;
  try {
    if (sample.participantId) {
      const consentsCollection = collectionResolver.getCollection(db, 'consents');
      const consent = await consentsCollection.findOne(
        { participantId: sample.participantId },
        { sort: { signedAt: -1, createdAt: -1 } }
      );
      if (consent) {
        consentStatus = String(consent.status || 'unknown').toLowerCase();
        canBeShared = consentStatus === 'active';
      }
    }
  } catch (err) {
    logger.error(`[MIABIS] Falha ao consultar consentimento para amostra ${specimenId}: ${err.message}`);
    consentStatus = 'error';
    canBeShared = false;
  }

  const isCompliant = missingFields.length === 0 && consentStatus === 'active';
  return { isCompliant, missingFields, consentStatus, canBeShared };
}

module.exports = { validateMiabisCompliance };
