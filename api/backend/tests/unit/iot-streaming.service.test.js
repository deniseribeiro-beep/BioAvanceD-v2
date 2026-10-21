import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = require('../../src/services/iot-streaming.service');
const queueConfig = require('../../src/config/queue');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../src/utils/logger');
const { createFakeCollection, createFakeDb } = require('./ingestion/testHelpers');

function makeSocket(id = 'sock1') {
  return { id, emit: vi.fn(), join: vi.fn() };
}

describe('iot-streaming.service', () => {
  beforeEach(() => {
    service.activeStreams.clear();
    service.io = null;
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleDeviceRegistration', () => {
    it('emits error and does not register when deviceId is missing', async () => {
      const socket = makeSocket();
      await service.handleDeviceRegistration(socket, { sensorId: 's1' });

      expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
      expect(service.activeStreams.size).toBe(0);
    });

    it('emits error and does not register when sensorId is missing', async () => {
      const socket = makeSocket();
      await service.handleDeviceRegistration(socket, { deviceId: 'd1' });

      expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
      expect(service.activeStreams.size).toBe(0);
    });

    it('registers device, joins room, and emits device-registered for valid data', async () => {
      const socket = makeSocket('sock1');
      await service.handleDeviceRegistration(socket, {
        deviceId: 'd1',
        sensorId: 's1',
        locationId: 'loc1',
        facility: 'fac1',
        zone: 'zone1',
      });

      expect(service.activeStreams.has('d1')).toBe(true);
      const entry = service.activeStreams.get('d1');
      expect(entry.socketId).toBe('sock1');
      expect(entry.sensorId).toBe('s1');
      expect(socket.join).toHaveBeenCalledWith('device-d1');
      expect(socket.emit).toHaveBeenCalledWith('device-registered', expect.objectContaining({ deviceId: 'd1' }));
    });
  });

  describe('handleTemperatureData', () => {
    it('emits error when deviceId is missing', async () => {
      const socket = makeSocket();
      await service.handleTemperatureData(socket, { temperature: 5 });

      expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
    });

    it('emits error when temperature is undefined', async () => {
      const socket = makeSocket();
      await service.handleTemperatureData(socket, { deviceId: 'd1' });

      expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
    });

    it('emits "não registrado" error when device is not registered', async () => {
      const socket = makeSocket();
      await service.handleTemperatureData(socket, { deviceId: 'unknown-device', temperature: 5 });

      expect(socket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('não registrado') })
      );
    });

    it('enqueues a job and emits temperature-received for a registered device', async () => {
      // The service destructures `{ getQueue } = require('../config/queue')` at
      // require-time, so spying on the module's export after it has already been
      // required does not affect the local binding. Clear Node's CJS require
      // cache, spy first, then re-require the service so the destructuring
      // picks up the mock.
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/iot-streaming.service')];
      const freshQueueConfig = require('../../src/config/queue');
      const addMock = vi.fn().mockResolvedValue({ id: 'job1' });
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue({ add: addMock });
      const freshService = require('../../src/services/iot-streaming.service');

      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1', locationId: 'loc1' });

      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 21.5, batteryLevel: '80', signalQuality: 'good' });

      expect(addMock).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = addMock.mock.calls[0];
      expect(jobName).toBe('temperature-iot');
      expect(payload.deviceId).toBe('d1');
      expect(payload.temperatureData.sensorId).toBe('s1');
      expect(payload.temperatureData.temperatureValue).toBe(21.5);
      expect(opts).toEqual(expect.objectContaining({ priority: 5, jobId: expect.any(String) }));

      expect(socket.emit).toHaveBeenCalledWith('temperature-received', expect.objectContaining({ deviceId: 'd1' }));
    });

    // RF009 AC7 (#1317): the client's contract fields reach the queued
    // reading, so its idempotencyKey replays there.
    it("passes a socket payload's idempotencyKey and deviceMessageId on to the job, and adds neither when absent", async () => {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/iot-streaming.service')];
      const freshQueueConfig = require('../../src/config/queue');
      const addMock = vi.fn().mockResolvedValue({ id: 'job1' });
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue({ add: addMock });
      const freshService = require('../../src/services/iot-streaming.service');

      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1', locationId: 'loc1' });
      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 4, idempotencyKey: 'k-1', deviceMessageId: 'm-1' });
      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 4 });

      expect(addMock.mock.calls[0][1].temperatureData).toMatchObject({ idempotencyKey: 'k-1', deviceMessageId: 'm-1' });
      expect(addMock.mock.calls[1][1].temperatureData).not.toHaveProperty('idempotencyKey');
      expect(addMock.mock.calls[1][1].temperatureData).not.toHaveProperty('deviceMessageId');
    });

    it('a socket payload with contract fields the contract refuses is queued and stored without them', async () => {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/iot-streaming.service')];
      const freshQueueConfig = require('../../src/config/queue');
      const addMock = vi.fn().mockResolvedValue({ id: 'job1' });
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue({ add: addMock });
      const freshService = require('../../src/services/iot-streaming.service');
      vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const temperatures = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'temp-id-1' }) };
      const db = { collection: vi.fn(() => temperatures) };

      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1', locationId: 'loc1' });
      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 4, deviceMessageId: 12345, sequenceNumber: '7', idempotencyKey: '  ' });

      const { temperatureData } = addMock.mock.calls[0][1];
      const readingId = await freshService.processTemperatureData(db, temperatureData);
      const stored = temperatures.insertOne.mock.calls[0][0];
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(stored.idempotencyKeySource).toBe('derived');
      expect(stored.deviceMessageId).toBeNull();
      expect(stored.sequenceNumber).toBeNull();
    });

    it('emits error when the queue rejects', async () => {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/iot-streaming.service')];
      const freshQueueConfig = require('../../src/config/queue');
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue({
        add: vi.fn().mockRejectedValue(new Error('queue down')),
      });
      const freshService = require('../../src/services/iot-streaming.service');

      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1' });
      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 10 });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'queue down' });
    });
  });

  describe('handleDeviceDisconnection', () => {
    it('removes the matching entry by socketId', async () => {
      const socket = makeSocket('sock1');
      await service.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1' });
      expect(service.activeStreams.has('d1')).toBe(true);

      service.handleDeviceDisconnection(socket);

      expect(service.activeStreams.has('d1')).toBe(false);
    });

    it('is a no-op when no entry matches the socket', () => {
      const socket = makeSocket('unknown-sock');
      expect(() => service.handleDeviceDisconnection(socket)).not.toThrow();
      expect(service.activeStreams.size).toBe(0);
    });
  });

  describe('processTemperatureData', () => {
    // The Mongo copy, and RF029's key store as the shared query-matching
    // fake (#1391); any other collection is unexpected here.
    function makeDb(keyRows = []) {
      const temperaturesCollection = {
        collectionName: 'temperatures',
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'temp-id-1' }),
      };
      const fake = createFakeDb({ ingestionIdempotencyKeys: keyRows });
      const keys = fake.collections.ingestionIdempotencyKeys;
      const db = {
        collection: vi.fn((name) => {
          if (name === 'temperatures') return temperaturesCollection;
          if (name === 'ingestionIdempotencyKeys') return keys;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      return { db, temperaturesCollection, keys };
    }

    function completedKey(idempotencyKey, telemetryReadingId, sensorId = 'sensor-1') {
      return {
        idempotencyKey,
        scope: `TelemetryReading:${sensorId}`,
        status: 'completed',
        resultRef: { telemetryReadingId, observedAt: new Date(0), receivedAt: new Date(0), persistedAt: new Date(0), clockStatus: 'synchronized' },
      };
    }

    const baseTemperatureData = {
      sensorId: 'sensor-1',
      temperatureValue: 5,
      temperatureUnit: '°C',
      timestamp: new Date(),
      readingStatus: 'valid',
      sensorStatus: 'normal',
    };

    const persistedAt = new Date('2026-10-10T12:00:01.000Z');
    beforeEach(() => {
      vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(persistedAt);
    });

    // #1317 (RF009 AC1-AC3): the temperature route's reading contract.
    it('writes InfluxDB first, then inserts the reading with its identity and persistedAt, without any FHIR conversion or device collection access', async () => {
      const { db, temperaturesCollection } = makeDb();
      const order = [];
      influxTelemetryWriteRepository.writeTemperatureReadingNow.mockImplementation(async () => { order.push('influx'); return persistedAt; });
      temperaturesCollection.insertOne.mockImplementation(async () => { order.push('mongo'); return { insertedId: 'temp-id-1' }; });

      const readingId = await service.processTemperatureData(db, baseTemperatureData);

      expect(order).toEqual(['influx', 'mongo']);
      const stored = temperaturesCollection.insertOne.mock.calls[0][0];
      // #1391: the reading's id, never the Mongo copy's _id.
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(stored).toMatchObject({ ...baseTemperatureData, clockStatus: 'synchronized', persistedAt });
      expect(stored.telemetryReadingId).toBeTruthy();
      expect(stored.observedAt).toEqual(baseTemperatureData.timestamp);
      expect(db.collection).not.toHaveBeenCalledWith('devices');
    });

    it('a reading with no device time is stored at its receipt time with clockStatus unknown', async () => {
      const { db, temperaturesCollection } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, timestamp: null, source: 'mqtt', createdAt: new Date() });
      const stored = temperaturesCollection.insertOne.mock.calls[0][0];
      expect(stored.clockStatus).toBe('unknown');
      expect(stored.timestamp).toBe(stored.receivedAt);
      expect(stored.ingestionService).toBe('mqtt');
    });

    it('control: a queued reading names the queue as its ingestion service', async () => {
      const { db, temperaturesCollection } = makeDb();
      await service.processTemperatureData(db, baseTemperatureData);
      expect(temperaturesCollection.insertOne.mock.calls[0][0].ingestionService).toBe('iot-queue');
    });

    it('the server-added fields are not part of the payload hash', async () => {
      const { db, temperaturesCollection } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, source: 'mqtt', createdAt: new Date(1), updatedAt: new Date(1) });
      await service.processTemperatureData(db, { ...baseTemperatureData, source: 'mqtt', createdAt: new Date(2), updatedAt: new Date(2) });
      const [first, second] = temperaturesCollection.insertOne.mock.calls.map(([doc]) => doc.payloadHash);
      expect(first).toBe(second);
    });

    // #1317 (V2E-0546, V2E-0547): the datastream and the location come from
    // the binding, never from the payload; this db has no datastreams, so the
    // reading is unbound.
    it('a payload naming its own datastreamId and storageLocationId is stored with both null', async () => {
      const { db, temperaturesCollection } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, datastreamId: 'spoofed', storageLocationId: 'spoofed' });
      const stored = temperaturesCollection.insertOne.mock.calls[0][0];
      expect(stored.datastreamId).toBeNull();
      expect(stored.storageLocationId).toBeNull();
    });

    it('a failed InfluxDB write throws and stores nothing', async () => {
      const { db, temperaturesCollection } = makeDb();
      influxTelemetryWriteRepository.writeTemperatureReadingNow.mockRejectedValue(new Error('influx down'));
      await expect(service.processTemperatureData(db, baseTemperatureData)).rejects.toThrow('influx down');
      expect(temperaturesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('logs and re-throws when insertOne rejects', async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.insertOne.mockRejectedValue(new Error('insert failed'));

      await expect(service.processTemperatureData(db, baseTemperatureData)).rejects.toThrow('insert failed');
    });

    // RF009 AC7 (#1317, #1391): a client idempotencyKey replays here as on
    // the temperature route, from RF029's key store under the same scope.
    it('a completed client key for the sensor returns its telemetryReadingId and writes nothing', async () => {
      const { db, temperaturesCollection } = makeDb([completedKey('k-1', 'r-first')]);

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-1' });

      expect(readingId).toBe('r-first');
      expect(temperaturesCollection.findOne).not.toHaveBeenCalled();
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).not.toHaveBeenCalled();
      expect(temperaturesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('control: a new client key records one key row with the five resultRef keys, and is inserted once', async () => {
      const { db, temperaturesCollection, keys } = makeDb();

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-2' });

      expect(temperaturesCollection.insertOne).toHaveBeenCalledTimes(1);
      const stored = temperaturesCollection.insertOne.mock.calls[0][0];
      expect(stored).toMatchObject({ idempotencyKey: 'k-2', idempotencyKeySource: 'client' });
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(keys.docs).toHaveLength(1);
      expect(keys.docs[0]).toMatchObject({ idempotencyKey: 'k-2', scope: 'TelemetryReading:sensor-1', status: 'completed' });
      expect(Object.keys(keys.docs[0].resultRef).sort()).toEqual(['clockStatus', 'observedAt', 'persistedAt', 'receivedAt', 'telemetryReadingId']);
      expect(keys.docs[0].resultRef).toMatchObject({ telemetryReadingId: readingId, persistedAt });
      expect(keys.docs[0].resultRef).not.toHaveProperty('temperatureValue');
    });

    it("a concurrent send that loses the key-store race returns the winner's id and stores no copy", async () => {
      const { db, temperaturesCollection, keys } = makeDb();
      // The winner records the same key between this send's lookup and record.
      const upsert = keys.updateOne;
      keys.updateOne = async (filter, update, options) => {
        keys.docs.push(completedKey('k-3', 'r-winner'));
        return upsert(filter, update, options);
      };

      await expect(service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-3' })).resolves.toBe('r-winner');
      expect(temperaturesCollection.insertOne).not.toHaveBeenCalled();
      expect(keys.docs).toHaveLength(1);
    });

    it('a failing key-store lookup is logged without the key, and the reading is stored', async () => {
      const { db, temperaturesCollection, keys } = makeDb();
      keys.findOne = vi.fn().mockRejectedValue(new Error('key store down'));

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-secret-5' });

      expect(temperaturesCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(readingId).toBe(temperaturesCollection.insertOne.mock.calls[0][0].telemetryReadingId);
      expect(logger.error).toHaveBeenCalled();
      expect(logger.error.mock.calls.map((args) => args.join(' ')).join(' ')).not.toContain('k-secret-5');
    });

    // The scope is the sensorId as text, so a numeric sensorId replays too.
    it('a numeric sensorId resent under one client key writes InfluxDB once and replays the first reading', async () => {
      const temperatures = createFakeCollection([]);
      const insert = temperatures.insertOne;
      temperatures.insertOne = (doc) => insert({ ...doc, _id: `temp-id-${temperatures.docs.length + 1}` });
      const others = createFakeCollection([]);
      const db = { collection: vi.fn((name) => (name === 'temperatures' ? temperatures : others)) };
      const reading = { ...baseTemperatureData, sensorId: 101, idempotencyKey: 'k-num', source: 'mqtt' };

      const first = await service.processTemperatureData(db, reading);
      const second = await service.processTemperatureData(db, { ...reading });

      expect(second).toBe(first);
      expect(first).toBe(temperatures.docs[0].telemetryReadingId);
      expect(temperatures.docs).toHaveLength(1);
      expect(others.docs.filter((doc) => doc.scope)).toMatchObject([{ idempotencyKey: 'k-num', scope: 'TelemetryReading:101' }]);
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).toHaveBeenCalledTimes(1);
    });

    it('control: a derived key never touches the key store, and an insert error still throws', async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(service.processTemperatureData(db, baseTemperatureData)).rejects.toThrow(/E11000/);
      expect(temperaturesCollection.findOne).not.toHaveBeenCalled();
      expect(db.collection).not.toHaveBeenCalledWith('ingestionIdempotencyKeys');
    });
  });

  describe('getActiveStreams', () => {
    it('returns an empty array when there are no active streams', () => {
      expect(service.getActiveStreams()).toEqual([]);
    });

    it('returns the shape {deviceId, sensorId, locationId, connectedAt} for each active stream', async () => {
      const socket = makeSocket('sock1');
      await service.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1', locationId: 'loc1' });

      const streams = service.getActiveStreams();

      expect(streams).toHaveLength(1);
      expect(streams[0]).toEqual({
        deviceId: 'd1',
        sensorId: 's1',
        locationId: 'loc1',
        connectedAt: expect.any(Date),
      });
    });
  });

  describe('initSocketIO', () => {
    it('sets and returns this.io, and is idempotent on a second call', () => {
      const fakeServer = {};
      const io1 = service.initSocketIO(fakeServer);

      expect(service.io).toBe(io1);
      expect(io1).toBeTruthy();

      const io2 = service.initSocketIO(fakeServer);
      expect(io2).toBe(io1);
    });
  });
});
