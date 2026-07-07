import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  connection: require.resolve('../../src/infrastructure/database/mongodb/connection'),
  saveTelemetryPoint: require.resolve('../../src/services/saveTelemetryPoint'),
  sendCriticalAlertEmail: require.resolve('../../src/services/sendCriticalAlertEmail'),
  sendIncidentAlertEmail: require.resolve('../../src/services/sendIncidentAlertEmail'),
  sensorMetadata: require.resolve('../../src/models/SensorMetadata.schema'),
  controller: require.resolve('../../src/controllers/iot.controller'),
  routes: require.resolve('../../src/interface/routes/iot.routes'),
};

const connectMongoDB = vi.fn();
const saveTelemetryPoint = vi.fn();
const sendCriticalAlertEmail = vi.fn();
const sendIncidentAlertEmail = vi.fn();
const findOne = vi.fn();

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function buildDb() {
  const incidents = [];
  const samples = [{
    _id: '507f1f77bcf86cd799439055',
    sampleID: 'BIO-IOT-001',
    barcode: 'BC-IOT-001',
    locationID: 501,
    status: 'AVAILABLE',
    currentStatus: 'Available',
    release_status: 'AVAILABLE',
    availabilityStatus: 'AVAILABLE',
    quantity: 1,
    unit: 'mL',
  }];

  const incidentCollection = {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockImplementation(async (doc) => {
      incidents.push({ ...doc, _id: '507f1f77bcf86cd799439044' });
      return { insertedId: '507f1f77bcf86cd799439044' };
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  };

  const sensorsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ sensorId: 'sensor-1', locationID: 501 }]),
    }),
  };

  const sensorMetadataCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  };

  const locationsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ locationID: 501, equipmentID: 9001 }]),
    }),
  };

  const samplesCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(samples),
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    createIndex: vi.fn().mockResolvedValue('idx'),
  };

  const sampleMovementsCollection = {
    collectionName: 'sampleMovements',
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      next: vi.fn().mockResolvedValue(null),
    }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-1' }),
    createIndex: vi.fn().mockResolvedValue('idx'),
  };

  const countersCollection = {
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
  };

  const usersCollection = {
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { email: 'alerta@example.test', accessType: 2, status: 'active' },
        ]),
      }),
    }),
  };

  return {
    db: {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'temperatureIncidents') return incidentCollection;
        if (name === 'users') return usersCollection;
        if (name === 'sensors') return sensorsCollection;
        if (name === 'sensorMetadata') return sensorMetadataCollection;
        if (name === 'locations') return locationsCollection;
        if (name === 'samples') return samplesCollection;
        if (name === 'sampleMovements') return sampleMovementsCollection;
        if (name === 'sample_movements') return sampleMovementsCollection;
        if (name === 'counters') return countersCollection;
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    },
    incidents,
    incidentCollection,
    samplesCollection,
    sampleMovementsCollection,
  };
}

describe('IoT API integration', () => {
  let app;
  let iotRouter;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    mockDb = buildDb();
    connectMongoDB.mockResolvedValue(mockDb.db);
    saveTelemetryPoint.mockResolvedValue(true);
    sendCriticalAlertEmail.mockResolvedValue({ id: 'mail-1' });
    sendIncidentAlertEmail.mockResolvedValue({ id: 'mail-2' });
    findOne.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        sensorId: 'sensor-1',
        sensorName: 'Sensor 1',
        alertEmail: 'alerta@example.test',
        temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
      }),
    });

    setCachedModule(modulePaths.connection, { connectMongoDB });
    setCachedModule(modulePaths.saveTelemetryPoint, { saveTelemetryPoint });
    setCachedModule(modulePaths.sendCriticalAlertEmail, { sendCriticalAlertEmail });
    setCachedModule(modulePaths.sendIncidentAlertEmail, { sendIncidentAlertEmail });
    setCachedModule(modulePaths.sensorMetadata, { findOne });

    delete require.cache[modulePaths.controller];
    delete require.cache[modulePaths.routes];
    iotRouter = require(modulePaths.routes);

    app = express();
    app.use(express.json());
    app.use('/api/iot', iotRouter);

  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  it('POST /api/iot/telemetry aceita telemetria e registra incidente quando fora da faixa', async () => {
    const response = await request(app).post('/api/iot/telemetry').send({
      sensorId: 'sensor-1',
      temperature: 12.5,
      timestamp: '2026-04-10T10:00:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, accepted: true });

    await vi.waitFor(() => {
      expect(saveTelemetryPoint).toHaveBeenCalledTimes(1);
      expect(mockDb.incidentCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(mockDb.samplesCollection.updateOne).toHaveBeenCalledTimes(1);
      expect(mockDb.sampleMovementsCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(sendCriticalAlertEmail).toHaveBeenCalledTimes(1);
    });

    expect(mockDb.incidents).toHaveLength(1);
    expect(mockDb.incidents[0].sensorKey).toBe('sensor-1');
    expect(mockDb.incidents[0].status).toBe('open');
    const update = mockDb.samplesCollection.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      status: 'QUARANTINED',
      currentStatus: 'QUARANTINED',
      release_status: 'QUARANTINE',
      availabilityStatus: 'BLOCKED',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainSensorKey: 'sensor-1',
      coldChainStatus: 'INCIDENT_OPEN',
    });
    const movement = mockDb.sampleMovementsCollection.insertOne.mock.calls[0][0];
    expect(movement).toMatchObject({
      purpose: 'cold_chain_incident_quarantine',
      destination: 'Quarentena',
      responsible: 'SYSTEM',
    });
  });
});
