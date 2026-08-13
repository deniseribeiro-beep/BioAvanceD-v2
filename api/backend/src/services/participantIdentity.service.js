const { getCollection } = require('../utils/collectionResolver');
const { encryptValue, decryptValue } = require('../utils/fieldEncryption');

// RF005/RNF007 (#560): read access to ParticipantIdentity, the segregated
// civil-identity collection created by #363. Kept separate from
// PatientIdentityService.js, which resolves import-time name+DOB matches
// against `patients` and has nothing to do with this entity.
class ParticipantIdentityService {
  async getIdentityCollection(db) {
    return getCollection(db, 'participantIdentities');
  }

  // RF005/RNF007 (#566), dict-07 row 1 ("cifrar"): the three civil-identity
  // fields that must be encrypted at rest. Unlike patient.service.js's
  // getEncryptedFieldMap (which nulls the plaintext once ciphertext exists),
  // this stays additive-only for now — #561-#564 migrated 10+ consumers to
  // read patientName/birthDate/identityDocument directly off this
  // collection's plaintext fields, and #566's own scope is storage only
  // ("it only touches how participantIdentities documents are stored, not
  // who reads them"). Cutting the plaintext over to ciphertext-only needs
  // those consumers repointed first — tracked as a follow-up, not done here.
  getEncryptedFieldMap() {
    return {
      patientName: 'patientNameEncrypted',
      birthDate: 'birthDateEncrypted',
      identityDocument: 'identityDocumentEncrypted'
    };
  }

  encryptIdentityFields(fields = {}) {
    const doc = { ...fields };
    const encryptedFieldMap = this.getEncryptedFieldMap();
    let keyVersion = null;

    for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(doc, plainField) || doc[plainField] === null || doc[plainField] === undefined) {
        continue;
      }

      const encryptedPayload = encryptValue(doc[plainField]);
      if (encryptedPayload) {
        doc[encryptedField] = encryptedPayload;
        keyVersion = encryptedPayload.keyId;
      }
    }

    // dict-02 P1X-0362 (encryptionKeyVersion): records which key/envelope
    // ciphered these fields, so key rotation stays auditable.
    if (keyVersion) {
      doc.encryptionKeyVersion = keyVersion;
    }

    return doc;
  }

  decryptIdentity(identity) {
    if (!identity || typeof identity !== 'object') return identity;

    const doc = { ...identity };
    const encryptedFieldMap = this.getEncryptedFieldMap();

    for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
      if (doc[plainField] !== undefined && doc[plainField] !== null && doc[plainField] !== '') {
        continue;
      }

      const payload = doc[encryptedField];
      if (!payload) {
        continue;
      }

      const decryptedValue = decryptValue(payload);
      if (decryptedValue === null || decryptedValue === undefined) {
        continue;
      }

      doc[plainField] = plainField === 'birthDate' ? new Date(decryptedValue) : decryptedValue;
    }

    return doc;
  }

  // RF005/RNF007 (#560/#566): the sole authorized re-identification access
  // path (paciente.controller.js#reidentify) — decryption happens here, not
  // in every caller.
  async getIdentityByParticipantId(db, participantId) {
    const collection = await this.getIdentityCollection(db);
    const identity = await collection.findOne({ participantId });
    return this.decryptIdentity(identity);
  }
}

module.exports = new ParticipantIdentityService();
