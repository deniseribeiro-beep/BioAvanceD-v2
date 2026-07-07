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
      availabilityStatus: 'BLOCKED',
      quarantineStatus: 'QUARANTINED',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainIncidentId: String(incidentId),
      coldChainSensorKey: 'sensor-cold-001',
      coldChainReviewRequired: true,
      coldChainStatus: 'INCIDENT_OPEN',
    });

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
    const collections = {
      samples: makeCollection([{
        _id: new ObjectId(),
        coldChainIncidentId: String(incidentId),
        quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
        release_status: 'QUARANTINE',
        status: 'QUARANTINED',
      }]),
    };
    const db = buildDb(collections);

    const result = await quarantineService.markColdChainIncidentSamplesForReview(db, { _id: incidentId });

    expect(result.reviewRequired).toBe(true);
    expect(result.matched).toBe(1);
    expect(collections.samples.updateMany).toHaveBeenCalledTimes(1);
    const update = collections.samples.updateMany.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      availabilityStatus: 'PENDING_REVIEW',
      quarantineStatus: 'PENDING_REVIEW',
      coldChainStatus: 'INCIDENT_RESOLVED_REVIEW_REQUIRED',
      coldChainReviewRequired: true,
    });
    expect(update.coldChainIncidentResolvedAt).toBeInstanceOf(Date);
    expect(update.status).not.toBe('AVAILABLE');
    expect(update.release_status).not.toBe('AVAILABLE');
    expect(update.availabilityStatus).not.toBe('AVAILABLE');
  });
});
