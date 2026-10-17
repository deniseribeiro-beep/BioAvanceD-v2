import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = require('../../src/services/iot-streaming.service');
const queueConfig = require('../../src/config/queue');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../src/utils/logger');
const { createFakeCollection } = require('./ingestion/testHelpers');

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
      await expect(freshService.processTemperatureData(db, temperatureData)).resolves.toBe('temp-id-1');
      const stored = temperatures.insertOne.mock.calls[0][0];
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
    // A collection name per case, so the per-collection index latch never
    // carries over from one case to the next.
    let collectionCount = 0;
    function makeDb() {
      collectionCount += 1;
      const temperaturesCollection = {
        collectionName: `temperatures_streaming_case_${collectionCount}`,
        createIndex: vi.fn().mockResolvedValue('ok'),
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'temp-id-1' }),
      };
      const db = {
        collection: vi.fn((name) => {
          if (name === 'temperatures') return temperaturesCollection;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      return { db, temperaturesCollection };
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

      const insertedId = await service.processTemperatureData(db, baseTemperatureData);

      expect(insertedId).toBe('temp-id-1');
      expect(order).toEqual(['influx', 'mongo']);
      const stored = temperaturesCollection.insertOne.mock.calls[0][0];
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

    // RF009 AC7 (#1317): a client idempotencyKey replays here as on the
    // temperature route, against the same per-sensor key.
    it('a client key already stored for the sensor returns the stored id and writes nothing', async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.findOne.mockResolvedValue({ _id: 'stored-id', sensorId: 'sensor-1', idempotencyKey: 'k-1' });

      const insertedId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-1' });

      expect(insertedId).toBe('stored-id');
      expect(temperaturesCollection.findOne).toHaveBeenCalledWith({ sensorId: 'sensor-1', idempotencyKey: 'k-1', idempotencyKeySource: 'client' });
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).not.toHaveBeenCalled();
      expect(temperaturesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('control: a new client key is inserted once, after the unique client-key index is built', async () => {
      const { db, temperaturesCollection } = makeDb();

      const insertedId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-2' });

      expect(insertedId).toBe('temp-id-1');
      expect(temperaturesCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(temperaturesCollection.insertOne.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'k-2', idempotencyKeySource: 'client' });
      expect(temperaturesCollection.createIndex).toHaveBeenCalledWith(
        { sensorId: 1, idempotencyKey: 1 },
        expect.objectContaining({ unique: true, name: 'temperatures_client_idempotencyKey_v1' })
      );
    });

    it("a concurrent send that loses the unique index race returns the winner's id", async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'winner-id', idempotencyKey: 'k-3' });
      temperaturesCollection.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-3' })).resolves.toBe('winner-id');
    });

    // Mongo matches type-strictly, so the replay filter carries the sensorId
    // as the reading stores it: a numeric one stays a number.
    it('a numeric sensorId resent under one client key writes InfluxDB once and replays the stored reading', async () => {
      const temperatures = createFakeCollection([]);
      const insert = temperatures.insertOne;
      temperatures.insertOne = (doc) => insert({ ...doc, _id: `temp-id-${temperatures.docs.length + 1}` });
      const others = createFakeCollection([]);
      const db = { collection: vi.fn((name) => (name === 'temperatures' ? temperatures : others)) };
      const reading = { ...baseTemperatureData, sensorId: 101, idempotencyKey: 'k-num', source: 'mqtt' };

      const first = await service.processTemperatureData(db, reading);
      const second = await service.processTemperatureData(db, { ...reading });

      expect(second).toBe(first);
      expect(temperatures.docs).toHaveLength(1);
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).toHaveBeenCalledTimes(1);
    });

    it('control: a duplicate-key error without a client key still throws', async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(service.processTemperatureData(db, baseTemperatureData)).rejects.toThrow(/E11000/);
      expect(temperaturesCollection.findOne).not.toHaveBeenCalled();
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
