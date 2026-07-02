// backend/src/services/miabisValidator.service.js
const Sample = require('../models/Sample');
const PatientConsent = require('../models/PatientConsent');

/**
 * MIABIS Compliance Validator
 * @param {string} sampleId
 * @returns {Promise<{isCompliant: boolean, missingFields: string[], consentStatus: string, canBeShared: boolean}>}
 */
async function validateMiabisCompliance(sampleId) {
  // 1. MongoDB: Check required fields
  const sample = await Sample.findById(sampleId).lean();
  const missingFields = [];
  if (!sample) {
    return { isCompliant: false, missingFields: ['sampleNotFound'], consentStatus: 'not_found', canBeShared: false };
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

  let consentStatus = 'not_found';
  let canBeShared = false;
  try {
    const consent = await PatientConsent.findOne({ patientId: sample.patientID }).sort({ signedAt: -1, createdAt: -1 }).lean();
    if (consent) {
      consentStatus = String(consent.status || 'unknown').toLowerCase();
      canBeShared = consentStatus === 'active';
    }
  } catch (err) {
    consentStatus = 'error';
    canBeShared = false;
  }

  const isCompliant = missingFields.length === 0 && consentStatus === 'valid';
  return { isCompliant, missingFields, consentStatus, canBeShared };
}

module.exports = { validateMiabisCompliance };
