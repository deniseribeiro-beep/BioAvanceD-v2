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

describe('the manual sensor read is gone (#1387)', () => {
  // A caller who holds recordTemperature, with the sensor present, reached
  // the removed handler before; now neither path is routed at all.
  it.each([
    '/api/sensors/S-001/reading',
    '/api/sensors/S-001/collect-reading',
  ])('POST %s answers 404 to a recordTemperature holder', async (path) => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ value: 4.5, unit: '°C' });

    expect(res.status).toBe(404);
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

// #1073: every sensor WRITE route was gated on requirePermission('view
// Temperature') -- a read permission -- so the capability to delete a sensor
// was indistinguishable from the capability to look at cold-chain data.
// The writes now gate on 'manageSensor' (device lifecycle) and
// 'recordTemperature' (reading ingestion) instead.
//
// The grants are deliberately unchanged: manageSensor and recordTemperature
// are seeded to exactly the three roles that already held viewTemperature, so
// no caller gains or loses anything today. What changes is that the two are
// now SEPARABLE -- revoking sensor lifecycle from Tecnico is a catalogue edit
// rather than a code change. These cases pin that separability, which is the
// whole content of the fix and is not observable through any seeded role.
describe('#1073: sensor writes are gated on a write permission, not viewTemperature', () => {
  const VIEW_ONLY_USER = 'qa-view-only-temp';

  function viewOnlyToken() {
    return jwt.sign(
      { userID: VIEW_ONLY_USER, accessType: 2, roleName: 'Técnico', name: 'QA View Only', mfaVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  beforeEach(() => {
    app.locals.db = createDbMock({
      ...buildRbacCollections(
        [{ userAccountId: VIEW_ONLY_USER, roleCodes: ['temperature_viewer'], organizationId: 'test-org-default' }],
        [{ roleCode: 'temperature_viewer', hierarchyLevel: 2, permissions: ['viewTemperature'] }]
      )
    });
  });

  // CONTROL: unchanged by the fix and green in both directions. A red here
  // means the fixture is wrong, not that the gate moved (#695).
  it('CONTROL: a viewTemperature-only caller can still LIST sensors', async () => {
    vi.spyOn(sensorService, 'listSensors').mockResolvedValue([FAKE_SENSOR]);

    const res = await request(app)
      .get('/api/sensors')
      .set('Authorization', `Bearer ${viewOnlyToken()}`);

    expect(res.status).toBe(200);
  });

  it('refuses DELETE /api/sensors/:id to a viewTemperature-only caller', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'deleteSensor').mockResolvedValue({ deleted: true });

    const res = await request(app)
      .delete('/api/sensors/S-001')
      .set('Authorization', `Bearer ${viewOnlyToken()}`);

    expect(res.status).toBe(403);
    expect(sensorService.deleteSensor).not.toHaveBeenCalled();
  });

  it('refuses POST /api/sensors to a viewTemperature-only caller', async () => {
    vi.spyOn(sensorService, 'createSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${viewOnlyToken()}`)
      .send({ sensorId: 'S-002', type: 'temperature' });

    expect(res.status).toBe(403);
    expect(sensorService.createSensor).not.toHaveBeenCalled();
  });

  it('refuses PUT /api/sensors/:id to a viewTemperature-only caller', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${viewOnlyToken()}`)
      .send({ status: 'offline' });

    expect(res.status).toBe(403);
    expect(sensorService.updateSensor).not.toHaveBeenCalled();
  });

  // The seeded population is unchanged, so a Tecnico keeps every write it
  // had. This is the case that would go red if the fix had been shipped as
  // a bare swap onto manageTemperature, whose allowedActions is ['UPDATE']
  // -- CREATE and DELETE would 403 for everyone (#929 records the same trap
  // for manageStorageTopology).
  it('CONTROL: a Tecnico still deletes a sensor after the split', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-tecnico-2', accessType: 2 }])
    });
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(FAKE_SENSOR);
    vi.spyOn(sensorService, 'deleteSensor').mockResolvedValue({ deleted: true });

    const res = await request(app)
      .delete('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
  });
});

// #1071: requireOrganizationScope RESOLVES the caller's scope and refuses an
// org-less caller. It does not decide which organization a CREATE stamps --
// and nothing validated a client-supplied organizationId against the
// caller's scope, so a caller could create a record already belonging to
// another organization, out of their own reach the moment it landed.
//
// assertOrganizationIdResolves is not that check: it only asserts the
// Organization EXISTS. Naming a real org you do not belong to passed it.
//
// The creates now stamp from the resolved scope and ignore the body's value.
// Administrador resolves to scope 'global' with an empty organizationIds and
// is deliberately left unconstrained -- that is the same shape #637 already
// ships for Report.organizationIds in reports.routes.js.
describe('#1071: a CREATE stamps organizationId from the caller resolved scope', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  function tokenFor(userAccountId, accessType) {
    return jwt.sign(
      { userID: userAccountId, accessType, roleName: 'Técnico', name: 'QA', mfaVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  it('ignores a body organizationId naming another organization', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-org-a', accessType: 2, organizationId: ORG_A }])
    });
    const createSensor = vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ ...FAKE_SENSOR, _id: { toString: () => 'new-id' } });

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${tokenFor('qa-org-a', 2)}`)
      .send({ sensorId: 'S-9', type: 'temperature', organizationId: ORG_B });

    expect([200, 201]).toContain(res.status);
    expect(createSensor).toHaveBeenCalled();
    expect(createSensor.mock.calls[0][1].organizationId).toBe(ORG_A);
  });

  it('stamps the caller organization when the body omits it entirely', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-org-a', accessType: 2, organizationId: ORG_A }])
    });
    const createSensor = vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ ...FAKE_SENSOR, _id: { toString: () => 'new-id' } });

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${tokenFor('qa-org-a', 2)}`)
      .send({ sensorId: 'S-9', type: 'temperature' });

    expect([200, 201]).toContain(res.status);
    expect(createSensor.mock.calls[0][1].organizationId).toBe(ORG_A);
  });

  // Administrador resolves to scope 'global'. Unconstrained on purpose: an
  // administrator legitimately provisions a sensor for any organization, and
  // the #637 precedent treats global the same way.
  it('CONTROL: an Administrador may still name any organization', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin', accessType: 4 }])
    });
    const createSensor = vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ ...FAKE_SENSOR, _id: { toString: () => 'new-id' } });

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${jwt.sign({ userID: 'qa-admin', accessType: 4, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true }, process.env.JWT_SECRET, { expiresIn: '1h' })}`)
      .send({ sensorId: 'S-9', type: 'temperature', organizationId: ORG_B });

    expect([200, 201]).toContain(res.status);
    expect(createSensor.mock.calls[0][1].organizationId).toBe(ORG_B);
  });

  // CONTROL: unchanged by this fix -- an org-less caller was already refused
  // by requireOrganizationScope before any of this runs. Red here means the
  // fixture, not the bug (#695).
  it('CONTROL: an org-less caller is still refused before the stamp', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-orgless', accessType: 2, organizationId: '' }])
    });
    vi.spyOn(sensorService, 'createSensor').mockResolvedValue(FAKE_SENSOR);

    const res = await request(app)
      .post('/api/sensors')
      .set('Authorization', `Bearer ${tokenFor('qa-orgless', 2)}`)
      .send({ sensorId: 'S-9', type: 'temperature', organizationId: ORG_B });

    expect(res.status).toBe(403);
    expect(sensorService.createSensor).not.toHaveBeenCalled();
  });
});

