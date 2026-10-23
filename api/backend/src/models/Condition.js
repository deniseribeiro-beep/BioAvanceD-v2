const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0200..ELM-0210 (domain "Dados clínicos"), #690 --
// RF005 clinical-data slice 2/5 (see #677 for the full 5-slice breakdown).
// This is AC4-6's own requirement text: structured coding via ORPHA/
// ICD-11/ICD-10/SNOMED/MONDO/OMIM (`conditionCoding`, Coding[], 1..*).
// Follows the RcsAssessment/SpecimenPreanalytics referenced-entity pattern
// (#383/#388), not an embedded field on Participant. Coding shape --
// `{systemUri, code, version, display}` -- matches TerminologyConceptModel's
// own field names (systemUri, not FHIR's plain `system`), so entries can be
// checked directly against activeCodeValidator.checkActiveCode without
// reshaping.
class ConditionModel {
  static fieldsOf(data = {}) {
    const conditionCoding = Array.isArray(data.conditionCoding)
      ? data.conditionCoding.filter((coding) => coding && coding.systemUri && coding.code)
      : [];
    const diagnosisEvidence = Array.isArray(data.diagnosisEvidence)
      ? data.diagnosisEvidence.map((ref) => String(ref)).filter(Boolean)
      : [];

    return {
      conditionId: data.conditionId || crypto.randomUUID(),
      participantId: String(data.participantId || '').trim(),
      // ELM-0202: Coding[], 1..* -- "uma ou mais codificações externas,
      // preservando a fonte" (ORPHA|ICD-11|ICD-10|SNOMED|MONDO|OMIM).
      conditionCoding,
      // ELM-0203/0204: code, 0..1 -- FHIR ConditionClinicalStatus/
      // ConditionVerificationStatus vocab, stored as given (not enumerated
      // here -- neither dict-02 nor RF005's AC list constrains this repo to
      // a fixed subset of the FHIR value sets).
      clinicalStatus: data.clinicalStatus ? String(data.clinicalStatus).trim() : null,
      verificationStatus: data.verificationStatus ? String(data.verificationStatus).trim() : null,
      // ELM-0205/0206: choice, 0..1 -- FHIR onset[x]/abatement[x] (date, age,
      // Period, string, Range), stored as given rather than forced into one
      // shape, same precedent as encounterType elsewhere in this domain.
      onset: data.onset ?? null,
      abatement: data.abatement ?? null,
      // ELM-0207: CodeableConcept, 0..1.
      severity: data.severity ?? null,
      // ELM-0208: BackboneElement, 0..1 ("estágio clínico/patológico com
      // sistema e versão") -- stored as given, a nested object.
      stage: data.stage ?? null,
      // ELM-0209: Reference[], 0..* -> DiagnosticReport (#695) -- the
      // service layer hard-checks only an entry typed
      // `DiagnosticReport/<id>`; an untyped entry (a criterion or a
      // professional, per ELM-0209) is stored unchecked.
      diagnosisEvidence,
      // ELM-0210: dateTime, 0..1.
      recordedDate: data.recordedDate ? new Date(data.recordedDate) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.participantId) {
      errors.push('participantId é obrigatório para Condition');
    }
    if (fields.conditionCoding.length === 0) {
      errors.push('conditionCoding é obrigatório para Condition (1..*, cada item precisa de systemUri e code)');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = ConditionModel;
