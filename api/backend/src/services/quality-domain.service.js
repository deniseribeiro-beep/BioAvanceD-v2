const rcsCertificationService = require('./rcs-certification.service');
const qualityCompatibility = require('./quality-compatibility.service');
const rcsAssessmentService = require('./rcs-assessment.service');

const QUALITY_RULE_VERSION = 'RCS-GOV-1.0';

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function evaluateQuality(payload = {}) {
  // Normalize legacy input to canonical fields without destroying legacy values
  const normalized = qualityCompatibility.normalizeSample(payload || {});
  const result = rcsCertificationService.certify(normalized);
  return {
    ...result,
    deprecated_legacy_fields: ['quality_score', 'quality_category', 'penalty_log', 'forcedQuarantine', 'category'],
  };
}

function resolveMethodologicalQuality(samplePayload = {}) {
  return evaluateQuality(samplePayload);
}

function calculateMethodologyQualityFromSprec(sprec = {}, context = {}) {
  return evaluateQuality({ ...normalizeObject(context), sprec });
}

function buildPenaltyLog(qualityAssessment = {}) {
  if (Array.isArray(qualityAssessment.axis_penalties)) {
    return qualityAssessment.axis_penalties.map((item) => `${item.axis_code}:${item.sprec_code}:+${item.penalty}`);
  }
  if (Array.isArray(qualityAssessment.rcsCertification?.axis_penalties)) {
    return qualityAssessment.rcsCertification.axis_penalties.map((item) => `${item.axis_code}:${item.sprec_code}:+${item.penalty}`);
  }
  return [];
}

function buildSprecCode(sprec = {}) {
  const parts = [
    sprec.sampleType,
    sprec.primaryContainer || sprec.collectionType,
    sprec.preCentrifugation || sprec.warmIschemia,
    sprec.centrifugation || sprec.coldIschemia,
    sprec.secondCentrifugation || sprec.fixationType,
    sprec.postCentrifugationDelay || sprec.fixationTime,
    sprec.longTermStorage,
  ];
  return parts.map((part) => String(part?.code ?? part?.value ?? part ?? 'X').trim().toUpperCase() || 'X').join('-');
}

function validateQualityForRelease(sample = {}) {
  const assessment = resolveMethodologicalQuality(sample);
  // final_grade must be A..E and governance_status must be approved (1)
  const valid = assessment.governance_status === 1 && ['A', 'B', 'C', 'D'].includes(String(assessment.final_grade));
  const invalidInput = assessment.input_status === 'invalid';
  return {
    valid,
    reason: valid
      ? `RCS-GOV ${assessment.final_grade} aprovado (rcs_score ${assessment.rcs_score})`
      : invalidInput
        ? `RCS-GOV entrada inválida: ${(assessment.input_errors || []).join('; ')}`
        : `RCS-GOV ${assessment.final_grade} bloqueado: ${assessment.grade_route}`,
    assessment,
  };
}

/** Maps a persisted RcsAssessment snapshot onto the same shape validateQualityForRelease's assessment returns. */
function assessmentFromRcsAssessment(record) {
  return {
    governance_status: record.governanceStatus,
    final_grade: record.finalGrade,
    rcs_score: record.rcsScore,
    grade_route: record.gradeRoute,
    axis_penalties: record.axisPenalties,
    calculation_trace: record.calculationTrace,
  };
}

/**
 * Same contract as validateQualityForRelease, but for an already-persisted sample:
 * resolves the newest referenced RcsAssessment snapshot for the sample's specimenId (#383)
 * instead of recomputing from the sample's legacy embedded fields. Falls back to the legacy
 * path for samples that don't have a recorded snapshot yet.
 */
async function validateQualityForReleaseFromSample(db, sample = {}) {
  const specimenId = String(sample?.specimenId || '').trim();
  if (db && specimenId) {
    const [latest] = await rcsAssessmentService.getAssessmentsForSpecimen(db, specimenId);
    if (latest) {
      const assessment = assessmentFromRcsAssessment(latest);
      const valid = assessment.governance_status === 1 && ['A', 'B', 'C', 'D'].includes(String(assessment.final_grade));
      return {
        valid,
        reason: valid
          ? `RCS-GOV ${assessment.final_grade} aprovado (rcs_score ${assessment.rcs_score})`
          : `RCS-GOV ${assessment.final_grade} bloqueado: ${assessment.grade_route}`,
        assessment,
      };
    }
  }

  return validateQualityForRelease(sample);
}

module.exports = {
  QUALITY_RULE_VERSION,
  resolveMethodologicalQuality,
  evaluateQuality,
  calculateMethodologyQualityFromSprec,
  buildPenaltyLog,
  buildSprecCode,
  validateQualityForRelease,
  validateQualityForReleaseFromSample,
};
