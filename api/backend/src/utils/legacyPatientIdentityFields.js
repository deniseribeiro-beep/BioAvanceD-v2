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

// #1166 slice 4: the participant's contact is identity data too (dict-02
// P1X-0352/P1X-0353, ParticipantIdentity only). Kept apart from the list
// above because PatientModel still accepts and validates it as input: every
// writer routes it on to ParticipantIdentity, then strips it before a
// Patient write that does not go through PatientModel.create.
const PARTICIPANT_CONTACT_FIELDS = ['email', 'phone'];

// #1168: the same holds for the deceased participant's legal representative
// (dict-02 P1X-0357..0360, ParticipantIdentity only).
const PARTICIPANT_REPRESENTATIVE_FIELDS = [
  'representativeName',
  'representativeEmail',
  'representativeIdentityDocument',
  'representativePhone',
];

// #1386: and the hospital record number (dict-02 P1X-0355,
// ParticipantIdentity only, as recordNumberCiphertext).
const PARTICIPANT_RECORD_FIELDS = ['recordNumber'];

// Every field PatientModel accepts as input but that lives on
// ParticipantIdentity alone.
const PARTICIPANT_IDENTITY_ONLY_FIELDS = [
  ...PARTICIPANT_CONTACT_FIELDS,
  ...PARTICIPANT_REPRESENTATIVE_FIELDS,
  ...PARTICIPANT_RECORD_FIELDS,
];

function omitParticipantIdentityOnlyFields(data = {}) {
  const result = { ...data };
  for (const field of PARTICIPANT_IDENTITY_ONLY_FIELDS) delete result[field];
  return result;
}

module.exports = {
  LEGACY_PATIENT_IDENTITY_FIELDS,
  omitLegacyIdentityFields,
  PARTICIPANT_CONTACT_FIELDS,
  PARTICIPANT_REPRESENTATIVE_FIELDS,
  PARTICIPANT_RECORD_FIELDS,
  PARTICIPANT_IDENTITY_ONLY_FIELDS,
  omitParticipantIdentityOnlyFields,
};
