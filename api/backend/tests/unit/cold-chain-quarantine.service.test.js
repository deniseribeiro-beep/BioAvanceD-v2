import { describe, it, expect, vi } from 'vitest';
const { ObjectId } = require('mongodb');

const quarantineService = require('../../src/services/equipment-sensor-quarantine.service');
const { matchesFilter } = require('../factories/filter.factory');
const { createForeignBsonGuardCollectionMock } = require('../factories/db.factory');

/**
 * #912: local `$expr`/`$toString` extension of the shared `matchesFilter`
 * matcher, confined to this file (the shared factory in
 * `tests/factories/filter.factory.js` documents `$expr` as unsupported).
 * `buildSensorLookup`/`findEquipmentByMetadata`'s `_id` branch now reads
 * `{ $expr: { $eq: [{ $toString: '$_id' }, raw] } }` instead of an `$in` of
 * ObjectId variants, so the two pinned `_id`-branch tests below need this
 * matcher to understand that shape to keep passing -- their assertions are
 * unchanged, only what the mock understands is extended.
 */
function evalExprToStringEq(doc, expr) {
  if (!expr || !Array.isArray(expr.$eq)) return false;
  const resolve = (side) => {
    if (side && typeof side === 'object' && typeof side.$toString === 'string') {
      const path = side.$toString.replace(/^\$/, '');
      const raw = path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
      return raw === undefined || raw === null ? null : String(raw);
    }
    return side;
  };
  const [left, right] = expr.$eq;
  return resolve(left) === resolve(right);
}

function matchesFilterWithExpr(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return Array.isArray(condition) && condition.some((entry) => matchesFilterWithExpr(doc, entry));
    }
    if (key === '$and') {
      return Array.isArray(condition) && condition.every((entry) => matchesFilterWithExpr(doc, entry));
    }
    if (key === '$expr') {
      return evalExprToStringEq(doc, condition);
    }
    return matchesFilter(doc, { [key]: condition });
  });
}

function makeCursor(items) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(items),
    next: vi.fn().mockResolvedValue(items[0] || null),
  };
}

function makeCollection(seed = []) {
  const docs = [...seed];
  const collection = {
    collectionName: 'mock',
    docs,
    find: vi.fn((filter = {}) => makeCursor(docs.filter((doc) => matchesFilterWithExpr(doc, filter)))),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matchesFilterWithExpr(doc, filter)) || null),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((entry) => matchesFilter(entry, filter));
      if (doc && update?.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
    updateMany: vi.fn(async (filter, update) => {
      const matched = docs.filter((doc) => matchesFilter(doc, filter));
      matched.forEach((doc) => {
        if (update?.$set) Object.assign(doc, update.$set);
      });
      return { matchedCount: matched.length, modifiedCount: matched.length };
    }),
    insertOne: vi.fn(async (doc) => {
      docs.push(doc);
      return { insertedId: doc._id || new ObjectId() };
    }),
    createIndex: vi.fn().mockResolvedValue('idx'),
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
  };
  return collection;
}

function buildDb(collections) {
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) collections[name] = makeCollection([]);
      collections[name].collectionName = name;
      return collections[name];
    }),
  };
}

/**
 * #464: seeds a FREEZER -> SHELF -> RACK -> StorageBox chain for a given
 * equipment/containerID, the down-walk mirror of #462's up-walk fixture
 * shape — returns the box `_id` so a test can put it on a sample's
 * `storageLocation.boxId`.
 */
function seedCanonicalPlacement(collections, boxId, specimenId, positionCode = 'A1') {
  const storageRackId = String(boxId);
  const storagePositionId = `${storageRackId}:${String(positionCode).toUpperCase()}`;
  const containerId = `container:${specimenId}`;
  collections.containers = makeCollection([{ containerId, status: 'active' }]);
  collections.storageRacks = makeCollection([{ storageRackId, status: 'active' }]);
  collections.storagePositions = makeCollection([{ storagePositionId, storageRackId, positionCode: String(positionCode).toUpperCase(), status: 'available' }]);
  collections.containerPositionAssignments = makeCollection([{ containerPositionAssignmentId: `cpa:${specimenId}`, containerId, storagePositionId, assignmentStatus: 'active' }]);
  collections.specimenContainerAssignments = makeCollection([{ specimenContainerAssignmentId: `sca:${specimenId}`, specimenId, containerId, assignmentStatus: 'active' }]);
  collections.rackLocationAssignments = makeCollection([]);
}

