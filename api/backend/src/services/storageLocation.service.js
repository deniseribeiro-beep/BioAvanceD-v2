const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const StorageLocationModel = require('../models/StorageLocation');
const { ensureStorageLocationIndexes } = require('../utils/physicalChainIndexes');

// #1314 (RF017 AC1/AC3/AC8): the StorageLocation records a rack is located
// at. A location belongs to one organization, and so does every location
// under it. A location is usable only while it and every ancestor are
// active, so interdicting a room blocks the freezers in it.

class StorageLocationError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'StorageLocationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// A hierarchy deeper than this is a cycle written around the model, not a
// real building.
const MAX_DEPTH = 32;
const ensuredDbs = new WeakSet();

async function ensureLocationIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await ensureStorageLocationIndexes(await getCollection(db, 'storageLocations'));
  } catch (error) {
    logger.warn(`[STORAGE_LOCATION] Falha ao criar índices: ${error.message}`);
  }
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

async function findLocation(db, storageLocationId, session) {
  const location = await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(storageLocationId) }, sessionOptions(session));
  if (!location) {
    throw new StorageLocationError(`Local ${storageLocationId} não encontrado`, 'LOCATION_NOT_FOUND', 404);
  }
  return location;
}

// Given a session, every read and the write run in the caller's
// transaction, and no index is built beside it (physicalChain.service.js).
async function createLocation(db, data, { session } = {}) {
  if (!session) await ensureLocationIndexes(db);
  let location;
  try {
    location = StorageLocationModel.create(data);
  } catch (error) {
    throw new StorageLocationError(error.message, 'VALIDATION_ERROR', 422);
  }
  const organization = await (await getCollection(db, 'organizations')).findOne({ organizationId: location.organizationId }, sessionOptions(session));
  if (!organization) {
    throw new StorageLocationError(`Organização ${location.organizationId} não encontrada`, 'ORGANIZATION_NOT_FOUND', 404);
  }
  if (location.parentLocationId) {
    const parent = await findLocation(db, location.parentLocationId, session);
    try {
      StorageLocationModel.assertParentCompatible(location, parent);
    } catch (error) {
      throw new StorageLocationError(error.message, 'VALIDATION_ERROR', 422);
    }
  }
  // The unique index refuses a concurrent duplicate; this check answers the
  // plain one where the index could not be built.
  const locations = await getCollection(db, 'storageLocations');
  if (await locations.findOne({ storageLocationId: location.storageLocationId }, sessionOptions(session))) {
    throw new StorageLocationError(`Local ${location.storageLocationId} já existe`, 'LOCATION_EXISTS', 409);
  }
  try {
    await locations.insertOne(location, sessionOptions(session));
  } catch (error) {
    if (error?.code === 11000) throw new StorageLocationError(`Local ${location.storageLocationId} já existe`, 'LOCATION_EXISTS', 409);
    throw error;
  }
  return location;
}

// P1X-0101: a code is unique under its parent, so the location carrying
// this code under this parent is the one, if any; else it is created.
async function findOrCreateLocationByCode(db, data, session) {
  const code = data?.code ? String(data.code).trim() : null;
  const parentLocationId = data?.parentLocationId ? String(data.parentLocationId) : null;
  if (code) {
    const existing = await (await getCollection(db, 'storageLocations')).findOne({ code, parentLocationId }, sessionOptions(session));
    if (existing) return existing;
  }
  return createLocation(db, data, { session });
}

// RF017 AC8: the status moves; the record and its hierarchy stay. The route
// audits each change, which is the location's history.
async function setLocationStatus(db, storageLocationId, locationStatus) {
  const current = { ...(await findLocation(db, storageLocationId)) };
  const next = locationStatus ? String(locationStatus).toLowerCase() : null;
  try {
    StorageLocationModel.assertStatus(next);
  } catch (error) {
    throw new StorageLocationError(error.message, 'VALIDATION_ERROR', 422);
  }
  await (await getCollection(db, 'storageLocations')).updateOne(
    { storageLocationId: current.storageLocationId },
    { $set: { locationStatus: next } }
  );
  return { ...current, locationStatus: next, previousStatus: current.locationStatus };
}

// RF017 AC8: why a rack may not be located here, or null when it may. The
// first unusable location on the way up is named.
async function locationUsabilityRefusal(db, storageLocationId) {
  const locations = await getCollection(db, 'storageLocations');
  let id = String(storageLocationId);
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const location = await locations.findOne({ storageLocationId: id });
    if (!location) {
      return depth === 0 ? `Local ${id} não encontrado` : `Local ancestral ${id} não encontrado`;
    }
    if (!StorageLocationModel.isUsable(location)) {
      return depth === 0
        ? `Local ${id} está ${location.locationStatus}`
        : `Local ancestral ${id} está ${location.locationStatus}`;
    }
    if (!location.parentLocationId) return null;
    id = String(location.parentLocationId);
  }
  return `Hierarquia do local ${storageLocationId} excede ${MAX_DEPTH} níveis`;
}

// The locations a caller sees: every one for a global caller, else those of
// the caller's organizations.
async function listLocations(db, organizationScope) {
  const locations = await getCollection(db, 'storageLocations');
  if (organizationScope.scope === 'global') return locations.find({}).toArray();
  if (!organizationScope.organizationIds.length) return [];
  return locations.find({ $or: organizationScope.organizationIds.map((organizationId) => ({ organizationId: String(organizationId) })) }).toArray();
}

module.exports = {
  StorageLocationError,
  ensureLocationIndexes,
  findLocation,
  createLocation,
  findOrCreateLocationByCode,
  setLocationStatus,
  locationUsabilityRefusal,
  listLocations,
};
