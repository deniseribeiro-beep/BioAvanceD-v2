import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

// NOTE on why this file does NOT use vi.mock('mongodb', ...):
// src/routes/orphanet.js does `const { MongoClient } = require('mongodb')` at
// module scope (plain CommonJS require, inside a CJS source file). Verified in
// this repo/vitest version that vi.mock('mongodb', factory) does NOT intercept
// that require call -- even when *this test file* is loaded as ESM and even
// when the router itself is loaded via an ESM `import` of the .js file. A
// throwaway debug test confirmed the real `mongodb` driver got constructed
// (it threw MongoParseError for a bogus connection string) despite an active
// vi.mock('mongodb', ...) mock and vi.hoisted() wiring. So instead we patch
// the `mongodb` module's own MongoClient export in place (its property
// descriptor is a configurable getter-only accessor, so we override it with
// Object.defineProperty) BEFORE requiring the router via createRequire. Since
// the router's destructuring `const { MongoClient } = require('mongodb')`
// runs at router-require-time and reads off the (now patched) property, this
// reliably swaps in our fake constructor.
const require = createRequire(import.meta.url);
const mongodb = require('mongodb');

const connectMock = vi.fn(async () => {});
const closeMock = vi.fn(async () => {});
const findMock = vi.fn();
const collectionMock = vi.fn(() => ({ find: findMock }));
const dbMock = vi.fn(() => ({ collection: collectionMock }));

function FakeMongoClient() {
  return {
    connect: connectMock,
    db: dbMock,
    close: closeMock,
  };
}

Object.defineProperty(mongodb, 'MongoClient', {
  value: FakeMongoClient,
  configurable: true,
  writable: true,
  enumerable: true,
});

const router = require('../../../src/routes/orphanet.js');

function buildApp() {
  const app = express();
  app.use('/api/orphanet', router);
  return app;
}

function makeFind(results) {
  return vi.fn(() => ({
    limit: vi.fn(() => ({
      toArray: vi.fn(async () => results),
    })),
  }));
}

describe('orphanet route GET /search', () => {
  beforeEach(() => {
    connectMock.mockClear();
    closeMock.mockClear();
    findMock.mockReset();
    collectionMock.mockClear();
    dbMock.mockClear();
  });

  it('returns 400 with Missing query when q is absent, without connecting to the db', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/orphanet/search');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing query' });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('defaults lang to pt and returns lang-scoped results without falling back', async () => {
    const results = [{ name: 'Disease A', lang: 'pt' }];
    findMock.mockImplementation(makeFind(results));

    const app = buildApp();
    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(results);
    expect(findMock).toHaveBeenCalledTimes(1);
    const filterArg = findMock.mock.calls[0][0];
    expect(filterArg.lang).toBe('pt');
    expect(filterArg.$or).toEqual([
      { name: expect.any(RegExp) },
      { code: expect.any(RegExp) },
      { synonyms: expect.any(RegExp) },
    ]);
  });

  it('falls back to the lang-less query when the lang-scoped query returns empty results', async () => {
    const fallbackResults = [{ name: 'Disease B', lang: 'en' }];
    const emptyFind = vi.fn(() => ({
      limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    }));
    const fallbackFind = vi.fn(() => ({
      limit: vi.fn(() => ({ toArray: vi.fn(async () => fallbackResults) })),
    }));
    findMock.mockImplementationOnce(emptyFind).mockImplementationOnce(fallbackFind);

    const app = buildApp();
    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease', lang: 'fr' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fallbackResults);
    expect(findMock).toHaveBeenCalledTimes(2);
    // second call must be the plain base filter, without a lang key
    const secondFilter = findMock.mock.calls[1][0];
    expect(secondFilter.lang).toBeUndefined();
  });

  it('does not run the fallback query when the lang-scoped query returns results', async () => {
    const results = [{ name: 'Disease C', lang: 'es' }];
    findMock.mockImplementation(makeFind(results));

    const app = buildApp();
    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease', lang: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(results);
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the query throws, and still closes the client', async () => {
    findMock.mockImplementation(() => {
      throw new Error('boom');
    });

    const app = buildApp();
    const res = await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to search orphanet diseases' });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('closes the client on the success path too', async () => {
    findMock.mockImplementation(makeFind([{ name: 'Disease D', lang: 'pt' }]));

    const app = buildApp();
    await request(app).get('/api/orphanet/search').query({ q: 'disease' });

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
