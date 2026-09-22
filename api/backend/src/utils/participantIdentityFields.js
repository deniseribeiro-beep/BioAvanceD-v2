// RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
// identity — they live only on ParticipantIdentity, never on Patient.
// Shared by every Patient write path that receives these fields because the
// same input is also used to write ParticipantIdentity.
const PARTICIPANT_IDENTITY_FIELDS = ['patientName', 'birthDate', 'identityDocument'];

function omitParticipantIdentityFields(data = {}) {
  const result = { ...data };
  for (const field of PARTICIPANT_IDENTITY_FIELDS) delete result[field];
  return result;
}

module.exports = { PARTICIPANT_IDENTITY_FIELDS, omitParticipantIdentityFields };
