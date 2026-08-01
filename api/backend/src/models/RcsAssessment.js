// dict-07/dict-08 (#383): RCS certification results segregated off Sample
// into their own referenced, versioned-snapshot entity — see
// docs/architecture/canonical-data-contract-v1.md's RcsAssessment section
// for the contract this mirrors. Sample keeps its embedded RCS fields for
// backward compatibility during migration (not touched by this entity).
class RcsAssessmentModel {
  static fieldsOf(data = {}) {
    return {
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
      axisPenalties: Array.isArray(data.axisPenalties) ? data.axisPenalties : [],
      calculationTrace: data.calculationTrace ?? null,
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

  /** Maps the raw rcs-certification.service#certify() output onto this entity's fields. */
  static fromCertificationResult(specimenId, result = {}) {
    return this.create({
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
    });
  }
}

module.exports = RcsAssessmentModel;
