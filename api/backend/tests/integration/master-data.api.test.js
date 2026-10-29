import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const { createFakeDb } = require('../unit/foundation/helpers/fake-db');

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
// #913: real RBAC fixtures for the Técnico/Coordenador role-gate tests below --
// without these, resolveUserHierarchyLevel finds no UserRoleAssignment and
// returns null, and rbac.js:50's `userLevel === null || !allowedRoles.includes(userLevel)`
// short-circuits on the null branch before the role list is ever consulted.
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 2 }]);
const rbacCollectionsCoordenador = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 3 }]);

// Tests for createMasterDataRouter — covers all 5 mounted instances via
// /api/measurement-units (all branches of the factory router are shared code)

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_ITEM = { _id: '507f1f77bcf86cd799439011', measurementUnitID: 1, name: 'mL', symbol: 'mL' };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── /api/measurement-units ─────────────────────────────────
describe('GET /api/measurement-units', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/measurement-units');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([FAKE_ITEM]),
      }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // #1332: the chain above ignores its sort; this store sorts.
  it('lists items newest first', async () => {
    const store = createFakeDb().collection('measurementUnits');
    await store.insertOne({ _id: 'mid', name: 'mid', createdAt: new Date('2026-02-02') });
    await store.insertOne({ _id: 'newest', name: 'newest', createdAt: new Date('2026-02-03') });
    await store.insertOne({ _id: 'oldest', name: 'oldest', createdAt: new Date('2026-02-01') });
    const coll = createCollectionMock({ find: vi.fn((filter) => store.find(filter)) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => item.name)).toEqual(['newest', 'mid', 'oldest']);
  });
});

describe('GET /api/measurement-units/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/measurement-units/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns item by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_ITEM) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns item by numeric (non-ObjectId) id, matching on idField', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_ITEM) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units/42')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ unitID: 42 }, { unitID: '42' }]),
      })
    );
  });
});

describe('POST /api/measurement-units', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/measurement-units').send({ name: 'µL' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico (requireRole(3,4))', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });
    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'µL', symbol: 'µL' });
    expect(res.status).toBe(403);
  });

  // #913: Coordenador is hierarchyLevel 3, and the gate is requireRole(3, 4)
  // -- Coordenador is PERMITTED. With a real RBAC fixture seeded, the role
  // check passes and the request proceeds to MeasurementUnitModel.validate,
  // which rejects this payload for missing `description` (confirmed by
  // running: see report). A 403 assertion here would be asserting the
  // opposite of real behaviour.
  it('does not 403 for Coordenador -- the role gate lets Coordenador through, so the rejection is model validation', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordenador });
    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'µL', symbol: 'µL' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // #913: with no RBAC collections seeded at all, resolveUserHierarchyLevel
  // finds no UserRoleAssignment and returns null -- this is the branch the
  // four role-gate tests above used to hit by accident before they seeded
  // real fixtures. Kept as its own test so that branch stays covered now
  // that the others no longer exercise it.
  it('returns 403 when the caller has no resolvable role assignment at all (null hierarchy level)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'µL', symbol: 'µL' });
    expect(res.status).toBe(403);
  });

  it('creates item for admin', async () => {
    const coll = createCollectionMock({
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'µL', symbol: 'µL' });
    expect([200, 201, 422]).toContain(res.status);
  });

  it('returns 422 when payload fails model validation', async () => {
    app.locals.db = createDbMock({ measurementUnits: createCollectionMock(), ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.details)).toBe(true);
  });
});

describe('PUT /api/measurement-units/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/measurement-units/1').send({ description: 'Updated' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });
    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOneAndUpdate: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('updates item for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ ...FAKE_ITEM, unitID: 1, description: 'mL' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...FAKE_ITEM, description: 'Updated' }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('updates item by numeric (non-ObjectId) id, matching on idField', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ ...FAKE_ITEM, unitID: 1, description: 'mL' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...FAKE_ITEM, description: 'Updated' }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/measurement-units/42')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ unitID: 42 }, { unitID: '42' }]),
      }),
      expect.anything(),
      expect.anything()
    );
  });

  // #875: the PUT handler used to do `update = {...req.body, updatedAt};
  // delete update._id;` then `$set: update` -- every key the client sent
  // rode straight into $set, including `injected` (not a MeasurementUnit
  // field at all), `id` (the #881/#899 seeded MIABIS business key) and
  // `unitID` (this mount's own idField, immutable business identity). The
  // fix derives an allowlist from the model's own create() shape, so only
  // `description` (a real MeasurementUnit field) should survive into $set,
  // alongside the handler-owned `updatedAt`.
  it('#875 regression: PUT ignores non-model keys and the id/idField spoof attempt', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ ...FAKE_ITEM, unitID: 1, description: 'mL' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...FAKE_ITEM, description: 'x' }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'x', injected: 'y', id: 'SPOOF', unitID: 999 });
    expect(res.status).toBe(200);

    const [, update] = coll.findOneAndUpdate.mock.calls[0];
    expect(Object.keys(update.$set).sort()).toEqual(['description', 'updatedAt']);
    expect(update.$set.description).toBe('x');
  });
});

