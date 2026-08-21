const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0249..ELM-0251 (domain "Dados clínicos"),
// #692 -- RF005 clinical-data slice 4/5 (see #677 for the full 5-slice
// breakdown). dict-02's own field description for familyHistoryId calls
// it a "registro familiar pseudonimizado" -- same civil-identity
// discipline as ParticipantIdentity, though (per the dictionary's own
// row set) this entity carries no participantId field of its own, same
// documented omission as ClinicalOutcome/DerivedScore/AllergyIntolerance.
class FamilyHistoryModel {
  static fieldsOf(data = {}) {
    const familyCondition = Array.isArray(data.familyCondition) ? data.familyCondition : [];

    return {
      familyHistoryId: data.familyHistoryId || crypto.randomUUID(),
      // ELM-0250: CodeableConcept, 1..1 -- degree of kinship, stored as
      // given.
      relationship: data.relationship ?? null,
      // ELM-0251: BackboneElement[], 0..* -- ORPHA|ICD-11|MONDO coded
      // disease + age/period of onset in the family member, stored as
      // given.
      familyCondition,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.relationship) {
      throw new Error('relationship é obrigatório para FamilyHistory');
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = FamilyHistoryModel;
