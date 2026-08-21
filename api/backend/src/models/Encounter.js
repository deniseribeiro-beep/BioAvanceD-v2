const crypto = require('crypto');

// dict-02_DICIONARIO.md ELM-0194..ELM-0199 (domain "Dados clínicos"), #689 --
// RF005 clinical-data slice 1/5 (see #677 for the full 5-slice breakdown).
// Foundational "visit/interaction context" entity: Condition/
// PhenotypeObservation/ClinicalObservation (later slices) optionally
// reference it (`encounterId`, 0..1, joinable-but-not-enforced, same
// pattern as `equipmentId`/`thresholdProfileId` elsewhere in this repo) but
// nothing requires it to exist first at the schema level. Follows the
// RcsAssessment/SpecimenPreanalytics referenced-entity pattern (#383/#388),
// not an embedded field on Participant/Sample.
class EncounterModel {
  static fieldsOf(data = {}) {
    const encounterLocation = Array.isArray(data.encounterLocation)
      ? data.encounterLocation.map((ref) => String(ref)).filter(Boolean)
      : [];

    return {
      encounterId: data.encounterId || crypto.randomUUID(),
      participantId: String(data.participantId || '').trim(),
      // ELM-0196: CodeableConcept, 1..1 -- stored as given (string or coded
      // object), same "not forced into one shape" precedent
      // QuarantineAction.reasonCodes uses for its own CodeableConcept[].
      encounterType: data.encounterType ?? null,
      // ELM-0197: Period, 1..1 -- same {start, end: null-means-open-ended}
      // shape TemperaturePolicy.schema.js's effectivePeriod already uses.
      encounterPeriod: {
        start: data.encounterPeriod?.start ? new Date(data.encounterPeriod.start) : null,
        end: data.encounterPeriod?.end ? new Date(data.encounterPeriod.end) : null,
      },
      // ELM-0198: Reference, 0..1 -> Organization.
      serviceProvider: data.serviceProvider ? String(data.serviceProvider).trim() : null,
      // ELM-0199: Reference[], 0..* -> Location.
      encounterLocation,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.participantId) {
      errors.push('participantId é obrigatório para Encounter');
    }
    if (!fields.encounterType) {
      errors.push('encounterType é obrigatório para Encounter');
    }
    if (!fields.encounterPeriod.start) {
      errors.push('encounterPeriod.start é obrigatório para Encounter');
    }
    if (errors.length) {
      throw new Error(errors.join(', '));
    }

    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = EncounterModel;
