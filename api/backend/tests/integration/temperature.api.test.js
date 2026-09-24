import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function makeToken(accessType = 2) {
  return makeAuthToken(accessType);
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
    ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 }])
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

// #1071: the third module. POST /reading had no scope middleware at all, so
// the organization a cold-chain reading was filed under came straight from
// the request body -- and assertOrganizationIdResolves only checks the
// Organization EXISTS, so naming someone else's real organization passed.
describe('POST /api/temperature/reading stamps organizationId from the caller scope', () => {
  const temperatureService = require('../../src/services/temperature.service');

  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function givenScopedCaller(organizationId) {
    app.locals.db = createDbMock({
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId }) }),
      ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2, organizationId }])
    });
  }

  it('ignores a body organizationId naming another organization', async () => {
    givenScopedCaller('org-a');
    const create = vi.spyOn(temperatureService, 'createTemperatureReading')
      .mockResolvedValue({ _id: { toString: () => 't1' }, temperatureValue: -80, temperatureUnit: 'C' });

    const res = await request(app)
      .post('/api/temperature/reading')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sensorId: 'SEN-1', temperatureValue: -80, organizationId: 'org-b' });

    expect([200, 201]).toContain(res.status);
    expect(create.mock.calls[0][1].organizationId).toBe('org-a');
  });

  // #1080: this replaced a CONTROL asserting the machine route "still takes
  // organizationId from the body". That control could never fail. It set
  // 'x-telemetry-secret' where the gate reads 'x-telemetry-ingest-secret', so
  // it always 403d into an else branch asserting only [401, 403] -- the
  // organizationId expectation on the line above it never executed once. Its
  // premise is inverted now anyway: the machine route derives the organization
  // from the sensor, so the body cannot choose.
  function givenMachineIngest(sensorDoc) {
    process.env.TELEMETRY_INGEST_SECRET = 'test-ingest-secret';
    app.locals.db = createDbMock({
      sensors: createCollectionMock({ findOne: vi.fn().mockResolvedValue(sensorDoc) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-real' }) })
    });
    return vi.spyOn(temperatureService, 'createTemperatureReading')
      .mockResolvedValue({ _id: { toString: () => 't2' }, temperatureValue: -70, temperatureUnit: 'C' });
  }

  it('#1080: the machine-ingest route derives organizationId from the sensor, not the body', async () => {
    const create = givenMachineIngest({ sensorId: 'SEN-2', organizationId: 'org-real' });

    const res = await request(app)
      .post('/api/temperature/system/reading')
      .set('x-telemetry-ingest-secret', 'test-ingest-secret')
      .send({ sensorId: 'SEN-2', temperatureValue: -70, organizationId: 'org-b' });

    expect(res.status).toBe(201);
    expect(create.mock.calls[0][1].organizationId).toBe('org-real');
    delete process.env.TELEMETRY_INGEST_SECRET;
  });

  it('#1080: the machine-ingest route 404s when the sensor is unknown', async () => {
    const create = givenMachineIngest(null);

    const res = await request(app)
      .post('/api/temperature/system/reading')
      .set('x-telemetry-ingest-secret', 'test-ingest-secret')
      .send({ sensorId: 'GHOST', temperatureValue: -70, organizationId: 'org-b' });

    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    delete process.env.TELEMETRY_INGEST_SECRET;
  });
});

// #1062: GET /api/temperature/alerts was the one read in this file without
// requireOrganizationScope, and adding the middleware alone would NOT have
// fixed it -- the alert document carried no organizationId at all, so the
// filter would have matched nothing and returned an empty list to every
// non-Administrador caller forever. The stamp has to land at write time
// first, which is what makes this a schema change rather than a middleware
// line.
//
// Same treatment #634/#635/#636 gave Sensor, Equipment and Temperature:
// stamp on new rows, no backfill.
describe('#1062: GET /api/temperature/alerts is organization-scoped', () => {
  const temperatureService = require('../../src/services/temperature.service');

  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function givenAlerts(alerts, callerOrganizationId, accessType = 2) {
    const captured = {};
    app.locals.db = createDbMock({
      alerts: createCollectionMock({
        find: vi.fn((query = {}) => {
          captured.query = query;
          const toArray = async () => alerts.filter((a) => {
            const scoped = query.organizationId;
            if (!scoped) return true;
            return (scoped.$in || []).includes(a.organizationId);
          });
          return {
            // #1079: getActiveAlerts bounds the read now, so the cursor
            // grows a .limit() stage. Captured rather than swallowed --
            // a mock that returns the chain unchanged from .limit() hides
            // whether the bound is actually applied.
            sort: () => ({
              limit: (n) => {
                captured.limit = n;
                return { toArray };
              },
            }),
          };
        }),
      }),
      ...buildRbacCollections([{
        userAccountId: TEST_USER_ACCOUNT_IDS[accessType] || TEST_USER_ACCOUNT_IDS[2],
        accessType,
        organizationId: callerOrganizationId,
      }])
    });
    return captured;
  }

  it('does not return another organization alerts', async () => {
    givenAlerts([
      { sensorId: 'SEN-A', status: 'active', organizationId: 'org-a' },
      { sensorId: 'SEN-B', status: 'active', organizationId: 'org-b' },
    ], 'org-a');

    const res = await request(app)
      .get('/api/temperature/alerts')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain('SEN-A');
    expect(body).not.toContain('SEN-B');
  });

  it('passes the caller organization scope into the alerts query', async () => {
    const captured = givenAlerts([{ sensorId: 'SEN-A', status: 'active', organizationId: 'org-a' }], 'org-a');

    await request(app)
      .get('/api/temperature/alerts')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(captured.query).toMatchObject({ status: 'active' });
    expect(captured.query.organizationId).toEqual({ $in: ['org-a'] });
  });

  // CONTROL: an Administrador resolves to scope 'global' and is left
  // unfiltered, the same bypass every other org-scoped read here gives.
  it('CONTROL: an Administrador still sees every organization alerts', async () => {
    givenAlerts([
      { sensorId: 'SEN-A', status: 'active', organizationId: 'org-a' },
      { sensorId: 'SEN-B', status: 'active', organizationId: 'org-b' },
    ], null, 4);

    const res = await request(app)
      .get('/api/temperature/alerts')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain('SEN-A');
    expect(body).toContain('SEN-B');
  });

  // CONTROL: unchanged -- 401 without a token, green before and after.
  it('CONTROL: still 401 without a token', async () => {
    const res = await request(app).get('/api/temperature/alerts');
    expect(res.status).toBe(401);
  });
});

// #1062: the write half. An alert with no organizationId can never be
// scoped, so both writers must stamp one.
describe('#1062: an alert is stamped with the organization at write time', () => {
  const temperatureService = require('../../src/services/temperature.service');

  it('checkPolicyAndAlert stamps the reading organization onto the alert', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'alert-1' });
    const db = createDbMock({
      policies: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ policyId: 'P-1', minThreshold: -80, maxThreshold: -60 }) }),
      alerts: createCollectionMock({ insertOne }),
      temperature: createCollectionMock(),
    });

    await temperatureService.checkPolicyAndAlert(db, {
      sensorId: 'SEN-1',
      policyId: 'P-1',
      temperatureValue: 20,
      organizationId: 'org-a',
    });

    expect(insertOne).toHaveBeenCalled();
    expect(insertOne.mock.calls[0][0].organizationId).toBe('org-a');
  });
});
