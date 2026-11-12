const rcsCertificationService = require('./rcs-certification.service');
const qualityCompatibility = require('./quality-compatibility.service');
const rcsAssessmentService = require('./rcs-assessment.service');

const QUALITY_RULE_VERSION = 'RCS-GOV-1.0';

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// RF018 AC2 (#1320): the assessment's use context, kept only when the request
// carries one. Each field is a non-empty string or a plain object, else null.
const QUALIFICATION_CONTEXT_KEYS = Object.freeze([
  'intendedUseCode', 'targetAnalyte', 'assayFamily', 'workflowProtocolId', 'workflowProtocolVersion',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function isKeptContextValue(value) {
  return (typeof value === 'string' && value.trim() !== '') || isPlainObject(value);
}

// RF018 AC2 (#1320): the fields a sent context lacks, in key order. Reads
// with the same rule readQualificationContext keeps a value by.
function missingQualificationContextFields(context) {
  if (!isPlainObject(context)) return [...QUALIFICATION_CONTEXT_KEYS];
  return QUALIFICATION_CONTEXT_KEYS.filter((key) => !isKeptContextValue(context[key]));
}

// RF018 AC2 (#1320): the 422 messages for a request body's use context, one
// rule for every route that creates a sample. An absent or null one is none.
function qualificationContextErrors(context) {
  if (context === undefined || context === null) return [];
  if (!isPlainObject(context)) return ['qualificationContext deve ser um objeto (RF018 AC2)'];
  return missingQualificationContextFields(context).map(
    (field) => `qualificationContext.${field} é obrigatório quando o contexto de uso é informado (RF018 AC2)`
  );
}

function readQualificationContext(payload = {}) {
  const source = normalizeObject(payload);
  const context = isPlainObject(source.qualificationContext)
    ? source.qualificationContext
    : normalizeObject(source.sample).qualificationContext;
  if (!isPlainObject(context)) return null;
  return Object.fromEntries(QUALIFICATION_CONTEXT_KEYS.map((key) => {
    const value = context[key];
    return [key, isKeptContextValue(value) ? value : null];
  }));
}

// RNF018 AC5 (#1524): governanceEvidenceResolution is set only by the
// server's evidence resolver, through the option; a copy the client sent,
// at the top level or inside `sample`, is dropped, so it can never pass a
// governance criterion.
function evaluateQuality(payload = {}, { governanceEvidenceResolution } = {}) {
  // Normalize legacy input to canonical fields without destroying legacy values
  const normalized = qualityCompatibility.normalizeSample(payload || {});
  delete normalized.governanceEvidenceResolution;
  if (isPlainObject(normalized.sample)) {
    const { governanceEvidenceResolution: _clientSent, ...sample } = normalized.sample;
    normalized.sample = sample;
  }
  if (isPlainObject(governanceEvidenceResolution)) {
    rcsCertificationService.samplePayloadOf(normalized).governanceEvidenceResolution = governanceEvidenceResolution;
  }
  const result = rcsCertificationService.certify(normalized);
  const qualificationContext = readQualificationContext(payload);
  return {
    ...result,
    deprecated_legacy_fields: ['quality_score', 'quality_category', 'penalty_log', 'forcedQuarantine', 'category'],
    // RF018 AC3: the input this result was computed from, for its snapshot.
    rcs_input: rcsCertificationService.readInput(normalized),
    ...(qualificationContext ? { qualification_context: qualificationContext } : {}),
  };
}

// RNF018 AC5 (#1524): options carries only the server-resolved
// governanceEvidenceResolution, as evaluateQuality takes it.
function resolveMethodologicalQuality(samplePayload = {}, options = {}) {
  return evaluateQuality(samplePayload, options);
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
  return {
    valid,
    reason: valid
      ? `RCS-GOV ${assessment.final_grade} aprovado (rcs_score ${assessment.rcs_score})`
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
  missingQualificationContextFields,
  qualificationContextErrors,
  calculateMethodologyQualityFromSprec,
  buildPenaltyLog,
  buildSprecCode,
  validateQualityForRelease,
  validateQualityForReleaseFromSample,
};
