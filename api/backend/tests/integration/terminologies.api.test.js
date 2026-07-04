import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const express = require('express');

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

describe('GET /api/terminologies - Orphadata fallback (base URL unset)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not call fetch and returns 200 empty when ORPHADATA_BASE_URL is unset (whether or not sync is "enabled")', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const previousAllow = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';

    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }), limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    const cidsColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    const orphaColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    app.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

    const res = await request(app).get('/api/terminologies?q=raredisease123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = previousAllow;
  });
});

describe('GET /api/terminologies - Orphadata live fallback (fresh module, base URL set at require time)', () => {
  let freshApp;
  let previousAllow;
  let previousBaseUrl;
  const routesModulePath = require.resolve('../../src/interface/routes/terminologies.routes');

  beforeEach(() => {
    previousAllow = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
    previousBaseUrl = process.env.ORPHADATA_BASE_URL;
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
    process.env.ORPHADATA_BASE_URL = 'https://fake-orphadata.test';

    // ORPHADATA_BASE_URL is captured into a frozen module-level const at
    // require time in terminologies.routes.js, so setting the env var alone
    // does not affect an already-cached instance of the module. Clear the
    // cache and re-require so the fresh module picks up the new value.
    delete require.cache[routesModulePath];
    const freshRouter = require('../../src/interface/routes/terminologies.routes');

    freshApp = express();
    freshApp.use((req, res, next) => { next(); });
    freshApp.use('/api/terminologies', freshRouter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = previousAllow;
    process.env.ORPHADATA_BASE_URL = previousBaseUrl;
    delete require.cache[routesModulePath];
    // re-require once more so any subsequent describe blocks reusing the
    // shared `app` (which already holds its own cached router instance)
    // are unaffected; this just restores the module cache to a clean state.
    require('../../src/interface/routes/terminologies.routes');
  });

  function mockOrphadataFetch(orphaApiItem) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { results: [orphaApiItem] } }),
    });
  }

  it('hydrates from Orphadata live API when local db and redundancy both return empty, and upserts to both collections', async () => {
    const orphaApiItem = {
      ORPHAcode: '166',
      'Preferred term': 'Rare Disease X',
      ExternalReference: [
        { Source: 'ICD-10', Reference: 'Q87.1' },
        { Source: 'OMIM', Reference: '123456' },
      ],
      Synonym: [{ label: 'RDX' }],
    };
    vi.stubGlobal('fetch', mockOrphadataFetch(orphaApiItem));

    const storedDoc = {
      _id: 'fresh-doc-id',
      sistema: 'ORPHA',
      codigo: 'ORPHA:166',
      descricao: 'Rare Disease X',
      label: 'Rare Disease X',
      sinonimos: ['RDX'],
      aliases: ['RDX'],
      relacoes: { cid: 'Q87.1', omim: 'OMIM:123456', orpha: 'ORPHA:166', hpo: '' },
      ativo: true,
      lang: 'en',
      sincronizadoEm: new Date(),
    };

    let findCallCount = 0;
    const bulkWriteSpy = vi.fn().mockResolvedValue({ ok: 1 });
    const coll = createCollectionMock({
      find: vi.fn().mockImplementation(() => {
        findCallCount += 1;
        const docs = findCallCount >= 2 ? [storedDoc] : [];
        return {
          sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }) }),
          limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }),
        };
      }),
      countDocuments: vi.fn().mockResolvedValue(findCallCount >= 2 ? 1 : 0),
      bulkWrite: bulkWriteSpy,
    });
    const cidsColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    const orphaBulkWriteSpy = vi.fn().mockResolvedValue({ ok: 1 });
    const orphaColl = createCollectionMock({
      find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
      bulkWrite: orphaBulkWriteSpy,
    });
    freshApp.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

    const res = await request(freshApp).get('/api/terminologies?q=166');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].codigo).toBe('ORPHA:166');
    expect(bulkWriteSpy).toHaveBeenCalled();
    expect(orphaBulkWriteSpy).toHaveBeenCalled();
  });

  it('swallows Orphadata fetch errors per-URL and still returns 200 with no crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    const cidsColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    const orphaColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
    freshApp.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

    const res = await request(freshApp).get('/api/terminologies?q=999999');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('normalizes ORPHA codes consistently regardless of whether the search term is already ORPHA:-prefixed', async () => {
    const makeItem = () => ({
      ORPHAcode: '166',
      'Preferred term': 'Rare Disease X',
      ExternalReference: [],
      Synonym: [],
    });

    const storedDoc = (search) => ({
      _id: `doc-${search}`,
      sistema: 'ORPHA',
      codigo: 'ORPHA:166',
      descricao: 'Rare Disease X',
      label: 'Rare Disease X',
      sinonimos: [],
      aliases: [],
      relacoes: { cid: '', omim: '', orpha: 'ORPHA:166', hpo: '' },
      ativo: true,
      lang: 'en',
      sincronizadoEm: new Date(),
    });

    async function runQuery(search) {
      vi.stubGlobal('fetch', mockOrphadataFetch(makeItem()));
      let findCallCount = 0;
      const doc = storedDoc(search);
      const coll = createCollectionMock({
        find: vi.fn().mockImplementation(() => {
          findCallCount += 1;
          const docs = findCallCount >= 2 ? [doc] : [];
          return {
            sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }) }),
            limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }),
          };
        }),
        countDocuments: vi.fn().mockResolvedValue(0),
        bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
      });
      const cidsColl = createCollectionMock({ find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) });
      const orphaColl = createCollectionMock({
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
      });
      freshApp.locals.db = createDbMock({ terminologies: coll, cids: cidsColl, orphanet_diseases: orphaColl });

      return request(freshApp).get(`/api/terminologies?q=${encodeURIComponent(search)}`);
    }

    const bareRes = await runQuery('166');
    vi.unstubAllGlobals();
    const prefixedRes = await runQuery('ORPHA:166');

    expect(bareRes.status).toBe(200);
    expect(prefixedRes.status).toBe(200);
    expect(bareRes.body.data[0].codigo).toBe('ORPHA:166');
    expect(prefixedRes.body.data[0].codigo).toBe('ORPHA:166');
    expect(bareRes.body.data[0].codigo).toBe(prefixedRes.body.data[0].codigo);
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
