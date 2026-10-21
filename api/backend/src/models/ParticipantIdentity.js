const crypto = require('crypto');

// RF005/RNF007 (#363): civil identity fields segregated off the Participant
// resource. Which dict-02 ParticipantIdentity elements (P1X-0348..0364) are
// built, and under which names, is decided in
// docs/decisions/2026-10-17-participant-identity-names-and-fields.md.
class ParticipantIdentityModel {
  // #1386: participantIdentityId, identityStatus and encryptionKeyVersion are
  // constants, never read from `data`: create() is fed whole import rows, and
  // a column of that name must not choose a record's id or status.
  // encryptIdentityFields overwrites encryptionKeyVersion whenever it
  // enciphers a field.
  //
  // P1X-0354 and P1X-0359 are declared under their ciphertext names (item 5
  // of the decision record). identityDocument and representativeIdentityDocument
  // are the plaintext input encryptIdentityFields enciphers into them and then
  // nulls. Every caller passes this through it, which fills the ciphertext
  // whenever there is a value to encipher.
  //
  // #1386: P1X-0355 is declared under its ciphertext name too,
  // recordNumberCiphertext; recordNumber is the plaintext input
  // encryptIdentityFields enciphers and then nulls. create() leaves both keys
  // out when there is no number, so only a writer that set or cleared the
  // number makes it present, and a reader falls back to a legacy
  // patients.recordNumber only where it is absent.
  static fieldsOf(data = {}) {
    return {
      participantIdentityId: null,
      participantId: String(data.participantId || '').trim(),
      patientName: data.patientName ? String(data.patientName).trim() : null,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      identityDocument: data.identityDocument ? String(data.identityDocument).trim() : null,
      identityDocumentCiphertext: null,
      email: data.email ? String(data.email).trim().toLowerCase() : null,
      phone: data.phone || null,
      representativeName: data.representativeName || null,
      representativeEmail: data.representativeEmail || null,
      representativeIdentityDocument: data.representativeIdentityDocument || null,
      representativeIdentityDocumentCiphertext: null,
      representativePhone: data.representativePhone || null,
      recordNumber: data.recordNumber !== undefined && data.recordNumber !== null && String(data.recordNumber).trim() !== ''
        ? String(data.recordNumber).trim()
        : null,
      recordNumberCiphertext: null,
      identityStatus: 'active',
      encryptionKeyVersion: null,
    };
  }

  // The values a newly inserted record takes (P1X-0348, P1X-0361). An upsert
  // writer passes them under $setOnInsert, so a matched record keeps its own.
  static onInsertFields() {
    return { participantIdentityId: crypto.randomUUID(), identityStatus: 'active' };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.participantId) {
      throw new Error('participantId é obrigatório para ParticipantIdentity');
    }
    if (fields.recordNumber === null) {
      delete fields.recordNumber;
      delete fields.recordNumberCiphertext;
    }
    const now = new Date();
    return { ...fields, ...this.onInsertFields(), createdAt: now, updatedAt: now };
  }
}

module.exports = ParticipantIdentityModel;
