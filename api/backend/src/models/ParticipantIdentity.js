// RF005/RNF007 (#363): civil identity fields segregated off the Participant
// resource — see docs/architecture/canonical-data-contract-v1.md's
// ParticipantIdentity section for the contract this mirrors.
class ParticipantIdentityModel {
  static fieldsOf(data = {}) {
    return {
      participantId: String(data.participantId || '').trim(),
      patientName: data.patientName ? String(data.patientName).trim() : null,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      identityDocument: data.identityDocument ? String(data.identityDocument).trim() : null,
      email: data.email ? String(data.email).trim().toLowerCase() : null,
      phone: data.phone || null,
      representativeName: data.representativeName || null,
      representativeEmail: data.representativeEmail || null,
      representativeIdentityDocument: data.representativeIdentityDocument || null,
      representativePhone: data.representativePhone || null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.participantId) {
      throw new Error('participantId é obrigatório para ParticipantIdentity');
    }
    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = ParticipantIdentityModel;
