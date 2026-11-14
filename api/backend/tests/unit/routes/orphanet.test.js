import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import router from '../../../src/routes/orphanet.js';

const require2 = createRequire(import.meta.url);
const logger = require2('../../../src/utils/logger');

// src/routes/orphanet.js reads its db connection from req.app.locals.db
// (a shared connection set up once at server startup, not a per-request
// MongoClient) -- see git history of the file, commit e9fc064c switched
// it from `new MongoClient(MONGO_URI)` per request to `req.app.locals.db`.
// So tests here set app.locals.db directly.

function emptyFind() {
  return vi.fn(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) }));
}

function findReturning(results) {
  return vi.fn(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => results) })) }));
}

function buildDb({ cidsFind = emptyFind(), orphanetFind = emptyFind() } = {}) {
  const collection = vi.fn((name) => {
    if (name === 'cids') return { find: cidsFind };
    if (name === 'orphanet_diseases') return { find: orphanetFind };
    throw new Error(`unexpected collection ${name}`);
  });
  return { collection };
}

function buildApp(db) {
  const app = express();
  if (db) app.locals.db = db;
  app.use('/api/orphanet', router);
  return app;
}

describe('orphanet route GET /search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 with Missing query when q is absent', async () => {
    const app = buildApp(buildDb());
    const res = await request(app).get('/api/orphanet/search');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing query' });
  });

  it('returns 503 when app.locals.db is not set', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Database unavailable' });
  });

  it('defaults lang to pt and returns lang-scoped results without falling back', async () => {
    const orphanetFind = findReturning([{ ORPHA: '166024', name: 'Disease A', lang: 'pt' }]);
    const app = buildApp(buildDb({ orphanetFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ code: '166024', name: 'Disease A', lang: 'pt' }),
    ]);
    expect(orphanetFind).toHaveBeenCalledTimes(1);
    const filterArg = orphanetFind.mock.calls[0][0];
    expect(filterArg.lang).toEqual({ $in: ['pt', '', null] });
  });

  it('treats a whitespace-only lang the same as an omitted one, defaulting to pt (issue #231)', async () => {
    const orphanetFind = findReturning([{ ORPHA: '166030', name: 'Disease E', lang: 'pt' }]);
    const app = buildApp(buildDb({ orphanetFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease', lang: '   ' });

    expect(res.status).toBe(200);
    expect(orphanetFind).toHaveBeenCalledTimes(1);
    const filterArg = orphanetFind.mock.calls[0][0];
    expect(filterArg.lang).toEqual({ $in: ['pt', '', null] });
  });

  it('falls back to the lang-less query when the lang-scoped query returns empty results', async () => {
    const fallbackDoc = { ORPHA: '166025', name: 'Disease B', lang: 'en' };
    const orphanetFind = vi.fn()
      .mockImplementationOnce(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) }))
      .mockImplementationOnce(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => [fallbackDoc]) })) }));
    const app = buildApp(buildDb({ orphanetFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease', lang: 'fr' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ code: '166025', name: 'Disease B', lang: 'en' }),
    ]);
    expect(orphanetFind).toHaveBeenCalledTimes(2);
    // second call must be the plain base filter, without a lang key
    const secondFilter = orphanetFind.mock.calls[1][0];
    expect(secondFilter.lang).toBeUndefined();
  });

  it('does not run the fallback query when the lang-scoped query returns results', async () => {
    const orphanetFind = findReturning([{ ORPHA: '166026', name: 'Disease C', lang: 'es' }]);
    const app = buildApp(buildDb({ orphanetFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease', lang: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ code: '166026', name: 'Disease C', lang: 'es' }),
    ]);
    expect(orphanetFind).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when both the primary search and the fallback search throw', async () => {
    const throwingFind = vi.fn(() => {
      throw new Error('boom');
    });
    const app = buildApp(buildDb({ cidsFind: throwingFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to search orphanet diseases' });
  });

  it('logs the fallback warning as a local-search failure, not an external one, when searchLocal itself throws (issue #232)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const cidsFind = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('local boom');
      })
      .mockImplementationOnce(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) }));
    const app = buildApp(buildDb({ cidsFind }));

    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(200);
    expect(cidsFind).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Busca local falhou'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Busca externa/local falhou'));
    warnSpy.mockRestore();
  });
});
