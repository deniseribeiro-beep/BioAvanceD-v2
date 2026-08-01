const crypto = require('crypto');

// dict-07/dict-08 (#388): SPREC pre-analytic profile segregated off Sample
// into its own referenced, versioned-snapshot entity — see
// docs/architecture/canonical-data-contract-v1.md's SpecimenPreanalytics
// section for the contract this mirrors. Named after dict-02's canonical
// entity ("SpecimenPreanalytics", ELM-0145+/P1X-0057+), not the "SPREC"
// shorthand dict-07/dict-08 and the issue use — same substitution #383
// made for "RCS" -> "RcsAssessment". Sample keeps its embedded `sprec`
// field for backward compatibility during migration (not touched by this
// entity).
//
// matrixType/sampleType/primaryContainer/preCentrifugation/centrifugation/
// secondCentrifugation/postCentrifugationDelay/longTermStorage (#388) are
// generic axis-position slots (axis 1-7) populated by import.service.js
// straight from CSV columns, regardless of matrix type — mirroring
// frontend/src/constants/sprecDictionary.js's SPREC_FLUID_DICTIONARY vs
// SPREC_SOLID_DICTIONARY, which relabel the same axis 2-6 slots per
// matrixType. dict-02's fuller canonical field set (#392) is exposed by
// deriving from those same slots based on matrixType, not by re-parsing
// new columns for them — sprecSpecimenType (axis 1) applies to both
// matrices; sprecPrimaryContainer (axis 2, fluid) vs sprecCollectionType
// (axis 2, solid) and warmIschemiaTime/coldIschemiaTime/
// fixationStabilizationType/fixationTime (axis 3-6, solid only) branch on
// matrixType. sprecCode/sprecVersion (ELM-0145/0146) are genuinely new
// pass-through values with no existing source; sprecProfileId (P1X-0057)
// is generated per snapshot (immutable identifier of *this* profile
// version, same pattern as PatientConsentModel's consentId); profileStatus
// (P1X-0059) defaults to 'draft' — nothing in the codebase confirms/
// validates a profile yet.
class SpecimenPreanalyticsModel {
  static fieldsOf(data = {}) {
    const matrixType = data.matrixType ?? null;
    const isFluid = matrixType === 'fluid';
    const isSolid = matrixType === 'solid';

    return {
      specimenId: String(data.specimenId || '').trim(),
      matrixType,
      sampleType: data.sampleType ?? null,
      primaryContainer: data.primaryContainer ?? null,
      preCentrifugation: data.preCentrifugation ?? null,
      centrifugation: data.centrifugation ?? null,
      secondCentrifugation: data.secondCentrifugation ?? null,
      postCentrifugationDelay: data.postCentrifugationDelay ?? null,
      longTermStorage: data.longTermStorage ?? null,
      // dict-02's fuller SpecimenPreanalytics field set (#392):
      sprecCode: data.sprecCode ?? null,
      sprecVersion: data.sprecVersion ?? null,
      sprecSpecimenType: data.sampleType ?? null,
      sprecPrimaryContainer: isFluid ? (data.primaryContainer ?? null) : null,
      sprecCollectionType: isSolid ? (data.primaryContainer ?? null) : null,
      warmIschemiaTime: isSolid ? (data.preCentrifugation ?? null) : null,
      coldIschemiaTime: isSolid ? (data.centrifugation ?? null) : null,
      fixationStabilizationType: isSolid ? (data.secondCentrifugation ?? null) : null,
      fixationTime: isSolid ? (data.postCentrifugationDelay ?? null) : null,
      sprecProfileId: data.sprecProfileId || crypto.randomUUID(),
      profileStatus: data.profileStatus ?? 'draft',
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
