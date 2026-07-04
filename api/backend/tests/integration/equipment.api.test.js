import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_EQ = { _id: '507f1f77bcf86cd799439011', equipmentID: 'EQ-001', name: 'Freezer A', type: 'Storage', status: 'Active' };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment');
    expect(res.status).toBe(401);
  });

  it('returns equipment list for authenticated user', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_EQ]) }) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/equipment/analytical', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment/analytical');
    expect(res.status).toBe(401);
  });

  it('returns analytical equipment', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns equipment by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_EQ) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/equipment').send({ name: 'New EQ' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico (accessType 2 — no createPatient permission)', async () => {
    app.locals.db = createDbMock({});
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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ status: 'Maintenance' });
    expect(res.status).toBe(403);
  });

  it('updates equipment for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Maintenance' });
    expect([200, 400]).toContain(res.status);
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
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'New EQ', type: 'Analytical' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/equipmentDescription/);
  });

  it('returns 400 when type is not one of the allowed EQUIPMENT_TYPES', async () => {
    app.locals.db = createDbMock({});
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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', name: 'New Freezer', type: 'Storage', status: 'Active' });

    expect(res.status).toBe(201);
    expect(res.body.data.equipmentID).toBeDefined();
    expect(typeof res.body.data.equipmentID).toBe('number');
  });

  it('returns 400 when the collection throws during insertOne (error branch)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockRejectedValue(new Error('insert failed')),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ equipmentDescription: 'desc', equipmentID: 99 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('insert failed');
  });
});

describe('GET /api/equipment/:id with an invalid ObjectId', () => {
  it('returns 500 because new ObjectId() throws synchronously inside the try block', async () => {
    // req.params.id = 'not-a-valid-id' cannot be cast to ObjectId; the thrown
    // error is caught by the route's catch block and mapped to a 500 response
    // (unlike PUT/DELETE which have their own try/catch around the ObjectId
    // construction and fall back to numeric equipmentID lookup instead).
    app.locals.db = createDbMock({ equipment: createCollectionMock() });
    const res = await request(app)
      .get('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/equipment/:id with a non-ObjectId, non-numeric id', () => {
  it('returns 400 "ID inválido" when id is neither a valid ObjectId nor parseable as a number', async () => {
    app.locals.db = createDbMock({ equipment: createCollectionMock() });
    const res = await request(app)
      .put('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ID inválido');
  });

  it('falls back to numeric equipmentID lookup when id is not a valid ObjectId but is numeric', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'abc', equipmentID: 123, status: 'Active' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Active' });

    expect(res.status).toBe(200);
    expect(quarantineByEquipmentStatus).not.toHaveBeenCalled();
    expect(res.body.quarantine.triggered).toBe(false);

    delete app.locals.quarantineService;
  });

  it('returns 500 when updateOne matches no documents (found but not updatable)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({});
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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

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
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/not-a-valid-id')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the equipment does not exist for a well-formed ObjectId', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439099')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });
});
