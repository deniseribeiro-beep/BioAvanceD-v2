import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const TemperatureModel = require('../../src/models/Temperature');
const logger = require('../../src/utils/logger');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const notificationServiceV2 = require('../../src/services/NotificationService');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const temperatureService = require('../../src/services/temperature.service');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDb(collections = {}) {
  return {
    collection: vi.fn((name) => collections[name])
  };
}

function makeFindChain(docs) {
  const toArray = vi.fn().mockResolvedValue(docs);
  const skip = vi.fn().mockReturnValue({ toArray });
  const limit = vi.fn().mockReturnValue({ skip });
  const sort = vi.fn().mockReturnValue({ limit });
  return { sort, limit, skip, toArray };
}

describe('temperatureService.createTemperatureReading', () => {
  it('throws a joined validation error message when validation fails', async () => {
    vi.spyOn(TemperatureModel, 'validate').mockReturnValue({
      isValid: false,
      errors: ['sensorId é obrigatório', 'temperatureValue é obrigatório e deve ser number']
    });

    await expect(
      temperatureService.createTemperatureReading({}, {})
    ).rejects.toThrow('sensorId é obrigatório, temperatureValue é obrigatório e deve ser number');
  });

  it('does not call checkPolicyAndAlert when no policyId/policyID present', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc123' });
    const db = makeDb({ temperatures: { insertOne } });
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5
    });

    expect(checkSpy).not.toHaveBeenCalled();
    expect(insertOne).toHaveBeenCalled();
    expect(result._id).toBe('abc123');
  });

  it('calls checkPolicyAndAlert when policyId is present', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'id1' });
    const db = makeDb({ temperatures: { insertOne } });
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      policyId: 'p1'
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('calls checkPolicyAndAlert when policyID (alternate casing) is present', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'id2' });
    const db = makeDb({ temperatures: { insertOne } });
    const checkSpy = vi.spyOn(temperatureService, 'checkPolicyAndAlert').mockResolvedValue(undefined);
    vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      policyID: 'p2'
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('fires the influx enqueue with the inserted _id merged into the reading', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'influx-id' });
    const db = makeDb({ temperatures: { insertOne } });
    const enqueueSpy = vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    await temperatureService.createTemperatureReading(db, {
      sensorId: 'sensor-x',
      temperatureValue: 3.5
    });

    // enqueue is fired via Promise.resolve().then(), flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const arg = enqueueSpy.mock.calls[0][0];
    expect(arg._id).toBe('influx-id');
    expect(arg.sensorId).toBe('sensor-x');
    expect(arg.temperatureValue).toBe(3.5);
  });

  // #636: organizationId, when provided, must resolve to a real
  // Organization -- same write-time validation shape #634/#635 used.
  it('throws a 404 when organizationId does not resolve to a real Organization', async () => {
    const organizations = { findOne: vi.fn().mockResolvedValue(null) };
    const insertOne = vi.fn();
    const db = makeDb({ temperatures: { insertOne }, organizations });

    const err = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      organizationId: 'org-inexistente'
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('org-inexistente');
    expect(err.statusCode).toBe(404);
    expect(organizations.findOne).toHaveBeenCalledWith({ organizationId: 'org-inexistente' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('creates a reading with organizationId when it resolves to a real Organization', async () => {
    const organizations = { findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) };
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc123' });
    const db = makeDb({ temperatures: { insertOne }, organizations });
    vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5,
      organizationId: 'org-1'
    });

    expect(result.organizationId).toBe('org-1');
  });

  it('leaves organizationId null when not provided (no backfill, unscoped/legacy by default)', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'abc123' });
    const db = makeDb({ temperatures: { insertOne } });
    vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});

    const result = await temperatureService.createTemperatureReading(db, {
      sensorId: 's1',
      temperatureValue: 5
    });

    expect(result.organizationId).toBeNull();
  });

  it('propagates (rejects) when insertOne throws, and logs the error', async () => {
    const insertOne = vi.fn().mockRejectedValue(new Error('mongo down'));
    const db = makeDb({ temperatures: { insertOne } });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      temperatureService.createTemperatureReading(db, {
        sensorId: 's1',
        temperatureValue: 1
      })
    ).rejects.toThrow('mongo down');

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('temperatureService.checkPolicyAndAlert', () => {
  it('does not query for or apply a policy when no policyId/policyID is present (#73)', async () => {
    const findOne = vi.fn().mockResolvedValue({ minTemp: 0, maxTemp: 10 });
    const insertOne = vi.fn();
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { temperatureValue: 999 })
    ).resolves.toBeUndefined();

    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('resolves without inserting an alert when no policy is found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn();
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', temperatureValue: 5 })
    ).resolves.toBeUndefined();

    expect(insertOne).not.toHaveBeenCalled();
  });

  it('does not create an alert when the reading is within thresholds', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn();
    // #1079: the in-range branch now resolves active threshold alerts, so
    // this fixture needs updateMany or the call lands in the catch and the
    // assertion below passes for the wrong reason.
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany } });

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      temperatureValue: 5
    });

    expect(insertOne).not.toHaveBeenCalled();
  });

  it('inserts an alert and notifies when the reading is outside policy thresholds', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne } });
    const notifySpy = vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      sampleId: 'sample-1',
      temperatureValue: 99
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const alertDoc = insertOne.mock.calls[0][0];
    expect(alertDoc.sensorId).toBe('sensor-a');
    expect(alertDoc.policyId).toBe('p1');
    expect(alertDoc.temperatureValue).toBe(99);
    expect(alertDoc.threshold).toEqual({ min: 0, max: 10 });
    expect(alertDoc.status).toBe('active');

    expect(notifySpy).toHaveBeenCalledWith('sample-1', 99);

    // #646 Wave 3 (RF015/RNF026) - the rule-driven notification engine is
    // also fired from this real critical-alert trigger, alongside (not
    // instead of) the legacy sendCriticalTempAlert call above.
    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'environmental_excursion',
      sourceEventType: 'TemperatureAlert',
      sourceEventId: 'alert1',
      payload: { sensorId: 'sensor-a', temperatureValue: 99, minThreshold: 0, maxThreshold: 10 }
    });
  });

  it('does not let a rejected notification dispatch break the alert flow (fire-and-forget)', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue(new Error('no active rule collection'));

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', sensorId: 'sensor-a', temperatureValue: 99 })
    ).resolves.toBeUndefined();

    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  // #1079: the alerts collection has two writers with disjoint shapes.
  // scheduler.service.js emits type: 'missing_reading'/'stale_reading' and
  // both of its lifecycle helpers filter on { sensorId, type, status }, so
  // this writer's untyped document could be matched by neither -- threshold
  // breaches were never deduplicated and never resolved.
  it('#1079: tags the alert with a threshold_breach type so the scheduler lifecycle helpers can match it', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 99
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0][0].type).toBe('threshold_breach');
  });

  it('#1079: resolves active threshold alerts for the sensor once a reading is back within range', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany } });

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 5
    });

    expect(insertOne).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({ sensorId: 'sensor-a', type: 'threshold_breach', status: 'active' });
    expect(updateMany.mock.calls[0][1].$set.status).toBe('resolved');
    expect(updateMany.mock.calls[0][1].$set.resolvedAt).toBeInstanceOf(Date);
  });

  // Control: the resolve must not fire while the reading is still bad, or a
  // sensor sitting out of range would clear its own alert on every reading.
  it('#1079: does not resolve anything while the reading is still out of range', async () => {
    const policy = { minTemp: 0, maxTemp: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = makeDb({ temperaturePolicies: { findOne }, alerts: { insertOne, updateMany } });
    vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      sensorId: 'sensor-a',
      temperatureValue: 99
    });

    expect(updateMany).not.toHaveBeenCalled();
  });
  it('swallows internal errors (e.g. policiesCollection.findOne rejecting) and resolves', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db unreachable'));
    const db = makeDb({ temperaturePolicies: { findOne } });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', temperatureValue: 5 })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('temperatureService.getTemperatureHistory', () => {
  it('uses default limit and skip, and _id sort when no timestamp/dateTime docs exist', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    const result = await temperatureService.getTemperatureHistory(db, {});

    expect(result.limit).toBe(1000);
    expect(result.skip).toBe(0);
    expect(chain.sort).toHaveBeenCalledWith({ _id: -1 });
    expect(find).toHaveBeenCalledWith({});
  });

  // #917: was a two-branch `$or` over sensorId/sensorID. Nothing ever wrote
  // the capitalised key -- TemperatureModel.create coalesces it into
  // `sensorId` on the way in, and has since the initial commit -- so the
  // second branch matched nothing and the filter is now a plain key.
  it('builds a plain sensorId filter', async () => {
    const findOne = vi.fn().mockResolvedValue({ timestamp: new Date() });
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    await temperatureService.getTemperatureHistory(db, { sensorId: 'sensor-1' });

    expect(find).toHaveBeenCalledWith({ sensorId: 'sensor-1' });
    expect(chain.sort).toHaveBeenCalledWith({ timestamp: -1 });
  });

  it('builds a date-range-only $or filter across timestamp and dateTime', async () => {
    const findOne = vi.fn().mockResolvedValue(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ dateTime: new Date() });
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    const start = '2024-01-01';
    const end = '2024-01-31';
    await temperatureService.getTemperatureHistory(db, { startDate: start, endDate: end });

    const calledQuery = find.mock.calls[0][0];
    expect(calledQuery.$or).toEqual([
      { timestamp: { $gte: new Date(start), $lte: new Date(end) } },
      { dateTime: { $gte: new Date(start), $lte: new Date(end) } }
    ]);
    // second findOne fallback found a dateTime doc -> sort by dateTime
    expect(chain.sort).toHaveBeenCalledWith({ dateTime: -1 });
  });

  // #917: this used to assert an `$and` wrapper. That merge branch existed
  // only because the sensor filter was itself an `$or`; with a plain
  // `sensorId` key the two conditions compose as siblings, which is the same
  // query one wrapper shallower. The date-range `$or` is unchanged.
  it('composes sensorId + date-range filters as sibling keys, no $and wrapper', async () => {
    const findOne = vi.fn().mockResolvedValue({ timestamp: new Date() });
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    const start = '2024-02-01';
    await temperatureService.getTemperatureHistory(db, {
      sensorId: 'sensor-9',
      startDate: start
    });

    const calledQuery = find.mock.calls[0][0];
    expect(calledQuery.$and).toBeUndefined();
    expect(calledQuery.sensorId).toBe('sensor-9');
    expect(calledQuery.$or).toEqual([
      { timestamp: { $gte: new Date(start) } },
      { dateTime: { $gte: new Date(start) } }
    ]);
  });

  // #636 (F3-G09): an organization-scoped caller must only see readings
  // whose organizationId is one of their scoped organizations -- a null
  // organizationId (unscoped/legacy reading) must not be exposed.
  it('applies an organizationId $in filter for an organization-scoped caller', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    await temperatureService.getTemperatureHistory(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
    });

    expect(find).toHaveBeenCalledWith({ organizationId: { $in: ['org-1'] } });
  });

  it('does not filter by organizationId for a global-scope caller (Administrador)', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    await temperatureService.getTemperatureHistory(db, { organizationScope: { scope: 'global' } });

    expect(find).toHaveBeenCalledWith({});
  });

  it('passes custom limit and skip through, and uses countDocuments for total', async () => {
    const findOne = vi.fn().mockResolvedValue({ timestamp: new Date() });
    const docs = [{ _id: 1 }, { _id: 2 }];
    const chain = makeFindChain(docs);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(42);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    const result = await temperatureService.getTemperatureHistory(db, { limit: 5, skip: 10 });

    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(result.temperatures).toEqual(docs);
    expect(result.total).toBe(42);
  });
});

