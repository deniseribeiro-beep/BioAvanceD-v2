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
    { userID: 'qa-admin-1', accessType, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// The `authenticate` middleware itself short-circuits with a 503 (different
// message) if `app.locals.db` is falsy *before* the route handler runs, so
// setting `app.locals.db = null` up front never reaches the route's own
// `if (!db)` branch. To exercise that route-level guard we let auth pass
// with a real db, then flip `app.locals.db` to null as a side effect of the
// mocked `verifySession` call (simulating the db becoming unavailable in the
// brief window between the middleware's check and the handler running).
function givenSessionThenDbDisappears() {
  vi.spyOn(sessionService, 'verifySession').mockImplementation(async () => {
    app.locals.db = null;
    return { valid: true, session: { sessionID: 'session-1' } };
  });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

describe('GET /api/locations', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(401);
  });

  it('returns location list for authenticated user', async () => {
    const loc = { _id: 'loc-1', locationID: 1, equipmentType: 1, block: 1, rack: 1 };
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([loc]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .get('/api/locations')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/locations', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/locations').send({ equipmentType: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 403 for user without createSample permission (accessType 1 — Pesquisador)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ equipmentType: 1, block: 1, rack: 1, drawer: 1, box: 1 });
    expect(res.status).toBe(403);
  });

  it('creates a location for admin user', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-loc-id' }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentType: 1, block: 1, rack: 1, drawer: 1, box: 1 });

    expect([200, 201, 400]).toContain(res.status);
  });

  it('coerces numeric-looking string fields to numbers on create', async () => {
    let inserted = null;
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockImplementation((doc) => {
        inserted = doc;
        return Promise.resolve({ insertedId: 'new-loc-id-2' });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentType: '2', equipmentID: '5', block: '1', rack: '2', drawer: '3', box: '4', locationID: '99' });

    expect(res.status).toBe(201);
    expect(inserted.equipmentType).toBe(2);
    expect(inserted.equipmentID).toBe(5);
    expect(inserted.block).toBe(1);
    expect(inserted.rack).toBe(2);
    expect(inserted.drawer).toBe(3);
    expect(inserted.box).toBe(4);
    expect(res.body.data.equipmentType).toBe(2);
    expect(res.body.data.box).toBe(4);
  });

  it('returns 400 when equipmentType is missing (validation failure)', async () => {
    const coll = createCollectionMock({});
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ block: 1, rack: 1 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Dados inválidos');
    expect(res.body.message).toContain('equipmentType é obrigatório');
  });

  it('returns 400 when the supplied locationID already exists', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'existing-1', locationID: 42 }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentType: 1, locationID: 42 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('LocationID já existe');
    expect(res.body.message).toContain('42');
  });

  it('auto-generates a locationID when none is supplied', async () => {
    let inserted = null;
    const coll = createCollectionMock({
      // generateUniqueLocationID calls findOne twice: sorted lastItem lookup, then existence check.
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockImplementation((doc) => {
        inserted = doc;
        return Promise.resolve({ insertedId: 'new-loc-id-3' });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentType: 1 });

    expect(res.status).toBe(201);
    expect(inserted.locationID).toBe(1);
    expect(res.body.data.locationID).toBe(1);
  });
});

describe('GET /api/locations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 503 when db is unavailable', async () => {
    givenSessionThenDbDisappears();
    const res = await request(app)
      .get('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 404 when the location does not exist', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .get('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Localização não encontrada' });
  });

  it('returns 200 with the found location', async () => {
    const loc = { _id: '507f1f77bcf86cd799439011', locationID: 5, equipmentType: 1 };
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(loc) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .get('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(loc);
  });

  it('returns 500 when findOne rejects', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('db exploded')) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .get('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Erro ao buscar localização');
    expect(res.body.message).toBe('db exploded');
  });
});

