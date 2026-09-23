const { getCollection } = require('../utils/collectionResolver');
const { encryptValue, decryptValue, hmacBlindIndex, hmacBlindIndexCandidates } = require('../utils/fieldEncryption');
const logger = require('../utils/logger');

// RF005/RNF007 (#560): read access to ParticipantIdentity, the segregated
// civil-identity collection created by #363. Kept separate from
// PatientIdentityService.js, which resolves import-time name+DOB matches
// against `patients` and has nothing to do with this entity.
class ParticipantIdentityService {
  async getIdentityCollection(db) {
    return getCollection(db, 'participantIdentities');
  }

  // RF005/RNF007 (#566), dict-07 row 1 ("cifrar"): the three civil-identity
  // fields that must be encrypted at rest.
  //
  // #1104: this is no longer uniformly additive. getCiphertextOnlyFields()
  // below names the fields that have completed the cutover and now match
  // patient.service.js's getEncryptedFieldMap precedent -- the plaintext is
  // nulled once the ciphertext exists. birthDate has; patientName and
  // identityDocument have not, and that list carries the reason for each.
  //
  // The original blocker was that #561-#564 migrated 10+ consumers to read
  // these off the plaintext fields while #566's own scope was storage only.
  // Every reader now goes through decryptIdentity, which is what made the
  // birthDate half safe to do.
  //
  // #1166: plus the participant's contact, dict-02 P1X-0352/P1X-0353
  // (ParticipantIdentity.email/phone, "MongoDB protegido"). Additive for now:
  // the plaintext copy on `patients` is still written (slice 4 drops it), but
  // every reader takes the contact from here through withIdentityContact.
  getEncryptedFieldMap() {
    return {
      patientName: 'patientNameEncrypted',
      birthDate: 'birthDateEncrypted',
      identityDocument: 'identityDocumentEncrypted',
      email: 'emailEncrypted',
      phone: 'phoneEncrypted'
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
    // #1104: which fields THIS call actually enciphered. Tracked rather than
    // inferred from the presence of doc[encryptedField], so a caller that
    // passes a ciphertext through untouched cannot cause its plaintext to be
    // cleared.
    const encryptedThisCall = new Set();

    for (const [plainField, encryptedField] of Object.entries(encryptedFieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(doc, plainField) || doc[plainField] === null || doc[plainField] === undefined) {
        continue;
      }

      const encryptedPayload = encryptValue(doc[plainField]);
      if (encryptedPayload) {
        doc[encryptedField] = encryptedPayload;
        keyVersion = encryptedPayload.keyId;
        encryptedThisCall.add(plainField);
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

    // RF005/RNF007, dict-07 row 1 ("cifrar") (#1104): drop the plaintext for
    // every field that has completed the cutover. This is what makes the
    // encryption load-bearing -- decryptIdentity skips its ciphertext branch
    // whenever the plaintext is present, so while both were written the
    // ciphertext was a write-only artefact and the data it exists to protect
    // sat in the clear in the same document.
    //
    // Runs AFTER the hash loop, which reads doc[plainField].
    //
    // CONDITIONAL ON HAVING ENCIPHERED IT, and that is load-bearing (#1083).
    // encryptValue returns null on a keyless stack, and #1083 deliberately
    // left THIS service degrading to plaintext for exactly that case -- its
    // own comment says so, "that is right for participantIdentity.service,
    // whose map is deliberately additive pending #574". Dropping the
    // plaintext unconditionally would invert it: no plaintext, no ciphertext
    // and no hash written, and the request still answering 201.
    for (const plainField of this.getCiphertextOnlyFields()) {
      if (encryptedThisCall.has(plainField)) {
        doc[plainField] = null;
      }
    }

    return doc;
  }

  // RF005/RNF007, dict-07 row 1 (#1104): the fields whose plaintext copy is
  // no longer written, so the ciphertext is the only representation at rest.
  // Deliberately a LIST rather than the whole encryptedFieldMap -- this is a
  // per-field cutover. patientName still has a live plaintext consumer
  // (patient.service.js#listPatients' $regex substring search, which a blind
  // index cannot serve) and identityDocument still has plaintext query arms,
  // so both keep dual-writing until those are resolved.
  getCiphertextOnlyFields() {
    return ['birthDate'];
  }

  // #1166: phoneHash is what lets phone uniqueness (#1165) move off the
  // plaintext `patients.phone` column once the ciphertext is all that's left.
  getHashFieldMap() {
    return {
      identityDocument: 'identityDocumentHash',
      birthDate: 'birthDateHash',
      phone: 'phoneHash'
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

    // #1166: digits only, the spelling patient.service.js#normalizePhone
    // stores, so a punctuated phone hashes the same as its stored form.
    if (field === 'phone') {
      const digits = String(value).replace(/\D/g, '');
      return digits || null;
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

  // #1166 slice 2: the participant's contact is identity data (dict-02
  // P1X-0352/P1X-0353), so a reader overlays it from the DECRYPTED identity
  // record onto the Patient document. The Patient's own copy survives only
  // where the identity record holds no value, which is a fallback for the
  // transition: slice 4 stops writing it, and with it goes the fallback.
  withIdentityContact(patient, identity) {
    const doc = { ...(patient || {}) };
    for (const field of ['email', 'phone']) {
      const value = identity?.[field];
      if (value !== undefined && value !== null && value !== '') {
        doc[field] = value;
      }
    }
    return doc;
  }

  // #1166 slice 3: every writer that creates a participant inserts the
  // Patient row first and the identity row second, and none undid the first
  // when the second failed -- leaving a Patient with no identity at all. With
  // phone uniqueness enforced on the identity side (phoneHash), that failure
  // is an ordinary duplicate-phone refusal rather than an outage. Undo the
  // Patient insert, then rethrow the identity error unchanged so each
  // caller's own handling (409, per-row import error) still applies.
  async insertIdentityOrRollbackPatient(identityCollection, identityDoc, patientsCollection, patientInsertedId) {
    try {
      return await identityCollection.insertOne(identityDoc);
    } catch (error) {
      try {
        await patientsCollection.deleteOne({ _id: patientInsertedId });
      } catch (rollbackError) {
        logger.error(
          'Falha ao desfazer o paciente após erro na identidade (#1166):',
          rollbackError?.message || rollbackError
        );
      }
      throw error;
    }
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
