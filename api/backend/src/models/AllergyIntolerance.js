const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0246..ELM-0248 (domain "Dados clínicos"),
// #692 -- RF005 clinical-data slice 4/5 (see #677 for the full 5-slice
// breakdown). dict-02's own row set for this entity has no participantId
// field -- same documented omission as ClinicalOutcome/DerivedScore
// (#691), not invented here.
class AllergyIntoleranceModel {
  static fieldsOf(data = {}) {
    const reaction = Array.isArray(data.reaction) ? data.reaction : [];

    return {
      allergyId: data.allergyId || crypto.randomUUID(),
      // ELM-0247: Coding, 1..1 -- DCB/SNOMED subset, same
      // {systemUri, code, version, display} shape as elsewhere in this
      // domain.
      allergenCoding: data.allergenCoding && data.allergenCoding.systemUri && data.allergenCoding.code
        ? data.allergenCoding
        : null,
      // ELM-0248: BackboneElement[], 0..* -- "manifestação, severidade e
      // período," stored as given.
      reaction,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.allergenCoding) {
      throw new Error('allergenCoding é obrigatório para AllergyIntolerance (systemUri e code)');
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = AllergyIntoleranceModel;
