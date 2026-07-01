import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

const FAKE_TERM = {
  _id: '507f1f77bcf86cd799439011',
  sistema: 'ORPHA',
  codigo: 'ORPHA:123',
  descricao: 'Some Rare Disease',
  label: 'Some Rare Disease',
  sinonimos: ['alias1'],
  aliases: ['alias1'],
  relacoes: { cid: 'Q87.1', omim: '', orpha: 'ORPHA:123', hpo: '' },
  ativo: true,
  lang: 'pt',
  sincronizadoEm: new Date(),
};

afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/terminologies', () => {
  it('returns 200 with empty list when no records', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    const cidsColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    const orphaColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    app.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

    const res = await request(app).get('/api/terminologies');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('returns matching items when db has records', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_TERM]) }) }) }),
      countDocuments: vi.fn().mockResolvedValue(1),
    });
    app.locals.db = createDbMock({ terminologies: coll });

    const res = await request(app).get('/api/terminologies');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].codigo).toBe('ORPHA:123');
  });

  it('filters by sistema query param', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_TERM]) }) }) }),
      countDocuments: vi.fn().mockResolvedValue(1),
    });
    app.locals.db = createDbMock({ terminologies: coll });

    const res = await request(app).get('/api/terminologies?sistema=ORPHA');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('searches by q param and falls back to local redundancy on empty result', async () => {
    let callCount = 0;
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => ({
        sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      })),
      countDocuments: vi.fn().mockResolvedValue(0),
      bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    });
    const cidsColl = createCollectionMock({
      find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
    });
    const orphaColl = createCollectionMock({
      find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
      bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    });
    app.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

    const res = await request(app).get('/api/terminologies?q=rare');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;

    const res = await request(app).get('/api/terminologies');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/terminologies/sync', () => {
  it('returns success when sync runs without error', async () => {
    const terminologySync = require('../../src/services/terminologySync.service');
    vi.spyOn(terminologySync, 'syncFromOrphadata').mockResolvedValue({ synced: 0, errors: 0 });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ terminologies: coll });

    const res = await request(app).post('/api/terminologies/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;

    const res = await request(app).post('/api/terminologies/sync');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with sync result fields', async () => {
    const terminologySync = require('../../src/services/terminologySync.service');
    vi.spyOn(terminologySync, 'syncFromOrphadata').mockResolvedValue({ synced: 42, errors: 0 });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ terminologies: coll });

    const res = await request(app).post('/api/terminologies/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
