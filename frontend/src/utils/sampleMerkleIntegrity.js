const textEncoder = new TextEncoder();

async function sha256Hex(input) {
  const payload = typeof input === 'string' ? input : String(input ?? '');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(payload));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
  const source = raw && typeof raw === 'object' ? raw : {};
  const atcCode = normalizeString(source.atcCode || source.atc_code || source.medication_code).toUpperCase().replace(/^ATC:/i, '');
  // Mirrors buildPharmacologyData's atcLevel1 fallback (intakeWizard.js#121-131, #521):
  // derive atcClass from the ATC code's first character when no explicit class was given.
  const atcClass = normalizeString(source.atcClass || source.atc_level_1 || source.medication_drug_class).toUpperCase()
    || (atcCode ? atcCode.charAt(0) : '');
  return {
    treatmentStatus: normalizeString(source.treatmentStatus || source.treatment_status).toUpperCase(),
    medicationName: normalizeString(source.medicationName || source.medication_name || source.drug_name),
    atcCode,
    atcClass,
    lastDoseDate: source.lastDoseDate || source.last_dose_date || null,
    washoutStartDate: source.washoutStartDate || source.washout_start_date || null,
    washoutEndDate: source.washoutEndDate || source.washout_end_date || null,
  };
}

/**
 * Mirrors the backend's buildClinicalData (intakeWizard.js#107-119, #521) so the
 * hashed clinicalData carries exactly the same keys, regardless of whether the
 * caller already used the canonical camelCase field names or the wizard's
 * legacy snake_case ones.
 */
function normalizeClinicalData(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    orphaCode: normalizeString(source.orphaCode),
    omimCode: normalizeString(source.omimCode),
    cid: normalizeString(source.cid),
    phenotypes: Array.isArray(source.phenotypes) ? source.phenotypes : [],
    charlsonComorbidities: Array.isArray(source.charlsonComorbidities)
      ? source.charlsonComorbidities
      : (Array.isArray(source.charlson_comorbidities) ? source.charlson_comorbidities : []),
    biomarkerValues: source.biomarkerValues && typeof source.biomarkerValues === 'object'
      ? source.biomarkerValues
      : (source.biomarkers_values && typeof source.biomarkers_values === 'object' ? source.biomarkers_values : {}),
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

/**
 * Mirrors the backend's api/backend/src/services/MerkleService.js#generateSampleHash
 * field-for-field (same key names, same normalization) so a value computed here
 * agrees with the server for the same sample shape (#519).
 */
async function generateSampleHash(sample = {}) {
  const payload = {
    participant_identity: normalizeParticipantIdentity(sample),
    clinicalData: normalizeClinicalData(sample?.clinicalData),
    sprec: sample?.sprec && typeof sample.sprec === 'object' ? sample.sprec : {},
    pharmacologyData: normalizePharmacologyData(sample?.pharmacologyData && typeof sample.pharmacologyData === 'object' ? sample.pharmacologyData : {}),
    rcsScore: sample?.rcsScore ?? null,
    finalGrade: sample?.finalGrade ?? null,
    calculationTrace: sample?.calculationTrace ?? null,
    axisPenalties: sample?.axisPenalties ?? null,
  };

  return sha256Hex(stableSerialize(payload));
}

async function buildSampleMerkleRoot(sample = {}) {
  const rootHash = await generateSampleHash(sample);
  return { rootHash };
}

async function verifySampleIntegrity(sample, rootHash) {
  if (!rootHash) return false;
  const computed = await generateSampleHash(sample);
  return computed === rootHash;
}

export {
  deepSort,
  stableSerialize,
  generateSampleHash,
  buildSampleMerkleRoot,
  verifySampleIntegrity,
};
