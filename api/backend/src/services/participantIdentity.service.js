const { getCollection } = require('../utils/collectionResolver');
const { encryptValue, decryptValue, hmacBlindIndex, hmacBlindIndexCandidates } = require('../utils/fieldEncryption');

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

    // #1109: canonicalize identityDocument BEFORE deriving the ciphertext
    // and the blind index, so the stored plaintext, the ciphertext and
    // identityDocumentHash all carry the same digits-only spelling for
    // every writer. Only patient.service.js#createPatient normalized ahead
    // of this call -- import, updatePatient, the FHIR staging path, the
    // backfill and PatientIdentityService all passed the raw value through,
    // so a CPF typed as 111.444.777-35 was stored verbatim and invisible to
    // checkIdentifierConflict, which searches for the stripped form.
    const canonicalDocument = this.normalizeIdentityDocument(doc.identityDocument);
    if (canonicalDocument) {
      doc.identityDocument = canonicalDocument;
    }

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

    // RF005/RNF007 (#574): blind-index siblings for the two fields queried
    // by exact/range match elsewhere (identityDocument dedup, birthDate
    // day-range matching) -- ciphertext itself can't be queried, so these
    // let consumers query without touching plaintext going forward.
    const hashFieldMap = this.getHashFieldMap();
    for (const [plainField, hashField] of Object.entries(hashFieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(doc, plainField) || doc[plainField] === null || doc[plainField] === undefined || doc[plainField] === '') {
        continue;
      }

      const hash = this.computeBlindIndex(plainField, doc[plainField]);
      if (hash) {
        doc[hashField] = hash;
      }
    }

    return doc;
  }

  getHashFieldMap() {
    return {
      identityDocument: 'identityDocumentHash',
      birthDate: 'birthDateHash'
    };
  }

  // #1109: the one canonical spelling of identityDocument -- digits only.
  // The field is a CPF throughout this codebase (utils/security.js#validateCPF
  // wants 11 digits, and patient.service.js has always stripped non-digits on
  // the query side), so punctuation is formatting rather than identity.
  // patient.service.js#normalizeidentityDocument delegates here so the read
  // and write sides cannot drift apart again.
  normalizeIdentityDocument(value) {
    if (value === null || value === undefined) return null;
    const digits = String(value).replace(/\D/g, '').trim();
    return digits || null;
  }

  // Normalizes a raw value into the exact string that gets hashed, so the
  // same input always produces the same blind-index value at write time and
  // at query time. birthDate normalizes to the local calendar date
  // (YYYY-MM-DD) to match the existing day-range query semantics these
  // fields replace -- not a UTC ISO slice, which could shift the date near
  // local midnight.
  normalizeForHash(field, value) {
    if (value === null || value === undefined || value === '') return null;

    // #1109: hash the digits-only form on both sides. Writers stored the
    // value verbatim while checkIdentifierConflict searched for the stripped
    // form, so a punctuated CPF matched neither the plaintext arm nor the
    // blind index and a second participant was created for the same civil
    // identity.
    if (field === 'identityDocument') {
      return this.normalizeIdentityDocument(value);
    }

    if (field === 'birthDate') {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    return String(value).trim();
  }

  computeBlindIndex(field, value) {
    const normalized = this.normalizeForHash(field, value);
    if (normalized === null) return null;
    return hmacBlindIndex(normalized);
  }

  // #1099: the QUERY-side counterpart of computeBlindIndex -- one
  // candidate hash per registered key, so a value indexed before an
  // ENCRYPTION_KEY rotation is still matchable while the previous slot
  // is populated. Callers match with $in rather than equality. Writes
  // keep using computeBlindIndex, which is active-key only.
  computeBlindIndexCandidates(field, value) {
    const normalized = this.normalizeForHash(field, value);
    if (normalized === null) return [];
    return hmacBlindIndexCandidates(normalized);
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
