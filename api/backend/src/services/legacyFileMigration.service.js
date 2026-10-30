/**
 * #1419: move the binary of a DataFile row written before the object store
 * (no storageObjectVersion, a label storageUri, the ciphertext at storagePath
 * on disk) into the object store, so the key-rotation rewrite can reach it
 * (docs/decisions/2026-10-30-data-file-legacy-disk-rows-migration.md).
 *
 * It acts on positive evidence: a row is migrated only when its storagePath
 * is a regular file inside a storage root, it names an owner, it carries an
 * envelope, a registered key opens the bytes and the plaintext matches the
 * row's checksum. Any other row is counted and left untouched. The bytes are
 * put unchanged, so the envelope stays valid; re-keying is the rewrite's job.
 * The disk file is never removed or changed.
 */
const fs = require('fs');
const path = require('path');
const { decryptFileBuffer, computeChecksum } = require('../utils/fileCrypto');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { STORAGE_BASE, UPLOADS_BASE } = require('../config/uploadConfig');

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

// Each DataFile collection, with the area and owner field its upload puts
// under (sample-file.controller.js, createLinkedFileController.js).
const LEGACY_FILE_COLLECTIONS = Object.freeze([
  { name: 'sample_files', area: 'samples', ownerField: 'sampleID' },
  { name: 'assayFiles', area: 'assays', ownerField: 'assayId' },
  { name: 'datasetFiles', area: 'datasets', ownerField: 'datasetId' }
]);

function emptySummary() {
  return {
    candidates: 0,
    migrated: 0,
    versionsMigrated: 0,
    outsideRoots: 0,
    fileMissing: 0,
    notEncrypted: 0,
    unreadable: 0,
    noOwner: 0,
    changedMeanwhile: 0
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function realRoots(roots) {
  return roots.flatMap((root) => {
    try {
      return [fs.realpathSync(root)];
    } catch (_error) {
      return [];
    }
  });
}

// The bytes at storagePath, or the outcome that leaves the row: a path that
// is not a string, resolves outside every root or is a symlink is
// outsideRoots, and one that does not exist is fileMissing.
function readDiskFile(storagePath, roots) {
  if (!isNonEmptyString(storagePath)) return { outcome: 'outsideRoots' };
  let real;
  let stat;
  try {
    real = fs.realpathSync(storagePath);
    stat = fs.lstatSync(storagePath);
  } catch (error) {
    return { outcome: error && error.code === 'ENOENT' ? 'fileMissing' : 'outsideRoots' };
  }
  const inside = roots.some((root) => real.startsWith(root + path.sep));
  if (!inside || !stat.isFile()) return { outcome: 'outsideRoots' };
  return { bytes: fs.readFileSync(real) };
}

function ownerOf(row, ownerField) {
  const owner = row[ownerField];
  if (isNonEmptyString(owner) || (typeof owner === 'number' && Number.isFinite(owner))) return String(owner);
  return null;
}

function hasEnvelope(row) {
  return isNonEmptyString(row.encryptionKeyId) && isNonEmptyString(row.encryptionIv) && isNonEmptyString(row.encryptionTag);
}

function opensToChecksum(bytes, row) {
  let plaintext;
  try {
    plaintext = decryptFileBuffer(bytes, row);
  } catch (_error) {
    return false;
  }
  return isNonEmptyString(row.checksum) && CHECKSUM_PATTERN.test(row.checksum) && computeChecksum(plaintext) === row.checksum;
}

async function migrateLegacyFileBinaries(db, { apply = false, objectStore, roots = [STORAGE_BASE, UPLOADS_BASE] } = {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const versionsName = CANONICAL_COLLECTIONS.dataFileVersions;
  const versions = existing.has(versionsName) ? db.collection(versionsName) : null;
  const resolvedRoots = realRoots(roots);
  let store = null;
  const resolveStore = () => {
    if (!store) store = objectStore || require('../infrastructure/objectStorage').getFileObjectStore();
    return store;
  };

  const summaries = {};
  for (const { name, area, ownerField } of LEGACY_FILE_COLLECTIONS) {
    const summary = emptySummary();
    summaries[name] = summary;
    if (!existing.has(name)) continue;

    const collection = db.collection(name);
    // Mongo's null matches a null or absent field; a logically deleted row
    // is included, since its binary is kept evidence.
    const rows = await collection.find({ storageObjectVersion: null }).toArray();
    summary.candidates = rows.length;

    for (const row of rows) {
      const disk = readDiskFile(row.storagePath, resolvedRoots);
      if (disk.outcome) {
        summary[disk.outcome] += 1;
        continue;
      }
      const owner = ownerOf(row, ownerField);
      if (owner === null) {
        summary.noOwner += 1;
        continue;
      }
      if (!hasEnvelope(row)) {
        summary.notEncrypted += 1;
        continue;
      }
      if (!opensToChecksum(disk.bytes, row)) {
        summary.unreadable += 1;
        continue;
      }

      // Only the version rows holding this binary under this envelope move
      // with it; any other legacy version row stays as it is.
      const versionRows = versions
        ? await versions.find({ fileId: String(row._id), objectUri: row.storageUri, encryptionIv: row.encryptionIv }).toArray()
        : [];

      if (!apply) {
        summary.migrated += 1;
        summary.versionsMigrated += versionRows.length;
        continue;
      }

      let stored;
      try {
        stored = await resolveStore().putObject({ area, ownerKey: owner, body: disk.bytes });
      } catch (error) {
        if (error && error.code === 'OBJECT_CONFLICT') {
          summary.unreadable += 1;
          continue;
        }
        throw error;
      }

      // The version rows move first and the file row last: a run that stops
      // in between leaves the file row a candidate, so a rerun finishes it.
      let versionMissed = false;
      for (const version of versionRows) {
        const moved = await versions.updateOne(
          { _id: version._id, objectUri: version.objectUri, encryptionIv: version.encryptionIv },
          { $set: { objectUri: stored.uri } }
        );
        if (moved.matchedCount === 1) summary.versionsMigrated += 1;
        else versionMissed = true;
      }
      if (versionMissed) {
        summary.changedMeanwhile += 1;
        continue;
      }

      const guard = {
        _id: row._id,
        storagePath: row.storagePath,
        storageUri: row.storageUri,
        encryptionIv: row.encryptionIv,
        storageObjectVersion: null
      };
      const result = await collection.updateOne(guard, {
        $set: { storageUri: stored.uri, storageObjectVersion: stored.version, storagePath: stored.path }
      });
      if (result.matchedCount === 1) summary.migrated += 1;
      else summary.changedMeanwhile += 1;
    }
  }
  return summaries;
}

module.exports = { migrateLegacyFileBinaries, LEGACY_FILE_COLLECTIONS };
