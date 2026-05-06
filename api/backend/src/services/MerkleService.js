const crypto = require('crypto');

function deepSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepSort(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = deepSort(value[key]);
        return acc;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function stableSerialize(value) {
  return JSON.stringify(deepSort(value));
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePharmacologyData(raw = {}) {
  const source = raw && typeof raw === 'object' ? { ...raw } : {};
  const treatmentStatus = normalizeString(raw.treatment_status || raw.treatmentStatus).toUpperCase();
  const drugName = normalizeString(raw.drug_name || raw.medication_name || raw.medicationName);
  const atcCode = normalizeString(raw.atc_code || raw.medication_code || raw.medicationCode).toUpperCase().replace(/^ATC:/i, '');
  const atcLevel1 = normalizeString(raw.atc_level_1 || raw.medication_drug_class || raw.medicationDrugClass).toUpperCase() || (atcCode ? atcCode.charAt(0) : '');

  source.treatment_status = treatmentStatus;
  source.drug_name = drugName;
  source.atc_code = atcCode;
  source.atc_level_1 = atcLevel1;
  source.last_dose_date = raw.last_dose_date || raw.lastDoseDate || null;
  source.washout_start_date = raw.washout_start_date || raw.washoutStartDate || null;
  source.washout_end_date = raw.washout_end_date || raw.washoutEndDate || null;

  return source;
}

function normalizePatientIdentity(sample = {}) {
  const source = sample?.patient_identity && typeof sample.patient_identity === 'object'
    ? sample.patient_identity
    : sample;

  return {
    patient_id: normalizeString(source?.patient_id || source?.patientID || source?.patientId),
    patient_name: normalizeString(source?.patient_name || source?.patientName || source?.patient_name_confirmed),
  };
}

function generateSampleHash(sample = {}) {
  const payload = {
    patient_identity: normalizePatientIdentity(sample),
    clinical_data: sample?.clinical_data && typeof sample.clinical_data === 'object' ? sample.clinical_data : {},
    sprec: sample?.sprec && typeof sample.sprec === 'object' ? sample.sprec : {},
    // Keep insertion order explicit for drug_name and atc_code before stable sorting.
    pharmacology_data: normalizePharmacologyData(sample?.pharmacology_data && typeof sample.pharmacology_data === 'object' ? sample.pharmacology_data : {}),
  };

  return crypto
    .createHash('sha256')
    .update(stableSerialize(payload))
    .digest('hex');
}

function buildClinicalPharmacologyHash(sample = {}) {
  return generateSampleHash(sample);
}

module.exports = {
  deepSort,
  stableSerialize,
  generateSampleHash,
  buildClinicalPharmacologyHash,
};
