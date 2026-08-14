// RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
// identity — they live only on ParticipantIdentity, never on Patient.
// Shared by every Patient write path that still receives these fields
// from callers (which also need them for the ParticipantIdentity write).
const LEGACY_PATIENT_IDENTITY_FIELDS = ['patientName', 'birthDate', 'identityDocument'];

function omitLegacyIdentityFields(data = {}) {
  const result = { ...data };
  for (const field of LEGACY_PATIENT_IDENTITY_FIELDS) delete result[field];
  return result;
}

module.exports = { LEGACY_PATIENT_IDENTITY_FIELDS, omitLegacyIdentityFields };
