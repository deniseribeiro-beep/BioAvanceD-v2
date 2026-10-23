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
      inputSnapshotId: data.inputSnapshotId ?? null,
      inputSnapshotUri: data.inputSnapshotUri ?? null,
      inputSnapshotHash: data.inputSnapshotHash ?? null,
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
    });
  }
}

module.exports = RcsAssessmentModel;
