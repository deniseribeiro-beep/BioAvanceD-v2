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
  const source = raw && typeof raw === 'object' ? { ...raw } : {};
  return {
    ...source,
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

/**
 * Mirrors the backend's api/backend/src/services/MerkleService.js#generateSampleHash
 * field-for-field (same key names, same normalization) so a value computed here
 * agrees with the server for the same sample shape (#519).
 */
async function generateSampleHash(sample = {}) {
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
