/**
 * #1103: the one inventory of fields encrypted at rest with encryptValue
 * (utils/fieldEncryption.js).
 *
 * Each entry names the collection, the module that writes the ciphertext,
 * and every ciphertext field it writes. Where a service maps a plaintext
 * field to its ciphertext field, the map lives here and the service reads it
 * (participantIdentity.service, patient.service), so the inventory and the
 * writer cannot list different fields.
 *
 * Three things read it:
 *   - the writers above, for their field maps;
 *   - src/scripts/rewriteEncryptedFields.js (npm run encryption:rewrite), which
 *     re-encrypts every listed field under the active key, so the previous
 *     key slot can be emptied after a rotation;
 *   - tests/architecture/encrypted-field-registry.arch.test.js, which fails
 *     when a module calls encryptValue without an entry here.
 *
 * The worklist needs no marker on the document: every envelope encryptValue
 * writes carries its own `keyId`, so `{ '<field>.keyId': { $ne: <active> } }`
 * selects exactly the documents a rotation left behind. participantIdentities
 * also keeps its dict-02 `encryptionKeyVersion` (P1X-0362), which the rewrite
 * updates with the envelopes.
 *
 * Blind indexes: hmacBlindIndex stores a bare hash with no keyId, so a
 * rotation leaves the hashes under the old key too. They are re-derived from
 * the decrypted values when their document is rewritten. `blindIndexes`
 * names the entry whose hashes the rewrite owns.
 */

const ENCRYPTED_FIELD_REGISTRY = [
  {
    // RF005/RNF007 (#566, #1166, #1168): civil identity and contact.
    collectionKey: 'participantIdentities',
    writer: 'services/participantIdentity.service.js',
    fields: {
      patientName: 'patientNameEncrypted',
      birthDate: 'birthDateEncrypted',
      identityDocument: 'identityDocumentEncrypted',
      email: 'emailEncrypted',
      phone: 'phoneEncrypted',
      representativeName: 'representativeNameEncrypted',
      representativeEmail: 'representativeEmailEncrypted',
      representativeIdentityDocument: 'representativeIdentityDocumentEncrypted',
      representativePhone: 'representativePhoneEncrypted',
    },
    keyVersionField: 'encryptionKeyVersion',
    blindIndexes: 'participantIdentity',
  },
  {
    collectionKey: 'patients',
    writer: 'services/patient.service.js',
    fields: {
      representativeIdentityDocument: 'representativeIdentityDocumentEncrypted',
    },
  },
  {
    collectionKey: 'biomarkerObservations',
    writer: 'services/biomarker-observation.service.js',
    fields: { value: 'valueEncrypted' },
  },
  {
    // #1072: the TOTP seed.
    collectionName: 'users',
    writer: 'services/auth.service.js',
    fields: { mfaSecret: 'mfaSecretCiphertext' },
  },
  {
    // #807, #1191: quarantined import rows and FHIR staging records, sealed
    // as one envelope whatever fields it holds.
    collectionName: 'import_staging_records',
    writer: 'utils/stagedRowCrypto.js',
    fields: { sealed: 'sealedPayload' },
  },
];

function entryFor(writer) {
  const entry = ENCRYPTED_FIELD_REGISTRY.find((e) => e.writer === writer);
  if (!entry) throw new Error(`encryptedFieldRegistry: no entry for ${writer}`);
  return entry;
}

/** A copy of a writer's plaintext -> ciphertext field map. */
function fieldMapFor(writer) {
  return { ...entryFor(writer).fields };
}

module.exports = { ENCRYPTED_FIELD_REGISTRY, fieldMapFor };
