const crypto = require('crypto');
const rcsAssessmentService = require('./rcs-assessment.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');

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

/** Maps a persisted RcsAssessment snapshot onto the sample's embedded RCS field shape. */
function rcsFieldsFromAssessment(record) {
  return {
    rcsScore: record.rcsScore ?? null,
    finalGrade: record.finalGrade ?? null,
    calculationTrace: record.calculationTrace ?? null,
    axisPenalties: record.axisPenalties ?? null,
  };
}

/** Maps a persisted SpecimenPreanalytics snapshot onto the sample's embedded `sprec` field shape. */
function sprecFromProfile(record) {
  return {
    matrixType: record.matrixType ?? null,
    sampleType: record.sampleType ?? null,
    primaryContainer: record.primaryContainer ?? null,
    preCentrifugation: record.preCentrifugation ?? null,
    centrifugation: record.centrifugation ?? null,
    secondCentrifugation: record.secondCentrifugation ?? null,
    postCentrifugationDelay: record.postCentrifugationDelay ?? null,
    longTermStorage: record.longTermStorage ?? null,
    sprecCode: record.sprecCode ?? null,
    sprecVersion: record.sprecVersion ?? null,
  };
}

/**
 * Same contract as generateSampleHash, but for an already-persisted sample:
 * resolves the referenced RcsAssessment (#383) and SpecimenPreanalytics
 * (#388) snapshots for the sample's specimenId and hashes those in place of
 * the legacy embedded rcsScore/sprec fields when present. Falls back to the
 * legacy embedded-field read for samples that don't have a recorded snapshot
 * yet, so the hash stays equivalent for already-migrated samples (#497/#493).
 *
 * Snapshot resolution is pinned to whichever RcsAssessment/SpecimenPreanalytics
 * record the sample was *sealed* against (`sealedRcsAssessmentId`/
 * `sealedSpecimenPreanalyticsId`, set at write time — see
 * import.service.js/import-lgpd.service.js), not "whatever is newest right
 * now" (#502): resolving the newest snapshot false-positives a tamper report
 * if a later re-assessment/re-import records a new snapshot for the same
 * specimenId after the merkleRoot was already sealed. Samples written before
 * this pin existed (no `sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId`
 * own-property on the document at all) keep the pre-#502 "resolve newest"
 * behavior for backward compatibility.
 */
async function generateSampleHashFromSample(db, sample = {}) {
  const specimenId = String(sample?.specimenId || '').trim();
  let effectiveSample = sample;

  if (db && specimenId) {
    const hasPinnedRcs = Object.prototype.hasOwnProperty.call(sample, 'sealedRcsAssessmentId');
    const hasPinnedSprec = Object.prototype.hasOwnProperty.call(sample, 'sealedSpecimenPreanalyticsId');

    const latestRcs = hasPinnedRcs
      ? await rcsAssessmentService.getAssessmentById(db, sample.sealedRcsAssessmentId)
      : (await rcsAssessmentService.getAssessmentsForSpecimen(db, specimenId))[0];
    const latestSprec = hasPinnedSprec
      ? await specimenPreanalyticsService.getProfileById(db, sample.sealedSpecimenPreanalyticsId)
      : (await specimenPreanalyticsService.getProfilesForSpecimen(db, specimenId))[0];

    if (latestRcs || latestSprec) {
      effectiveSample = {
        ...sample,
        ...(latestRcs ? rcsFieldsFromAssessment(latestRcs) : {}),
        ...(latestSprec ? { sprec: sprecFromProfile(latestSprec) } : {}),
      };
    }
  }

  return generateSampleHash(effectiveSample);
}

module.exports = {
  deepSort,
  stableSerialize,
  generateSampleHash,
  generateSampleHashFromSample,
  buildClinicalPharmacologyHash,
};
