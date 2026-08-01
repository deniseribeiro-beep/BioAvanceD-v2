// dict-07/dict-08 (#388): SPREC pre-analytic profile segregated off Sample
// into its own referenced, versioned-snapshot entity — see
// docs/architecture/canonical-data-contract-v1.md's SpecimenPreanalytics
// section for the contract this mirrors. Named after dict-02's canonical
// entity ("SpecimenPreanalytics", ELM-0145+/P1X-0057+), not the "SPREC"
// shorthand dict-07/dict-08 and the issue use — same substitution #383
// made for "RCS" -> "RcsAssessment". Sample keeps its embedded `sprec`
// field for backward compatibility during migration (not touched by this
// entity). Field set is deliberately limited to what import.service.js
// already parses (matrixType/sampleType/primaryContainer/... below) — not
// dict-02's fuller SpecimenPreanalytics list (sprecCode, sprecVersion,
// sprecProfileId, profileStatus, warmIschemiaTime, coldIschemiaTime,
// fixationStabilizationType, fixationTime), which nothing in the codebase
// computes yet.
class SpecimenPreanalyticsModel {
  static fieldsOf(data = {}) {
    return {
      specimenId: String(data.specimenId || '').trim(),
      matrixType: data.matrixType ?? null,
      sampleType: data.sampleType ?? null,
      primaryContainer: data.primaryContainer ?? null,
      preCentrifugation: data.preCentrifugation ?? null,
      centrifugation: data.centrifugation ?? null,
      secondCentrifugation: data.secondCentrifugation ?? null,
      postCentrifugationDelay: data.postCentrifugationDelay ?? null,
      longTermStorage: data.longTermStorage ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.specimenId) {
      throw new Error('specimenId é obrigatório para SpecimenPreanalytics');
    }
    const now = new Date();
    return { ...fields, recordedAt: data.recordedAt ? new Date(data.recordedAt) : now, createdAt: now };
  }

  /** Maps the `sprec` object import.service.js already parses onto this entity's fields. */
  static fromSprecData(specimenId, sprec = {}) {
    return this.create({ specimenId, ...sprec });
  }
}

module.exports = SpecimenPreanalyticsModel;
