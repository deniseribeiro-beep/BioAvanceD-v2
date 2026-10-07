const mongo = require('../database/mongo');
const stagingImportIndexes = require('../utils/stagingImportIndexes');

/**
 * #830: the `stagingImports` collection, on the native driver.
 *
 * This used to be a Mongoose model (models/StagingImport.js) while every
 * other collection in the import path went through the native driver. That
 * mixture is what made #826 process-dependent: a Mongoose model with no
 * Mongoose connection does not throw, it BUFFERS and rejects after 10s, so
 * the API worked (its upload path happened to connect Mongoose) and the
 * worker retried forever. On the native driver there is one connection
 * concept, and no connection is a loud failure at the call.
 *
 * The call shapes are the ones the model had -- `create(doc)`,
 * `findOne(filter)`, `updateOne(filter, update)` -- so the call sites only
 * changed their require. What the schema used to do is done here instead:
 *
 *   - defaults (`status: 'staged'`, zero counters, empty `importErrors`) and
 *     `createdAt`/`updatedAt` timestamps on create, `updatedAt` on update;
 *   - `jobId`, `fileName` and `rawData` required, `jobId`/`fileName` trimmed;
 *   - `status` restricted to STATUSES, counters to non-negative numbers.
 *
 * One deliberate difference: the schema was `strict`, so a write to an
 * undeclared field was silently STRIPPED (#900 is that failure). Here a write
 * to a field outside FIELDS throws, so the same mistake is loud.
 *
 * `db` is optional everywhere: the worker and the API pass the handle they
 * already hold, and a caller without one gets the shared connection
 * database/mongo.js caches.
 */

const COLLECTION_NAME = 'stagingImports';

const STATUSES = Object.freeze(['staged', 'queued', 'processing', 'completed', 'failed']);

const FIELDS = Object.freeze([
  '_id',
  'jobId',
  'fileName',
  'status',
  'totalRows',
  'processedRows',
  'importErrors',
  'rawData',
  'createdAt',
  'updatedAt',
]);

const FIELD_SET = new Set(FIELDS);

async function collection(db) {
  const handle = db || await mongo.connectDB();
  const coll = handle.collection(COLLECTION_NAME);
  // Un-awaited and best-effort, as before (#941): the helper never rejects,
  // is latched per process, and jobId is a uuidv4 from the single writer.
  stagingImportIndexes.ensureStagingImportIndexes(coll);
  return coll;
}

function invalid(message) {
  const error = new Error(`StagingImport inválido: ${message}`);
  error.code = 'STAGING_IMPORT_INVALID';
  return error;
}

function assertKnownFields(keys, where) {
  const unknown = keys
    .map((key) => String(key).split('.')[0])
    .filter((key) => !FIELD_SET.has(key));
  if (unknown.length > 0) {
    throw invalid(`campo(s) não declarado(s) em ${where}: ${unknown.join(', ')}`);
  }
}

function assertStatus(status) {
  if (status !== undefined && !STATUSES.includes(status)) {
    throw invalid(`status '${status}' fora de ${STATUSES.join('|')}`);
  }
}

function assertCounter(name, value) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw invalid(`${name} deve ser um número >= 0`);
  }
}

/** Builds the stored document the schema used to produce. Exported for tests. */
function buildDocument(input = {}) {
  assertKnownFields(Object.keys(input), 'create');

  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : input.jobId;
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : input.fileName;
  if (!jobId) throw invalid('jobId é obrigatório');
  if (!fileName) throw invalid('fileName é obrigatório');
  if (input.rawData === undefined || input.rawData === null) throw invalid('rawData é obrigatório');

  const status = input.status === undefined ? 'staged' : input.status;
  assertStatus(status);
  const totalRows = input.totalRows === undefined ? 0 : input.totalRows;
  const processedRows = input.processedRows === undefined ? 0 : input.processedRows;
  assertCounter('totalRows', totalRows);
  assertCounter('processedRows', processedRows);

  const now = new Date();
  return {
    jobId,
    fileName,
    status,
    totalRows,
    processedRows,
    importErrors: Array.isArray(input.importErrors) ? input.importErrors : [],
    rawData: input.rawData,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

async function create(input, db = null) {
  const doc = buildDocument(input);
  const coll = await collection(db);
  const result = await coll.insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function findOne(filter, db = null) {
  const coll = await collection(db);
  return coll.findOne(filter);
}

async function updateOne(filter, update = {}, db = null) {
  const set = { ...(update.$set || {}) };
  for (const operator of Object.keys(update)) {
    if (!operator.startsWith('$')) throw invalid(`update sem operador: ${operator}`);
    assertKnownFields(Object.keys(update[operator] || {}), operator);
  }
  assertStatus(set.status);
  assertCounter('totalRows', set.totalRows);
  assertCounter('processedRows', set.processedRows);
  if (!set.updatedAt) set.updatedAt = new Date();

  const coll = await collection(db);
  return coll.updateOne(filter, { ...update, $set: set });
}

module.exports = {
  COLLECTION_NAME,
  STATUSES,
  FIELDS,
  buildDocument,
  create,
  findOne,
  updateOne,
};
