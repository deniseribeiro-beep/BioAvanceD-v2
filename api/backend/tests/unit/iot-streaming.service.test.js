import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = require('../../src/services/iot-streaming.service');
const queueConfig = require('../../src/config/queue');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../src/utils/logger');
const auditLogger = require('../../src/utils/auditLogger');
const mongoConnection = require('../../src/infrastructure/database/mongodb/connection');
const { createFakeDb } = require('./ingestion/testHelpers');

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
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const fake = createFakeDb();
      const db = { collection: vi.fn((name) => fake.collection(name)) };

      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1', locationId: 'loc1' });
      await freshService.handleTemperatureData(socket, { deviceId: 'd1', temperature: 4, deviceMessageId: 12345, sequenceNumber: '7', idempotencyKey: '  ' });

      const { temperatureData } = addMock.mock.calls[0][1];
      const readingId = await freshService.processTemperatureData(db, temperatureData);
      const stored = write.mock.calls[0][0];
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(stored.idempotencyKeySource).toBe('derived');
      expect(stored.deviceMessageId).toBeNull();
      expect(stored.sequenceNumber).toBeNull();
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
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
    // RF029's key store as the shared query-matching fake (#1391); any other
    // collection is unexpected here, the retired `temperatures` copy
    // included: InfluxDB is the reading's only store (RF009 AC1).
    function makeDb(keyRows = []) {
      const fake = createFakeDb({ ingestionIdempotencyKeys: keyRows });
      const keys = fake.collections.ingestionIdempotencyKeys;
      const db = {
        collection: vi.fn((name) => {
          if (name === 'ingestionIdempotencyKeys') return keys;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      return { db, keys };
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

    const written = () => influxTelemetryWriteRepository.writeTemperatureReadingNow.mock.calls.map(([reading]) => reading);

    // #1317 (RF009 AC1-AC3): the temperature route's reading contract.
    it('writes the reading with its identity to InfluxDB, without any FHIR conversion or device collection access', async () => {
      const { db } = makeDb();

      const readingId = await service.processTemperatureData(db, baseTemperatureData);

      const [stored] = written();
      // #1391: the reading's id, never a Mongo _id.
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(stored).toMatchObject({ ...baseTemperatureData, clockStatus: 'synchronized', persistedAt });
      expect(stored.telemetryReadingId).toBeTruthy();
      expect(stored.observedAt).toEqual(baseTemperatureData.timestamp);
      expect(db.collection).not.toHaveBeenCalledWith('devices');
    });

    it('writes no Mongo temperatures copy', async () => {
      const { db } = makeDb();
      await service.processTemperatureData(db, baseTemperatureData);
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    });

    it('a client key is recorded after the confirmed InfluxDB write', async () => {
      const { db, keys } = makeDb();
      const order = [];
      influxTelemetryWriteRepository.writeTemperatureReadingNow.mockImplementation(async () => { order.push('influx'); return persistedAt; });
      const upsert = keys.updateOne;
      keys.updateOne = async (filter, update, options) => { order.push('key store'); return upsert(filter, update, options); };

      await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-order' });

      expect(order).toEqual(['influx', 'key store']);
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    });

    it('a reading with no device time is stored at its receipt time with clockStatus unknown', async () => {
      const { db } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, timestamp: null, source: 'mqtt', createdAt: new Date() });
      const [stored] = written();
      expect(stored.clockStatus).toBe('unknown');
      expect(stored.timestamp).toBe(stored.receivedAt);
      expect(stored.ingestionService).toBe('mqtt');
    });

    it('control: a queued reading names the queue as its ingestion service', async () => {
      const { db } = makeDb();
      await service.processTemperatureData(db, baseTemperatureData);
      expect(written()[0].ingestionService).toBe('iot-queue');
    });

    it('the server-added fields are not part of the payload hash', async () => {
      const { db } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, source: 'mqtt', createdAt: new Date(1), updatedAt: new Date(1) });
      await service.processTemperatureData(db, { ...baseTemperatureData, source: 'mqtt', createdAt: new Date(2), updatedAt: new Date(2) });
      const [first, second] = written().map((reading) => reading.payloadHash);
      expect(first).toBe(second);
    });

    // #1317 (V2E-0546, V2E-0547): the datastream and the location come from
    // the binding, never from the payload; this db has no datastreams, so the
    // reading is unbound.
    it('a payload naming its own datastreamId and storageLocationId is stored with both null', async () => {
      const { db } = makeDb();
      await service.processTemperatureData(db, { ...baseTemperatureData, datastreamId: 'spoofed', storageLocationId: 'spoofed' });
      const [stored] = written();
      expect(stored.datastreamId).toBeNull();
      expect(stored.storageLocationId).toBeNull();
    });

    it('a failed InfluxDB write throws and records no client key', async () => {
      const { db, keys } = makeDb();
      influxTelemetryWriteRepository.writeTemperatureReadingNow.mockRejectedValue(new Error('influx down'));
      await expect(service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-down' })).rejects.toThrow('influx down');
      expect(keys.docs).toHaveLength(0);
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    });

    // RF009 AC7 (#1317, #1391): a client idempotencyKey replays here as on
    // the temperature route, from RF029's key store under the same scope.
    it('a completed client key for the sensor returns its telemetryReadingId and writes nothing', async () => {
      const { db } = makeDb([completedKey('k-1', 'r-first')]);

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-1' });

      expect(readingId).toBe('r-first');
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).not.toHaveBeenCalled();
    });

    it('control: a new client key records one key row with the five resultRef keys, and is written once', async () => {
      const { db, keys } = makeDb();

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-2' });

      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).toHaveBeenCalledTimes(1);
      const [stored] = written();
      expect(stored).toMatchObject({ idempotencyKey: 'k-2', idempotencyKeySource: 'client' });
      expect(readingId).toBe(stored.telemetryReadingId);
      expect(keys.docs).toHaveLength(1);
      expect(keys.docs[0]).toMatchObject({ idempotencyKey: 'k-2', scope: 'TelemetryReading:sensor-1', status: 'completed' });
      expect(Object.keys(keys.docs[0].resultRef).sort()).toEqual(['clockStatus', 'observedAt', 'persistedAt', 'receivedAt', 'telemetryReadingId']);
      expect(keys.docs[0].resultRef).toMatchObject({ telemetryReadingId: readingId, persistedAt });
      expect(keys.docs[0].resultRef).not.toHaveProperty('temperatureValue');
    });

    it("a concurrent send that loses the key-store race returns the winner's id", async () => {
      const { db, keys } = makeDb();
      // The winner records the same key between this send's lookup and record.
      const upsert = keys.updateOne;
      keys.updateOne = async (filter, update, options) => {
        keys.docs.push(completedKey('k-3', 'r-winner'));
        return upsert(filter, update, options);
      };

      await expect(service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-3' })).resolves.toBe('r-winner');
      expect(keys.docs).toHaveLength(1);
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    });

    it('a failing key-store lookup is logged without the key, and the reading is stored', async () => {
      const { db, keys } = makeDb();
      keys.findOne = vi.fn().mockRejectedValue(new Error('key store down'));

      const readingId = await service.processTemperatureData(db, { ...baseTemperatureData, idempotencyKey: 'k-secret-5' });

      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).toHaveBeenCalledTimes(1);
      expect(readingId).toBe(written()[0].telemetryReadingId);
      expect(logger.error).toHaveBeenCalled();
      expect(logger.error.mock.calls.map((args) => args.join(' ')).join(' ')).not.toContain('k-secret-5');
    });

    // The scope is the sensorId as text, so a numeric sensorId replays too.
    it('a numeric sensorId resent under one client key writes InfluxDB once and replays the first reading', async () => {
      const fake = createFakeDb();
      const db = { collection: vi.fn((name) => fake.collection(name)) };
      const reading = { ...baseTemperatureData, sensorId: 101, idempotencyKey: 'k-num', source: 'mqtt' };

      const first = await service.processTemperatureData(db, reading);
      const second = await service.processTemperatureData(db, { ...reading });

      expect(second).toBe(first);
      expect(first).toBe(written()[0].telemetryReadingId);
      expect(influxTelemetryWriteRepository.writeTemperatureReadingNow).toHaveBeenCalledTimes(1);
      expect(fake.collections.ingestionIdempotencyKeys.docs).toMatchObject([{ idempotencyKey: 'k-num', scope: 'TelemetryReading:101' }]);
      expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    });

    it('control: a derived key never touches the key store', async () => {
      const { db } = makeDb();

      await service.processTemperatureData(db, baseTemperatureData);

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

  // RULE-025, RF009 AC8 (#1582): the socket handler strips a reading's fields
  // outside the queue's reading contract before it is queued, writes one
  // security audit at receipt whatever the reading's fate, and the job carries
  // the listable names only; the worker's processTemperatureData flags the
  // kept reading and writes no second audit on a retry.
  describe('RULE-025 on the queue (#1582)', () => {
    const PII_VALUE = 'Maria da Silva 123.456.789-09';
    const S1_DATASTREAM = {
      telemetryDatastreamId: 'ds-s1', sensorId: 's1', observedProperty: 'temperature', validityPeriod: { start: new Date('2020-01-01T00:00:00.000Z'), end: null },
    };
    const S1_REGISTRATION = { deviceRegistrationId: 'reg-s1', deviceId: 's1', status: 'active' };
    const S1_DEVICE = { deviceId: 's1', deviceType: 'sensor', qualificationStatus: 'qualified', retiredAt: null };

    // Sensor s1 is bound and a usable device, so a synchronized plausible
    // reading carries no issue but the one under test.
    function boundDb() {
      const collections = {};
      const collectionOf = (name) => {
        collections[name] = collections[name] || {
          createIndex: vi.fn().mockResolvedValue('ok'),
          findOne: vi.fn().mockResolvedValue({ deviceRegistrations: S1_REGISTRATION, devices: S1_DEVICE }[name] || null),
          find: vi.fn(() => ({ toArray: async () => (name === 'telemetryDatastreams' ? [S1_DATASTREAM] : []) })),
          insertOne: vi.fn().mockResolvedValue({ insertedId: `${name}-id` }),
          insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
        };
        return collections[name];
      };
      return { db: { collection: vi.fn(collectionOf) }, collectionOf };
    }

    function freshServiceWithQueue() {
      delete require.cache[require.resolve('../../src/config/queue')];
      delete require.cache[require.resolve('../../src/services/iot-streaming.service')];
      const freshQueueConfig = require('../../src/config/queue');
      const addMock = vi.fn().mockResolvedValue({ id: 'job1' });
      vi.spyOn(freshQueueConfig, 'getQueue').mockReturnValue({ add: addMock });
      return { freshService: require('../../src/services/iot-streaming.service'), addMock };
    }

    let auditDb;
    let logSpy;
    beforeEach(() => {
      // The audit at socket receipt resolves the Mongo connection itself.
      auditDb = { name: 'audit-db' };
      vi.spyOn(mongoConnection, 'connectMongoDB').mockResolvedValue(auditDb);
      logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    });

    const strippedAudits = () => logSpy.mock.calls.filter(([entry]) => entry.action === 'TELEMETRY_PII_STRIPPED');
    const issuesOf = (collectionOf) => collectionOf('telemetryValidationIssues').insertMany.mock.calls.flatMap(([rows]) => rows);
    const queuedReading = (overrides = {}) => ({
      sensorId: 's1', temperatureValue: 4, temperatureUnit: '°C', timestamp: new Date(), readingStatus: 'valid', sensorStatus: 'normal', source: 'iot-streaming', ...overrides,
    });

    async function receive(data) {
      const { freshService, addMock } = freshServiceWithQueue();
      const socket = makeSocket('sock1');
      await freshService.handleDeviceRegistration(socket, { deviceId: 'd1', sensorId: 's1' });
      await freshService.handleTemperatureData(socket, data);
      return { freshService, addMock, socket };
    }

    it('(a) queues a valid reading without its extra fields and audits it once at receipt', async () => {
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      const { freshService, addMock } = await receive({ deviceId: 'd1', temperature: 4, patientName: PII_VALUE, cpf: '123.456.789-09' });

      const jobData = addMock.mock.calls[0][1];
      expect(jobData.strippedFields).toEqual(['cpf', 'patientName']);
      expect(jobData.unlistedFieldCount).toBe(0);
      expect(JSON.stringify(jobData)).not.toContain('Maria');
      expect(JSON.stringify(jobData)).not.toContain('123.456');
      expect(strippedAudits()).toHaveLength(1);
      expect(strippedAudits()[0][0]).toMatchObject({ source: 'worker', resourceId: 's1', payload: { ingestionService: 'iot-queue', fieldNames: ['cpf', 'patientName'], unlistedFieldCount: 0 } });

      await freshService.processTemperatureData(db, queuedReading(), { strippedFields: jobData.strippedFields });

      expect(write).toHaveBeenCalledTimes(1);
      expect(strippedAudits()).toHaveLength(1);
      expect(collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0]).toMatchObject({ protocol: 'adapter', validationStatus: 'quarantined' });
      expect(issuesOf(collectionOf)).toEqual([
        expect.objectContaining({ issueCode: 'personal_data_stripped', disposition: 'quarantined', fieldPath: 'cpf,patientName' }),
      ]);
    });

    it('(a) a retried job writes no further security audit', async () => {
      vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      await service.processTemperatureData(db, queuedReading(), { strippedFields: ['cpf', 'patientName'] });
      await service.processTemperatureData(db, queuedReading(), { strippedFields: ['cpf', 'patientName'] });

      expect(strippedAudits()).toHaveLength(0);
      expect(issuesOf(collectionOf).map((issue) => issue.issueCode)).toEqual(['personal_data_stripped', 'personal_data_stripped']);
    });

    it('(b) refuses an implausible queued reading whole and still audits its extra fields', async () => {
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      const { freshService, addMock } = await receive({ deviceId: 'd1', temperature: 900, patientName: PII_VALUE, cpf: '123.456.789-09' });
      const { temperatureData, strippedFields } = addMock.mock.calls[0][1];

      await expect(freshService.processTemperatureData(db, temperatureData, { strippedFields }))
        .rejects.toMatchObject({ statusCode: 422 });

      expect(write).not.toHaveBeenCalled();
      expect(strippedAudits()).toHaveLength(1);
      expect(issuesOf(collectionOf).map((issue) => issue.issueCode)).toEqual(['invalid_value', 'personal_data_stripped']);
    });

    it('(b) a socket reading refused for a missing temperature still audits its extra fields', async () => {
      const { addMock, socket } = await receive({ deviceId: 'd1', patientName: PII_VALUE, cpf: '123.456.789-09' });

      expect(addMock).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'deviceId e temperature são obrigatórios' });
      expect(strippedAudits()).toHaveLength(1);
      expect(strippedAudits()[0][0]).toMatchObject({ resourceId: 's1', payload: { ingestionService: 'iot-queue', fieldNames: ['cpf', 'patientName'] } });
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('123.456');
    });

    it('(b) a socket reading from an unregistered device still audits its extra fields', async () => {
      const { addMock, socket } = await receive({ deviceId: 'unknown-device', temperature: 4, patientName: PII_VALUE, cpf: '123.456.789-09' });

      expect(addMock).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Dispositivo não registrado' });
      expect(strippedAudits()).toHaveLength(1);
      expect(strippedAudits()[0][0]).toMatchObject({ resourceId: 'unknown-device', payload: { ingestionService: 'iot-queue', fieldNames: ['cpf', 'patientName'] } });
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('123.456');
    });

    it('(c) a contract-only queued reading writes no security audit and no personal_data_stripped issue', async () => {
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      const { freshService, addMock } = await receive({ deviceId: 'd1', temperature: 4 });
      const { temperatureData, strippedFields } = addMock.mock.calls[0][1];
      expect(strippedFields).toEqual([]);
      await freshService.processTemperatureData(db, temperatureData, { strippedFields });

      expect(write).toHaveBeenCalledTimes(1);
      expect(strippedAudits()).toHaveLength(0);
      expect(issuesOf(collectionOf).filter((issue) => issue.issueCode === 'personal_data_stripped')).toHaveLength(0);
    });

    it('(c) an MQTT reading is not audited twice by processTemperatureData', async () => {
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      await service.processTemperatureData(db, queuedReading({ source: 'mqtt' }), { strippedFields: ['cpf', 'patientName'] });

      expect(write).toHaveBeenCalledTimes(1);
      expect(strippedAudits()).toHaveLength(0);
      expect(issuesOf(collectionOf)).toEqual([
        expect.objectContaining({ issueCode: 'personal_data_stripped' }),
      ]);
    });

    it('(d) no extra field value reaches a log or a socket message or a queued job', async () => {
      vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = boundDb();

      const { freshService, addMock, socket } = await receive({ deviceId: 'd1', temperature: 4, patientName: PII_VALUE, cpf: '123.456.789-09' });
      const { temperatureData, strippedFields } = addMock.mock.calls[0][1];
      await freshService.processTemperatureData(db, temperatureData, { strippedFields });

      const seen = JSON.stringify([
        ...['info', 'error', 'debug', 'warn'].map((level) => logger[level].mock.calls),
        socket.emit.mock.calls,
        addMock.mock.calls,
        logSpy.mock.calls,
        collectionOf('telemetryIngestionEvents').insertOne.mock.calls,
        collectionOf('telemetryValidationIssues').insertMany.mock.calls,
      ]);
      expect(seen).toContain('patientName');
      expect(seen).not.toContain('Maria');
      expect(seen).not.toContain('123.456');
    });

    it('(d) a non-listable field name never reaches the queued job and is counted instead', async () => {
      const { addMock } = await receive({ deviceId: 'd1', temperature: 4, patientName: 'x', [PII_VALUE]: true });

      const jobData = addMock.mock.calls[0][1];
      expect(jobData.strippedFields).toEqual(['patientName']);
      expect(jobData.unlistedFieldCount).toBe(1);
      expect(JSON.stringify(addMock.mock.calls)).not.toContain('Maria');
      expect(strippedAudits()[0][0].payload).toEqual({ ingestionService: 'iot-queue', fieldNames: ['patientName'], unlistedFieldCount: 1 });
    });
  });
});
