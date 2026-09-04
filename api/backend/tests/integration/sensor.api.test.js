import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const sensorService = require('../../src/services/sensor.service');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function makeToken(accessType = 2) {
  return jwt.sign(
    { userID: `qa-tecnico-${accessType}`, accessType, roleName: 'Técnico', name: 'QA Técnico', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// #634: organizationId matches buildRbacCollections' default scopeId for a
// non-Administrador assignment ('test-org-default') so this fixture stays
// visible to the org-scoped Técnico callers most tests in this file use.
const FAKE_SENSOR = { _id: '507f1f77bcf86cd799439011', sensorId: 'S-001', type: 'temperature', status: 'online', organizationId: 'test-org-default' };

beforeEach(() => {
  givenSession();
  app.locals.db = createDbMock({
    ...buildRbacCollections([
      { userAccountId: 'qa-tecnico-1', accessType: 1 },
      { userAccountId: 'qa-tecnico-2', accessType: 2 }
    ])
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/sensors', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/sensors');
    expect(res.status).toBe(401);
  });

  it('returns 403 for user without viewTemperature permission (accessType 1)', async () => {
    const res = await request(app)
      .get('/api/sensors')
      .set('Authorization', `Bearer ${makeToken(1)}`);
    expect(res.status).toBe(403);
  });

  it('returns sensor list for Técnico (accessType 2)', async () => {
    vi.spyOn(sensorService, 'listSensors').mockResolvedValue([FAKE_SENSOR]);

    const res = await request(app)
      .get('/api/sensors')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // #634: proves requireOrganizationScope is actually wired into this
  // route (a controller-level unit test can't prove routing). The caller
  // keeps viewTemperature (via its role) but has an 'unassigned' org
  // scope (an organization-scopeType assignment with no scopeId) --
  // isolates the 403 to requireOrganizationScope, not requirePermission.
  it('returns 403 for a caller whose org assignment has no scopeId (unassigned)', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-tecnico-2', accessType: 2, organizationId: '' }])
    });

    const res = await request(app)
      .get('/api/sensors')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/sensors', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/sensors').send({ sensorId: 'S-002' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador (accessType 1)', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ sensorId: 'S-002', type: 'temperature' });
    expect(res.status).toBe(403);
  });

  it('creates a sensor for Técnico', async () => {
    vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ ...FAKE_SENSOR, _id: { toString: () => 'new-id' } });

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sensorId: 'S-002', type: 'temperature', status: 'online' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/sensors/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/sensors/S-001');
    expect(res.status).toBe(401);
  });

  it('returns sensor by id', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .get('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when sensor not found', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(null);

    const res = await request(app)
      .get('/api/sensors/NOT-FOUND')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect([404, 400]).toContain(res.status);
  });
});

describe('POST /api/sensors/:id/reading', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/sensors/S-001/reading').send({ value: 4.5 });
    expect(res.status).toBe(401);
  });

  it('records a sensor reading', async () => {
    // #1029: now also stubs getSensor -- the handler fetches the sensor to
    // check ownership before acting, so without this the real getSensor runs
    // against an unseeded mock, resolves null, and the handler 404s.
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'collectReading').mockResolvedValue({
      sensorId: 'S-001', value: 4.5, unit: '°C', recordedAt: new Date().toISOString()
    });

    const res = await request(app)
      .post('/api/sensors/S-001/reading')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ value: 4.5, unit: '°C' });

    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('PUT /api/sensors/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/sensors/S-001').send({ status: 'offline' });
    expect(res.status).toBe(401);
  });

  it('updates a sensor', async () => {
    // #1029: now also stubs getSensor -- the handler fetches the sensor to
    // check ownership before acting, so without this the real getSensor runs
    // against an unseeded mock, resolves null, and the handler 404s.
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue({ ...FAKE_SENSOR, status: 'offline' });

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ status: 'offline' });

    expect([200, 400]).toContain(res.status);
  });
});

describe('DELETE /api/sensors/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/sensors/S-001');
    expect(res.status).toBe(401);
  });

  it('deletes a sensor for Técnico', async () => {
    // #1029: now also stubs getSensor. The handler fetches the sensor to check
    // ownership before deleting, so without this stub the real getSensor runs
    // against an unseeded mock, resolves null, and the handler 404s -- which is
    // correct behaviour and not what this case is about.
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'deleteSensor').mockResolvedValue({ deleted: true });

    const res = await request(app)
      .delete('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect([200, 400]).toContain(res.status);
  });
});

