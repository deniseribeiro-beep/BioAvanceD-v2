/**
 * RF007 AC4, RNF029 C3 (#1321): a file replace writes DataFileVersion rows
 * (V2E-0346..0353) and keeps the superseded binary as evidence
 * (docs/decisions/2026-10-22-data-file-versions.md).
 *
 * The first replace of a file also writes a baseline version 1 for the
 * binary it supersedes, since an upload writes no version row.
 */
const DataFileVersionModel = require('../models/DataFileVersion');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const logger = require('../utils/logger');

const BASELINE_CHANGE_REASON = 'initial upload';
const DEFAULT_CHANGE_REASON = 'replacement';

function versionsCollection(db) {
  return db.collection(CANONICAL_COLLECTIONS.dataFileVersions);
}

async function recordReplacement(db, { fileRecord, storageUri, checksum, encryption, changeReason, now = new Date() }) {
  const coll = versionsCollection(db);
  const fileId = String(fileRecord._id);

  let latest = await coll.findOne({ fileId }, { sort: { versionNumber: -1 } });
  let baseline = null;
  if (!latest) {
    baseline = DataFileVersionModel.create({
      fileId,
      versionNumber: 1,
      objectUri: fileRecord.storageUri,
      checksum: fileRecord.checksum,
      encryptionAlgorithm: fileRecord.encryptionAlgorithm,
      encryptionKeyId: fileRecord.encryptionKeyId,
      encryptionIv: fileRecord.encryptionIv,
      encryptionTag: fileRecord.encryptionTag,
      previousVersionId: null,
      changeReason: BASELINE_CHANGE_REASON,
      createdAt: fileRecord.uploadDate || fileRecord.createdAt || now,
    });
    await coll.insertOne(baseline);
    latest = baseline;
  }

  const version = DataFileVersionModel.create({
    fileId,
    versionNumber: latest.versionNumber + 1,
    objectUri: storageUri,
    checksum,
    encryptionAlgorithm: encryption ? encryption.algorithm : null,
    encryptionKeyId: encryption ? encryption.keyId : null,
    encryptionIv: encryption ? encryption.iv : null,
    encryptionTag: encryption ? encryption.tag : null,
    previousVersionId: latest.dataFileVersionId,
    changeReason,
    createdAt: now,
  });
  await coll.insertOne(version);

  return { baseline, version };
}

/** Best effort: removes a version row whose DataFile update failed. */
async function discardVersion(db, version) {
  try {
    await versionsCollection(db).deleteOne({ dataFileVersionId: version.dataFileVersionId });
  } catch (error) {
    logger.error('Erro ao remover DataFileVersion após falha na substituição:', error.message);
  }
}

// INFERENCE, not a citation: changeReason is Core (V2E-0352) but the replace
// form need not send it, so an omitted value is defaulted server-side, the
// way uploadFile defaults an omitted fileRole to 'raw'.
function resolveChangeReason(body) {
  const value = body && body.changeReason;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return DEFAULT_CHANGE_REASON;
}

module.exports = {
  BASELINE_CHANGE_REASON,
  DEFAULT_CHANGE_REASON,
  recordReplacement,
  discardVersion,
  resolveChangeReason,
};
