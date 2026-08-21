const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0233..ELM-0241 (domain "Dados clínicos"),
// #692 -- RF005 clinical-data slice 4/5 (see #677 for the full 5-slice
// breakdown). dict-02's own row set for this entity has no participantId
// field, same documented omission as its domain siblings above.
class MedicationExposureModel {
  static fieldsOf(data = {}) {
    const medicationCoding = Array.isArray(data.medicationCoding)
      ? data.medicationCoding.filter((coding) => coding && coding.systemUri && coding.code)
      : [];
    // ELM-0241: Reference[], 0..* -> Condition (#690) -- stays
    // joinable-but-unenforced, same pattern as diagnosisEvidence/
    // phenotypeEvidence elsewhere in this domain (#692's own issue text
    // doesn't call for a hard reference-check here, unlike #691's
    // specimenId/deviceId).
    const indication = Array.isArray(data.indication) ? data.indication.map((ref) => String(ref)).filter(Boolean) : [];

    return {
      medicationRecordId: data.medicationRecordId || crypto.randomUUID(),
      // ELM-0234: Coding[], 1..* -- DCB|ATC|SNOMED subset.
      medicationCoding,
      // ELM-0235: code, 1..1 -- prescribed/dispensed/administered/
      // reported, stored as given (not enumerated here, same reasoning
      // as Condition.clinicalStatus elsewhere in this domain).
      recordType: data.recordType ? String(data.recordType).trim() : null,
      // ELM-0236: code, 1..1 -- FHIR status vocab.
      medicationStatus: data.medicationStatus ? String(data.medicationStatus).trim() : null,
      // ELM-0237: Quantity, 0..1.
      dose: data.dose ?? null,
      // ELM-0238: CodeableConcept, 0..1.
      route: data.route ?? null,
      // ELM-0239: Timing, 0..1 -- stored as given.
      frequency: data.frequency ?? null,
      // ELM-0240: Period, 0..1 -- same {start, end} shape as
      // Encounter.encounterPeriod.
      medicationPeriod: data.medicationPeriod
        ? {
            start: data.medicationPeriod.start ? new Date(data.medicationPeriod.start) : null,
            end: data.medicationPeriod.end ? new Date(data.medicationPeriod.end) : null,
          }
        : null,
      indication,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (fields.medicationCoding.length === 0) {
      errors.push('medicationCoding é obrigatório para MedicationExposure (1..*, cada item precisa de systemUri e code)');
    }
    if (!fields.recordType) {
      errors.push('recordType é obrigatório para MedicationExposure');
    }
    if (!fields.medicationStatus) {
      errors.push('medicationStatus é obrigatório para MedicationExposure');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = MedicationExposureModel;
