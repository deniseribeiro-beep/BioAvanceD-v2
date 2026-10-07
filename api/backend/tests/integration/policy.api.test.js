import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function rbacFor(accessType) {
  return buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType }]);
}

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

const FAKE_POLICY = { _id: 'policy-1', policyId: 1, name: 'Política Padrão', minTemp: 2, maxTemp: 8 };

describe('GET /api/policies', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/policies');
    expect(res.status).toBe(401);
  });

  it('returns policy list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_POLICY]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .get('/api/policies')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/policies/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when policy not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .get('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it('returns policy by numeric policyId', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_POLICY) });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .get('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// #1074: all three policy READS carried `authenticate` and nothing else,
// while the three WRITES carried requirePermission('viewTemperature'). So the
// write population was every role above UsuarioExterno and the read population
// was EVERY authenticated user, UsuarioExterno included.
//
// It is not cosmetic: temperature.service.js#checkPolicyAndAlert resolves a
// policy and reads minTemp/maxTemp off it to decide whether a
// reading is an excursion, so these rows are the thresholds that decide
// whether the cold chain reports failures at all (RF009 AC#4/AC#6).
//
// Gating the reads is backend-only. usePolicies has exactly one consumer,
// FacilityManagementPage, which ProtectedRoute already restricts to
// Administrador/Coordenador/Tecnico -- and those are precisely the three roles
// seeded with viewTemperature (rbac-catalog-seed.service.js:41,46,51).
// viewTemperature's allowedActions are CRUD (:96), so the #631 derived-action
// check passes for GET -> READ with no catalogue change.
describe('#1074: the three policy READS are permission-gated', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function policiesCollection() {
    return createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_POLICY]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
      countDocuments: vi.fn().mockResolvedValue(1),
    });
  }

  it('GET / refuses an accessType 1 caller, who holds only viewReports', async () => {
    app.locals.db = createDbMock({ policies: policiesCollection(), ...rbacFor(1) });

    const res = await request(app)
      .get('/api/policies')
      .set('Authorization', `Bearer ${makeToken(1)}`);

    expect(res.status).toBe(403);
  });

  it('GET /:id refuses an accessType 1 caller', async () => {
    app.locals.db = createDbMock({ policies: policiesCollection(), ...rbacFor(1) });

    const res = await request(app)
      .get('/api/policies/policy-1')
      .set('Authorization', `Bearer ${makeToken(1)}`);

    expect(res.status).toBe(403);
  });

  it('GET /:id/active-limit refuses an accessType 1 caller', async () => {
    app.locals.db = createDbMock({ policies: policiesCollection(), ...rbacFor(1) });

    const res = await request(app)
      .get('/api/policies/policy-1/active-limit')
      .set('Authorization', `Bearer ${makeToken(1)}`);

    expect(res.status).toBe(403);
  });

  // CONTROL: green before and after. Tecnico holds viewTemperature and is the
  // narrowest role that legitimately reads policies, so if the gate closed the
  // route rather than scoping it, this is what would show it.
  it('#1074 control: an accessType 2 caller, who holds viewTemperature, still reads the list', async () => {
    app.locals.db = createDbMock({ policies: policiesCollection(), ...rbacFor(2) });

    const res = await request(app)
      .get('/api/policies')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // CONTROL: the unauthenticated refusal must stay a 401, not become a 403.
  it('#1074 control: no token is still 401, not 403', async () => {
    const res = await request(app).get('/api/policies');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/policies', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/policies').send({ name: 'Nova Política' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador without viewTemperature permission (accessType 1)', async () => {
    app.locals.db = createDbMock({ ...rbacFor(1) });
    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ name: 'Nova Política', minTemp: 2, maxTemp: 8 });
    expect(res.status).toBe(403);
  });

  it('creates a policy for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-policy-id' }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Criotecnia', minTemp: -80, maxTemp: -60, description: 'Armazenamento criogênico' });

    expect([200, 201, 422]).toContain(res.status);
  });
});

describe('PUT /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/policies/1').send({ name: 'Atualizada' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador (accessType 1)', async () => {
    app.locals.db = createDbMock({ ...rbacFor(1) });
    const res = await request(app)
      .put('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ name: 'Atualizada' });
    expect(res.status).toBe(403);
  });

  it('updates an existing policy', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .put('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Política Atualizada', minTemp: 2, maxTemp: 8 });

    expect([200, 400]).toContain(res.status);
  });
});

