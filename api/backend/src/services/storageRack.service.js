const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const logger = require('../utils/logger');
const StorageRackModel = require('../models/StorageRack');
const { ensureStorageRackIndexes, ensureStoragePositionIndexes } = require('../utils/physicalChainIndexes');

// #1513 (RF016 AC2): a rack and its grid as separate records. Creating a
// rack writes its StorageRack row and one StoragePosition row per cell of
// its grid, 96 for the approved 8x12 fixture, in one transaction wherever
// one runs. The grid is the model's (StorageRack.positionsOf); this service
// only persists and reads it back.

class StorageRackError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'StorageRackError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// The StorageRack fields a caller may give; the rest is the model's.
const RACK_FIELDS = [
  'storageRackId', 'rackType', 'rowCount', 'columnCount', 'coordinateScheme',
  'orientationRule', 'storageLocationId', 'catalogReference', 'status',
];

const ensuredDbs = new WeakSet();

// Latched before the await: a persistent failure is logged once, and the
// find-then-insert check still answers a plain duplicate without it.
async function ensureRackIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await ensureStorageRackIndexes(await getCollection(db, 'storageRacks'));
    await ensureStoragePositionIndexes(await getCollection(db, 'storagePositions'));
  } catch (error) {
    logger.warn(`[STORAGE_RACK] Falha ao criar índices: ${error.message}`);
  }
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

function rackExists(storageRackId) {
  return new StorageRackError(`Rack ${storageRackId} já existe`, 'RACK_EXISTS', 409);
}

// A given field overrides the approved fixture; an absent, undefined or
// null one leaves the fixture's value, since createApprovedFixture spreads
// the data over it.
function givenFields(data) {
  const given = {};
  for (const field of RACK_FIELDS) {
    if (data[field] !== undefined && data[field] !== null) given[field] = data[field];
  }
  return given;
}

async function createRack(db, data = {}) {
  // Before any transaction: an index build beside an open one is a write
  // conflict.
  await ensureRackIndexes(db);
  // A given id is a non-empty string: a number would key a grid no read
  // reaches, and an object would reach findOne as a query operator.
  const { storageRackId } = data;
  if (storageRackId !== undefined && storageRackId !== null && (typeof storageRackId !== 'string' || storageRackId.trim() === '')) {
    throw new StorageRackError('storageRackId deve ser um texto não vazio', 'VALIDATION_ERROR', 422);
  }
  let rack;
  let positions;
  try {
    rack = StorageRackModel.createApprovedFixture(givenFields(data));
    positions = StorageRackModel.positionsOf(rack);
  } catch (error) {
    throw new StorageRackError(error.message, 'VALIDATION_ERROR', 422);
  }
  await withTransactionWhereSupported(db, async (session) => {
    const racks = await getCollection(db, 'storageRacks');
    // The unique index refuses a concurrent duplicate; this check answers
    // the plain one where the index could not be built.
    if (await racks.findOne({ storageRackId: rack.storageRackId }, sessionOptions(session))) {
      throw rackExists(rack.storageRackId);
    }
    try {
      // Copies, so the driver's _id never reaches the response.
      await racks.insertOne({ ...rack }, sessionOptions(session));
      await (await getCollection(db, 'storagePositions')).insertMany(positions.map((position) => ({ ...position })), sessionOptions(session));
    } catch (error) {
      if (error?.code === 11000) throw rackExists(rack.storageRackId);
      throw error;
    }
  });
  return { ...rack, positionCount: positions.length };
}

async function findRack(db, storageRackId) {
  const rack = await (await getCollection(db, 'storageRacks')).findOne({ storageRackId: String(storageRackId) });
  if (!rack) {
    throw new StorageRackError(`Rack ${storageRackId} não encontrado`, 'RACK_NOT_FOUND', 404);
  }
  return rack;
}

// The rack's positions in top_left_origin order: row A first, columns 01
// upwards within a row.
async function listRackPositions(db, storageRackId) {
  const rows = await (await getCollection(db, 'storagePositions')).find({ storageRackId: String(storageRackId) }).toArray();
  return rows
    .map(({ _id, ...position }) => position)
    .sort((a, b) => (a.rowIndex - b.rowIndex) || (a.columnIndex - b.columnIndex));
}

module.exports = {
  StorageRackError,
  ensureRackIndexes,
  createRack,
  findRack,
  listRackPositions,
};
