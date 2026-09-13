const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0219..ELM-0232 + P1X-0077..P1X-0078 (domain
// "Dados clínicos"), #691 -- RF005 clinical-data slice 3/5 (see #677 for
// the full 5-slice breakdown). LOINC-coded clinical result
// (`observationCoding`, Coding, 1..1). Follows the RcsAssessment/
// SpecimenPreanalytics referenced-entity pattern (#383/#388).
class ClinicalObservationModel {
  static fieldsOf(data = {}) {
    const referenceRange = Array.isArray(data.referenceRange) ? data.referenceRange : [];
    const interpretation = Array.isArray(data.interpretation) ? data.interpretation : [];

    return {
      observationId: data.observationId || crypto.randomUUID(),
      // P1X-0077: Reference, 1..1 -> Participant.
      participantId: String(data.participantId || '').trim(),
      // ELM-0220: Coding, 1..1 -- LOINC, same {systemUri, code, version,
      // display} shape Condition.conditionCoding/PhenotypeObservation.
      // hpoCoding use.
      observationCoding: data.observationCoding && data.observationCoding.systemUri && data.observationCoding.code
        ? data.observationCoding
        : null,
      // ELM-0221: choice, 0..1 -- "preservar valor original," stored as
      // given rather than forced into one shape.
      value: data.value ?? null,
      // ELM-0222: Coding, 0..1 -- UCUM, "unidade conforme recebida."
      unit: data.unit ?? null,
      // ELM-0223: Quantity, 0..1 -- "não sobrescrever o original," a
      // distinct field from `value`, never derived by overwriting it.
      normalizedValue: data.normalizedValue ?? null,
      // ELM-0224: BackboneElement[], 0..* -- "não assumir universalidade"
      // (population/method/lab-scoped, not one fixed range).
      referenceRange,
      // ELM-0225: CodeableConcept[], 0..*.
      interpretation,
      // ELM-0226: dateTime, 1..1.
      effectiveDateTime: data.effectiveDateTime ? new Date(data.effectiveDateTime) : null,
      // ELM-0227: dateTime, 0..1.
      issuedDateTime: data.issuedDateTime ? new Date(data.issuedDateTime) : null,
      // ELM-0228: code, 1..1 -- FHIR ObservationStatus vocab, stored as
      // given (not enumerated here, same reasoning as Condition.
      // clinicalStatus).
      observationStatus: data.observationStatus ? String(data.observationStatus).trim() : null,
      // ELM-0229: CodeableConcept, 0..1.
      method: data.method ?? null,
      // ELM-0230: Reference, 0..1 -> Device -- unlike diagnosticReportId
      // below, a real `devices` collection exists (Device.schema.js), so
      // the service layer hard-checks this reference when supplied.
      deviceId: data.deviceId ? String(data.deviceId).trim() : null,
      // ELM-0231: Reference, 0..1 -> Specimen (samples collection) --
      // same hard-check treatment as deviceId, per #691's own scope.
      specimenId: data.specimenId ? String(data.specimenId).trim() : null,
      // ELM-0232: Reference, 0..1 -> DiagnosticReport -- stays
      // unenforced, no DiagnosticReport entity exists in this repo, same
      // pattern as Condition.diagnosisEvidence.
      diagnosticReportId: data.diagnosticReportId ? String(data.diagnosticReportId).trim() : null,
      // P1X-0078: Reference, 0..1 -> Encounter (#689) -- joinable-but-
      // unenforced, same pattern as PhenotypeObservation.encounterId.
      encounterId: data.encounterId ? String(data.encounterId).trim() : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.participantId) {
      errors.push('participantId é obrigatório para ClinicalObservation');
    }
    if (!fields.observationCoding) {
      errors.push('observationCoding é obrigatório para ClinicalObservation (systemUri e code)');
    }
    if (!fields.effectiveDateTime) {
      errors.push('effectiveDateTime é obrigatório para ClinicalObservation');
    }
    if (!fields.observationStatus) {
      errors.push('observationStatus é obrigatório para ClinicalObservation');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = ClinicalObservationModel;
