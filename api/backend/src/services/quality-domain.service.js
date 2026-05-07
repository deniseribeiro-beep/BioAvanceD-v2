const rcsCertificationService = require('./rcs-certification.service');
const qualityCompatibility = require('./quality-compatibility.service');

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
    ...rcsCertificationService.buildDeprecatedCompatibility ? rcsCertificationService.buildDeprecatedCompatibility(result) : {},
    // Keep legacy fields for backwards compatibility, but mark them as deprecated.
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
  const valid = assessment.governance_status === 1 && ['A', 'B', 'C', 'D', 'E'].includes(String(assessment.final_grade));
  return {
    valid,
    reason: valid
      ? `RCS-GOV ${assessment.final_grade} aprovado (rcs_score ${assessment.rcs_score})`
      : `RCS-GOV ${assessment.final_grade} bloqueado: ${assessment.grade_route}`,
    assessment,
  };
}

module.exports = {
  QUALITY_RULE_VERSION,
  resolveMethodologicalQuality,
  evaluateQuality,
  calculateMethodologyQualityFromSprec,
  buildPenaltyLog,
  buildSprecCode,
  validateQualityForRelease,
};
