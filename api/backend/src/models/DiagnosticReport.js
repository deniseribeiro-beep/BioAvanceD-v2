const crypto = require('crypto');

// dict-02_DICIONARIO.md P1X-0168..P1X-0174 (domain "Dados clínicos"), #695.
// v1.3.0 marked this entity "P1-Stub"; the approved v2.0.0 rows mark all 7
// fields `maintained`, Phase 1 (docs/decisions/2026-10-23-diagnostic-report-
// entity.md). It groups ClinicalObservation results and is the target of
// Condition.diagnosisEvidence, PhenotypeObservation.phenotypeEvidence and
// ClinicalObservation.diagnosticReportId. Follows the ClinicalObservation
// referenced-entity pattern (#691).
class DiagnosticReportModel {
  static fieldsOf(data = {}) {
    const resultIds = Array.isArray(data.resultIds)
      ? data.resultIds.map((ref) => String(ref ?? '').trim()).filter(Boolean)
      : [];

    return {
      // P1X-0168: uuid, 1..1.
      diagnosticReportId: data.diagnosticReportId || crypto.randomUUID(),
      // P1X-0169: Reference, 1..1 -> Donor -- unenforced, as no service in
      // this domain checks participantId.
      participantId: String(data.participantId || '').trim(),
      // P1X-0170: Reference, 0..1 -> Encounter (#689) -- joinable-but-
      // unenforced, same pattern as ClinicalObservation.encounterId.
      encounterId: data.encounterId ? String(data.encounterId).trim() : null,
      // P1X-0171: code, 1..1 -- FHIR DiagnosticReportStatus vocab, stored as
      // given (not enumerated here, same reasoning as ClinicalObservation.
      // observationStatus).
      reportStatus: data.reportStatus ? String(data.reportStatus).trim() : null,
      // P1X-0172: dateTime, 0..1.
      issuedDateTime: data.issuedDateTime ? new Date(data.issuedDateTime) : null,
      // P1X-0173: Reference[], 0..* -> ClinicalObservation -- the service
      // layer hard-checks each entry against clinicalObservations.
      resultIds,
      // P1X-0174: uri, 0..1.
      documentUri: data.documentUri ? String(data.documentUri).trim() : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.participantId) {
      errors.push('participantId é obrigatório para DiagnosticReport');
    }
    if (!fields.reportStatus) {
      errors.push('reportStatus é obrigatório para DiagnosticReport');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = DiagnosticReportModel;
