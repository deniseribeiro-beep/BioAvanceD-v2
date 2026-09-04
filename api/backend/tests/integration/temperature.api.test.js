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

// #1054: this block used to assert `response.status).not.toBe(403)` under the
// title "accepts a reading from an automated system without user
// authentication" -- i.e. it pinned the missing gate as intended behaviour, and
// was the route's ONLY caller anywhere in the repo. The capability is real
// (RF009's primary actor is "Sistema", and MQTT ingest is configured on no
// stack, so this is the only working telemetry door today) but "no user
// session" was never supposed to mean "no credential": every other machine
// caller in this repo goes through a fail-closed shared secret. The assertions
// below are the inverted ones.
describe('POST /api/temperature/system/reading (#1054)', () => {
  const ORIGINAL_SECRET = process.env.TELEMETRY_INGEST_SECRET;

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_SECRET === undefined) delete process.env.TELEMETRY_INGEST_SECRET;
    else process.env.TELEMETRY_INGEST_SECRET = ORIGINAL_SECRET;
  });

  it('refuses an anonymous reading when no ingest secret is configured -- an unset secret is not "no auth required"', async () => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    const coll = givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-1' }),
    });

    const response = await request(app)
      .post('/api/temperature/system/reading')
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    expect(response.status).toBe(403);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('refuses a reading carrying no secret header when one IS configured', async () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    const coll = givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-1' }),
    });

    const response = await request(app)
      .post('/api/temperature/system/reading')
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    expect(response.status).toBe(403);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('refuses a reading carrying the wrong secret', async () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    const coll = givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-1' }),
    });

    const response = await request(app)
      .post('/api/temperature/system/reading')
      .set('x-telemetry-ingest-secret', 'wrong')
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    expect(response.status).toBe(403);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('accepts a reading carrying the configured secret -- the capability survives', async () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-1' }),
    });

    const response = await request(app)
      .post('/api/temperature/system/reading')
      .set('x-telemetry-ingest-secret', 'machine-secret-1')
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    // The gate is what is under test, not the controller's own validation --
    // assert only that it is no longer the gate turning this away.
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
  });

  it('CONTROL: the AUTHENTICATED sibling POST /reading is unaffected by the ingest secret', async () => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    givenSession();
    givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-2' }),
    });

    const response = await request(app)
      .post('/api/temperature/reading')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
  });

  it('CONTROL: an unauthenticated call to the authenticated sibling still 401s, not 403', async () => {
    process.env.TELEMETRY_INGEST_SECRET = 'machine-secret-1';
    givenTemperatureCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'reading-id-3' }),
    });

    const response = await request(app)
      .post('/api/temperature/reading')
      .set('x-telemetry-ingest-secret', 'machine-secret-1')
      .send({ sensorId: 'sensor-001', temperatureValue: 3.8, temperatureUnit: '°C' });

    // The ingest secret must not become a second way past `authenticate`.
    expect(response.status).toBe(401);
  });
});
