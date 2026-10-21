import { describe, it, expect, vi, afterEach } from 'vitest';
const { ObjectId } = require('mongodb');

const quarantineService = require('../../src/services/equipment-sensor-quarantine.service');
const physicalChain = require('../../src/services/physicalChain.service');
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
 *
 * #1392: also `{ $in: [{ $toString: '$_id' }, [...]] }`, the cold-chain
 * quarantine's match of a legacy sample whose chain key is its `_id`.
 */
function evalExprToString(doc, expr) {
  if (!expr || !(Array.isArray(expr.$eq) || Array.isArray(expr.$in))) return false;
  const resolve = (side) => {
    if (side && typeof side === 'object' && typeof side.$toString === 'string') {
      const path = side.$toString.replace(/^\$/, '');
      const raw = path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
      return raw === undefined || raw === null ? null : String(raw);
    }
    return side;
  };
  if (Array.isArray(expr.$in)) {
    const [needle, haystack] = expr.$in;
    return Array.isArray(haystack) && haystack.includes(resolve(needle));
  }
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
      return evalExprToString(doc, condition);
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
  it('quarentena amostra vinculada por sensor -> storageLocation.boxId e registra movimento', async () => {
    const incidentId = new ObjectId();
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-cold-001', locationID: 9001 }]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 9001);
    collections.samples = makeCollection([{
      _id: new ObjectId(),
      sampleID: 'BIO-SAMPLE-001',
      barcode: 'BC-COLD-001',
      storageLocation: { boxId, position: 'A1' },
      status: 'AVAILABLE',
      currentStatus: 'Available',
      availabilityStatus: 'AVAILABLE',
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

    expect(collections.samples.updateOne).toHaveBeenCalledTimes(1);
    const update = collections.samples.updateOne.mock.calls[0][1].$set;
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

    expect(collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
    const movement = collections.sample_movements.insertOne.mock.calls[0][0];
    expect(movement).toMatchObject({
      purpose: 'cold_chain_incident_quarantine',
      destination: 'Quarentena',
      responsible: 'SYSTEM',
    });

    // RF006 AC7 (#1315): the status change is an append-only decision whose
    // trigger is the ledger movement.
    expect(collections.operationalStateDecisions.insertOne).toHaveBeenCalledTimes(1);
    const decision = collections.operationalStateDecisions.insertOne.mock.calls[0][0];
    expect(decision).toMatchObject({
      previousStatus: 'available',
      newStatus: 'quarantined',
      triggerEventId: String(movement.movementId),
      rulesApplied: ['cold_chain_incident_quarantine'],
      reasonCodes: ['COLD_CHAIN_INCIDENT'],
    });
  });

  it('encontra amostra por sensorMetadata -> equipment -> freezer -> box -> samples', async () => {
    const equipmentObjectId = new ObjectId();
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-freezer-002', equipment: equipmentObjectId }]),
      equipment: makeCollection([{ _id: equipmentObjectId, equipmentID: 9100 }]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 9100);
    collections.samples = makeCollection([{
      _id: new ObjectId(),
      sampleID: 'BIO-SAMPLE-002',
      barcode: 'BC-COLD-002',
      storageLocation: { boxId, position: 'A1' },
      status: 'AVAILABLE',
      currentStatus: 'Available',
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
    expect(collections.samples.updateOne).toHaveBeenCalledTimes(1);
  });

  // #1208: sensor registration (sensor.service.js linkSensorMetadata, #311)
  // binds a sensor to its freezer through SensorMetadata.storageContainer,
  // the FREEZER's _id -- the link TelemetryMonitor.resolveRootSamples reads
  // for the Neo4j COMPROMISED mark. The quarantine read only locationId ->
  // containerID and equipment, so a sensor registered that way resolved zero
  // boxes and its samples were never quarantined.
  it('#1208: encontra amostra por sensorMetadata.storageContainer -> freezer -> box -> samples', async () => {
    const collections = {
      sensors: makeCollection([]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    // No containerID and no equipment: storageContainer is the only link.
    const { freezerId, boxId } = seedStorageHierarchy(collections, undefined);
    collections.sensorMetadata = makeCollection([{ sensorId: 'sensor-freezer-003', storageContainer: freezerId }]);
    collections.samples = makeCollection([{
      _id: new ObjectId(),
      sampleID: 'BIO-SAMPLE-003',
      barcode: 'BC-COLD-003',
      storageLocation: { boxId, position: 'A1' },
      status: 'AVAILABLE',
      currentStatus: 'Available',
      quantity: 1,
      unit: 'mL',
    }]);
    const db = buildDb(collections);

    const result = await quarantineService.quarantineByColdChainIncident(db, {
      _id: new ObjectId(),
      sensorKey: 'sensor-freezer-003',
      status: 'open',
      currentTemperature: 12.5,
    });

    expect(result.boxIds.map(String)).toEqual([String(boxId)]);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(collections.samples.updateOne).toHaveBeenCalledTimes(1);
  });

  it('#1392: encontra amostra por TelemetryDatastream -> StorageLocation espelhada -> freezer -> box, sem sensorMetadata', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { freezerId, boxId } = seedStorageHierarchy(collections, undefined);
    collections.storageLocations = makeCollection([
      { storageLocationId: 'loc-freezer-004', code: `legacy-storage-container:${String(freezerId)}` },
    ]);
    // The matcher has no $lte, so this collection returns its documents
    // unfiltered; the service filters them again by sensor, property and
    // validity.
    collections.telemetryDatastreams = {
      find: vi.fn(() => makeCursor([{
        sensorId: 'sensor-freezer-004',
        observedProperty: 'temperature',
        equipmentId: 'eq-unregistered',
        storageLocationId: 'loc-freezer-004',
        thresholdProfileId: 'pol-1',
        validityPeriod: { start: new Date(Date.now() - 60 * 60 * 1000), end: null },
      }])),
    };
    collections.samples = makeCollection([{
      _id: new ObjectId(),
      sampleID: 'BIO-SAMPLE-004',
      barcode: 'BC-COLD-004',
      storageLocation: { boxId, position: 'A1' },
      status: 'AVAILABLE',
      currentStatus: 'Available',
      quantity: 1,
      unit: 'mL',
    }]);
    const db = buildDb(collections);

    const result = await quarantineService.quarantineByColdChainIncident(db, {
      _id: new ObjectId(),
      sensorKey: 'sensor-freezer-004',
      status: 'open',
      currentTemperature: -40,
    });

    expect(result.boxIds.map(String)).toEqual([String(boxId)]);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
  });

  it('incidente resolvido mantém amostras para revisão e não libera automaticamente', async () => {
    const incidentId = new ObjectId();
    const sampleId = new ObjectId();
    const collections = {
      samples: makeCollection([{
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
    expect(collections.samples.updateMany).toHaveBeenCalledTimes(1);
    const update = collections.samples.updateMany.mock.calls[0][1].$set;
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
      samples: makeCollection([]),
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
      samples: makeCollection([]),
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
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), samples: makeCollection([]) };
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
    const collections = { samples: makeCollection([]) };
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
      samples: makeCollection([{ _id: new ObjectId(), storageLocation: { boxId: new ObjectId(), position: 'A1' }, status: 'AVAILABLE' }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-unknown',
      status: 'open',
    });
    expect(result.matched).toBe(0);
    expect(result.quarantined).toBe(0);
    expect(collections.samples.updateOne).not.toHaveBeenCalled();
  });

  it('falls back to incident.sensorID (third field) when sensorKey and sensorId are both absent', async () => {
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), samples: makeCollection([]) };
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
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 66);
    collections.samples = makeCollection([{ _id: new ObjectId(), storageLocation: { boxId, position: 'A1' }, status: 'AVAILABLE', quantity: 2 }]);
    const db = buildDb(collections);
    await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-session-2',
      status: 'open',
    }, { session });
    expect(collections.samples.find).toHaveBeenCalledWith(expect.anything(), { session });
    expect(collections.samples.updateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session });
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
    const collections = { samples: makeCollection([]) };
    const db = buildDb(collections);
    await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: new ObjectId() }, { session });
    expect(collections.samples.updateMany).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session });
  });

  it('defaults quantitySnapshot to 0 when neither currentQuantity nor quantity is set on the sample', async () => {
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-qty', locationID: 55 }]),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const { boxId } = seedStorageHierarchy(collections, 55);
    collections.samples = makeCollection([{ _id: new ObjectId(), storageLocation: { boxId, position: 'A1' }, status: 'AVAILABLE' }]);
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-qty',
      status: 'open',
    });
    expect(result.quarantined).toBe(1);
    const movement = collections.sample_movements.insertOne.mock.calls[0][0];
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

describe('#1392: cold-chain quarantine through the physical chain (RF009 AC5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NOW = new Date();
  const HOUR = 60 * 60 * 1000;

  // The matcher has no $lte, so these collections return their documents
  // unfiltered, as in the #1392 datastream case above; the services filter
  // them again.
  function unfiltered(docs) {
    return { docs, find: vi.fn(() => makeCursor(docs)) };
  }

  function stream(overrides = {}) {
    return {
      sensorId: 'sensor-chain-001',
      observedProperty: 'temperature',
      storageLocationId: 'loc-X',
      validityPeriod: { start: new Date(NOW.getTime() - HOUR), end: null },
      ...overrides,
    };
  }

  function chainCollections({ streams = [stream()], samples = [], sensors = [] } = {}) {
    return {
      sensors: makeCollection(sensors),
      sensorMetadata: makeCollection([]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
      telemetryDatastreams: unfiltered(streams),
      samples: makeCollection(samples),
    };
  }

  function incident(overrides = {}) {
    return { _id: new ObjectId(), sensorKey: 'sensor-chain-001', status: 'open', currentTemperature: -40, ...overrides };
  }

  it('(a) quarantines a specimen the chain puts at the stream location, with no box path, over [excursionStartedAt, now]', async () => {
    const collections = chainCollections({ samples: [{ _id: new ObjectId(), specimenId: 'SPC-CHAIN', quantity: 1 }] });
    const db = buildDb(collections);
    const spy = vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockResolvedValue(['SPC-CHAIN']);
    const excursionStartedAt = new Date(NOW.getTime() - HOUR / 2);

    const result = await quarantineService.quarantineByColdChainIncident(db, incident({ excursionStartedAt }), { now: NOW });

    expect(result.boxIds).toEqual([]);
    expect(result.specimenIds).toEqual(['SPC-CHAIN']);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(spy).toHaveBeenCalledWith(db, 'loc-X', { from: excursionStartedAt, to: NOW });
  });

  it('(b) the window falls back to openedAt, then to the instant now', async () => {
    const spy = vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockResolvedValue([]);
    const openedAt = new Date(NOW.getTime() - HOUR / 4);

    await quarantineService.quarantineByColdChainIncident(buildDb(chainCollections()), incident({ openedAt }), { now: NOW });
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), 'loc-X', { from: openedAt, to: NOW });

    await quarantineService.quarantineByColdChainIncident(buildDb(chainCollections()), incident(), { now: NOW });
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), 'loc-X', { from: NOW, to: NOW });
  });

  it('(c) quarantines a legacy sample with no specimenId whose String(_id) the chain returns', async () => {
    const legacyId = new ObjectId();
    const collections = chainCollections({ samples: [{ _id: legacyId, sampleID: 'BIO-LEGACY', quantity: 1 }] });
    vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockResolvedValue([String(legacyId)]);

    const result = await quarantineService.quarantineByColdChainIncident(buildDb(collections), incident(), { now: NOW });

    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
  });

  it('(d) takes the union of the box path and the chain', async () => {
    const collections = chainCollections({ sensors: [{ sensorId: 'sensor-chain-001', locationID: 9101 }] });
    const { boxId } = seedStorageHierarchy(collections, 9101);
    collections.samples = makeCollection([
      { _id: new ObjectId(), specimenId: 'SPC-BOX', storageLocation: { boxId, position: 'A1' }, quantity: 1 },
      { _id: new ObjectId(), specimenId: 'SPC-CHAIN', quantity: 1 },
      { _id: new ObjectId(), specimenId: 'SPC-ELSEWHERE', quantity: 1 },
    ]);
    vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockResolvedValue(['SPC-CHAIN']);

    const result = await quarantineService.quarantineByColdChainIncident(buildDb(collections), incident(), { now: NOW });

    expect(result.boxIds.map(String)).toEqual([String(boxId)]);
    expect(result.matched).toBe(2);
    expect(result.quarantined).toBe(2);
  });

  it('(e) a stream whose validity ended before the window reads no chain and quarantines nothing', async () => {
    const collections = chainCollections({
      streams: [stream({ validityPeriod: { start: new Date(NOW.getTime() - 3 * HOUR), end: new Date(NOW.getTime() - 2 * HOUR) } })],
      samples: [{ _id: new ObjectId(), specimenId: 'SPC-CHAIN', quantity: 1 }],
    });
    const spy = vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockResolvedValue(['SPC-CHAIN']);

    const result = await quarantineService.quarantineByColdChainIncident(
      buildDb(collections), incident({ excursionStartedAt: new Date(NOW.getTime() - HOUR) }), { now: NOW },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.specimenIds).toEqual([]);
    expect(result.matched).toBe(0);
    expect(result.quarantined).toBe(0);
  });

  it('(f) a failed chain lookup still quarantines the box sample', async () => {
    const collections = chainCollections({ sensors: [{ sensorId: 'sensor-chain-001', locationID: 9102 }] });
    const { boxId } = seedStorageHierarchy(collections, 9102);
    collections.samples = makeCollection([
      { _id: new ObjectId(), specimenId: 'SPC-BOX', storageLocation: { boxId, position: 'A1' }, quantity: 1 },
    ]);
    vi.spyOn(physicalChain, 'specimenIdsAtLocation').mockRejectedValue(new Error('chain down'));

    const result = await quarantineService.quarantineByColdChainIncident(buildDb(collections), incident(), { now: NOW });

    expect(result.specimenIds).toEqual([]);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
  });

  it('(g) reads the seeded SCA -> CPA -> RLA chain and quarantines the chained sample', async () => {
    const collections = chainCollections({
      samples: [
        { _id: new ObjectId(), specimenId: 'SPC-CHAINED', quantity: 1 },
        { _id: new ObjectId(), specimenId: 'SPC-OTHER', quantity: 1 },
      ],
    });
    const placedAt = new Date(NOW.getTime() - 2 * HOUR);
    collections.rackLocationAssignments = unfiltered([
      { storageRackId: 'rack-X', storageLocationId: 'loc-X', placedAt, removedAt: null },
      { storageRackId: 'rack-Y', storageLocationId: 'loc-Y', placedAt, removedAt: null },
    ]);
    collections.containerPositionAssignments = unfiltered([
      { containerId: 'CT-X', storagePositionId: 'rack-X:A01', placedAt, removedAt: null },
      { containerId: 'CT-Y', storagePositionId: 'rack-Y:A01', placedAt, removedAt: null },
    ]);
    collections.specimenContainerAssignments = unfiltered([
      { specimenId: 'SPC-CHAINED', containerId: 'CT-X', loadedAt: placedAt, unloadedAt: null },
      { specimenId: 'SPC-OTHER', containerId: 'CT-Y', loadedAt: placedAt, unloadedAt: null },
    ]);

    const result = await quarantineService.quarantineByColdChainIncident(
      buildDb(collections), incident({ excursionStartedAt: new Date(NOW.getTime() - HOUR) }), { now: NOW },
    );

    expect(result.specimenIds).toEqual(['SPC-CHAINED']);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(collections.samples.docs.find((doc) => doc.specimenId === 'SPC-CHAINED').specimenStatus).toBe('quarantined');
    expect(collections.samples.docs.find((doc) => doc.specimenId === 'SPC-OTHER').specimenStatus).toBeUndefined();
  });
});