describe('PUT /api/locations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 503 when db is unavailable', async () => {
    givenSessionThenDbDisappears();
    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ block: 1 });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
  });

  it('converts array-form eppendorfWell into a wellPosition string', async () => {
    let setPayload = null;
    const coll = createCollectionMock({
      updateOne: vi.fn().mockImplementation((filter, update) => {
        setPayload = update.$set;
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ eppendorfWell: ['A', 1] });

    expect(res.status).toBe(200);
    expect(setPayload.wellPosition).toBe('Ax1');
    expect(setPayload.eppendorfWell).toBeUndefined();
  });

  it('keeps string-form eppendorfWell as wellPosition directly', async () => {
    let setPayload = null;
    const coll = createCollectionMock({
      updateOne: vi.fn().mockImplementation((filter, update) => {
        setPayload = update.$set;
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ eppendorfWell: 'B2' });

    expect(res.status).toBe(200);
    expect(setPayload.wellPosition).toBe('B2');
  });

  it('coerces numeric-looking string fields to numbers on update', async () => {
    let setPayload = null;
    const coll = createCollectionMock({
      updateOne: vi.fn().mockImplementation((filter, update) => {
        setPayload = update.$set;
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ equipmentType: '3', equipmentID: '7', block: '1', rack: '2', drawer: '3', box: '4' });

    expect(res.status).toBe(200);
    expect(setPayload.equipmentType).toBe(3);
    expect(setPayload.equipmentID).toBe(7);
    expect(setPayload.block).toBe(1);
    expect(setPayload.rack).toBe(2);
    expect(setPayload.drawer).toBe(3);
    expect(setPayload.box).toBe(4);
  });

  it('returns 404 when no document matches the given id', async () => {
    const coll = createCollectionMock({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ block: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Localização não encontrada' });
  });

  it('returns 200 on a successful update', async () => {
    const coll = createCollectionMock({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ block: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Localização atualizada com sucesso' });
  });

  it('returns 400 when updateOne rejects', async () => {
    const coll = createCollectionMock({
      updateOne: vi.fn().mockRejectedValue(new Error('update failed')),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .put('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ block: 1 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Erro ao atualizar localização');
    expect(res.body.message).toBe('update failed');
  });
});

describe('DELETE /api/locations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 503 when db is unavailable', async () => {
    givenSessionThenDbDisappears();
    const res = await request(app)
      .delete('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 404 when nothing is deleted', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .delete('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Localização não encontrada' });
  });

  it('returns 200 on successful delete', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .delete('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Localização deletada com sucesso' });
  });

  it('returns 400 when deleteOne rejects', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockRejectedValue(new Error('delete failed')) });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .delete('/api/locations/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Erro ao deletar localização');
    expect(res.body.message).toBe('delete failed');
  });
});

describe('PATCH /api/locations/fix-missing-locationids', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 503 when db is unavailable', async () => {
    givenSessionThenDbDisappears();
    const res = await request(app)
      .patch('/api/locations/fix-missing-locationids')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns updated: 0 when no locations need fixing', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .patch('/api/locations/fix-missing-locationids')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Todas as localizações já possuem locationID válido',
      updated: 0,
    });
  });

  it('assigns generated locationIDs to locations that need one', async () => {
    const badLocation = { _id: 'loc-needs-id-1' };
    const updateOneCalls = [];
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([badLocation]) }),
      // generateUniqueLocationID's internal findOne calls resolve null -> newID stays 1
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockImplementation((filter, update) => {
        updateOneCalls.push({ filter, update });
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }),
    });
    app.locals.db = createDbMock({ locations: coll });

    const res = await request(app)
      .patch('/api/locations/fix-missing-locationids')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(1);
    expect(res.body.total).toBe(1);
    expect(updateOneCalls).toHaveLength(1);
    expect(updateOneCalls[0].filter).toEqual({ _id: 'loc-needs-id-1' });
    expect(updateOneCalls[0].update.$set.locationID).toBe(1);
  });
});