// #1053 slice A: the sensor half of the org-scope re-stamping class.
//
// #1029 gave the sensor PUT a fetch-404-first SOURCE check -- is this sensor
// currently mine? It says nothing about the DESTINATION, and
// ALLOWED_SENSOR_UPDATE_FIELDS contains 'organizationId', the very field
// sensor.service.js scopes on. So an in-scope caller could push their own
// sensor into another organization and out of their own reach, with the
// source check passing cleanly on the way through.
//
// assertOrganizationIdResolves is not that check: it asserts the target
// Organization EXISTS, so naming a real organization you do not belong to
// passed it. Same distinction #1071's commit had to make on the create side.
describe('#1053: a sensor PUT cannot re-parent the sensor to another organization', () => {
  const IN_SCOPE = { ...FAKE_SENSOR, organizationId: 'test-org-default' };

  beforeEach(() => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-tecnico-2', accessType: 2 }])
    });
  });

  it('refuses a PUT that moves an in-scope sensor to another organization', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(IN_SCOPE);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue(IN_SCOPE);

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ organizationId: 'other-org' });

    expect(res.status).toBe(403);
    expect(sensorService.updateSensor).not.toHaveBeenCalled();
  });

  // CONTROL: green before and after. The ordinary update path is untouched.
  it('CONTROL: an update that does not name organizationId still succeeds', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(IN_SCOPE);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue({ ...IN_SCOPE, maintenanceStatus: 'ok' });

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ maintenanceStatus: 'ok' });

    expect(res.status).toBe(200);
    expect(sensorService.updateSensor).toHaveBeenCalled();
  });

  // CONTROL: re-sending the sensor's OWN organizationId is a no-op, not a
  // move, and must not be refused -- the operator UI spreads the fetched
  // record, so this is the shape a normal edit actually sends.
  it('CONTROL: re-sending the sensor own organizationId is allowed', async () => {
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(IN_SCOPE);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue(IN_SCOPE);

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ organizationId: 'test-org-default', maintenanceStatus: 'ok' });

    expect(res.status).toBe(200);
    expect(sensorService.updateSensor).toHaveBeenCalled();
  });

  it('CONTROL: an Administrador may still move a sensor between organizations', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin-move', accessType: 4 }])
    });
    vi.spyOn(sensorService, 'getSensor').mockResolvedValue(IN_SCOPE);
    vi.spyOn(sensorService, 'updateSensor').mockResolvedValue({ ...IN_SCOPE, organizationId: 'other-org' });

    const res = await request(app)
      .put('/api/sensors/S-001')
      .set('Authorization', `Bearer ${jwt.sign({ userID: 'qa-admin-move', accessType: 4, roleName: 'Administrador', name: 'QA', mfaVerified: true }, process.env.JWT_SECRET, { expiresIn: '1h' })}`)
      .send({ organizationId: 'other-org' });

    expect(res.status).toBe(200);
    expect(sensorService.updateSensor).toHaveBeenCalled();
  });
});
