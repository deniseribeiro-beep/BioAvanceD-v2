import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  connection: require.resolve('../../src/infrastructure/database/mongodb/connection'),
  sendIncidentAlertEmail: require.resolve('../../src/services/sendIncidentAlertEmail'),
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

  const incidentsCollection = {
    async findOne(filter) {
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
      return { find: () => ({ toArray: async () => [] }) };
    },
  };

  return { db, incidents, incidentsCollection };
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
});