// #1029: five of the seven sensor routes carried no requireOrganizationScope --
// #634 gated only list and get. The four that act on an EXISTING sensor are
// gated here.
//
// The rider on #1029 is the reason these tests seed a FOREIGN-org sensor rather
// than relying on the default fixture: getSensor was previously unstubbed on the
// write paths, and db.factory defaults findOne to null, so a null-tolerant
// post-fetch check would have no-opped and every one of these would have passed
// green against an unfixed handler. A null document and a foreign-org document
// are indistinguishable to isRecordInOrganizationScope -- both are out of scope
// -- so only a populated, foreign document proves the check is doing its job.
describe('sensor write routes are organization-scoped (#1029)', () => {
  // Belongs to another organization than buildRbacCollections' default
  // ('test-org-default'), which is what the Técnico callers below resolve to.
  const FOREIGN_SENSOR = { ...FAKE_SENSOR, _id: '507f1f77bcf86cd799439099', sensorId: 'S-FOREIGN', organizationId: 'other-org' };

  it('PUT refuses a sensor belonging to another organization, and does not update it', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FOREIGN_SENSOR);
    const updateSensor = vi.spyOn(sensorService, 'updateSensor').mockResolvedValue(FOREIGN_SENSOR);

    const res = await request(app)
      .put('/api/sensors/S-FOREIGN')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ maintenanceStatus: 'pending' });

    expect(res.status).toBe(403);
    // A handler that 403s AFTER mutating still leaks the write.
    expect(updateSensor).not.toHaveBeenCalled();
  });

  it('DELETE refuses a sensor belonging to another organization, and does not delete it', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FOREIGN_SENSOR);
    const deleteSensor = vi.spyOn(sensorService, 'deleteSensor').mockResolvedValue({ deleted: true });

    const res = await request(app)
      .delete('/api/sensors/S-FOREIGN')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
    expect(deleteSensor).not.toHaveBeenCalled();
  });

  it('POST /:id/reading refuses a sensor belonging to another organization', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FOREIGN_SENSOR);
    const collectReading = vi.spyOn(sensorService, 'collectReading').mockResolvedValue({ sensorId: 'S-FOREIGN' });

    const res = await request(app)
      .post('/api/sensors/S-FOREIGN/reading')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ value: 4.5, unit: '°C' });

    expect(res.status).toBe(403);
    expect(collectReading).not.toHaveBeenCalled();
  });

  it('POST /:id/collect-reading refuses a sensor belonging to another organization', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FOREIGN_SENSOR);
    const collectReading = vi.spyOn(sensorService, 'collectReading').mockResolvedValue({ sensorId: 'S-FOREIGN' });

    const res = await request(app)
      .post('/api/sensors/S-FOREIGN/collect-reading')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({});

    expect(res.status).toBe(403);
    expect(collectReading).not.toHaveBeenCalled();
  });

  it('CONTROL: an IN-SCOPE sensor is still updatable', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    const updateSensor = vi.spyOn(sensorService, 'updateSensor').mockResolvedValue({ ...FAKE_SENSOR, maintenanceStatus: 'pending' });

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ maintenanceStatus: 'pending' });

    expect(res.status).not.toBe(403);
    expect(updateSensor).toHaveBeenCalled();
  });

  it('CONTROL: an IN-SCOPE sensor is still deletable', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    const deleteSensor = vi.spyOn(sensorService, 'deleteSensor').mockResolvedValue({ deleted: true });

    const res = await request(app)
      .delete('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).not.toBe(403);
    expect(deleteSensor).toHaveBeenCalled();
  });

  it('a MISSING sensor 404s rather than 403ing -- the fetch must precede the scope check', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(null);
    const updateSensor = vi.spyOn(sensorService, 'updateSensor').mockResolvedValue(null);

    const res = await request(app)
      .put('/api/sensors/NOT-FOUND')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ maintenanceStatus: 'pending' });

    expect(res.status).toBe(404);
    expect(updateSensor).not.toHaveBeenCalled();
  });

  it('an org-LESS caller is refused by the middleware before any handler runs', async () => {
    // buildRbacCollections gives this user no assignment at all, so
    // resolveUserOrganizationScope returns an unusable scope and
    // requireOrganizationScope 403s ahead of the handler.
    app.locals.db = createDbMock({ ...buildRbacCollections([]) });
    const getSensor = vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .delete('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
    expect(getSensor).not.toHaveBeenCalled();
  });
});
