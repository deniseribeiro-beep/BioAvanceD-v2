const StorageAssignmentModel = require('../models/StorageAssignment');

/**
 * #461 — one-time backfill: legacy `locations` (+ Sample.locationID
 * references) into the canonical StorageContainer/StorageBox/
 * StorageAssignment chain. Design/field mapping:
 * docs/architecture/legacy-location-migration-mapping.md.
 *
 * `locations` stays read-only — this only reads it, never writes back.
 * Safe to run more than once: containers/boxes are found-or-created by
 * their deterministic parent+name key, and an already-open
 * StorageAssignment for the same specimen/box/position is not duplicated.
 */
async function backfillLocationsToStorage(db) {
  const locationsCollection = db.collection('locations');
  const equipmentCollection = db.collection('equipment');
  const samplesCollection = db.collection('samples');
  const storageContainersCollection = db.collection('storageContainers');
  const storageBoxesCollection = db.collection('storageBoxes');
  const storageAssignmentsCollection = db.collection('storageAssignments');

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
    assignmentsCreated: 0,
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
        roomId: null,
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
        roomId: null,
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

    boxCache.set(cacheKey, box._id);
    return box._id;
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

    const boxId = await findOrCreateBox(boxParentId, location.box);
    locationIdToBoxId.set(location.locationID, boxId);

    const samples = await samplesCollection.find({ locationID: location.locationID }).toArray();
    for (const sample of samples) {
      const existing = await storageAssignmentsCollection.findOne({
        specimenId: String(sample._id),
        boxId: String(boxId),
        positionCode: location.wellPosition,
        removedAt: null,
      });
      if (existing) continue;

      const record = StorageAssignmentModel.open({
        specimenId: sample._id,
        boxId,
        positionCode: location.wellPosition,
        equipmentId: freezerId,
        shelfId,
        rackId,
        placedAt: sample.registeredAt || sample.receivedAt || sample.createdAt || undefined,
      });
      await storageAssignmentsCollection.insertOne(record);
      summary.assignmentsCreated += 1;
    }
  }

  return { summary, locationIdToBoxId };
}

module.exports = { backfillLocationsToStorage };
