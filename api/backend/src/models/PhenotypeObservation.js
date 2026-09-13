const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0211..ELM-0218 + P1X-0074..P1X-0076 (domain
// "Dados clínicos"), #690 -- RF005 clinical-data slice 2/5 (see #677 for
// the full 5-slice breakdown). HPO-coded phenotype presence/absence
// (`hpoCoding`, Coding, 1..1) -- AC4-6's own requirement text. Follows the
// RcsAssessment/SpecimenPreanalytics referenced-entity pattern (#383/#388).
const PRESENCE_STATUSES = ['present', 'absent', 'unknown', 'not_assessed'];

class PhenotypeObservationModel {
  static fieldsOf(data = {}) {
    const phenotypeEvidence = Array.isArray(data.phenotypeEvidence)
      ? data.phenotypeEvidence.map((ref) => String(ref)).filter(Boolean)
      : [];

    return {
      phenotypeObservationId: data.phenotypeObservationId || crypto.randomUUID(),
      // P1X-0074: Reference, 1..1 -> Participant.
      participantId: String(data.participantId || '').trim(),
      // ELM-0212: Coding, 1..1 -- HPO-coded, "presente ou explicitamente
      // ausente". Same {systemUri, code, version, display} shape
      // Condition.conditionCoding uses.
      hpoCoding: data.hpoCoding && data.hpoCoding.systemUri && data.hpoCoding.code ? data.hpoCoding : null,
      // ELM-0213: code, 1..1 -- dict-02's own note: "Ausente não equivale a
      // não preenchido" (absent isn't the same as not filled in). No
      // default value here -- an omitted presenceStatus must fail
      // validation, not silently resolve to any of the four real states.
      presenceStatus: data.presenceStatus ? String(data.presenceStatus).trim().toLowerCase() : null,
      // ELM-0214: choice, 0..1.
      phenotypeOnset: data.phenotypeOnset ?? null,
      // ELM-0215/0216/0217: CodeableConcept, 0..1 each.
      phenotypeSeverity: data.phenotypeSeverity ?? null,
      phenotypeFrequency: data.phenotypeFrequency ?? null,
      observationMethod: data.observationMethod ?? null,
      // ELM-0218: Reference[], 0..* -> DiagnosticReport -- stays
      // unenforced, same pattern as Condition.diagnosisEvidence.
      phenotypeEvidence,
      // P1X-0075: Reference, 0..1 -> Encounter (#689) -- joinable-but-
      // unenforced, same pattern as equipmentId/thresholdProfileId
      // elsewhere in this repo.
      encounterId: data.encounterId ? String(data.encounterId).trim() : null,
      // P1X-0076: dateTime, 1..1.
      effectiveDateTime: data.effectiveDateTime ? new Date(data.effectiveDateTime) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.participantId) {
      errors.push('participantId é obrigatório para PhenotypeObservation');
    }
    if (!fields.hpoCoding) {
      errors.push('hpoCoding é obrigatório para PhenotypeObservation (systemUri e code)');
    }
    if (!fields.presenceStatus || !PRESENCE_STATUSES.includes(fields.presenceStatus)) {
      errors.push(`presenceStatus é obrigatório para PhenotypeObservation e deve ser um de: ${PRESENCE_STATUSES.join('|')}`);
    }
    if (!fields.effectiveDateTime) {
      errors.push('effectiveDateTime é obrigatório para PhenotypeObservation');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = PhenotypeObservationModel;
module.exports.PRESENCE_STATUSES = PRESENCE_STATUSES;
