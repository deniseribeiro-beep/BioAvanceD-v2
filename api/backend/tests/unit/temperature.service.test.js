import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const TemperatureModel = require('../../src/models/Temperature');
const logger = require('../../src/utils/logger');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const notificationServiceV2 = require('../../src/services/NotificationService');
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
    const findOne = vi.fn().mockResolvedValue({ minThreshold: 0, maxThreshold: 10 });
    const insertOne = vi.fn();
    const db = makeDb({ policies: { findOne }, alerts: { insertOne } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { temperatureValue: 999 })
    ).resolves.toBeUndefined();

    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('resolves without inserting an alert when no policy is found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn();
    const db = makeDb({ policies: { findOne }, alerts: { insertOne } });

    await expect(
      temperatureService.checkPolicyAndAlert(db, { policyId: 'p1', temperatureValue: 5 })
    ).resolves.toBeUndefined();

    expect(insertOne).not.toHaveBeenCalled();
  });

  it('does not create an alert when the reading is within thresholds', async () => {
    const policy = { minThreshold: 0, maxThreshold: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn();
    const db = makeDb({ policies: { findOne }, alerts: { insertOne } });

    await temperatureService.checkPolicyAndAlert(db, {
      policyId: 'p1',
      temperatureValue: 5
    });

    expect(insertOne).not.toHaveBeenCalled();
  });

  it('inserts an alert and notifies when the reading is outside policy thresholds', async () => {
    const policy = { minThreshold: 0, maxThreshold: 10 };
    const findOne = vi.fn().mockResolvedValue(policy);
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert1' });
    const db = makeDb({ policies: { findOne }, alerts: { insertOne } });
    const notifySpy = vi.spyOn(notificationServiceV2, 'sendCriticalTempAlert').mockResolvedValue(undefined);

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
  });

  it('swallows internal errors (e.g. policiesCollection.findOne rejecting) and resolves', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('db unreachable'));
    const db = makeDb({ policies: { findOne } });
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

  it('builds a sensorId-only $or filter', async () => {
    const findOne = vi.fn().mockResolvedValue({ timestamp: new Date() });
    const chain = makeFindChain([]);
    const find = vi.fn().mockReturnValue(chain);
    const countDocuments = vi.fn().mockResolvedValue(0);
    const db = makeDb({ temperatures: { findOne, find, countDocuments } });

    await temperatureService.getTemperatureHistory(db, { sensorId: 'sensor-1' });

    expect(find).toHaveBeenCalledWith({
      $or: [{ sensorId: 'sensor-1' }, { sensorID: 'sensor-1' }]
    });
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

  it('merges sensorId + date-range filters into an $and query (dedicated branch)', async () => {
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
    expect(calledQuery.$or).toBeUndefined();
    expect(calledQuery.$and).toEqual([
      { $or: [{ sensorId: 'sensor-9' }, { sensorID: 'sensor-9' }] },
      { $or: [{ timestamp: { $gte: new Date(start) } }, { dateTime: { $gte: new Date(start) } }] }
    ]);
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
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const db = makeDb({ alerts: { find } });

    const result = await temperatureService.getActiveAlerts(db);

    expect(find).toHaveBeenCalledWith({ status: 'active' });
    expect(sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(result).toEqual(docs);
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
