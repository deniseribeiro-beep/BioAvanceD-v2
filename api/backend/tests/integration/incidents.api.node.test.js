import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  connection: require.resolve('../../src/infrastructure/database/mongodb/connection'),
  sendIncidentAlertEmail: require.resolve('../../src/services/sendIncidentAlertEmail'),
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  controller: require.resolve('../../src/controllers/incident.controller'),
  routes: require.resolve('../../src/interface/routes/incident.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function buildMongoCollections(seedIncidents = []) {
  const incidents = [...seedIncidents];
  const samples = [{
    _id: '507f1f77bcf86cd799439088',
    sampleID: 'BIO-INC-001',
    barcode: 'BC-INC-001',
    locationID: 321,
    status: 'AVAILABLE',
    currentStatus: 'Available',
    release_status: 'AVAILABLE',
    availabilityStatus: 'AVAILABLE',
    quantity: 1,
    unit: 'mL',
  }];

  const incidentsCollection = {
    async findOne(filter) {
      if (filter._id) {
        return incidents.find((item) => String(item._id) === String(filter._id)) || null;
      }
      if (filter.sensorKey) {
        const allowedStatus = filter.status?.$in || [];
        return incidents.find((item) => item.sensorKey === filter.sensorKey && allowedStatus.includes(item.status)) || null;
      }
      return null;
    },
    async insertOne(doc) {
      incidents.push({ ...doc, _id: '507f1f77bcf86cd799439011' });
      return { insertedId: '507f1f77bcf86cd799439011' };
    },
    async updateOne() {
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(filter) {
      return incidents.filter((incident) => {
        if (filter.sensorKey && incident.sensorKey !== filter.sensorKey) {
          return false;
        }
        if (filter.status && incident.status !== filter.status) {
          return false;
        }
        return true;
      }).length;
    },
    find(filter) {
      const results = incidents.filter((incident) => {
        if (filter.sensorKey && incident.sensorKey !== filter.sensorKey) {
          return false;
        }
        if (filter.status && incident.status !== filter.status) {
          return false;
        }
        return true;
      });

      return {
        sort() {
          return {
            skip(skipValue) {
              return {
                limit(limitValue) {
                  return {
                    toArray: async () => results.slice(skipValue, skipValue + limitValue),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const sensorsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ sensorId: 'sensor-a1', locationID: 321 }]),
    }),
  };

  const sensorMetadataCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  };

  const locationsCollection = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ locationID: 321, equipmentID: 9001 }]),
    }),
  };

  const samplesCollection = {
    find: vi.fn().mockImplementation((filter = {}) => {
      const coldChainIncidentId = filter?.coldChainIncidentId;
      const releaseStatus = filter?.release_status;
      const results = coldChainIncidentId
        ? samples.filter((sample) => sample.coldChainIncidentId === String(coldChainIncidentId) && (!releaseStatus || sample.release_status === releaseStatus))
        : samples.filter((sample) => sample.locationID === 321 && sample.release_status !== 'QUARANTINE');
      return { toArray: vi.fn().mockResolvedValue(results) };
    }),
    updateOne: vi.fn().mockImplementation(async (filter, update) => {
      const sample = samples.find((item) => String(item._id) === String(filter._id));
      if (sample && update?.$set) Object.assign(sample, update.$set);
      return { matchedCount: sample ? 1 : 0, modifiedCount: sample ? 1 : 0 };
    }),
    updateMany: vi.fn().mockImplementation(async (filter, update) => {
      const matched = samples.filter((sample) => sample.coldChainIncidentId === String(filter.coldChainIncidentId));
      matched.forEach((sample) => {
        if (update?.$set) Object.assign(sample, update.$set);
      });
      return { matchedCount: matched.length, modifiedCount: matched.length };
    }),
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
    find() {
      return {
        project() {
          return {
            async toArray() {
              return [{ email: 'tecnico@example.test', accessType: 2, status: 'active' }];
            },
          };
        },
      };
    },
  };

  const db = {
    collection(name) {
      if (name === 'temperatureIncidents') return incidentsCollection;
      if (name === 'users') return usersCollection;
      if (name === 'sensors') return sensorsCollection;
      if (name === 'sensorMetadata') return sensorMetadataCollection;
      if (name === 'locations') return locationsCollection;
      if (name === 'samples') return samplesCollection;
      if (name === 'sampleMovements') return sampleMovementsCollection;
      if (name === 'sample_movements') return sampleMovementsCollection;
      if (name === 'counters') return countersCollection;
      return { find: () => ({ toArray: async () => [] }) };
    },
  };

  return { db, incidents, incidentsCollection, samples, samplesCollection, sampleMovementsCollection };
}

