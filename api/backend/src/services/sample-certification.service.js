'use strict';

const qualityDomain = require('./quality-domain.service');
const governanceEvidenceResolver = require('./governance-evidence-resolver.service');

// RNF018 AC4 (#1537): the one certification of a sample's SPREC, shared by
// the live registration and the JSON import. It sets every RCS result field
// on sampleData and returns the assessment, or null when there is no SPREC.
async function certifySampleSprec(db, sampleData) {
  if (sampleData.sprec && typeof sampleData.sprec === 'object' && Object.keys(sampleData.sprec).length > 0) {
    // RNF018 AC5 (#1524): the body's governanceEvidence references are
    // resolved against the stored records before certification, as the
    // preview resolves them; only the resolution reaches the assessment.
    const governanceEvidenceResolution = await governanceEvidenceResolver.resolveGovernanceEvidence(db, {
      governanceEvidence: sampleData.governanceEvidence,
      specimenId: sampleData.specimenId,
    });
    const canonicalQualityAssessment = qualityDomain.resolveMethodologicalQuality({
      sprec: sampleData.sprec,
      // RF018 AC2 (#1320): the use context reaches the assessment only when sent.
      ...(sampleData.qualificationContext !== undefined ? { qualificationContext: sampleData.qualificationContext } : {}),
    }, ...(governanceEvidenceResolution ? [{ governanceEvidenceResolution }] : []));
    sampleData.modelVersion = canonicalQualityAssessment.model_version;
    sampleData.matrixType = canonicalQualityAssessment.matrix_type;
    sampleData.governanceStatus = canonicalQualityAssessment.governance_status;
    sampleData.governanceFailureReasons = canonicalQualityAssessment.governance_failure_reasons || [];
    sampleData.governanceRuleCodes = canonicalQualityAssessment.governance_rule_codes || [];
    sampleData.rcsScore = canonicalQualityAssessment.rcs_score;
    sampleData.scoreBasedGrade = canonicalQualityAssessment.score_based_grade;
    sampleData.finalGrade = canonicalQualityAssessment.final_grade || '';
    sampleData.gradeRoute = canonicalQualityAssessment.grade_route;
    sampleData.axisPenalties = canonicalQualityAssessment.axis_penalties || [];
    sampleData.calculationTrace = canonicalQualityAssessment.calculation_trace || {};
    sampleData.rcsEvaluation = canonicalQualityAssessment;
    return canonicalQualityAssessment;
  }
  return null;
}

module.exports = { certifySampleSprec };