describe('DELETE /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/policies/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador (accessType 1)', async () => {
    app.locals.db = createDbMock({ ...rbacFor(1) });
    const res = await request(app)
      .delete('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(1)}`);
    expect(res.status).toBe(403);
  });

  it('deletes a policy for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({ policies: coll, ...rbacFor(4) });

    const res = await request(app)
      .delete('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect([200, 400]).toContain(res.status);
  });
});

// #1074 (write half): the three policy WRITES carried requirePermission(
// 'viewTemperature') -- a READ permission. Its allowedActions had been
// widened to the full CRUD set, so the writes passed the #631 derived-action
// check and nothing was broken; what was broken is that "may look at a
// threshold" and "may rewrite the threshold that decides whether the cold
// chain reports a failure at all" were ONE capability, and no catalogue
// edit could separate them.
//
// Same defect and same remedy as #1073 one resource over, including the
// trap that manageTemperature is not the answer despite its name (it is
// ['UPDATE'] only, so it would 403 POST and DELETE).
//
// The grants are DELIBERATELY unchanged: manageTemperaturePolicy is seeded
// to exactly the three roles that already held viewTemperature, so no
// caller gains or loses anything today. What changes is that revoking
// threshold governance from Tecnico -- the open question in #1074, and
// Denise's to answer -- becomes a catalogue edit rather than a code change.
// These cases pin that separability, which is the whole content of the fix
// and is not observable through any seeded role.
describe('#1074: policy writes are gated on a write permission, not viewTemperature', () => {
  const VIEW_ONLY_USER = 'qa-policy-view-only';
  const BOTH_USER = 'qa-policy-governor';

  function tokenFor(userAccountId) {
    return jwt.sign(
      { userID: userAccountId, accessType: 2, roleName: 'T\u00e9cnico', name: 'QA', mfaVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  // Neither principal can be built from a seeded role, by construction:
  // the point of the fix is that the two capabilities used to be one.
  function rbacSplit() {
    return buildRbacCollections(
      [
        { userAccountId: VIEW_ONLY_USER, roleCodes: ['policy_viewer'], organizationId: 'test-org-default' },
        { userAccountId: BOTH_USER, roleCodes: ['policy_governor'], organizationId: 'test-org-default' },
      ],
      [
        { roleCode: 'policy_viewer', hierarchyLevel: 2, permissions: ['viewTemperature'] },
        {
          roleCode: 'policy_governor',
          hierarchyLevel: 2,
          permissions: ['viewTemperature', 'manageTemperaturePolicy'],
        },
      ]
    );
  }

  function writableCollection() {
    return createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'policy-new' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_POLICY]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
  }

  // #1089 made the name required, so a body that omits it 422s before
  // the gate is even reached -- which would make a 403 assertion vacuous.
  const VALID_BODY = {
    name: 'Freezer -80',
    minTemp: -85,
    maxTemp: -75,
  };

  beforeEach(() => {
    givenSession();
    app.locals.db = createDbMock({ temperaturePolicies: writableCollection(), ...rbacSplit() });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POST / refuses a caller holding viewTemperature but NOT manageTemperaturePolicy', async () => {
    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${tokenFor(VIEW_ONLY_USER)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(403);
  });

  it('PUT /:id refuses the same caller', async () => {
    const res = await request(app)
      .put('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${tokenFor(VIEW_ONLY_USER)}`)
      .send({ minTemp: -90 });

    expect(res.status).toBe(403);
  });

  it('DELETE /:id refuses the same caller', async () => {
    const res = await request(app)
      .delete('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${tokenFor(VIEW_ONLY_USER)}`);

    expect(res.status).toBe(403);
  });

  // CONTROL, and per #768 this is the ONLY signal that the three cases
  // above mean what they say: a 403 is satisfied by ANY upstream refusal
  // (a bad token, a missing assignment, a broken fixture). This proves the
  // same principal still passes every gate up to the write one.
  it('CONTROL: the viewTemperature-only caller can still READ policies', async () => {
    const res = await request(app)
      .get('/api/policies')
      .set('Authorization', `Bearer ${tokenFor(VIEW_ONLY_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // CONTROL: holding BOTH is what the three seeded roles do today, so this
  // case is green before and after the fix. A red here means the swap took
  // a capability away from someone, which the fix explicitly must not do.
  it('CONTROL: a caller holding both permissions can still WRITE', async () => {
    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${tokenFor(BOTH_USER)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
  });
});
