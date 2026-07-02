import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = require('../../src/services/iot-streaming.service');
const queueConfig = require('../../src/config/queue');
const fhirService = require('../../src/services/fhir.service');
const influxTelemetryWriteRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../src/utils/logger');

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
    function makeDb({ existingDevice = null } = {}) {
      const temperaturesCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'temp-id-1' }),
        updateOne: vi.fn().mockResolvedValue({}),
      };
      const devicesCollection = {
        findOne: vi.fn().mockResolvedValue(existingDevice),
        updateOne: vi.fn().mockResolvedValue({}),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'device-id-1' }),
      };
      const db = {
        collection: vi.fn((name) => {
          if (name === 'temperatures') return temperaturesCollection;
          if (name === 'devices') return devicesCollection;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      return { db, temperaturesCollection, devicesCollection };
    }

    const baseTemperatureData = {
      sensorId: 'sensor-1',
      temperatureValue: 5,
      temperatureUnit: '°C',
      timestamp: new Date(),
      readingStatus: 'valid',
      sensorStatus: 'normal',
    };

    beforeEach(() => {
      vi.spyOn(influxTelemetryWriteRepository, 'enqueueTemperatureReading').mockImplementation(() => {});
    });

    it('inserts, converts to FHIR, updates the record, and inserts a new device when none exists', async () => {
      const { db, temperaturesCollection, devicesCollection } = makeDb({ existingDevice: null });
      const validateSpy = vi.spyOn(fhirService, 'validateFHIRResource');

      const insertedId = await service.processTemperatureData(db, baseTemperatureData);

      expect(insertedId).toBe('temp-id-1');
      expect(temperaturesCollection.insertOne).toHaveBeenCalledWith(baseTemperatureData);
      expect(validateSpy).toHaveBeenCalledTimes(2);
      expect(temperaturesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'temp-id-1' },
        expect.objectContaining({ $set: expect.objectContaining({ fhir: expect.any(Object), fhirDevice: expect.any(Object) }) })
      );
      expect(devicesCollection.findOne).toHaveBeenCalledWith({ 'fhir.identifier.value': 'sensor-1' });
      expect(devicesCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ sensorId: 'sensor-1', fhir: expect.any(Object) })
      );
      expect(devicesCollection.updateOne).not.toHaveBeenCalled();
    });

    it('updates the existing device when one is found', async () => {
      const existingDevice = { _id: 'existing-device-id' };
      const { db, devicesCollection } = makeDb({ existingDevice });

      await service.processTemperatureData(db, baseTemperatureData);

      expect(devicesCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'existing-device-id' },
        expect.objectContaining({ $set: expect.objectContaining({ fhir: expect.any(Object) }) })
      );
      expect(devicesCollection.insertOne).not.toHaveBeenCalled();
    });

    it('logs and re-throws when insertOne rejects', async () => {
      const { db, temperaturesCollection } = makeDb();
      temperaturesCollection.insertOne.mockRejectedValue(new Error('insert failed'));

      await expect(service.processTemperatureData(db, baseTemperatureData)).rejects.toThrow('insert failed');
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