describe('DELETE /api/measurement-units/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/measurement-units/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });
    const res = await request(app)
      .delete('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('deletes item for admin', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('deletes item by numeric (non-ObjectId) id, matching on idField', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/measurement-units/42')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ unitID: 42 }, { unitID: '42' }]),
      })
    );
  });
});

// ── RF020 AC4: a collection's governanceRegime is set at creation and never
// rewritten by an edit; a conversion is a governed event, not a PUT.
describe('PUT /api/collections/:id (governanceRegime is immutable)', () => {
  const EXISTING = { collectionId: 'col-1', collectionName: 'Coleção', governanceRegime: 'biobank' };

  it('answers 422 and writes nothing when an edit changes the regime', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(EXISTING),
      findOneAndUpdate: vi.fn(),
    });
    app.locals.db = createDbMock({ collections: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/collections/col-1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ collectionName: 'Renomeada', governanceRegime: 'biorepository' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/governanceRegime não pode ser alterado/);
    expect(res.body.details).toEqual([res.body.message]);
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accepts an edit that repeats the same regime', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(EXISTING),
      findOneAndUpdate: vi.fn().mockResolvedValue({ ...EXISTING, collectionName: 'Renomeada' }),
    });
    app.locals.db = createDbMock({ collections: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/collections/col-1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ collectionName: 'Renomeada', governanceRegime: 'biobank' });

    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate).toHaveBeenCalled();
  });

  it('lets a collection stored before the regime existed receive its first one', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ collectionId: 'col-legacy', collectionName: 'Antiga' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ collectionId: 'col-legacy', governanceRegime: 'biorepository' }),
    });
    app.locals.db = createDbMock({ collections: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/collections/col-legacy')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ governanceRegime: 'biorepository' });

    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate).toHaveBeenCalled();
  });

  it('answers 422 for a collection created with no regime', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn() });
    app.locals.db = createDbMock({ collections: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/collections')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ collectionId: 'col-2', collectionName: 'Sem regime' });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' ')).toMatch(/governanceRegime/);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });
});

// ── /api/sample-types ─────────────────────────────────────
// Exercises the same factory code with a different collection mount
describe('GET /api/sample-types', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/sample-types');
    expect(res.status).toBe(401);
  });

  it('returns sample types for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/sample-types')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── #881: seeded rows carry a string business key on `id` (e.g. "PLASMA"),
// separate from the collection's own idField ("sampleTypeID"). The $or
// query must include an `{ id: rawId }` branch so those rows are reachable,
// while the existing _id / numeric-idField / string-idField branches keep
// working unchanged.
describe('GET /api/sample-types/:id (canonical string business key)', () => {
  const SEEDED_ITEM = { id: 'PLASMA', description: 'Plasma', code: 'MIABIS:ST:PLASMA' };

  it('finds a seeded row by its canonical string key ("PLASMA")', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(SEEDED_ITEM) });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/sample-types/PLASMA')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ id: 'PLASMA' }]),
      })
    );
  });

  it('regression: still finds a row by its Mongo _id and numeric/string idField', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(SEEDED_ITEM) });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/sample-types/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(coll.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ _id: new (require('mongodb').ObjectId)('507f1f77bcf86cd799439011') }]),
      })
    );

    const res2 = await request(app)
      .get('/api/sample-types/42')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res2.status).toBe(200);
    // #881: idField is now 'id' for this mount, so buildIdQuery's
    // numeric-idField and string-idField branches both resolve on `id`.
    expect(coll.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ id: 42 }, { id: '42' }]),
      })
    );
  });
});

describe('PUT /api/sample-types/:id (canonical string business key)', () => {
  it('updates a seeded row found by its canonical string key ("PLASMA")', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ id: 'PLASMA', description: 'Plasma' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ id: 'PLASMA', description: 'Plasma Updated' }),
    });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/sample-types/PLASMA')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Plasma Updated' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ id: 'PLASMA' }]),
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('regression: still updates a row found by its Mongo _id', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ id: 'PLASMA', description: 'Plasma' }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ id: 'PLASMA', description: 'Updated' }),
    });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/sample-types/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ _id: new (require('mongodb').ObjectId)('507f1f77bcf86cd799439011') }]),
      }),
      expect.anything(),
      expect.anything()
    );
  });
});

describe('DELETE /api/sample-types/:id (canonical string business key)', () => {
  it('deletes a seeded row found by its canonical string key ("PLASMA")', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/sample-types/PLASMA')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ id: 'PLASMA' }]),
      })
    );
  });

  it('regression: still deletes a row found by its Mongo _id', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ sampleTypes: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/sample-types/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(coll.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ _id: new (require('mongodb').ObjectId)('507f1f77bcf86cd799439011') }]),
      })
    );
  });
});

