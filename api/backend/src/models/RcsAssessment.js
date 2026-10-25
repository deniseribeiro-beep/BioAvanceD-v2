// dict-07/dict-08 (#383): RCS certification results segregated off Sample
// into their own referenced, versioned-snapshot entity — see
// docs/architecture/canonical-data-contract-v1.md's RcsAssessment section
// for the contract this mirrors. Sample keeps its embedded RCS fields for
// backward compatibility during migration (not touched by this entity).
const crypto = require('crypto');

class RcsAssessmentModel {
  static fieldsOf(data = {}) {
    return {
      rcsAssessmentId: data.rcsAssessmentId || crypto.randomUUID(),
      specimenId: String(data.specimenId || '').trim(),
      modelVersion: data.modelVersion ?? null,
      matrixType: data.matrixType ?? null,
      governanceStatus: data.governanceStatus ?? null,
      governanceFailureReasons: Array.isArray(data.governanceFailureReasons) ? data.governanceFailureReasons : [],
      governanceRuleCodes: Array.isArray(data.governanceRuleCodes) ? data.governanceRuleCodes : [],
      rcsScore: data.rcsScore ?? null,
      scoreBasedGrade: data.scoreBasedGrade ?? null,
      finalGrade: data.finalGrade ?? null,
      gradeRoute: data.gradeRoute ?? null,
      // RF018 AC6 and AC8 (#1320): the reasons for the route and each axis's resolution.
      routeReasons: Array.isArray(data.routeReasons) ? data.routeReasons : [],
      axisPenalties: Array.isArray(data.axisPenalties) ? data.axisPenalties : [],
      rcsAxisResults: Array.isArray(data.rcsAxisResults) ? data.rcsAxisResults : [],
      calculationTrace: data.calculationTrace ?? null,
      // RF018 AC2 and AC3 (#1320): the use context the request carried, and
      // the RCSInputSnapshot this assessment was computed from.
      qualificationContext: data.qualificationContext ?? null,
      // RF018 AC2 (#1320): the context's intended use, target analyte, assay family and workflow protocol, top-level as V2E-0440..0444 name them.
      intendedUseCode: data.intendedUseCode ?? null,
      targetAnalyte: data.targetAnalyte ?? null,
      assayFamily: data.assayFamily ?? null,
      workflowProtocolId: data.workflowProtocolId ?? null,
      workflowProtocolVersion: data.workflowProtocolVersion ?? null,
      inputSnapshotId: data.inputSnapshotId ?? null,
      inputSnapshotUri: data.inputSnapshotUri ?? null,
      inputSnapshotHash: data.inputSnapshotHash ?? null,
      // RF018 AC1 (#1320): the SPREC version the result was computed with (V2E-0448).
      sprecVersion: data.sprecVersion ?? null,
      // RF018 (#1320): the result's P_bio and its 100 - P_bio score (V2E-0539, V2E-0540).
      preanalyticalPenalty: data.preanalyticalPenalty ?? null,
      score: data.score ?? null,
      // RF018 AC10 and AC11 (#1320): the rule package and environment the
      // result was computed with, and its justifications.
      rulePackageVersion: data.rulePackageVersion ?? null,
      rulePackageChecksum: data.rulePackageChecksum ?? null,
      executionEnvironment: data.executionEnvironment ?? null,
      justifications: Array.isArray(data.justifications) ? data.justifications : [],
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.specimenId) {
      throw new Error('specimenId é obrigatório para RcsAssessment');
    }
    const now = new Date();
    return { ...fields, assessedAt: data.assessedAt ? new Date(data.assessedAt) : now, createdAt: now };
  }

  /**
   * Maps the raw rcs-certification.service#certify() output onto this entity's
   * fields. `refs` carries the rcsAssessmentId and the input snapshot's id,
   * URI and hash.
   */
  static fromCertificationResult(specimenId, result = {}, refs = {}) {
    return this.create({
      ...refs,
      specimenId,
      modelVersion: result.model_version,
      matrixType: result.matrix_type,
      governanceStatus: result.governance_status,
      governanceFailureReasons: result.governance_failure_reasons,
      governanceRuleCodes: result.governance_rule_codes,
      rcsScore: result.rcs_score,
      scoreBasedGrade: result.score_based_grade,
      finalGrade: result.final_grade,
      gradeRoute: result.grade_route,
      axisPenalties: result.axis_penalties,
      calculationTrace: result.calculation_trace,
      qualificationContext: result.qualification_context,
      intendedUseCode: result.qualification_context?.intendedUseCode,
      targetAnalyte: result.qualification_context?.targetAnalyte,
      assayFamily: result.qualification_context?.assayFamily,
      workflowProtocolId: result.qualification_context?.workflowProtocolId,
      workflowProtocolVersion: result.qualification_context?.workflowProtocolVersion,
      sprecVersion: result.calculation_trace?.sprec_version,
      preanalyticalPenalty: result.p_bio,
      score: result.rcs_score,
    });
  }
}

module.exports = RcsAssessmentModel;
