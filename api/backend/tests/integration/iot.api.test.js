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

// #464: equipment-sensor-quarantine.service.js resolves sensor.locationID
// as an equipment identifier matched against a FREEZER StorageContainer's
// containerID, then walks FREEZER -> SHELF -> RACK -> StorageBox and
// filters samples on storageLocation.boxId -- the direct successor to
// #430's now-retired `locations`-collection lookup this fixture used to
// seed.
const FREEZER_CONTAINER_ID = 501;
const FREEZER_ID = 'FRZ-IOT-1';
const SHELF_ID = 'SHF-IOT-1';
const RACK_ID = 'RCK-IOT-1';
const BOX_ID = 'BOX-IOT-1';

function buildDb() {
  const incidents = [];
  const samples = [{
    _id: '507f1f77bcf86cd799439055',
    sampleID: 'BIO-IOT-001',
    barcode: 'BC-IOT-001',
    storageLocation: { boxId: BOX_ID, position: 'A1' },
    status: 'AVAILABLE',
    currentStatus: 'Available',
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

  const excursions = [];
  const environmentalExcursionsCollection = {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockImplementation(async (doc) => {
      excursions.push({ ...doc, _id: '507f1f77bcf86cd799439066' });
      return { insertedId: '507f1f77bcf86cd799439066' };
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  };

  const sensorsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ sensorId: 'sensor-1', locationID: FREEZER_CONTAINER_ID }]),
    }),
  };

  const sensorMetadataCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  };

  const storageContainersCollection = {
    find: vi.fn((filter) => {
      if (filter.containerType === 'FREEZER') {
        const matches = filter.containerID.$in.some((id) => String(id) === String(FREEZER_CONTAINER_ID));
        return { toArray: vi.fn().mockResolvedValue(matches ? [{ _id: FREEZER_ID, containerID: FREEZER_CONTAINER_ID }] : []) };
      }
      if (filter.containerType === 'SHELF') {
        return { toArray: vi.fn().mockResolvedValue(filter.parent_id === FREEZER_ID ? [{ _id: SHELF_ID }] : []) };
      }
      if (filter.containerType === 'RACK') {
        return { toArray: vi.fn().mockResolvedValue(filter.parent_id.$in.includes(SHELF_ID) ? [{ _id: RACK_ID }] : []) };
      }
      return { toArray: vi.fn().mockResolvedValue([]) };
    }),
  };

  const storageBoxesCollection = {
    find: vi.fn((filter) => ({
      toArray: vi.fn().mockResolvedValue(filter.parent_id.$in.includes(RACK_ID) ? [{ _id: BOX_ID }] : []),
    })),
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

  // #430: quarantine-action.service.js's recordAction() is on the
  // cold-chain quarantine path and needs its own collection branch --
  // without it, db.collection('quarantineActions') fell through to the
  // generic {find: ...} fallback (no insertOne), throwing before the
  // sampleMovements insert this test asserts on ever ran.
  const quarantineActionsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'quarantine-action-1' }),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
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

  // #426: notification-recipient resolution goes through
  // UserRoleAssignment -> Role, not an accessType $in query -- grant a
  // valid ObjectId hex string an active `technician` assignment so the
  // recipient-notification path stays exercised.
  const rolesCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ roleId: 'role-tech', roleCode: 'technician', roleStatus: 'active' }]),
    }),
  };
  const userRoleAssignmentsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { userAccountId: '507f1f77bcf86cd799439099', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null },
      ]),
    }),
  };

  return {
    db: {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'temperatureIncidents') return incidentCollection;
        if (name === 'environmentalExcursions') return environmentalExcursionsCollection;
        if (name === 'users') return usersCollection;
        if (name === 'sensors') return sensorsCollection;
        if (name === 'sensorMetadata') return sensorMetadataCollection;
        if (name === 'storageContainers') return storageContainersCollection;
        if (name === 'storageBoxes') return storageBoxesCollection;
        if (name === 'samples') return samplesCollection;
        if (name === 'sampleMovements') return sampleMovementsCollection;
        if (name === 'sample_movements') return sampleMovementsCollection;
        if (name === 'counters') return countersCollection;
        if (name === 'roles') return rolesCollection;
        if (name === 'userRoleAssignments') return userRoleAssignmentsCollection;
        if (name === 'quarantineActions') return quarantineActionsCollection;
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    },
    incidents,
    incidentCollection,
    excursions,
    environmentalExcursionsCollection,
    samplesCollection,
    sampleMovementsCollection,
    quarantineActionsCollection,
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
      expect(mockDb.environmentalExcursionsCollection.insertOne).toHaveBeenCalledTimes(1);
    });

    expect(mockDb.incidents).toHaveLength(1);
    expect(mockDb.incidents[0].sensorKey).toBe('sensor-1');
    expect(mockDb.incidents[0].status).toBe('open');
    const update = mockDb.samplesCollection.updateOne.mock.calls[0][1].$set;
    // #408 retired the legacy availabilityStatus field from Sample writes
    // (specimenStatus is the sole source of truth now) -- this assertion
    // was never updated when equipment-sensor-quarantine.service.js's
    // write site migrated onto specimenStatus (part of #409). #531 also
    // retired the redundant release_status write from this same site.
    expect(update).toMatchObject({
      status: 'QUARANTINED',
      currentStatus: 'QUARANTINED',
      specimenStatus: 'quarantined',
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

    expect(mockDb.excursions).toHaveLength(1);
    expect(mockDb.excursions[0]).toMatchObject({
      minimumValue: 12.5,
      maximumValue: 12.5,
      excursionStatus: 'open',
    });
  });

  it('POST /api/iot/telemetry widens the open EnvironmentalExcursion instead of creating a new one on a repeat out-of-range reading', async () => {
    const existingExcursion = {
      _id: 'excursion-existing-1',
      equipmentId: null,
      excursionStatus: 'open',
      minimumValue: 10,
      maximumValue: 12.5,
    };
    mockDb.environmentalExcursionsCollection.findOne.mockResolvedValue(existingExcursion);

    const response = await request(app).post('/api/iot/telemetry').send({
      sensorId: 'sensor-1',
      temperature: 9,
      timestamp: '2026-04-10T10:05:00.000Z',
    });

    expect(response.status).toBe(200);

    await vi.waitFor(() => {
      expect(mockDb.environmentalExcursionsCollection.updateOne).toHaveBeenCalledTimes(1);
    });

    expect(mockDb.environmentalExcursionsCollection.insertOne).not.toHaveBeenCalled();
    const [filter, update] = mockDb.environmentalExcursionsCollection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: existingExcursion._id });
    expect(update.$set).toMatchObject({
      minimumValue: 9,
      maximumValue: 12.5,
    });
  });

  describe('test-support telemetry-monitor routes (#307)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.TEST_SUPPORT_SECRET;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_SUPPORT_SECRET = 'the-real-secret';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.TEST_SUPPORT_SECRET = originalSecret;
    });

    it('rejects /telemetry-monitor/run-cycle with no shared-secret header', async () => {
      const response = await request(app).post('/api/iot/telemetry-monitor/run-cycle');
      expect(response.status).toBe(403);
    });

    it('rejects /telemetry-monitor/run-cycle with a wrong shared-secret header', async () => {
      const response = await request(app)
        .post('/api/iot/telemetry-monitor/run-cycle')
        .set('x-test-support-secret', 'wrong-secret');
      expect(response.status).toBe(403);
    });

    it('rejects /telemetry-monitor/find-critical-freezers with no shared-secret header', async () => {
      const response = await request(app).post('/api/iot/telemetry-monitor/find-critical-freezers');
      expect(response.status).toBe(403);
    });

    it('rejects both test-support routes when TEST_SUPPORT_SECRET is unset, even with a header sent', async () => {
      delete process.env.TEST_SUPPORT_SECRET;
      const runCycleResponse = await request(app)
        .post('/api/iot/telemetry-monitor/run-cycle')
        .set('x-test-support-secret', 'anything');
      expect(runCycleResponse.status).toBe(403);

      const findCriticalResponse = await request(app)
        .post('/api/iot/telemetry-monitor/find-critical-freezers')
        .set('x-test-support-secret', 'anything');
      expect(findCriticalResponse.status).toBe(403);
    });
  });
});