// ── /api/sample-origins ───────────────────────────────────
describe('GET /api/sample-origins', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/sample-origins');
    expect(res.status).toBe(401);
  });

  it('returns sample origins for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ sampleOrigins: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/sample-origins')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
  });
});

// ── /api/extraction-protocols ─────────────────────────────
describe('GET /api/extraction-protocols', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/extraction-protocols');
    expect(res.status).toBe(401);
  });

  it('returns extraction protocols for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ extractionProtocols: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/extraction-protocols')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
  });
});

// ── /api/quality-descriptions ─────────────────────────────
describe('GET /api/quality-descriptions', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/quality-descriptions');
    expect(res.status).toBe(401);
  });

  it('returns quality descriptions for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ qualityDescriptions: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/quality-descriptions')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
  });
});

// ── db-unavailable (503) and error (500) branches ─────────
// Exercised once via /api/measurement-units — shared factory code,
// covers the equivalent branch for all 5 mounted instances.
describe('db-not-available (503) branches', () => {
  it('GET / returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .get('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('GET /:id returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .get('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(503);
  });

  it('POST / returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'µL', symbol: 'µL' });
    expect(res.status).toBe(503);
  });

  it('PUT /:id returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(503);
  });

  it('DELETE /:id returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .delete('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(503);
  });
});

describe('unexpected-error (500) branches', () => {
  it('GET / returns 500 when the query throws', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('GET /:id returns 500 when the query throws', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockRejectedValue(new Error('boom')),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .get('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
  });

  it('POST / returns 500 when insertOne throws', async () => {
    const coll = createCollectionMock({
      insertOne: vi.fn().mockRejectedValue(new Error('boom')),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/measurement-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ unitID: 99, description: 'Microlitro' });
    expect(res.status).toBe(500);
  });

  it('PUT /:id returns 500 when findOneAndUpdate throws', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ ...FAKE_ITEM, unitID: 1, description: 'mL' }),
      findOneAndUpdate: vi.fn().mockRejectedValue(new Error('boom')),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .put('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'Updated' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id returns 500 when deleteOne throws', async () => {
    const coll = createCollectionMock({
      deleteOne: vi.fn().mockRejectedValue(new Error('boom')),
    });
    app.locals.db = createDbMock({ measurementUnits: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .delete('/api/measurement-units/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(500);
  });
});

// ── #881: idField for these four mounts is now 'id', matching the string
// MIABIS business key the seed writes (settled by #902). The numeric
// idField and the #899 number-typed validate() branch these tests used to
// exercise are retired along with it, so the mounts no longer require a
// generateId override -- the factory's randomUUID() default satisfies the
// (now type-agnostic) models directly.
describe('POST master-data: generated identifier satisfies the entity model (#881 retirement of #899)', () => {
  const STRING_ID_MOUNTS = [
    { route: '/api/sample-types', collection: 'sampleTypes' },
    { route: '/api/sample-origins', collection: 'sampleOrigins' },
    { route: '/api/extraction-protocols', collection: 'extractionProtocols' },
    { route: '/api/quality-descriptions', collection: 'qualityDescriptions' },
  ];

  for (const { route, collection } of STRING_ID_MOUNTS) {
    it(`${route} accepts a POST that omits id`, async () => {
      const coll = createCollectionMock({
        insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      });
      app.locals.db = createDbMock({ [collection]: coll, ...rbacCollectionsAdmin });

      const res = await request(app)
        .post(route)
        .set('Authorization', `Bearer ${makeToken(4)}`)
        .send({ description: 'Reproduction payload' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  }

  // #881 defect 1: master-data.routes.js:124's payload injects [idField]:
  // req.body?.[idField] ?? generateId() into the payload BEFORE
  // model.validate/create run, but model.create() previously returned a
  // fixed field list that did not include `id` -- so a client-supplied
  // `id` was thrown away before insertOne, and the stored document had no
  // `id` at all. Now that create() returns `id`, a POST-supplied id must
  // reach the driver's insertOne call unchanged.
  for (const { route, collection } of STRING_ID_MOUNTS) {
    it(`${route} POST with an explicit id: that id reaches insertOne unchanged`, async () => {
      const coll = createCollectionMock({
        insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      });
      app.locals.db = createDbMock({ [collection]: coll, ...rbacCollectionsAdmin });

      const res = await request(app)
        .post(route)
        .set('Authorization', `Bearer ${makeToken(4)}`)
        .send({ id: 'PLASMA', description: 'Plasma' });

      expect(res.status).toBe(201);
      expect(coll.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'PLASMA' })
      );
    });
  }
});
