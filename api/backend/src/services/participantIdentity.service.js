const { getCollection } = require('../utils/collectionResolver');
const { encryptValue, decryptValue, hmacBlindIndex, hmacBlindIndexCandidates } = require('../utils/fieldEncryption');
const { fieldMapFor, legacyFieldMapFor } = require('../utils/encryptedFieldRegistry');
const logger = require('../utils/logger');
const { parseBirthDateDay, birthDateKey } = require('../utils/birthDate');

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
  // #1104: every field here is ciphertext-only (getCiphertextOnlyFields),
  // matching patient.service.js's getEncryptedFieldMap precedent -- the
  // plaintext is nulled once the ciphertext exists.
  //
  // The original blocker was that #561-#564 migrated 10+ consumers to read
  // these off the plaintext fields while #566's own scope was storage only.
  // Every reader now goes through decryptIdentity, and every query matches
  // on a blind index (getHashFieldMap), which is what made the cutover safe.
  //
  // #1166: plus the participant's contact, dict-02 P1X-0352/P1X-0353
  // (ParticipantIdentity.email/phone, "MongoDB protegido"). This is its only
  // home since slice 4, and it is ciphertext-only (getCiphertextOnlyFields).
  //
  // #1168: plus the legal representative, dict-02 P1X-0357..0360.
  //
  // #1103: the map lives in utils/encryptedFieldRegistry.js, the one
  // inventory of encrypted fields, which the key-rotation rewrite reads too.
  getEncryptedFieldMap() {
    return fieldMapFor('services/participantIdentity.service.js');
  }

  // #1386: the <field>Encrypted names the ciphertext was stored under before
  // it moved to <field>Ciphertext. No reader falls back to them: they name
  // what the migration moves and what writers $unset.
  getLegacyCiphertextFieldMap() {
    return legacyFieldMapFor('services/participantIdentity.service.js');
  }

  // #1386: the $unset that goes with an update's $set, so a record rewritten
  // under a new ciphertext name keeps no stale envelope under the old one.
  // A new name set to null counts: a clearing write leaves the old envelope
  // stale too.
  legacyCiphertextUnset(setDoc = {}) {
    const legacyFieldMap = this.getLegacyCiphertextFieldMap();
    const unset = {};
    for (const [plainField, encryptedField] of Object.entries(this.getEncryptedFieldMap())) {
      if (legacyFieldMap[plainField] && Object.prototype.hasOwnProperty.call(setDoc, encryptedField)) {
        unset[legacyFieldMap[plainField]] = '';
      }
    }
    return unset;
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

    // #1386: the same for recordNumber, so an import's numeric 4512 is
    // stored and hashed as '4512'. Only where the caller passed it: a key
    // added here would mark the number present (cleared) on a record whose
    // update never touched it.
    if (Object.prototype.hasOwnProperty.call(doc, 'recordNumber')) {
      doc.recordNumber = this.normalizeRecordNumber(doc.recordNumber);
    }

    // #1412: the birth date as noon UTC of its calendar day, so the stored
    // instant, the ciphertext and birthDateHash name one day in every zone.
    // An unparseable value is left as it was.
    if (Object.prototype.hasOwnProperty.call(doc, 'birthDate')
        && doc.birthDate !== null && doc.birthDate !== undefined && doc.birthDate !== '') {
      const day = parseBirthDateDay(doc.birthDate);
      if (day) doc.birthDate = day;
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
  // Kept as a LIST rather than derived from the whole encryptedFieldMap
  // because the cutover went field by field, and a new encrypted field
  // should be added here deliberately, once its readers decrypt.
  // #1104: patientName's one plaintext query, listPatients' $regex substring
  // search, became an exact match on patientNameHash. identityDocument's two
  // $or plaintext arms became hash-only. #1166 slice 4: email and phone have
  // no plaintext query anywhere (phone uniqueness is phoneHash), and every
  // reader decrypts. #1168: nor do the representative fields, whose one
  // reader (updatePatient) decrypts. #1386: recordNumber (P1X-0355) is
  // matched only on recordNumberHash, and its one reader (by-barcode)
  // decrypts.
  getCiphertextOnlyFields() {
    return [
      'patientName',
      'birthDate',
      'identityDocument',
      'email',
      'phone',
      'representativeName',
      'representativeEmail',
      'representativeIdentityDocument',
      'representativePhone',
      'recordNumber'
    ];
  }

  // #1166: phoneHash is what lets phone uniqueness (#1165) move off the
  // plaintext `patients.phone` column once the ciphertext is all that's left.
  // #1104: patientNameHash serves listPatients' name filter, which is an
  // EXACT match on the normalized full name -- a blind index cannot serve a
  // substring search, and no screen sent that filter.
  // #1386: recordNumberHash serves the record-number matchers (conflict
  // check, search, import and batch linkage), each an exact match.
  getHashFieldMap() {
    return {
      patientName: 'patientNameHash',
      identityDocument: 'identityDocumentHash',
      birthDate: 'birthDateHash',
      phone: 'phoneHash',
      recordNumber: 'recordNumberHash'
    };
  }

  // #1386: the one canonical spelling of a hospital record number -- the
  // trimmed string, or null when nothing is left. patient.service.js
  // #normalizeRecordNumber delegates here.
  normalizeRecordNumber(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  // #1386: the participantIdentities filter for a record number, matched on
  // recordNumberHash under every registered key (#1099), or on the plaintext
  // on a keyless stack (#1083). null when the number normalizes to nothing:
  // `{ recordNumber: null }` would match every identity, whose plaintext
  // encryptIdentityFields nulls, so a blank number must run no query at all.
  recordNumberIdentityQuery(value) {
    const normalized = this.normalizeRecordNumber(value);
    if (normalized === null) return null;
    const recordNumberHashes = this.computeBlindIndexCandidates('recordNumber', normalized);
    return recordNumberHashes.length
      ? { recordNumberHash: { $in: recordNumberHashes } }
      : { recordNumber: normalized };
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
  // at query time. birthDate normalizes to the UTC calendar day (YYYY-MM-DD)
  // of its noon-UTC value (#1412), so an ISO and a DD/MM/YYYY spelling of one
  // day, and a legacy midnight instant, hash alike on a host in any zone.
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

    // #1104: the same name comparison PatientIdentityService#normalizeName and
    // intakeWizard's /patient-match already apply in memory -- accents
    // stripped, lowercased, whitespace collapsed -- so "José  da Silva" and
    // "jose da silva" are one name to the index as they are to those matchers.
    if (field === 'patientName') {
      const name = String(value)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      return name || null;
    }

    // #1166: digits only, the spelling patient.service.js#normalizePhone
    // stores, so a punctuated phone hashes the same as its stored form.
    if (field === 'phone') {
      const digits = String(value).replace(/\D/g, '');
      return digits || null;
    }

    if (field === 'recordNumber') {
      return this.normalizeRecordNumber(value);
    }

    if (field === 'birthDate') {
      return birthDateKey(value);
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

  // #1166: the participant's contact is identity data (dict-02
  // P1X-0352/P1X-0353), so a reader takes it from the DECRYPTED identity
  // record. Since slice 4 the Patient document is not a fallback: nothing
  // writes the contact there, and a copy left on a row the backfill has not
  // reached yet is stale by definition, so it is overwritten, not kept.
  withIdentityContact(patient, identity) {
    const doc = { ...(patient || {}) };
    for (const field of ['email', 'phone']) {
      const value = identity?.[field];
      if (value !== undefined && value !== null && value !== '') {
        doc[field] = value;
      } else {
        delete doc[field];
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

  // RF005/RNF007 (#560/#566): re-identification (paciente.controller.js#reidentify)
  // decrypts the whole identity. The directory reads only the record number
  // and the birth date, and only for the cadastro list.
  async getIdentityByParticipantId(db, participantId) {
    const collection = await this.getIdentityCollection(db);
    const identity = await collection.findOne({ participantId });
    return this.decryptIdentity(identity);
  }

  formatDirectoryBirthDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const day = String(value.getUTCDate()).padStart(2, '0');
      const month = String(value.getUTCMonth() + 1).padStart(2, '0');
      return `${day}/${month}/${value.getUTCFullYear()}`;
    }
    if (typeof value === 'string') {
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
      const calendar = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
      if (calendar) return value.trim();
    }
    return null;
  }

  async directoryFieldsByParticipantId(db, participantIds) {
    const ids = [...new Set((participantIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const fields = new Map();
    if (ids.length === 0) return fields;

    const collection = await this.getIdentityCollection(db);
    const rows = await collection.find({ participantId: { $in: ids } }).toArray();
    for (const row of rows) {
      const identity = this.decryptIdentity(row) || {};
      const recordNumber = this.normalizeRecordNumber(identity.recordNumber);
      fields.set(String(identity.participantId), {
        recordNumber,
        birthDate: this.formatDirectoryBirthDate(identity.birthDate)
      });
    }
    return fields;
  }
}

module.exports = new ParticipantIdentityService();