describe('temperatureService.getActiveAlerts', () => {
  it('returns [] immediately without calling .collection when db is falsy', async () => {
    const result = await temperatureService.getActiveAlerts(null);
    expect(result).toEqual([]);
  });

  it('returns the array from toArray() on success', async () => {
    const docs = [{ status: 'active', sensorId: 's1' }];
    const toArray = vi.fn().mockResolvedValue(docs);
    // #1079: the read is bounded now, so the chain gains a .limit() stage.
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    // #1062: getActiveAlerts now takes the caller's resolved scope and
    // filters on it. Called without one it fails CLOSED and returns []
    // without querying, which is pinned separately below -- so this case
    // supplies a scope and asserts the scoped query.
    const result = await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
    });

    expect(find).toHaveBeenCalledWith({ status: 'active', organizationId: { $in: ['org-a'] } });
    expect(sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(result).toEqual(docs);
  });

  // #1062: fail-closed. A missing scope means requireOrganizationScope is
  // not on the route; returning [] is the refusal, and it must not fall
  // through to an unfiltered query the way this module's sibling read does.
  it('returns [] without querying when no organizationScope is supplied (fail-closed)', async () => {
    const find = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ find }) };

    const result = await temperatureService.getActiveAlerts(db);

    expect(result).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  // #1079: the only read of this collection was unbounded -- no limit, no
  // projection, toArray() over a set that only ever grew.
  it('#1079: bounds the active-alert read with the default limit', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
    });

    expect(limit).toHaveBeenCalledWith(1000);
  });

  it('#1079: honours a caller-supplied limit, same as getTemperatureHistory', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit, toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    await temperatureService.getActiveAlerts(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-a'] },
      limit: 50,
    });

    expect(limit).toHaveBeenCalledWith(50);
  });
  it('swallows a thrown error from .find and returns []', async () => {
    const find = vi.fn(() => {
      throw new Error('sensors offline');
    });
    const db = makeDb({ alerts: { find } });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const result = await temperatureService.getActiveAlerts(db);

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
