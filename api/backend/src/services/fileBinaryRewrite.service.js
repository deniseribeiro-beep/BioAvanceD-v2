/**
 * #1321: re-encrypt the DataFile binaries held in the object store under the
 * active key, so a key rotation can retire the previous slot on a stack that
 * stored files before it (docs/decisions/2026-10-24-data-file-key-rotation-rewrite.md).
 *
 * The rewrite reads and writes through the object-store interface only, so
 * it works the same under either OBJECT_STORE_DRIVER. It acts on positive
 * evidence: a row is rewritten only when its URI names a store object, the
 * object is read, a registered key opens it and the plaintext matches the
 * row's checksum. Any other row is counted and left untouched. The old
 * object is never deleted: the stores have no delete.
 */
const { encryptFileBuffer, decryptFileBuffer, computeChecksum } = require('../utils/fileCrypto');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { FILE_ACCESS_COLLECTIONS } = require('./dataFileAccessToken.service');
const {
  OBJECT_URI_PATTERN,
  PLAIN_OWNER_PATTERN,
  isValidSegment
} = require('../infrastructure/objectStorage/filesystemObjectStore');

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

// The DataFile collections, then their version rows: a file row and its
// latest version row share one object, and the file row is rewritten first.
function fileCollections() {
  return [
    ...Object.keys(FILE_ACCESS_COLLECTIONS).map((name) => ({ name, isVersion: false })),
    { name: CANONICAL_COLLECTIONS.dataFileVersions, isVersion: true }
  ];
}

function emptySummary() {
  return { candidates: 0, rewritten: 0, unreadable: 0, objectMissing: 0, notInObjectStore: 0, changedMeanwhile: 0 };
}

// The area and owner segment of a URI the stores' getObject accepts, or null.
function parseStoredUri(uri) {
  const match = typeof uri === 'string' ? OBJECT_URI_PATTERN.exec(uri) : null;
  if (!match || !isValidSegment(match[1]) || !PLAIN_OWNER_PATTERN.test(match[2])) return null;
  return { area: match[1], owner: match[2] };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

async function readPlaintext(store, uri, row) {
  let bytes;
  try {
    bytes = await store.getObject(uri);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { outcome: 'objectMissing' };
    if (error && error.code === 'OBJECT_CONFLICT') return { outcome: 'unreadable' };
    throw error;
  }
  let plaintext;
  try {
    plaintext = decryptFileBuffer(bytes, row);
  } catch (_error) {
    return { outcome: 'unreadable' };
  }
  const checksumMatches = isNonEmptyString(row.checksum) && CHECKSUM_PATTERN.test(row.checksum) && row.checksum === computeChecksum(plaintext);
  if (!checksumMatches) return { outcome: 'unreadable' };
  return { plaintext };
}

async function rewriteFileBinaries(db, { apply = false, all = false, activeKeyId, objectStore } = {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const query = all
    ? { encryptionKeyId: { $exists: true, $ne: null } }
    : { encryptionKeyId: { $exists: true, $nin: [null, activeKeyId] } };
  let store = null;
  const resolveStore = () => {
    if (!store) store = objectStore || require('../infrastructure/objectStorage').getFileObjectStore();
    return store;
  };
  // Per run: a row holding the same object under the same envelope as one
  // already rewritten goes onto that row's new object.
  const written = new Map();

  const summaries = {};
  for (const { name, isVersion } of fileCollections()) {
    const summary = emptySummary();
    summaries[name] = summary;
    if (!existing.has(name)) continue;

    const collection = db.collection(name);
    const rows = await collection.find(query).toArray();
    summary.candidates = rows.length;

    for (const row of rows) {
      const uri = isVersion ? row.objectUri : row.storageUri;
      const location = parseStoredUri(uri);
      if (!location || (!isVersion && !isNonEmptyString(row.storageObjectVersion))) {
        summary.notInObjectStore += 1;
        continue;
      }

      const read = await readPlaintext(resolveStore(), uri, row);
      if (read.outcome) {
        summary[read.outcome] += 1;
        continue;
      }

      if (!apply) {
        summary.rewritten += 1;
        continue;
      }

      const memoKey = `${uri}\n${row.encryptionIv}`;
      let target = written.get(memoKey);
      if (!target) {
        const encryption = encryptFileBuffer(read.plaintext);
        const stored = await resolveStore().putObject({ area: location.area, owner: location.owner, body: encryption.ciphertext });
        target = { stored, encryption };
        written.set(memoKey, target);
      }
      const { stored, encryption } = target;

      // The guard is the row as read, never the memo: a write that landed
      // in between is counted, not overwritten.
      const guard = isVersion
        ? { _id: row._id, encryptionIv: row.encryptionIv, objectUri: row.objectUri }
        : { _id: row._id, encryptionIv: row.encryptionIv, storageUri: row.storageUri };
      const set = isVersion
        ? {
          objectUri: stored.uri,
          encryptionAlgorithm: encryption.algorithm,
          encryptionKeyId: encryption.keyId,
          encryptionIv: encryption.iv,
          encryptionTag: encryption.tag
        }
        : {
          storageUri: stored.uri,
          storageObjectVersion: stored.version,
          storagePath: stored.path,
          encryptionAlgorithm: encryption.algorithm,
          encryptionKeyId: encryption.keyId,
          encryptionIv: encryption.iv,
          encryptionTag: encryption.tag
        };
      const result = await collection.updateOne(guard, { $set: set });
      if (result.matchedCount === 1) summary.rewritten += 1;
      else summary.changedMeanwhile += 1;
    }
  }
  return summaries;
}

module.exports = { rewriteFileBinaries };
