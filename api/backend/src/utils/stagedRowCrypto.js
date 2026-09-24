const logger = require('./logger');
const {
  encryptValue,
  decryptValue,
  isFieldEncryptionAvailable,
  unencryptedFieldStorageAllowed,
} = require('./fieldEncryption');

/**
 * #807: encryption at rest for the rows an import puts in quarantine.
 *
 * A rejected import row is the spreadsheet row as the operator uploaded it,
 * before anonymisation, so it carries the civil identity that
 * participantIdentities stores encrypted (#566). RNF020 AC#4 asks for
 * encryption at rest for "ParticipantIdentity e outros campos criticos", and
 * RNF029 AC#5 ties encryption to the class of the data. So a row that failed
 * validation gets the same protection it would have had if it had passed.
 *
 * `row` and `normalized` are sealed together into one envelope
 * (`sealedPayload`) and nulled on the stored document. Everything a reviewer
 * needs to see why the row was rejected (rowNumber, status, errors) stays
 * readable. `revealStagedRecord` restores both fields on read, so the
 * quarantine API returns the same shape as before.
 *
 * With no key configured, the payload is withheld (`payloadWithheld`) rather
 * than written in plaintext, and the rejection itself is still recorded. This
 * matches #1083's refusal to degrade a sensitive write to plaintext.
 * `ALLOW_UNENCRYPTED_FIELD_STORAGE=true` is the same explicit opt-out that
 * governs the other sensitive fields.
 */
const SEALED_FIELDS = ['row', 'normalized'];
const PAYLOAD_WITHHELD_KEY_MISSING = 'ENCRYPTION_KEY_MISSING';

function hasValue(value) {
  return value !== undefined && value !== null;
}

function sealStagedRecord(record, { fields = SEALED_FIELDS } = {}) {
  if (!record || typeof record !== 'object') return record;

  const payload = {};
  for (const field of fields) {
    if (hasValue(record[field])) payload[field] = record[field];
  }
  if (Object.keys(payload).length === 0) return record;

  if (isFieldEncryptionAvailable()) {
    const sealed = { ...record, sealedPayload: encryptValue(payload) };
    for (const field of fields) sealed[field] = null;
    return sealed;
  }

  if (unencryptedFieldStorageAllowed()) return record;

  logger.warn(
    '[SECURITY][AES256] ENCRYPTION_KEY ausente: linha em quarentena gravada sem o conteudo '
      + 'original, para nao persistir identificadores civis em texto claro (#807).'
  );
  const withheld = { ...record, payloadWithheld: PAYLOAD_WITHHELD_KEY_MISSING };
  for (const field of fields) withheld[field] = null;
  return withheld;
}

function revealStagedRecord(record) {
  if (!record || typeof record !== 'object' || !record.sealedPayload) return record;

  const { sealedPayload, ...rest } = record;
  const payload = decryptValue(sealedPayload);
  if (!payload || typeof payload !== 'object') {
    // Wrong or missing key: say so on the record instead of failing the
    // whole batch read, so the rejection reasons stay reviewable.
    return { ...rest, payloadUnreadable: true };
  }

  // Restores whatever the envelope holds, so a caller that sealed a wider
  // field list (#1191) reads back through the same function.
  return { ...rest, ...payload };
}

/**
 * #1191: a collection handle that seals on write and reveals on read.
 *
 * The FHIR staging service reads and updates its records at about fifteen
 * sites, and some updates `$set` a sealed field on its own (`normalized` on
 * consent acceptance, `consentTracking` when a consent is sent). Wrapping the
 * handle keeps the service's logic unchanged: insertMany seals, find/findOne
 * reveal, and an updateOne whose `$set` names a sealed field merges it with
 * the record's current payload and seals the result, so the fields the
 * update did not name survive. Anything else passes straight through.
 */
function sealedStagingCollection(collection, { fields = SEALED_FIELDS } = {}) {
  const seal = (doc) => sealStagedRecord(doc, { fields });
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function wrapCursor(cursor) {
    return {
      sort(...args) { return wrapCursor(cursor.sort(...args)); },
      limit(...args) { return wrapCursor(cursor.limit(...args)); },
      skip(...args) { return wrapCursor(cursor.skip(...args)); },
      async toArray() { return (await cursor.toArray()).map(revealStagedRecord); },
    };
  }

  return {
    insertMany(docs, options) {
      return collection.insertMany(docs.map(seal), options);
    },
    insertOne(doc, options) {
      return collection.insertOne(seal(doc), options);
    },
    find(filter, options) {
      return wrapCursor(collection.find(filter, options));
    },
    async findOne(filter, options) {
      return revealStagedRecord(await collection.findOne(filter, options));
    },
    async updateOne(filter, update, options) {
      const set = update && update.$set;
      if (!set || !fields.some((field) => has(set, field))) {
        return collection.updateOne(filter, update, options);
      }

      const current = revealStagedRecord(await collection.findOne(filter, options)) || {};
      const merged = {};
      for (const field of fields) merged[field] = has(set, field) ? set[field] : current[field];
      const sealed = seal(merged);

      const nextSet = { ...set };
      for (const field of fields) nextSet[field] = sealed[field] ?? null;
      nextSet.sealedPayload = sealed.sealedPayload || null;
      if (sealed.payloadWithheld) nextSet.payloadWithheld = sealed.payloadWithheld;

      return collection.updateOne(filter, { ...update, $set: nextSet }, options);
    },
  };
}

module.exports = {
  PAYLOAD_WITHHELD_KEY_MISSING,
  sealStagedRecord,
  revealStagedRecord,
  sealedStagingCollection,
};
