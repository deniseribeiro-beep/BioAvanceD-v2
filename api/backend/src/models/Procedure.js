const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0242..ELM-0245 (domain "Dados clínicos"),
// #692 -- RF005 clinical-data slice 4/5 (see #677 for the full 5-slice
// breakdown). dict-02's own row set for this entity has no participantId
// field, same documented omission as its domain siblings above.
class ProcedureModel {
  static fieldsOf(data = {}) {
    const procedureCoding = Array.isArray(data.procedureCoding)
      ? data.procedureCoding.filter((coding) => coding && coding.systemUri && coding.code)
      : [];
    // ELM-0245: CodeableConcept[], 0..* -- Uberon/SNOMED subset. This repo
    // already imports Uberon as a reference dataset (RF028), but bodySite
    // resolution/validation against it is a distinct ingestion-pipeline
    // concern this slice doesn't take on (same "stored as given, not
    // hard-checked" call as Condition.severity/other CodeableConcept
    // fields elsewhere in this domain) -- #692's own issue text notes to
    // reuse the existing Uberon import, not that this slice must validate
    // against it.
    const bodySite = Array.isArray(data.bodySite) ? data.bodySite : [];

    return {
      procedureId: data.procedureId || crypto.randomUUID(),
      procedureCoding,
      // ELM-0244: choice, 1..1 -- date or Period, stored as given.
      performed: data.performed ?? null,
      bodySite,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (fields.procedureCoding.length === 0) {
      errors.push('procedureCoding é obrigatório para Procedure (1..*, cada item precisa de systemUri e code)');
    }
    if (!fields.performed) {
      errors.push('performed é obrigatório para Procedure');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = ProcedureModel;
