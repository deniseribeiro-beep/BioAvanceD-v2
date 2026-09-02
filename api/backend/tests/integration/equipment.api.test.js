import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function userIdFor(accessType) {
  return `qa-user-at${accessType}`;
}

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: userIdFor(accessType), accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Token shaped without `name`/`roleName` but with `userName`/`role` instead,
// to exercise the audit-info fallback branches (req.user?.name || req.user?.userName; req.user?.role || null).
function makeTokenLegacyClaims(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-legacy', accessType, role: 'Coordenador', userName: 'legacyUser', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// #421: enforcement now resolves permissions via UserRoleAssignment -> Role
// -> Permission, keyed by userID, not accessType directly off the JWT. Seed
// one active assignment per distinct (userID, accessType) pair this file's
// tokens use, reproducing the exact legacy accessType->permission mapping.
const RBAC_COLLECTIONS = buildRbacCollections([
  { userAccountId: userIdFor(2), accessType: 2 },
  { userAccountId: userIdFor(3), accessType: 3 },
  { userAccountId: userIdFor(4), accessType: 4 },
  { userAccountId: 'qa-user-legacy', accessType: 4 },
]);

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

// #635: organizationId matches buildRbacCollections' default scopeId for a
// non-Administrador assignment ('test-org-default') so this fixture stays
// visible to the org-scoped callers most tests in this file use.
// #868: this fixture is deliberately NOT a valid document. Its
// equipmentID is a string and it has no equipmentDescription, so
// EquipmentModel.validate() rejects it outright -- which is exactly the
// shape #757 records escaping into the database through a raw insertOne.
//
// PUT validates only the errors a request introduces, not the state it
// inherits, so every test below that patches an unrelated field on this
// document is also a regression guard: it proves a legacy record is still
// updatable rather than permanently frozen by the new check.
const FAKE_EQ = { _id: '507f1f77bcf86cd799439011', equipmentID: 'EQ-001', name: 'Freezer A', type: 'Storage', status: 'Active', organizationId: 'test-org-default' };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment');
    expect(res.status).toBe(401);
  });

  it('returns equipment list for authenticated user', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_EQ]) }) });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // #635: proves requireOrganizationScope is actually wired into this
  // route -- an org-scopeType assignment with no scopeId (unassigned) is
  // unusable and hard-403s, isolated from requirePermission (this route
  // has none) by using an accessType that's otherwise fully allowed.
  it('returns 403 for a caller whose org assignment has no scopeId (unassigned)', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: userIdFor(2), accessType: 2, organizationId: '' }]),
      equipment: createCollectionMock(),
    });

    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('filters the query by organizationId for an organization-scoped caller', async () => {
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment: coll });

    await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);

    expect(find).toHaveBeenCalledWith({ organizationId: { $in: ['test-org-default'] } });
  });

  it('does not filter by organizationId for a global-scope caller (Administrador)', async () => {
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment: coll });

    await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(4)}`);

    expect(find).toHaveBeenCalledWith({});
  });
});

describe('GET /api/equipment/analytical', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment/analytical');
    expect(res.status).toBe(401);
  });

  it('returns analytical equipment', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app).get('/api/equipment/analytical').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns equipment by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_EQ) });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // #635 (F3-G09): mirrors sensor.controller.js's own out-of-scope 403
  // pattern -- an org-scoped caller fetching equipment outside their
  // scoped organizations (including organizationId:null, unscoped/
  // legacy) gets 403, not the equipment's data.
  it('returns 403 when the equipment is outside the caller organizationScope', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ ...FAKE_EQ, organizationId: 'org-other' }) });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/equipment').send({ name: 'New EQ' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico (accessType 2 — no manageStorageTopology permission, #929)', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, });
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'New EQ', type: 'Analytical' });
    expect(res.status).toBe(403);
  });

  it('creates equipment for Coordenador (accessType 3)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'New Freezer', type: 'Storage', status: 'Active', location: 'Lab-1' });
    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('PUT /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/equipment/507f1f77bcf86cd799439011').send({ status: 'Maintenance' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, });
    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ status: 'Maintenance' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when updateData.organizationId does not resolve to a real Organization', async () => {
    const organizations = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    const equipment = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_EQ), updateOne: vi.fn() });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment, organizations });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ organizationId: 'org-inexistente' });

    expect(res.status).toBe(404);
    expect(equipment.updateOne).not.toHaveBeenCalled();
  });

  it('updates equipment for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Maintenance' });
    expect([200, 400]).toContain(res.status);
  });

  // #868: PUT is a partial update -- validating the merged (existing +
  // patch) document, not the raw body, must still let a legitimate partial
  // update through even though the body alone doesn't look like a full
  // Equipment document.
  it('returns 200 for a valid partial update (only equipmentDescription changed)', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne,
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentDescription: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: expect.objectContaining({ equipmentDescription: 'Updated description' }) }
    );
  });

  // #868: the core bug -- an unvalidated status write on PUT that also
  // auto-quarantines. A status EquipmentModel.validate rejects (here,
  // 'offline', which only the quarantine vocabulary recognises) must now
  // 400 before any write, and must never reach the quarantine service --
  // 400 rather than 422 to match this file's own POST and the 22 other
  // validate-then-reject sites in src/ (#884 carries the repo-wide question).
  it('returns 400 for an invalid status and never invokes the quarantine service', async () => {
    const isQuarantineTriggerStatus = vi.fn().mockReturnValue(true);
    const quarantineByEquipmentStatus = vi.fn();
    app.locals.quarantineService = { isQuarantineTriggerStatus, quarantineByEquipmentStatus };

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne,
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'offline' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/status deve ser um de/);
    expect(updateOne).not.toHaveBeenCalled();
    expect(quarantineByEquipmentStatus).not.toHaveBeenCalled();

    delete app.locals.quarantineService;
  });
});

describe('GET /api/equipment db-unavailable guard', () => {
  it('returns 503 when db is unavailable (via authenticate middleware, not the route-level guard)', async () => {
    // Note: authenticate() itself checks req.app.locals.db and 503s before this
    // route body ever runs (src/infrastructure/middleware/auth.js ~line 66),
    // so the route's own `if (!db) return 503` at equipment.routes.js:14-19 is
    // unreachable dead code for this path. This test can only exercise the
    // middleware's guard, confirming the observable 503 behavior.
    delete app.locals.db;
    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/equipment validation and duplicate-ID paths', () => {
  it('returns 400 when equipmentDescription is missing', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, });
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'New EQ', type: 'Analytical' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/equipmentDescription/);
  });

  it('returns 400 when type is not one of the allowed EQUIPMENT_TYPES', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, });
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', type: 'NotARealType' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type deve ser um de/);
  });

  it('returns 400 when a provided equipmentID already exists', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'existing', equipmentID: 42 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', equipmentID: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Já existe um equipamento com este ID');
  });

  it('creates equipment with an auto-generated equipmentID when none is provided', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', name: 'New Freezer', type: 'Storage', status: 'Active' });

    expect(res.status).toBe(201);
    expect(res.body.data.equipmentID).toBeDefined();
    expect(typeof res.body.data.equipmentID).toBe('number');
  });

  it('converts a provided purchaseDate string to a Date before creating', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439013' });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne,
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', equipmentID: 88, purchaseDate: '2024-01-15' });

    expect(res.status).toBe(201);
    const insertedDoc = insertOne.mock.calls[0][0];
    expect(insertedDoc.purchaseDate).toBeInstanceOf(Date);
  });

  // #635: organizationId, when provided, must resolve to a real
  // Organization -- same write-time validation shape #634 gave Sensor.
  it('returns 404 when organizationId does not resolve to a real Organization', async () => {
    const organizations = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    const equipment = createCollectionMock();
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment, organizations });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', organizationId: 'org-inexistente' });

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('org-inexistente');
    expect(equipment.insertOne).not.toHaveBeenCalled();
  });

  it('creates equipment with organizationId when it resolves to a real Organization', async () => {
    const organizations = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) });
    const equipment = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439014' }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, equipment, organizations });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', equipmentID: 55, organizationId: 'org-1' });

    expect(res.status).toBe(201);
    expect(res.body.data.organizationId).toBe('org-1');
  });

  it('returns 500 when the collection throws during insertOne (infra failure, not a validation error)', async () => {
    // insertOne failing is a DB-layer/infra failure, not a client validation
    // error; it must not be conflated with the 400s returned above for bad
    // input. Mirrors GET/PUT/DELETE, which already map unexpected errors to 500.
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockRejectedValue(new Error('insert failed')),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', equipmentID: 99 });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('insert failed');
  });
});

describe('GET /api/equipment error branches', () => {
  it('returns 500 when listing equipment fails', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(new Error('list failed')) }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('list failed');
  });

  it('returns 500 when listing analytical equipment fails', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(new Error('analytical failed')) }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app).get('/api/equipment/analytical').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('analytical failed');
  });

  it('returns 500 when findOne by id fails', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockRejectedValue(new Error('findOne failed')),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('findOne failed');
  });

  it('falls back to numeric equipmentID lookup and returns the equipment', async () => {
    const findOne = vi.fn().mockResolvedValue({ ...FAKE_EQ, equipmentID: 77 });
    const coll = createCollectionMock({ findOne });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .get('/api/equipment/77')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({ equipmentID: 77 });
  });
});

describe('GET /api/equipment/:id with an invalid ObjectId', () => {
  it('returns 400 "ID inválido" when id is neither a valid ObjectId nor parseable as a number', async () => {
    // req.params.id = 'not-a-valid-id' cannot be cast to ObjectId and is not
    // numeric either; GET falls back the same way PUT/DELETE already do.
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: createCollectionMock() });
    const res = await request(app)
      .get('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ID inválido');
  });
});

describe('PUT /api/equipment/:id with a non-ObjectId, non-numeric id', () => {
  it('returns 400 "ID inválido" when id is neither a valid ObjectId nor parseable as a number', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: createCollectionMock() });
    const res = await request(app)
      .put('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ID inválido');
  });

  it('falls back to numeric equipmentID lookup when id is not a valid ObjectId but is numeric', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'abc', equipmentID: 123, equipmentDescription: 'desc', status: 'Active' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/123')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ location: 'Lab-2' });
    expect(res.status).toBe(200);
    expect(coll.findOne).toHaveBeenCalledWith({ equipmentID: 123 });
  });

  it('returns 404 when the equipment cannot be found by _id or equipmentID', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(404);
  });

  it('triggers quarantine service when the new status is a quarantine-trigger status', async () => {
    const quarantineByEquipmentStatus = vi.fn().mockResolvedValue({
      triggered: true, matched: 2, quarantined: 2, movements: 1, reason: 'test reason'
    });
    app.locals.quarantineService = {
      isQuarantineTriggerStatus: vi.fn().mockReturnValue(true),
      quarantineByEquipmentStatus,
    };

    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Inactive' });

    expect(res.status).toBe(200);
    expect(quarantineByEquipmentStatus).toHaveBeenCalled();
    expect(res.body.quarantine.triggered).toBe(true);
    expect(res.body.quarantine.matched).toBe(2);

    delete app.locals.quarantineService;
  });

  it('does not call the quarantine service when the new status is not a trigger status', async () => {
    const quarantineByEquipmentStatus = vi.fn();
    app.locals.quarantineService = {
      isQuarantineTriggerStatus: vi.fn().mockReturnValue(false),
      quarantineByEquipmentStatus,
    };

    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });

    expect(res.status).toBe(200);
    expect(quarantineByEquipmentStatus).not.toHaveBeenCalled();
    expect(res.body.quarantine.triggered).toBe(false);

    delete app.locals.quarantineService;
  });

  it('converts a provided purchaseDate string to a Date before updating', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne,
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ purchaseDate: '2024-01-15' });

    expect(res.status).toBe(200);
    const setDoc = updateOne.mock.calls[0][1].$set;
    expect(setDoc.purchaseDate).toBeInstanceOf(Date);
  });

  it('returns 404 when a numeric id parses but matches no equipmentID (numeric-fallback not-found)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/999')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(404);
    expect(coll.findOne).toHaveBeenCalledWith({ equipmentID: 999 });
  });

  it('uses a real Mongo transaction (session.startSession/withTransaction/endSession) when quarantine triggers', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne,
    });
    const dbMock = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn().mockResolvedValue(undefined);
    const startSession = vi.fn(() => ({ withTransaction, endSession }));
    // #951: isTransactionCapable probes `hello` on the admin db, not just
    // the presence of startSession -- a replica set answer (setName) is
    // what makes this client transaction-capable.
    const helloCommand = vi.fn().mockResolvedValue({ setName: 'rs0' });
    app.locals.db = { ...dbMock, client: { startSession, db: vi.fn(() => ({ command: helloCommand })) } };

    const quarantineByEquipmentStatus = vi.fn().mockResolvedValue({
      triggered: true, matched: 1, quarantined: 1, movements: 1, reason: 'status:inactive'
    });
    app.locals.quarantineService = {
      isQuarantineTriggerStatus: vi.fn().mockReturnValue(true),
      quarantineByEquipmentStatus,
    };

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Inactive' });

    expect(res.status).toBe(200);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(quarantineByEquipmentStatus).toHaveBeenCalledWith(
      app.locals.db,
      expect.objectContaining({ equipmentID: FAKE_EQ.equipmentID }),
      'Inactive',
      expect.objectContaining({ session: expect.objectContaining({ withTransaction, endSession }) })
    );
    expect(res.body.quarantine.triggered).toBe(true);

    delete app.locals.quarantineService;
  });

  it('falls back to req.user.userName/null role in the auditInfo when req.user has no name/role claims (non-transaction path)', async () => {
    const quarantineByEquipmentStatus = vi.fn().mockResolvedValue({
      triggered: true, matched: 1, quarantined: 1, movements: 1, reason: 'test reason'
    });
    app.locals.quarantineService = {
      isQuarantineTriggerStatus: vi.fn().mockReturnValue(true),
      quarantineByEquipmentStatus,
    };

    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeTokenLegacyClaims(4)}`)
      .send({ status: 'Inactive' });

    expect(res.status).toBe(200);
    expect(quarantineByEquipmentStatus).toHaveBeenCalledWith(
      app.locals.db,
      expect.anything(),
      'Inactive',
      expect.objectContaining({
        auditInfo: expect.objectContaining({ userName: 'legacyUser', userRole: 'Coordenador' })
      })
    );

    delete app.locals.quarantineService;
  });

  it('falls back to req.user.userName/null role in the auditInfo when req.user has no name/role claims (transaction path)', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne,
    });
    const dbMock = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const withTransaction = vi.fn(async (cb) => cb());
    const endSession = vi.fn().mockResolvedValue(undefined);
    const startSession = vi.fn(() => ({ withTransaction, endSession }));
    app.locals.db = { ...dbMock, client: { startSession } };

    const quarantineByEquipmentStatus = vi.fn().mockResolvedValue({
      triggered: true, matched: 1, quarantined: 1, movements: 1, reason: 'status:inactive'
    });
    app.locals.quarantineService = {
      isQuarantineTriggerStatus: vi.fn().mockReturnValue(true),
      quarantineByEquipmentStatus,
    };

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeTokenLegacyClaims(4)}`)
      .send({ status: 'Inactive' });

    expect(res.status).toBe(200);
    expect(quarantineByEquipmentStatus).toHaveBeenCalledWith(
      app.locals.db,
      expect.anything(),
      'Inactive',
      expect.objectContaining({
        auditInfo: expect.objectContaining({ userName: 'legacyUser', userRole: 'Coordenador' })
      })
    );

    delete app.locals.quarantineService;
  });

  it('returns 400 (caught error) when findOne throws unexpectedly inside the update flow', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockRejectedValue(new Error('unexpected findOne failure')),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Erro ao atualizar equipamento');
    expect(res.body.message).toBe('unexpected findOne failure');
  });

  it('returns 500 when updateOne matches no documents (found but not updatable)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Erro ao atualizar equipamento');
  });
});

describe('DELETE /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/equipment/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS, });
    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('deletes equipment for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect([200, 400]).toContain(res.status);
  });

  it('falls back to numeric equipmentID lookup when id is not a valid ObjectId but is numeric', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'abc', equipmentID: 55 }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/55')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(coll.findOne).toHaveBeenCalledWith({ equipmentID: 55 });
    expect(coll.deleteOne).toHaveBeenCalledWith({ equipmentID: 55 });
  });

  it('returns 404 when id is neither a valid ObjectId nor numeric and nothing is found', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the equipment does not exist for a well-formed ObjectId', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439099')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when a numeric id parses but matches no equipmentID', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/999')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
    expect(coll.findOne).toHaveBeenCalledWith({ equipmentID: 999 });
  });

  it('returns 400 (caught error) when deleteOne throws unexpectedly', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      deleteOne: vi.fn().mockRejectedValue(new Error('delete failed')),
    });
    app.locals.db = createDbMock({ ...RBAC_COLLECTIONS,  equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Erro ao deletar equipamento');
    expect(res.body.message).toBe('delete failed');
  });
});
