import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4, roleName = 'Administrador') {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName, name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

function makeCursor(docs) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); delete app.locals.db; });

describe('GET /api/clinical-units gaps', () => {
  it('returns 503 when db is unavailable (via the auth middleware gate)', async () => {
    // The route's own `if (!db)` check (line 33) is unreachable in practice:
    // `authenticate` already 503s on a falsy req.app.locals.db before the
    // route handler runs, since both read the same app.locals.db.
    app.locals.db = null;
    const res = await request(app)
      .get('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when the collection lookup throws', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
    });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('boom');
  });

  it('includes inactive units when includeInactive=true', async () => {
    const active = { _id: '1', name: 'A', active: true };
    const inactive = { _id: '2', name: 'B', active: false };
    const find = vi.fn().mockReturnValue(makeCursor([active, inactive]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units?includeInactive=true')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({});
  });

  it('clamps an out-of-range limit', async () => {
    const find = vi.fn().mockReturnValue(makeCursor([]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units?limit=99999')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const cursor = find.mock.results[0].value;
    expect(cursor.limit).toHaveBeenCalledWith(500);
  });
});

describe('GET /api/clinical-units/search gaps', () => {
  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .get('/api/clinical-units/search?q=onco')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(503);
  });

  it('returns active units sorted by name when q is empty', async () => {
    const find = vi.fn().mockReturnValue(makeCursor([{ _id: '1', name: 'A' }]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({ active: { $ne: false } });
  });

  it('skips $text search for a term shorter than 3 chars and falls back to regex', async () => {
    const find = vi.fn().mockReturnValue(makeCursor([{ _id: '1', name: 'Oncologia' }]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search?q=on')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.any(Array) }));
  });

  it('falls back to regex search when the $text query throws', async () => {
    const find = vi.fn()
      .mockImplementationOnce(() => { throw new Error('no text index'); })
      .mockReturnValueOnce(makeCursor([{ _id: '1', name: 'Oncologia' }]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search?q=oncologia')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('returns text matches early when they already fill the limit', async () => {
    const textDocs = [{ _id: '1', name: 'Oncologia' }];
    const find = vi.fn().mockReturnValue(makeCursor(textDocs));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search?q=oncologia&limit=1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(textDocs);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('merges text and regex matches, de-duplicating by id', async () => {
    const shared = { _id: 'shared-1', name: 'Oncologia' };
    const regexOnly = { _id: 'regex-2', name: 'Oncologia Pediatrica' };
    const find = vi.fn()
      .mockReturnValueOnce(makeCursor([shared]))
      .mockReturnValueOnce(makeCursor([shared, regexOnly]));
    const coll = createCollectionMock({ find });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search?q=oncologia&limit=10')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const ids = res.body.data.map((d) => d._id);
    expect(ids).toEqual(['shared-1', 'regex-2']);
  });

  it('returns 500 when the search throws outside the text-search try/catch', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
    });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .get('/api/clinical-units/search')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('boom');
  });
});

describe('POST /api/clinical-units gaps', () => {
  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia' });
    expect(res.status).toBe(503);
  });

  it('returns 400 for a name shorter than 3 characters', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'AB' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('3 caracteres');
  });

  it('returns 400 when active is not a boolean', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia', active: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('active');
  });

  it('returns the existing unit without inserting when normalizedName already exists', async () => {
    const existing = { _id: 'cu-1', name: 'Cardiologia', normalizedName: 'CARDIOLOGIA', active: true };
    const findOne = vi.fn().mockResolvedValue(existing);
    const insertOne = vi.fn();
    const coll = createCollectionMock({ findOne, insertOne });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Unidade clínica já existente');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('recovers a duplicate-key race by returning the fallback existing record', async () => {
    const fallback = { _id: 'cu-2', name: 'Cardiologia', normalizedName: 'CARDIOLOGIA', active: true };
    const duplicateError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fallback);
    const insertOne = vi.fn().mockRejectedValue(duplicateError);
    const coll = createCollectionMock({ findOne, insertOne });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fallback);
    expect(res.body.message).toBe('Unidade clínica já existente');
  });

  it('returns 500 when a duplicate-key race has no recoverable fallback record', async () => {
    const duplicateError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const insertOne = vi.fn().mockRejectedValue(duplicateError);
    const coll = createCollectionMock({ findOne, insertOne });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('E11000 duplicate key');
  });

  it('returns 500 for a non-duplicate insertion error', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const insertOne = vi.fn().mockRejectedValue(new Error('connection lost'));
    const coll = createCollectionMock({ findOne, insertOne });
    app.locals.db = createDbMock({ clinicalUnits: coll, clinical_units: coll });

    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Cardiologia' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('connection lost');
  });

  it('returns 403 for a user without createPatient permission', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/clinical-units')
      .set('Authorization', `Bearer ${makeToken(1, 'Usuário Externo')}`)
      .send({ name: 'Cardiologia' });

    expect(res.status).toBe(403);
  });
});
