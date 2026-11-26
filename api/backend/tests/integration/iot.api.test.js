import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const { createFakeCollection } = require('../unit/ingestion/testHelpers');

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
      toArray: vi.fn().mockResolvedValue([{ sensorId: 'sensor-1', locationId: FREEZER_CONTAINER_ID }]),
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

  const idempotencyKeysCollection = createFakeCollection([]);

  // #1317: null unless a case binds the reading to a datastream.
  const bindingCollections = { telemetryDatastreams: null, deviceRegistrations: null, temperaturePolicies: null };

  return {
    db: {
      collection: vi.fn().mockImplementation((name) => {
        if (bindingCollections[name]) return bindingCollections[name];
        if (name === 'ingestionIdempotencyKeys') return idempotencyKeysCollection;
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
    bindingCollections,
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

    // #1063: POST /telemetry now requires a machine credential, the same
    // fail-closed gate #1054 put on /api/temperature/system/reading. The two
    // deep-ingest cases below are about what the controller DOES with an
    // accepted reading, so they are given a valid secret; the gate itself is
    // exercised by its own describe at the end of this file.
    process.env.TELEMETRY_INGEST_SECRET = 'iot-test-secret';

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
    const response = await request(app).post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', 'iot-test-secret')
      .send({
      sensorId: 'sensor-1',
      temperature: 12.5,
      timestamp: '2026-04-10T10:00:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ success: true, accepted: true, telemetryReadingId: expect.any(String) }));

    await vi.waitFor(() => {
      expect(saveTelemetryPoint).toHaveBeenCalledTimes(1);
      expect(mockDb.incidentCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(sendCriticalAlertEmail).toHaveBeenCalledTimes(1);
      expect(mockDb.environmentalExcursionsCollection.insertOne).toHaveBeenCalledTimes(1);
      // Sent after the point where the incident path used to quarantine.
      expect(sendIncidentAlertEmail).toHaveBeenCalledTimes(1);
    });

    expect(mockDb.incidents).toHaveLength(1);
    expect(mockDb.incidents[0].sensorKey).toBe('sensor-1');
    expect(mockDb.incidents[0].status).toBe('open');
    // #1207: the first out-of-range reading starts the excursion clock and
    // quarantines nothing. The policy's minimumDuration (or the 2-hour
    // TELEMETRY_CRITICAL_DURATION_HOURS fallback) has to elapse first.
    expect(mockDb.incidents[0].excursionStartedAt).toEqual(new Date('2026-04-10T10:00:00.000Z'));
    expect(mockDb.samplesCollection.updateOne).not.toHaveBeenCalled();
    expect(mockDb.sampleMovementsCollection.insertOne).not.toHaveBeenCalled();

    expect(mockDb.excursions).toHaveLength(1);
    expect(mockDb.excursions[0]).toMatchObject({
      minimumValue: 12.5,
      maximumValue: 12.5,
      excursionStatus: 'open',
    });
  });

  // RF009 AC4, V2E-0569 (#1317): the same reading, bound to a datastream
  // whose threshold profile is 0..20, is in range. The case above is its
  // control: the sensor's own 2..8 opens an incident.
  it('#1317: POST /api/iot/telemetry judges a bound reading against its datastream threshold profile', async () => {
    const stream = {
      telemetryDatastreamId: 'ds-iot-1',
      sensorId: 'sensor-1',
      observedProperty: 'temperature',
      storageLocationId: 'loc-iot-1',
      validityPeriod: { start: new Date('2026-04-01T00:00:00.000Z'), end: null },
      thresholdProfileId: 'policy-ds',
    };
    mockDb.bindingCollections.telemetryDatastreams = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([stream]) }),
      findOne: vi.fn(async (filter) => (filter.telemetryDatastreamId === stream.telemetryDatastreamId ? stream : null)),
    };
    // resolveReadingBinding reads the registration after the stream; without
    // a findOne here the binding throws and the reading goes on unbound.
    mockDb.bindingCollections.deviceRegistrations = { findOne: vi.fn().mockResolvedValue(null) };
    mockDb.bindingCollections.temperaturePolicies = {
      findOne: vi.fn(async (filter) => (filter._id === 'policy-ds' ? { _id: 'policy-ds', minTemp: 0, maxTemp: 20 } : null)),
    };

    const response = await request(app).post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', 'iot-test-secret')
      .send({
        sensorId: 'sensor-1',
        temperature: 12.5,
        timestamp: '2026-04-10T10:00:00.000Z',
      });

    expect(response.status).toBe(200);
    expect(mockDb.bindingCollections.temperaturePolicies.findOne).toHaveBeenCalledWith({ _id: 'policy-ds' });
    expect(sendCriticalAlertEmail).not.toHaveBeenCalled();
    // The in-range path's detached clock stop has run, so an incident insert
    // would have run by now too.
    await vi.waitFor(() => {
      expect(mockDb.incidentCollection.updateOne).toHaveBeenCalled();
    });
    expect(mockDb.incidentCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1207: POST /api/iot/telemetry quarantines the sensor samples once the excursion has outlasted its threshold', async () => {
    mockDb.incidentCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439044',
      sensorKey: 'sensor-1',
      sensorName: 'Sensor 1',
      status: 'open',
      openedAt: new Date('2026-04-10T07:00:00.000Z'),
      excursionStartedAt: new Date('2026-04-10T07:00:00.000Z'),
      currentTemperature: 12,
      maxTemperature: 12,
      minTemperature: 12,
      samplesOutOfRange: 30,
    });

    const response = await request(app).post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', 'iot-test-secret')
      .send({
      sensorId: 'sensor-1',
      temperature: 12.5,
      timestamp: '2026-04-10T10:00:00.000Z',
    });

    expect(response.status).toBe(200);

    await vi.waitFor(() => {
      expect(mockDb.samplesCollection.updateOne).toHaveBeenCalledTimes(1);
      expect(mockDb.sampleMovementsCollection.insertOne).toHaveBeenCalledTimes(1);
    });
    expect(mockDb.incidentCollection.insertOne).not.toHaveBeenCalled();

    const update = mockDb.samplesCollection.updateOne.mock.calls[0][1].$set;
    // #408 retired the legacy availabilityStatus field from Sample writes
    // (specimenStatus is the sole source of truth now) -- this assertion
    // was never updated when equipment-sensor-quarantine.service.js's
    // write site migrated onto specimenStatus (part of #409). #531 also
    // retired the redundant release_status write from this same site.
    // #540 retired the remaining status/currentStatus pair.
    expect(update).toMatchObject({
      specimenStatus: 'quarantined',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainSensorKey: 'sensor-1',
      coldChainStatus: 'INCIDENT_OPEN',
    });
    expect(update.status).toBeUndefined();
    expect(update.currentStatus).toBeUndefined();
    const movement = mockDb.sampleMovementsCollection.insertOne.mock.calls[0][0];
    expect(movement).toMatchObject({
      purpose: 'cold_chain_incident_quarantine',
      destination: 'Quarentena',
      responsible: 'SYSTEM',
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

    const response = await request(app).post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', 'iot-test-secret')
      .send({
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

  // RF009 AC7 (#1317): a client idempotencyKey replays the first reading.
  it('POST /api/iot/telemetry answers a repeated client idempotencyKey with the first reading, written once', async () => {
    const reading = { sensorId: 'sensor-1', temperature: 5, timestamp: '2026-04-10T10:10:00.000Z', idempotencyKey: 'k-api-1' };

    const first = await request(app).post('/api/iot/telemetry').set('x-telemetry-ingest-secret', 'iot-test-secret').send(reading);
    const second = await request(app).post('/api/iot/telemetry').set('x-telemetry-ingest-secret', 'iot-test-secret').send(reading);

    expect(first.status).toBe(200);
    expect(first.body.replayed).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, accepted: true, replayed: true, telemetryReadingId: first.body.telemetryReadingId });
    expect(saveTelemetryPoint).toHaveBeenCalledTimes(1);
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

  // #1063: `POST /api/iot/telemetry` was the SECOND unauthenticated machine-ingest
  // route -- #1054 named its own as "the only route in the file with no middleware",
  // which was true of that file and false of the repo. What makes this one pointed is
  // that the fail-closed shared-secret pattern it needed was already applied 25 lines
  // below it, to the test-support routes in this same router.
  describe('POST /api/iot/telemetry requires a machine credential (#1063)', () => {
    it('refuses an anonymous reading when no ingest secret is configured', async () => {
      delete process.env.TELEMETRY_INGEST_SECRET;

      const response = await request(app).post('/api/iot/telemetry')
        .send({ sensorId: 'sensor-1', temperature: 12.5 });

      expect(response.status).toBe(403);
      expect(saveTelemetryPoint).not.toHaveBeenCalled();
    });

    it('refuses a reading carrying no secret header when one IS configured', async () => {
      process.env.TELEMETRY_INGEST_SECRET = 'iot-test-secret';

      const response = await request(app).post('/api/iot/telemetry')
        .send({ sensorId: 'sensor-1', temperature: 12.5 });

      expect(response.status).toBe(403);
      expect(saveTelemetryPoint).not.toHaveBeenCalled();
    });

    it('refuses a reading carrying the wrong secret', async () => {
      process.env.TELEMETRY_INGEST_SECRET = 'iot-test-secret';

      const response = await request(app).post('/api/iot/telemetry')
        .set('x-telemetry-ingest-secret', 'wrong')
        .send({ sensorId: 'sensor-1', temperature: 12.5 });

      expect(response.status).toBe(403);
      expect(saveTelemetryPoint).not.toHaveBeenCalled();
    });

    it('CONTROL: accepts a reading carrying the configured secret', async () => {
      process.env.TELEMETRY_INGEST_SECRET = 'iot-test-secret';

      const response = await request(app).post('/api/iot/telemetry')
        .set('x-telemetry-ingest-secret', 'iot-test-secret')
        .send({ sensorId: 'sensor-1', temperature: 5 });

      expect(response.status).toBe(200);
    });

    it('CONTROL: a validation failure is still a 400, not swallowed by the gate', async () => {
      process.env.TELEMETRY_INGEST_SECRET = 'iot-test-secret';

      const response = await request(app).post('/api/iot/telemetry')
        .set('x-telemetry-ingest-secret', 'iot-test-secret')
        .send({ temperature: 5 });

      expect(response.status).toBe(400);
    });
  });
});

// #1505 (RF019 AC6): recordAction appends a QUARANTINE_APPLIED outbox event;
// this file's fake db has no outbox, and the event's contract is pinned in
// quarantine-action.service.test.js.
beforeEach(() => {
  const { GraphProjectionService } = require('../../src/services/graphProjection.service');
  vi.spyOn(GraphProjectionService.prototype, 'appendQuarantineApplyEvent').mockResolvedValue(null);
});
