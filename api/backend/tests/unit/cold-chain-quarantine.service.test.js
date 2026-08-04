import { describe, it, expect, vi } from 'vitest';
const { ObjectId } = require('mongodb');

const quarantineService = require('../../src/services/equipment-sensor-quarantine.service');

function getByPath(source, path) {
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function sameValue(left, right) {
  return String(left) === String(right);
}

function matchesCondition(value, condition) {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof ObjectId)) {
    if (condition.$in) {
      return condition.$in.some((candidate) => sameValue(value, candidate));
    }
    if (condition.$ne !== undefined) {
      return !sameValue(value, condition.$ne);
    }
  }

  return sameValue(value, condition);
}

function matchesFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return condition.some((entry) => matchesFilter(doc, entry));
    }
    if (key === '$and') {
      return condition.every((entry) => matchesFilter(doc, entry));
    }
    return matchesCondition(getByPath(doc, key), condition);
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
    find: vi.fn((filter = {}) => makeCursor(docs.filter((doc) => matchesFilter(doc, filter)))),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matchesFilter(doc, filter)) || null),
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

describe('equipment-sensor-quarantine.service cold-chain quarantine', () => {
  it('quarentena amostra vinculada por sensor -> locationID e registra movimento', async () => {
    const sampleId = new ObjectId();
    const incidentId = new ObjectId();
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-cold-001', locationID: 501 }]),
      sensorMetadata: makeCollection([]),
      equipment: makeCollection([{ equipmentID: 9001 }]),
      locations: makeCollection([{ locationID: 501, equipmentID: 9001 }]),
      samples: makeCollection([{
        _id: sampleId,
        sampleID: 'BIO-SAMPLE-001',
        barcode: 'BC-COLD-001',
        locationID: 501,
        status: 'AVAILABLE',
        currentStatus: 'Available',
        release_status: 'AVAILABLE',
        availabilityStatus: 'AVAILABLE',
        quantity: 1,
        unit: 'mL',
      }]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
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
    expect(result.locationIds).toContain(501);

    expect(collections.samples.updateOne).toHaveBeenCalledTimes(1);
    const update = collections.samples.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      status: 'QUARANTINED',
      currentStatus: 'QUARANTINED',
      release_status: 'QUARANTINE',
      specimenStatus: 'quarantined',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainIncidentId: String(incidentId),
      coldChainSensorKey: 'sensor-cold-001',
      coldChainReviewRequired: true,
      coldChainStatus: 'INCIDENT_OPEN',
    });
    expect(update.availabilityStatus).toBeUndefined();
    expect(update.quarantineStatus).toBeUndefined();

    expect(collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
    const movement = collections.sample_movements.insertOne.mock.calls[0][0];
    expect(movement).toMatchObject({
      purpose: 'cold_chain_incident_quarantine',
      destination: 'Quarentena',
      responsible: 'SYSTEM',
    });
  });

  it('encontra amostra por sensorMetadata -> equipment -> locations -> samples', async () => {
    const equipmentId = new ObjectId();
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-freezer-002', equipment: equipmentId }]),
      equipment: makeCollection([{ _id: equipmentId, equipmentID: 9100 }]),
      locations: makeCollection([{ equipmentID: 9100, locationID: 777 }]),
      samples: makeCollection([{ _id: new ObjectId(), sampleID: 'BIO-SAMPLE-002', barcode: 'BC-COLD-002', locationID: 777, status: 'AVAILABLE', currentStatus: 'Available', release_status: 'AVAILABLE', quantity: 1, unit: 'mL' }]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
    const db = buildDb(collections);

    const result = await quarantineService.quarantineByColdChainIncident(db, {
      _id: new ObjectId(),
      sensorKey: 'sensor-freezer-002',
      status: 'open',
      currentTemperature: 12.5,
    });

    expect(result.triggered).toBe(true);
    expect(result.locationIds).toContain(777);
    expect(result.matched).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(collections.samples.updateOne).toHaveBeenCalledTimes(1);
  });

  it('incidente resolvido mantém amostras para revisão e não libera automaticamente', async () => {
    const incidentId = new ObjectId();
    const sampleId = new ObjectId();
    const collections = {
      samples: makeCollection([{
        _id: sampleId,
        coldChainIncidentId: String(incidentId),
        quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
        release_status: 'QUARANTINE',
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
    expect(update.release_status).not.toBe('AVAILABLE');

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
    const result = await quarantineService.findLocationIdsBySensorKey(db, undefined);
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
      locations: makeCollection([]),
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
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), locations: makeCollection([]), samples: makeCollection([]) };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorKey: 'sensor-temp',
      status: 'open',
      currentTemperature: 8.2,
    });
    expect(result.reason).toContain('temperatura=8.2');
  });

  it('findLocationIdsBySensorKey returns [] immediately for a blank/whitespace sensorKey', async () => {
    const db = buildDb({});
    const result = await quarantineService.findLocationIdsBySensorKey(db, '   ');
    expect(result).toEqual([]);
  });

  it('follows sensorMetadata -> equipmentId (aliased field) -> equipment lookup by numeric equipmentID', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-alias', equipmentId: '9200' }]),
      equipment: makeCollection([{ equipmentID: 9200 }]),
      locations: makeCollection([{ equipmentID: 9200, locationID: 888 }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findLocationIdsBySensorKey(db, 'sensor-alias');
    expect(result).toContain(888);
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

  it('quarantineByColdChainIncident is a no-op (matched:0) when the sensor resolves no locations', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
      locations: makeCollection([]),
      samples: makeCollection([{ _id: new ObjectId(), locationID: 999, status: 'AVAILABLE' }]),
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
    const collections = { sensors: makeCollection([]), sensorMetadata: makeCollection([]), locations: makeCollection([]), samples: makeCollection([]) };
    const db = buildDb(collections);
    const result = await quarantineService.quarantineByColdChainIncident(db, {
      sensorID: 'sensor-caps-id',
      status: 'open',
    });
    expect(result.sensorKey).toBe('sensor-caps-id');
  });

  it('finds locations by equipment.id (bare id field) via findLocationIdsBySensorKey -> sensorMetadata -> equipment lookup', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-bareid', equipmentId: 'EQ-1' }]),
      equipment: makeCollection([{ id: 'EQ-1' }]),
      locations: makeCollection([]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findLocationIdsBySensorKey(db, 'sensor-bareid');
    expect(result).toEqual([]);
    expect(collections.equipment.findOne).toHaveBeenCalled();
  });

  it('returns null from the equipment lookup when sensorMetadata carries no equipment reference field', async () => {
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([{ sensorId: 'sensor-noref' }]),
      equipment: makeCollection([]),
      locations: makeCollection([]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findLocationIdsBySensorKey(db, 'sensor-noref');
    expect(result).toEqual([]);
  });

  it('resolves a valid ObjectId-string sensorKey through the ObjectId branch of buildSensorLookup', async () => {
    const objectIdSensorKey = new ObjectId().toString();
    const collections = {
      sensors: makeCollection([{ _id: new ObjectId(objectIdSensorKey), locationID: 321 }]),
      sensorMetadata: makeCollection([]),
      locations: makeCollection([]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findLocationIdsBySensorKey(db, objectIdSensorKey);
    expect(result).toContain(321);
  });

  it('passes options.session through to the underlying find/findOne calls', async () => {
    const session = { id: 'session-1' };
    const collections = {
      sensors: makeCollection([]),
      sensorMetadata: makeCollection([]),
      locations: makeCollection([]),
    };
    const db = buildDb(collections);
    await quarantineService.findLocationIdsBySensorKey(db, 'sensor-session', { session });
    expect(collections.sensors.find).toHaveBeenCalledWith(expect.anything(), { session });
  });

  it('quarantineByColdChainIncident propagates options.session down into quarantineSamplesByFilter\'s query/ledger calls', async () => {
    const session = { id: 'session-2' };
    const sampleId = new ObjectId();
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-session-2', locationID: 66 }]),
      sensorMetadata: makeCollection([]),
      locations: makeCollection([]),
      samples: makeCollection([{ _id: sampleId, locationID: 66, status: 'AVAILABLE', quantity: 2 }]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
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
      locations: makeCollection([{ equipmentID: 555, locationID: 44 }]),
    };
    const db = buildDb(collections);
    const result = await quarantineService.findLocationIdsBySensorKey(db, 'sensor-eqoid');
    expect(result).toContain(44);
  });

  it('markColdChainIncidentSamplesForReview passes options.session through to the updateMany call', async () => {
    const session = { id: 'sess-review' };
    const collections = { samples: makeCollection([]) };
    const db = buildDb(collections);
    await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: new ObjectId() }, { session });
    expect(collections.samples.updateMany).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session });
  });

  it('defaults quantitySnapshot to 0 when neither availableQuantity nor quantity is set on the sample', async () => {
    const sampleId = new ObjectId();
    const collections = {
      sensors: makeCollection([{ sensorId: 'sensor-qty', locationID: 55 }]),
      sensorMetadata: makeCollection([]),
      locations: makeCollection([]),
      samples: makeCollection([{ _id: sampleId, locationID: 55, status: 'AVAILABLE' }]),
      sampleMovements: makeCollection([]),
      sample_movements: makeCollection([]),
      counters: makeCollection([]),
    };
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
});
