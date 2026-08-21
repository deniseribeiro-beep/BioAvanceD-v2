const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0255..ELM-0259 (domain "Dados clínicos"),
// #691 -- RF005 clinical-data slice 3/5 (see #677 for the full 5-slice
// breakdown). Calculated composite score (e.g. Charlson Comorbidity
// Index). Same "dict-02 has no participantId row for this entity" note
// as ClinicalOutcome.js applies here too.
class DerivedScoreModel {
  static fieldsOf(data = {}) {
    const scoreComponents = Array.isArray(data.scoreComponents) ? data.scoreComponents : [];

    return {
      derivedScoreId: data.derivedScoreId || crypto.randomUUID(),
      // ELM-0255: CodeableConcept, 1..1.
      scoreType: data.scoreType ?? null,
      // ELM-0256: decimal, 1..1.
      scoreValue: typeof data.scoreValue === 'number' ? data.scoreValue : null,
      // ELM-0257: string, 1..1.
      algorithmVersion: data.algorithmVersion ? String(data.algorithmVersion).trim() : null,
      // ELM-0258: Duration/Period, 0..1 -- stored as given.
      lookbackPeriod: data.lookbackPeriod ?? null,
      // ELM-0259: BackboneElement[], 1..* -- dict-02's own note: "nunca
      // armazenar somente o escore final." Required non-empty, same
      // enforcement style as Condition.conditionCoding/DerivedScore's own
      // sibling required arrays elsewhere in this domain.
      scoreComponents,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.scoreType) {
      errors.push('scoreType é obrigatório para DerivedScore');
    }
    if (!Number.isFinite(fields.scoreValue)) {
      errors.push('scoreValue é obrigatório para DerivedScore e deve ser numérico');
    }
    if (!fields.algorithmVersion) {
      errors.push('algorithmVersion é obrigatório para DerivedScore');
    }
    if (fields.scoreComponents.length === 0) {
      errors.push('scoreComponents é obrigatório para DerivedScore (1..*, nunca armazenar somente o escore final)');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = DerivedScoreModel;
