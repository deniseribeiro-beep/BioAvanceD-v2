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


function rbacFor(accessType) {
  return buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType }]);
}

function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
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
// policy and reads minThreshold/maxThreshold off it to decide whether a
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
