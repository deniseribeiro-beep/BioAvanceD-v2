const { ensureStorageContainerIndexes, ensureStorageBoxIndexes } = require('../utils/storageIndexes');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const physicalChain = require('./physicalChain.service');
const { ensureLocationIndexes } = require('./storageLocation.service');
const { placeSpecimen, currentPlacement, chainPositionCode } = require('./legacyPlacementChain.service');

/**
 * #461 — one-time backfill: legacy `locations` (+ Sample.locationID
 * references) into the StorageContainer/StorageBox topology. Design/field
 * mapping: docs/architecture/legacy-location-migration-mapping.md.
 *
 * #1374 (RULE-026): each Sample.locationID specimen is placed on the
 * physical chain through legacyPlacementChain.service.js, one transaction
 * per specimen; no legacy placement row is written. Every index is built
 * before the first transaction.
 *
 * `locations` stays read-only — this only reads it, never writes back.
 * Safe to run more than once: containers/boxes are found-or-created by
 * their deterministic parent+name key, and a specimen the chain already
 * places, or has released, is not placed again.
 */
async function backfillLocationsToStorage(db) {
  const locationsCollection = db.collection('locations');
  const equipmentCollection = db.collection('equipment');
  const samplesCollection = db.collection('samples');
  const storageContainersCollection = db.collection('storageContainers');
  await ensureStorageContainerIndexes(storageContainersCollection);
  const storageBoxesCollection = db.collection('storageBoxes');
  await ensureStorageBoxIndexes(storageBoxesCollection);
  await physicalChain.ensurePhysicalChainIndexes(db);
  await ensureLocationIndexes(db);

  const locations = await locationsCollection.find({}).toArray();

  const freezerCache = new Map();
  const containerCache = new Map();
  const boxCache = new Map();
  const locationIdToBoxId = new Map();

  const summary = {
    locationsProcessed: 0,
    freezersCreated: 0,
    shelvesCreated: 0,
    racksCreated: 0,
    drawersCreated: 0,
    boxesCreated: 0,
    specimensPlaced: 0,
    alreadyPlaced: 0,
    skipped: [],
  };

  async function findOrCreateFreezer(equipmentID) {
    if (freezerCache.has(equipmentID)) return freezerCache.get(equipmentID);

    let freezer = await storageContainersCollection.findOne({
      containerType: 'FREEZER',
      containerID: equipmentID,
    });

    if (!freezer) {
      const equipment = await equipmentCollection.findOne({ equipmentID });
      const now = new Date();
      const doc = {
        containerID: equipmentID,
        name: equipment?.name || equipment?.equipmentDescription || `Equipment ${equipmentID}`,
        description: null,
        containerType: 'FREEZER',
        parent_id: null,
        temperature: null,
        temperatureUnit: 'CELSIUS',
        capacity: null,
        status: 'OPERATIONAL',
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const result = await storageContainersCollection.insertOne(doc);
      freezer = { _id: result.insertedId, ...doc };
      summary.freezersCreated += 1;
    }

    freezerCache.set(equipmentID, freezer._id);
    return freezer._id;
  }

  async function findOrCreateContainer(parentId, containerType, value, counterKey) {
    const cacheKey = `${parentId}:${containerType}:${value}`;
    if (containerCache.has(cacheKey)) return containerCache.get(cacheKey);

    const name = `${containerType} ${value}`;
    let container = await storageContainersCollection.findOne({
      parent_id: parentId,
      containerType,
      name,
    });

    if (!container) {
      const now = new Date();
      const doc = {
        name,
        description: null,
        containerType,
        parent_id: parentId,
        temperature: null,
        temperatureUnit: 'CELSIUS',
        capacity: null,
        status: 'OPERATIONAL',
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const result = await storageContainersCollection.insertOne(doc);
      container = { _id: result.insertedId, ...doc };
      summary[counterKey] += 1;
    }

    containerCache.set(cacheKey, container._id);
    return container._id;
  }

  async function findOrCreateBox(parentId, boxNumber) {
    const cacheKey = `${parentId}:${boxNumber}`;
    if (boxCache.has(cacheKey)) return boxCache.get(cacheKey);

    const name = `Box ${boxNumber}`;
    let box = await storageBoxesCollection.findOne({ parent_id: parentId, name });

    if (!box) {
      const now = new Date();
      // Legacy `locations` carries no box dimensions — default to the
      // schema's max grid so any backfilled wellPosition stays in bounds;
      // real dimensions land whenever a consumer migration (#462-#464)
      // next writes this box.
      const doc = {
        name,
        description: null,
        parent_id: parentId,
        dimension: { rows: 26, cols: 100 },
        occupancyGrid: {},
        currentOccupancy: 0,
        status: 'ACTIVE',
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        lastModified: now,
      };
      const result = await storageBoxesCollection.insertOne(doc);
      box = { _id: result.insertedId, ...doc };
      summary.boxesCreated += 1;
    }

    boxCache.set(cacheKey, box);
    return box;
  }

  for (const location of locations) {
    summary.locationsProcessed += 1;

    if (location.equipmentID === null || location.equipmentID === undefined) {
      summary.skipped.push({ locationID: location.locationID, reason: 'missing equipmentID' });
      continue;
    }
    if (location.rack === null || location.rack === undefined) {
      summary.skipped.push({ locationID: location.locationID, reason: 'missing rack' });
      continue;
    }

    const freezerId = await findOrCreateFreezer(location.equipmentID);
    // block==null backfills a single synthetic SHELF per freezer, per the
    // mapping doc — not a "no shelf" branch.
    const blockValue = location.block ?? 0;
    const shelfId = await findOrCreateContainer(freezerId, 'SHELF', blockValue, 'shelvesCreated');
    const rackId = await findOrCreateContainer(shelfId, 'RACK', location.rack, 'racksCreated');

    let boxParentId = rackId;
    if (location.drawer !== null && location.drawer !== undefined) {
      boxParentId = await findOrCreateContainer(rackId, 'DRAWER', location.drawer, 'drawersCreated');
    }

    if (location.box === null || location.box === undefined) {
      summary.skipped.push({ locationID: location.locationID, reason: 'missing box' });
      continue;
    }

    const box = await findOrCreateBox(boxParentId, location.box);
    locationIdToBoxId.set(location.locationID, box._id);

    const samples = await samplesCollection.find({ locationID: location.locationID }).toArray();
    for (const sample of samples) {
      const specimenId = String(sample.specimenId || sample._id);
      const skip = (reason) => summary.skipped.push({ locationID: location.locationID, specimenId, reason });

      if (!String(location.wellPosition ?? '').trim()) {
        skip('missing wellPosition');
        continue;
      }

      const current = await currentPlacement(db, sample);
      if (current) {
        const samePlace = String(current.boxId) === String(box._id)
          && chainPositionCode(current.positionCode) === chainPositionCode(location.wellPosition);
        if (!samePlace) {
          skip(`already placed at ${current.boxId}/${current.positionCode}`);
          continue;
        }
        if (current.source === 'physical_chain') {
          summary.alreadyPlaced += 1;
          continue;
        }
      } else if (await physicalChain.openSpecimenAssignment(db, specimenId)) {
        // Loaded and not placed: released on the chain. A stale locationID
        // must not place it again.
        skip('released on the chain');
        continue;
      }

      // A legacy row at this box and position is placed from its own
      // instant, so migrate:storage-assignments-to-chain recognises it.
      const at = current?.placedAt || sample.registeredAt || sample.receivedAt || sample.createdAt || undefined;
      try {
        await withTransactionWhereSupported(db, (session) => placeSpecimen(db, {
          sample,
          box,
          position: location.wellPosition,
          at,
          sourceEventId: `legacy-location-backfill:${location.locationID}:${String(sample._id)}`,
        }, session));
      } catch (error) {
        skip(error.message);
        continue;
      }
      summary.specimensPlaced += 1;
    }
  }

  return { summary, locationIdToBoxId };
}

module.exports = { backfillLocationsToStorage };
