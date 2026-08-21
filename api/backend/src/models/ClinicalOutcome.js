const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0252..ELM-0254 (domain "Dados clínicos"),
// #691 -- RF005 clinical-data slice 3/5 (see #677 for the full 5-slice
// breakdown). "Desfecho longitudinal" (progressão/remissão/recidiva/
// resposta/toxicidade/hospitalização/óbito).
//
// dict-02's own row set for this entity genuinely has no participantId
// field (unlike Condition/PhenotypeObservation/ClinicalObservation, which
// each carry an explicit P1X-/ELM- participantId row) -- only outcomeId/
// outcomeType/outcomeDate, matching #691's own issue scope exactly. Not
// invented here; a future slice may need to add subject linkage, but
// that's a design call beyond what the dictionary defines today.
class ClinicalOutcomeModel {
  static fieldsOf(data = {}) {
    return {
      outcomeId: data.outcomeId || crypto.randomUUID(),
      // ELM-0253: CodeableConcept, 1..1 -- stored as given, same "not
      // forced into one shape" precedent as Condition.severity etc.
      outcomeType: data.outcomeType ?? null,
      // ELM-0254: dateTime, 1..1.
      outcomeDate: data.outcomeDate ? new Date(data.outcomeDate) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.outcomeType) {
      errors.push('outcomeType é obrigatório para ClinicalOutcome');
    }
    if (!fields.outcomeDate) {
      errors.push('outcomeDate é obrigatório para ClinicalOutcome');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = ClinicalOutcomeModel;
