const { ObjectId } = require('mongodb');

// RF027 AC#3 (#716 slice 2/4, dict-02 ELM-0332/0333): WorkflowRun's
// inputFileIds/outputFileIds are Reference[] to DataFile, but this repo
// has no single unified DataFile collection -- scientific files are
// stored per-parent (`sample_files`, `assayFiles`, `datasetFiles`,
// per sample-file.controller.js/assay-file.routes.js/dataset-file.routes.js).
// Resolves a fileId against all three, mirroring
// assayReferenceValidator.js's "existence only, no status gate" checks.
const FILE_COLLECTIONS = ['sample_files', 'assayFiles', 'datasetFiles'];

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  try {
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  } catch (err) {
    return null;
  }
  return null;
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} fileId
 * @returns {Promise<string|null>} the collection name the file was found in, or null
 */
async function resolveFileReference(db, fileId) {
  const objectId = toObjectId(fileId);
  if (!objectId) return null;

  for (const collectionName of FILE_COLLECTIONS) {
    const found = await db.collection(collectionName).findOne({ _id: objectId });
    if (found) return collectionName;
  }
  return null;
}

module.exports = { resolveFileReference, FILE_COLLECTIONS };