function seedStorageHierarchy(collections, containerID) {
  const freezerId = new ObjectId();
  const shelfId = new ObjectId();
  const rackId = new ObjectId();
  const boxId = new ObjectId();

  collections.storageContainers = makeCollection([
    ...(collections.storageContainers?.docs || []),
    { _id: freezerId, containerID, containerType: 'FREEZER', parent_id: null },
    { _id: shelfId, containerType: 'SHELF', parent_id: freezerId },
    { _id: rackId, containerType: 'RACK', parent_id: shelfId },
  ]);
  collections.storageBoxes = makeCollection([
    ...(collections.storageBoxes?.docs || []),
    { _id: boxId, parent_id: rackId },
  ]);

  return { freezerId, shelfId, rackId, boxId };
}

describe('equipment-sensor-quarantine.service cold-chain quarantine', () => {
  it('quarentena amostra vinculada por sensor -> cadeia fisica v2 e registra movimento', async () => {
    const incidentId = new ObjectId();
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-cold-001', locationID: 9001 }]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 9001);
    const specimenId = 'BIO-SAMPLE-001';
    seedCanonicalPlacement(collections, boxId, specimenId);
    collections.specimens = makeCollection([{
      _id: new ObjectId(),
      specimenId,
      barcode: 'BC-COLD-001',
      specimenStatus: 'available',
      quantity: 1,
      unit: 'mL',
    }]);
    const db = buildDb(collections);

    const result = await quarantineService.quarantineByColdChainIncident(db, {
      _id: incidentId,
      sensorKey: 'sensor-cold-001',
      status: 'open',
      currentTemperature: 12.5,
      maxTemperature: 12.5,
      minTemperature: 2,
    });

    expect(result.triggered).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(result.movements).toBe(1);
    expect(result.boxIds.map(String)).toContain(String(boxId));

    expect(collections.specimens.updateOne).toHaveBeenCalledTimes(1);
    const update = collections.specimens.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      specimenStatus: 'quarantined',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainIncidentId: String(incidentId),
      coldChainSensorKey: 'sensor-cold-001',
      coldChainReviewRequired: true,
      coldChainStatus: 'INCIDENT_OPEN',
    });
    expect(update.availabilityStatus).toBeUndefined();
    expect(update.quarantineStatus).toBeUndefined();
    // #540: status/currentStatus retired alongside them.
    expect(update.status).toBeUndefined();
    expect(update.currentStatus).toBeUndefined();

    expect(collections.sampleMovements.insertOne).toHaveBeenCalledTimes(1);
    const movement = collections.sampleMovements.insertOne.mock.calls[0][0];
    expect(movement).toMatchObject({
      purpose: 'cold_chain_incident_quarantine',
      destination: 'Quarentena',
      responsible: 'SYSTEM',
    });
  });

  it('encontra amostra por sensorMetadata -> equipment -> freezer -> box -> samples', async () => {
    const equipmentObjectId = new ObjectId();
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-freezer-002', equipment: equipmentObjectId }]),
      equipment: makeCollection([{ _id: equipmentObjectId, equipmentID: 9100 }]),
      sampleMovements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 9100);
    const specimenId = 'BIO-SAMPLE-002';
    seedCanonicalPlacement(collections, boxId, specimenId);
    collections.specimens = makeCollection([{
      _id: new ObjectId(),
      specimenId,
      barcode: 'BC-COLD-002',
      specimenStatus: 'available',
      quantity: 1,
      unit: 'mL',
    }]);
    const db = buildDb(collections);

    const result = await quarantineService.quarantineByColdChainIncident(db, {
      _id: new ObjectId(),
      sensorKey: 'sensor-freezer-002',
      status: 'open',
      currentTemperature: 12.5,
    });

    expect(result.triggered).toBe(true);
    expect(result.boxIds.map(String)).toContain(String(boxId));
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(collections.specimens.updateOne).toHaveBeenCalledTimes(1);
  });

  it('incidente resolvido mantém amostras para revisão e não libera automaticamente', async () => {
    const incidentId = new ObjectId();
    const sampleId = new ObjectId();
    const collections = {
      specimens: makeCollection([{
        _id: sampleId,
        coldChainIncidentId: String(incidentId),
        quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
        specimenStatus: 'quarantined',
        status: 'QUARANTINED',
      }]),
      quarantineActions: makeCollection([{
        quarantineActionId: 'QA-EXISTING',
        specimenIds: [String(sampleId)],
        actionStatus: 'active',
        startedAt: new Date('2026-01-01'),
      }]),
    };
    const db = buildDb(collections);

    const result = await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: incidentId });

    expect(result.reviewRequired).toBe(true);
    expect(result.matched).toBe(1);
    expect(collections.specimens.updateMany).toHaveBeenCalledTimes(1);
    const update = collections.specimens.updateMany.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      coldChainStatus: 'INCIDENT_RESOLVED_REVIEW_REQUIRED',
      coldChainReviewRequired: true,
    });
    // pending-review is tracked on QuarantineAction.actionStatus, not the
    // legacy Sample trio (canonical-data-contract-v1.md, QuarantineAction
    // section) — the sample's own specimenStatus stays 'quarantined'.
    expect(update.availabilityStatus).toBeUndefined();
    expect(update.quarantineStatus).toBeUndefined();
    expect(update.coldChainIncidentResolvedAt).toBeInstanceOf(Date);
    expect(update.status).not.toBe('AVAILABLE');

    expect(collections.quarantineActions.docs[0].actionStatus).toBe('pending_review');
  });

  it('short-circuits with reason "missing-sensor-key" when the incident has no sensorKey/sensorId/sensorID', async () => {
    const db = buildDb({});
    const result = await quarantineService.quarantineByColdChainIncident(db, { _id: new ObjectId(), status: 'open' });
    expect(result).toEqual({
      triggered: false,
      matched: 0,
      quarantined: 0,
      movements: 0,
      reason: 'missing-sensor-key'
    });
  });

  it('falls back to incident.sensorId / incident.sensorID when sensorKey is absent', async () => {
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-9', locationID: 42 }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, undefined);
    expect(result).toEqual([]);

    const byId = await quarantineService.quarantineByColdChainIncident(buildDb({
      sensors: makeCollection([{ sensorId: 'sensor-9', locationID: 42 }]),
      specimens: makeCollection([]),
    }), { sensorId: 'sensor-9', status: 'open' });
    expect(byId.sensorKey).toBe('sensor-9');
  });

  it('short-circuits with reason "incident-not-active" for a status outside open/acknowledged/escalated', async () => {
    const db = buildDb({});
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-1',
      status: 'resolved',
    });
    expect(result).toEqual({
      triggered: false,
      matched: 0,
      quarantined: 0,
      movements: 0,
      reason: 'incident-not-active'
    });
  });

  it('falls back to the raw sensorKey as incidentId when the incident has no _id', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
      specimens: makeCollection([]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-no-id',
      status: 'acknowledged',
    });
    expect(result.incidentId).toBe('sensor-no-id');
    expect(result.matched).toBe(0);
  });

  it('includes the temperature suffix in the reason when currentTemperature is defined', async () => {
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), specimens: makeCollection([]) };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-temp',
      status: 'open',
      currentTemperature: 8.2,
    });
    expect(result.reason).toContain('temperatura=8.2');
  });

  it('findBoxIdsBySensorKey returns [] immediately for a blank/whitespace sensorKey', async () => {
    const db = buildDb({});
    const result = await quarantineService.findBoxIdsBySensorKey(db, '   ');
    expect(result).toEqual([]);
  });

  it('follows sensorMetadata -> equipmentId (aliased field) -> equipment lookup by numeric equipmentID', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-alias', equipmentId: '9200' }]),
      equipment: makeCollection([{ equipmentID: 9200 }]),
    };
    const { boxId } = seedStorageHierarchy(collections, 9200);
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, 'sensor-alias');
    expect(result.map(String)).toContain(String(boxId));
  });

  it('markColdChainIncidentSamplesForReview short-circuits when neither incident._id nor a sensor key is present', async () => {
    const db = buildDb({});
    const result = await quarantineService.markColdChainIncidentSamplesForReview(db, {});
    expect(result).toEqual({ matched: 0, modified: 0, reviewRequired: false });
  });

  it('markColdChainIncidentSamplesForReview reports 0/0 when nothing matches the incident filter', async () => {
    const collections = { specimens: makeCollection([]) };
    const db = buildDb(collections);
    const result = await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: new ObjectId() });
    expect(result.matched).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.reviewRequired).toBe(true);
  });

  it('quarantineByColdChainIncident is a no-op (matched:0) when the sensor resolves no boxes', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
      specimens: makeCollection([{ _id: new ObjectId(), storageLocation: { boxId: new ObjectId(), position: 'A1' }, status: 'AVAILABLE' }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-unknown',
      status: 'open',
    });
    expect(result.matched).toBe(0);
    expect(result.quarantined).toBe(0);
    expect(collections.specimens.updateOne).not.toHaveBeenCalled();
  });

  it('falls back to incident.sensorID (third field) when sensorKey and sensorId are both absent', async () => {
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), specimens: makeCollection([]) };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorID: 'sensor-caps-id',
      status: 'open',
    });
    expect(result.sensorKey).toBe('sensor-caps-id');
  });

  it('finds boxes by equipment.id (bare id field) via findBoxIdsBySensorKey -> sensorMetadata -> equipment lookup', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-bareid', equipmentId: 'EQ-1' }]),
      equipment: makeCollection([{ id: 'EQ-1' }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, 'sensor-bareid');
    expect(result).toEqual([]);
    expect(collections.equipment.findOne).toHaveBeenCalled();
  });

  it('returns null from the equipment lookup when sensorMetadata carries no equipment reference field', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-noref' }]),
      equipment: makeCollection([]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, 'sensor-noref');
    expect(result).toEqual([]);
  });

  it('resolves a valid ObjectId-string sensorKey through the ObjectId branch of buildSensorLookup', async () => {
    const objectIdSensorKey = new ObjectId().toString();
    const collections = {
      sensors: makeCollection([{ _id: new ObjectId(objectIdSensorKey), locationID: 321 }]),
      sensorMetadata: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 321);
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, objectIdSensorKey);
    expect(result.map(String)).toContain(String(boxId));
  });

  it('passes options.session through to the underlying find/findOne calls', async () => {
    const session = { id: 'session-1' };
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
    };
    const db = buildDb(collections);
    await quarantineService.findBoxIdsBySensorKey(db, 'sensor-session', { session });
    expect(collections.sensors.find).toHaveBeenCalledWith(expect.anything(), { session });
  });

  it('quarantineByColdChainIncident propagates options.session down into quarantineSamplesByFilter\'s query/ledger calls', async () => {
    const session = { id: 'session-2' };
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-session-2', locationID: 66 }]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 66);
    const specimenId = 'BIO-SESSION-2';
    seedCanonicalPlacement(collections, boxId, specimenId);
    collections.specimens = makeCollection([{ _id: new ObjectId(), specimenId, specimenStatus: 'available', quantity: 2 }]);
    const db = buildDb(collections);
    await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-session-2',
      status: 'open',
    }, { session });
    expect(collections.specimens.find).toHaveBeenCalledWith(expect.anything(), { session });
    expect(collections.specimens.updateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session });
  });

  it('resolves a valid ObjectId-string equipment reference on the sensorMetadata document', async () => {
    const equipmentObjectId = new ObjectId();
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-eqoid', equipment: equipmentObjectId.toString() }]),
      equipment: makeCollection([{ _id: equipmentObjectId, equipmentID: 555 }]),
    };
    const { boxId } = seedStorageHierarchy(collections, 555);
    const db = buildDb(collections);
    const result = await quarantineService.findBoxIdsBySensorKey(db, 'sensor-eqoid');
    expect(result.map(String)).toContain(String(boxId));
  });

  it('markColdChainIncidentSamplesForReview passes options.session through to the updateMany call', async () => {
    const session = { id: 'sess-review' };
    const collections = { specimens: makeCollection([]) };
    const db = buildDb(collections);
    await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: new ObjectId() }, { session });
    expect(collections.specimens.updateMany).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session });
  });

  it('defaults quantitySnapshot to 0 when neither currentQuantity nor quantity is set on the sample', async () => {
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-qty', locationID: 55 }]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 55);
    const specimenId = 'BIO-QTY-55';
    seedCanonicalPlacement(collections, boxId, specimenId);
    collections.specimens = makeCollection([{ _id: new ObjectId(), specimenId, specimenStatus: 'available' }]);
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-qty',
      status: 'open',
    });
    expect(result.quarantined).toBe(1);
    const movement = collections.sampleMovements.insertOne.mock.calls[0][0];
    expect(movement.quantity).toBe(0);
    // context.reason is always set by every caller (buildStatusChangeReason /
    // buildColdChainIncidentReason), so the `|| 'Quarentena automática por
    // falha...'` fallback text at line 316 is unreachable in practice.
    expect(movement.observations).toBe(result.reason);
  });

  // #912: `createForeignBsonGuardCollectionMock` (tests/factories/db.factory.js,
  // added under #651) throws the real "Unsupported BSON version..." error if
  // any filter value handed to find/findOne is a top-level `mongodb.ObjectId`
  // instance. These prove buildSensorLookup/findEquipmentByMetadata no longer
  // construct one, regardless of what the raw input looks like.
  it('buildSensorLookup never hands a foreign mongodb.ObjectId into the sensors filter', async () => {
    const objectIdSensorKey = new ObjectId().toString();
    const sensorsGuard = createForeignBsonGuardCollectionMock();
    const collections = {
      sensors: sensorsGuard,
      sensorMetadata: makeCollection([]),
    };
    const db = buildDb(collections);

    await expect(quarantineService.findBoxIdsBySensorKey(db, objectIdSensorKey)).resolves.toEqual([]);
    expect(sensorsGuard.find).toHaveBeenCalled();
  });

  it('findEquipmentByMetadata never hands a foreign mongodb.ObjectId into the equipment filter', async () => {
    const equipmentObjectId = new ObjectId();
    const equipmentGuard = createForeignBsonGuardCollectionMock();
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-guard', equipment: equipmentObjectId.toString() }]),
      equipment: equipmentGuard,
    };
    const db = buildDb(collections);

    await expect(quarantineService.findBoxIdsBySensorKey(db, 'sensor-guard')).resolves.toEqual([]);
    expect(equipmentGuard.findOne).toHaveBeenCalled();
  });
});
