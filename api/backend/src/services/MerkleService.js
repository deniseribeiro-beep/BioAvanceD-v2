const crypto = require('crypto');

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = deepSort(value[key]);
      return acc;
    }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableSerialize(value) {
  return JSON.stringify(deepSort(value));
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePharmacologyData(raw = {}) {
  return {
    treatmentStatus: normalizeString(raw.treatmentStatus || raw.treatment_status).toUpperCase(),
    medicationName: normalizeString(raw.medicationName || raw.medication_name || raw.drug_name),
    atcCode: normalizeString(raw.atcCode || raw.atc_code || raw.medication_code).toUpperCase().replace(/^ATC:/i, ''),
    atcClass: normalizeString(raw.atcClass || raw.atc_level_1 || raw.medication_drug_class).toUpperCase(),
    lastDoseDate: raw.lastDoseDate || raw.last_dose_date || null,
    washoutStartDate: raw.washoutStartDate || raw.washout_start_date || null,
    washoutEndDate: raw.washoutEndDate || raw.washout_end_date || null,
  };
}

function normalizeParticipantIdentity(sample = {}) {
  const source = sample?.participant_identity && typeof sample.participant_identity === 'object'
    ? sample.participant_identity
    : sample;
  return {
    participantId: normalizeString(source?.participantId || source?.participant_id),
    participantName: normalizeString(source?.participantName || source?.participant_name || source?.patientName),
  };
}

function generateSampleHash(sample = {}) {
  const payload = {
    participant_identity: normalizeParticipantIdentity(sample),
    clinicalData: sample?.clinicalData && typeof sample.clinicalData === 'object' ? sample.clinicalData : {},
    sprec: sample?.sprec && typeof sample.sprec === 'object' ? sample.sprec : {},
    pharmacologyData: normalizePharmacologyData(sample?.pharmacologyData && typeof sample.pharmacologyData === 'object' ? sample.pharmacologyData : {}),
    rcsScore: sample?.rcsScore ?? null,
    finalGrade: sample?.finalGrade ?? null,
    calculationTrace: sample?.calculationTrace ?? null,
    axisPenalties: sample?.axisPenalties ?? null,
  };

  return crypto.createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

function buildClinicalPharmacologyHash(sample = {}) {
  return generateSampleHash(sample);
}

module.exports = { deepSort, stableSerialize, generateSampleHash, buildClinicalPharmacologyHash };
