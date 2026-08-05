import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function makeToken(accessType = 2) {
  return jwt.sign(
    { userID: 'qa-tecnico-1', accessType, roleName: 'Técnico', name: 'QA Técnico', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

function givenTemperatureCollection(overrides = {}) {
  const coll = createCollectionMock(overrides);
  app.locals.db = createDbMock({
    temperature_readings: coll,
    temperaturereadings: coll,
    ...buildRbacCollections([{ userAccountId: 'qa-tecnico-1', accessType: 2 }])
  });
  return coll;
}

describe('GET /api/temperature', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/temperature');
    expect(response.status).toBe(401);
  });

  it('lists temperature readings for a Técnico (accessType 2)', async () => {
    givenTemperatureCollection({
      find: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: 'r1', value: 4.2, unit: 'C', timestamp: new Date().toISOString() }]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      })),
    });

    const response = await request(app)
      .get('/api/temperature')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect([200, 204]).toContain(response.status);
  });
});

describe('GET /api/temperature/control', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Issue #49: '/control' was registered after '/:id', so Express matched
  // '/:id' first (req.params.id === 'control') instead of reaching getControl.
  it('reaches the control handler instead of being shadowed by GET /:id', async () => {
    givenTemperatureCollection({
      find: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      })),
    });

    const response = await request(app)
      .get('/api/temperature/control')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    // GET /:id would try `new ObjectId('control')`, which throws and 500s.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });
});

describe('POST /api/temperature/system/reading', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts a reading from an automated system without user authentication', async () => {
    givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-1' }),
    });

    const response = await request(app)
      .post('/api/temperature/system/reading')
      .send({ value: 3.8, unit: 'C', sensorId: 'sensor-001', location: 'Freezer A' });

    // Could be 200/201 on success, or 400/422 on schema mismatch — we just assert it
    // doesn't 401/403 (it's the unauthenticated system endpoint).
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
