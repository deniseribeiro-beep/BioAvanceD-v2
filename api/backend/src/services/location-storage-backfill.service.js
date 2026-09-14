const { ensureStorageConfigurationIndexes } = require('../utils/storageIndexes');
const NormalizedPhysicalStorageStore = require('../infrastructure/persistence/mongo/NormalizedPhysicalStorageStore');

/**
 * One-time migration from legacy `locations` into physical-storage v2.
 *
 * Legacy locations stay read-only. StorageContainer/StorageBox are retained
 * as migration/layout sources, while the resulting specimen placement is
 * written exclusively through the normalized v2 assignment chain.
 */
async function backfillLocationsToStorage(db) {
  const locationsCollection = db.collection('locations');
  const equipmentCollection = db.collection('equipment');
  const samplesCollection = db.collection('samples');
  const storageContainersCollection = db.collection('storageContainers');
  const storageBoxesCollection = db.collection('storageBoxes');

  // #941: the migration writes the same governed configuration collections
  // as the runtime authoring surface. Complete their native index builds
  // before the first migrated row so the backfill cannot race the constraints.
  await ensureStorageConfigurationIndexes(db);

  const physicalStore = new NormalizedPhysicalStorageStore(db);
  await physicalStore.ensureIndexes();

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

  function equipmentIdVariants(value) {
    const text = String(value).trim();
    const variants = [text];
    const numeric = Number(text);
    if (Number.isFinite(numeric)) variants.push(numeric);
    return [...new Set(variants)];
  }

  async function findOrCreateFreezer(equipmentID) {
    const canonicalEquipmentId = String(equipmentID).trim();
    if (freezerCache.has(canonicalEquipmentId)) return freezerCache.get(canonicalEquipmentId);

    // Historical synthetic fixtures may contain numeric containerID values.
    // Read both representations during migration, but all new writes use the
    // canonical string representation used by the governed #1124 authoring surface.
    let freezer = await storageContainersCollection.findOne({
      containerType: 'FREEZER',
      containerID: { $in: equipmentIdVariants(canonicalEquipmentId) }
    });
    if (!freezer) {
      const equipment = await equipmentCollection.findOne({ equipmentID: { $in: equipmentIdVariants(canonicalEquipmentId) } });
      const now = new Date();
      const doc = {
        containerID: canonicalEquipmentId,
        name: equipment?.name || equipment?.equipmentDescription || `Equipment ${canonicalEquipmentId}`,
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
    freezerCache.set(canonicalEquipmentId, freezer._id);
    return freezer._id;
  }

  async function findOrCreateContainer(parentId, containerType, value, counterKey) {
    const cacheKey = `${parentId}:${containerType}:${value}`;
    if (containerCache.has(cacheKey)) return containerCache.get(cacheKey);
    const name = `${containerType} ${value}`;
    let container = await storageContainersCollection.findOne({ parent_id: parentId, containerType, name });
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
    if (location.box === null || location.box === undefined) {
      summary.skipped.push({ locationID: location.locationID, reason: 'missing box' });
      continue;
    }
    if (!location.wellPosition) {
      summary.skipped.push({ locationID: location.locationID, reason: 'missing wellPosition' });
      continue;
    }

    const freezerId = await findOrCreateFreezer(location.equipmentID);
    const shelfId = await findOrCreateContainer(freezerId, 'SHELF', location.block ?? 0, 'shelvesCreated');
    const rackId = await findOrCreateContainer(shelfId, 'RACK', location.rack, 'racksCreated');
    let boxParentId = rackId;
    if (location.drawer !== null && location.drawer !== undefined) {
      boxParentId = await findOrCreateContainer(rackId, 'DRAWER', location.drawer, 'drawersCreated');
    }

    const boxId = await findOrCreateBox(boxParentId, location.box);
    locationIdToBoxId.set(location.locationID, boxId);
    const box = await storageBoxesCollection.findOne({ _id: boxId });
    const samples = await samplesCollection.find({ locationID: location.locationID }).toArray();

    for (const sample of samples) {
      const specimenId = String(sample.specimenId || sample._id);
      if (await physicalStore.findCurrentBySpecimen(specimenId)) continue;
      await physicalStore.assignSpecimenPosition({
        specimenId,
        box,
        positionCode: String(location.wellPosition).toUpperCase(),
        hierarchy: {
          equipmentId: String(freezerId),
          shelfId: String(shelfId),
          rackId: String(rackId),
          roomId: null,
          facilityId: null
        }
      });
      summary.assignmentsCreated += 1;
    }
  }

  return { summary, locationIdToBoxId };
}

module.exports = { backfillLocationsToStorage };