describe('Incidents API integration', () => {
  let app;
  let incidentsState;
  const sendIncidentAlertEmail = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    incidentsState = buildMongoCollections([]);
    setCachedModule(modulePaths.connection, { connectMongoDB: async () => incidentsState.db });
    setCachedModule(modulePaths.sendIncidentAlertEmail, { sendIncidentAlertEmail });
    setCachedModule(modulePaths.auth, { authenticate: (_req, _res, next) => next() });
    setCachedModule(modulePaths.rbac, { requirePermission: () => (_req, _res, next) => next() });

    delete require.cache[modulePaths.controller];
    delete require.cache[modulePaths.routes];
    const incidentsRouter = require(modulePaths.routes);

    app = express();
    app.use(express.json());
    app.use('/api/incidents', incidentsRouter);

    sendIncidentAlertEmail.mockResolvedValue({ id: 'email-1' });
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  it('POST /api/incidents/create cria novo incidente e agrega um aberto existente', async () => {
    const createResponse = await request(app).post('/api/incidents/create').send({
      sensorKey: 'sensor-a1',
      sensorName: 'Sensor A1',
      currentTemperature: -3.1,
      maxTemperature: -2.8,
      minTemperature: -4.2,
      samplesOutOfRange: 1,
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.success).toBe(true);
    expect(incidentsState.incidents).toHaveLength(1);
    expect(incidentsState.incidents[0].sensorKey).toBe('sensor-a1');

    incidentsState.incidents[0].samplesOutOfRange = 1;
    incidentsState.incidents[0].status = 'open';

    const aggregateResponse = await request(app).post('/api/incidents/create').send({
      sensorKey: 'sensor-a1',
      sensorName: 'Sensor A1',
      currentTemperature: -2.2,
      maxTemperature: -1.9,
      minTemperature: -3.2,
      samplesOutOfRange: 3,
    });

    expect(aggregateResponse.status).toBe(200);
    expect(aggregateResponse.body.success).toBe(true);
    expect(aggregateResponse.body.incident.samplesOutOfRange).toBe(4);
  });

  it('POST /api/incidents/create quarentena amostra vinculada ao sensor', async () => {
    const response = await request(app).post('/api/incidents/create').send({
      sensorKey: 'sensor-a1',
      sensorName: 'Sensor A1',
      currentTemperature: -3.1,
      maxTemperature: -2.8,
      minTemperature: -4.2,
      samplesOutOfRange: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.quarantine.triggered).toBe(true);
    expect(response.body.quarantine.quarantined).toBe(1);
    expect(incidentsState.samplesCollection.updateOne).toHaveBeenCalledTimes(1);
    const update = incidentsState.samplesCollection.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      status: 'QUARANTINED',
      currentStatus: 'QUARANTINED',
      release_status: 'QUARANTINE',
      availabilityStatus: 'BLOCKED',
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      coldChainSensorKey: 'sensor-a1',
      coldChainStatus: 'INCIDENT_OPEN',
    });
  });

  it('PUT /api/incidents/:incidentId/resolve mantém amostra em revisão pós-incidente', async () => {
    const incidentId = '507f1f77bcf86cd799439077';
    incidentsState = buildMongoCollections([{
      _id: incidentId,
      sensorKey: 'sensor-a1',
      sensorName: 'Sensor A1',
      currentTemperature: -3.1,
      maxTemperature: -2.8,
      minTemperature: -4.2,
      samplesOutOfRange: 1,
      status: 'open',
    }]);
    incidentsState.samples[0].coldChainIncidentId = incidentId;
    incidentsState.samples[0].quarantineReasonCode = 'COLD_CHAIN_INCIDENT';
    incidentsState.samples[0].release_status = 'QUARANTINE';
    incidentsState.samples[0].status = 'QUARANTINED';
    setCachedModule(modulePaths.connection, { connectMongoDB: async () => incidentsState.db });

    delete require.cache[modulePaths.controller];
    delete require.cache[modulePaths.routes];
    const incidentsRouter = require(modulePaths.routes);
    app = express();
    app.use(express.json());
    app.use('/api/incidents', incidentsRouter);

    const response = await request(app)
      .put(`/api/incidents/${incidentId}/resolve`)
      .send({ userId: 'qa-user', notes: 'Temperatura normalizada' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toMatch(/revisão pós-incidente/i);
    expect(response.body.postIncidentReview.reviewRequired).toBe(true);
    expect(incidentsState.samplesCollection.updateMany).toHaveBeenCalledTimes(1);
    const update = incidentsState.samplesCollection.updateMany.mock.calls[0][1].$set;
    expect(update).toMatchObject({
      availabilityStatus: 'PENDING_REVIEW',
      quarantineStatus: 'PENDING_REVIEW',
      coldChainStatus: 'INCIDENT_RESOLVED_REVIEW_REQUIRED',
      coldChainReviewRequired: true,
    });
    expect(update.status).not.toBe('AVAILABLE');
    expect(update.release_status).not.toBe('AVAILABLE');
    expect(update.availabilityStatus).not.toBe('AVAILABLE');
  });
});
