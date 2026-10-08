/**
 * #1103: re-encrypt every field in utils/encryptedFieldRegistry.js under the
 * active ENCRYPTION_KEY, so the previous key slot can be emptied after a
 * rotation (keyRegistry.js, steps 1-3) as a checked step rather than a
 * judgement.
 *
 * What it does, per registry entry:
 *   - selects the documents holding an envelope whose `keyId` is not the
 *     active one (or, with --all, every document holding an envelope);
 *   - decrypts each envelope with whatever registered key opens it and
 *     re-encrypts it under the active key;
 *   - re-derives the blind indexes of an entry that owns them
 *     (participantIdentities), since hmacBlindIndex stores a bare hash with
 *     no keyId and a rotation leaves those under the old key too;
 *   - updates the entry's key-version field (encryptionKeyVersion).
 *
 * A document none of the registered keys opens is counted `unreadable` and
 * left untouched. Each update is guarded on the envelopes it read (their
 * `iv`), so a write that landed in between is counted `changedMeanwhile`
 * rather than overwritten.
 *
 * File binaries (fileCrypto.js) are encrypted under the same key, with the
 * key id on their metadata row as `encryptionKeyId`. They are not rewritten
 * here, but every collection is counted for rows under another key, so the
 * verdict below covers them.
 *
 * Usage, from api/backend:
 *   npm run encryption:rewrite              dry run: counts, writes nothing
 *   npm run encryption:rewrite -- --apply   rewrites
 *   add --all to rewrite every envelope and blind index, not only the
 *   documents under another key
 *
 * The previous slot is safe to empty when a dry run reports
 * `safeToEmptyPreviousSlot: true`: no field envelope, no unreadable document
 * and no file row left under another key.
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');
const { encryptValue, decryptValue } = require('../utils/fieldEncryption');
const keyRegistry = require('../config/keyRegistry');
const { ENCRYPTED_FIELD_REGISTRY } = require('../utils/encryptedFieldRegistry');
const participantIdentityService = require('../services/participantIdentity.service');

function isEnvelope(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

async function collectionFor(db, entry) {
  return entry.collectionKey ? getCollection(db, entry.collectionKey) : db.collection(entry.collectionName);
}

function buildEncryptionWorklistQuery(cipherFields, activeKeyId, all) {
  if (all) {
    return { $or: cipherFields.map((field) => ({ [field]: { $type: 'object' } })) };
  }
  return {
    $or: cipherFields.flatMap((field) => [
      { [`${field}.keyId`]: { $exists: true, $ne: activeKeyId } },
      // An envelope with no keyId at all decrypts only through the
      // fallback loop, so it is under no particular key: rewrite it.
      { [field]: { $type: 'object' }, [`${field}.keyId`]: { $exists: false } },
    ]),
  };
}

function blindIndexUpdates(entry, doc, plain) {
  if (entry.blindIndexes !== 'participantIdentity') return {};
  const updates = {};
  for (const [plainField, hashField] of Object.entries(participantIdentityService.getHashFieldMap())) {
    const value = hasValue(plain[plainField]) ? plain[plainField] : doc[plainField];
    if (!hasValue(value)) continue;
    const hash = participantIdentityService.computeBlindIndex(plainField, value);
    if (hash && hash !== doc[hashField]) updates[hashField] = hash;
  }
  return updates;
}

async function rewriteEntry(db, entry, { apply, all, activeKeyId }) {
  const collection = await collectionFor(db, entry);
  const cipherFields = Object.values(entry.fields);
  const docs = await collection.find(buildEncryptionWorklistQuery(cipherFields, activeKeyId, all)).toArray();
  const summary = { candidates: docs.length, rewritten: 0, unreadable: 0, changedMeanwhile: 0 };

  for (const doc of docs) {
    const set = {};
    const guard = { _id: doc._id };
    const plain = {};
    let unreadable = false;

    for (const [plainField, cipherField] of Object.entries(entry.fields)) {
      const envelope = doc[cipherField];
      if (!isEnvelope(envelope)) continue;

      const value = decryptValue(envelope);
      if (value === null || value === undefined) {
        unreadable = true;
        break;
      }
      plain[plainField] = value;

      if (all || envelope.keyId !== activeKeyId) {
        set[cipherField] = encryptValue(value);
        guard[`${cipherField}.iv`] = envelope.iv;
      }
    }

    if (unreadable) {
      summary.unreadable += 1;
      continue;
    }

    Object.assign(set, blindIndexUpdates(entry, doc, plain));
    if (entry.keyVersionField && cipherFields.some((field) => set[field])) {
      set[entry.keyVersionField] = activeKeyId;
    }
    if (Object.keys(set).length === 0) continue;

    if (!apply) {
      summary.rewritten += 1;
      continue;
    }

    const result = await collection.updateOne(guard, { $set: set });
    if (result.matchedCount === 1) summary.rewritten += 1;
    else summary.changedMeanwhile += 1;
  }

  return summary;
}

/** Rows of any collection whose file envelope names another key. */
async function countFileRowsUnderOtherKey(db, activeKeyId) {
  const counts = {};
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const count = await db.collection(name).countDocuments({
      encryptionKeyId: { $exists: true, $nin: [null, activeKeyId] },
    });
    if (count > 0) counts[name] = count;
  }
  return counts;
}

async function rewriteEncryptedFields(db, { apply = false, all = false, registry = ENCRYPTED_FIELD_REGISTRY } = {}) {
  if (!keyRegistry.getActiveKey()) {
    throw new Error('ENCRYPTION_KEY nao configurada: nada a reescrever sob uma chave ativa.');
  }
  const activeKeyId = keyRegistry.getActiveKeyId();

  const fields = {};
  for (const entry of registry) {
    const label = entry.collectionKey || entry.collectionName;
    fields[label] = await rewriteEntry(db, entry, { apply, all, activeKeyId });
  }
  const fileRowsUnderOtherKey = await countFileRowsUnderOtherKey(db, activeKeyId);

  // Only a plain dry run can say the slot is safe: its candidates are
  // exactly the documents still under another key. An --apply run reports
  // what it did, and the dry run after it gives the verdict.
  const nothingLeft = Object.values(fields).every((s) => s.candidates === 0 && s.unreadable === 0);
  return {
    mode: apply ? 'apply' : 'dry-run',
    activeKeyId,
    fields,
    fileRowsUnderOtherKey,
    safeToEmptyPreviousSlot: !apply && !all && nothingLeft && Object.keys(fileRowsUnderOtherKey).length === 0,
  };
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await rewriteEncryptedFields(db, { apply: argv.includes('--apply'), all: argv.includes('--all') });
  console.log(JSON.stringify(summary, null, 2));
  if (Object.values(summary.fields).some((s) => s.unreadable > 0)) process.exitCode = 1;
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao reescrever campos cifrados:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { rewriteEncryptedFields, buildEncryptionWorklistQuery, run };
