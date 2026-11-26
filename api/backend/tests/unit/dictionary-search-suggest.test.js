import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const neo4jModulePath = require.resolve('../../src/database/neo4j');
const redisModulePath = require.resolve('redis');
const dictionaryRoutePath = require.resolve('../../src/routes/dictionary');
const requestContext = require('../../src/utils/requestContext');

// #1394: the first require of the route's module tree costs seconds, so it is
// paid here, at import time, rather than inside the first case's timeout.
// The route and neo4j entries are cleared again, as afterEach does.
require(dictionaryRoutePath);
delete require.cache[neo4jModulePath];
delete require.cache[dictionaryRoutePath];

// dictionary.js destructures `getNeo4jDriver` from ../database/neo4j at
// require-time, so vi.spyOn on the already-required module has no effect
// (see hpo.routes.test.js / testing-conventions' cjs-mocking reference).
// Clear the cache for both the dependency and the route file, swap in a
// fake getNeo4jDriver, then require dictionary.js fresh.
function loadRouteWithMocks({ session, createClientImpl, withRequestContext = false } = {}) {
  delete require.cache[neo4jModulePath];
  delete require.cache[dictionaryRoutePath];

  const neo4jModule = require(neo4jModulePath);
  neo4jModule.getNeo4jDriver = vi.fn().mockReturnValue({
    session: () => session,
  });

  // dictionary.js references `redis.createClient(...)` (not destructured),
  // so spying directly on the shared module object is sufficient here.
  const redisModule = require(redisModulePath);
  vi.spyOn(redisModule, 'createClient').mockImplementation(
    createClientImpl || (() => ({
      isOpen: false,
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      setEx: vi.fn().mockResolvedValue('OK'),
    }))
  );

  const router = require(dictionaryRoutePath);
  const app = express();
  if (withRequestContext) app.use(requestContext.middleware);
  app.use('/api/dictionary', router);
  return app;
}

function fakeSession(records) {
  return {
    run: vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function record(map) {
  return { get: (key) => map[key] };
}

describe('dictionary routes - /search and /suggest (Neo4j + redis cache)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[neo4jModulePath];
    delete require.cache[dictionaryRoutePath];
  });

  describe('GET /api/dictionary/search', () => {
    it('returns 400 when query is missing', async () => {
      const app = loadRouteWithMocks({ session: fakeSession([]) });
      const res = await request(app).get('/api/dictionary/search');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing query' });
    });

    it('returns 400 when query is only whitespace', async () => {
      const app = loadRouteWithMocks({ session: fakeSession([]) });
      const res = await request(app).get('/api/dictionary/search?query=%20%20');
      expect(res.status).toBe(400);
    });

    it('returns 400 when query is repeated (#1415)', async () => {
      const session = fakeSession([]);
      const app = loadRouteWithMocks({ session });
      const res = await request(app).get('/api/dictionary/search?query=a&query=b').timeout(2000);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid query' });
      expect(session.run).not.toHaveBeenCalled();
    });

    it('queries Neo4j, normalizes results, and caches the payload on a cache miss', async () => {
      const session = fakeSession([
        record({ d: { properties: { code: 'ORPHA:558', nome: 'Fabry disease' } } }),
      ]);
      const setEx = vi.fn().mockResolvedValue('OK');
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(null),
          setEx,
        }),
      });

      const res = await request(app).get('/api/dictionary/search?query=fabry');

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([
        { system: 'http://www.orpha.net', code: 'ORPHA:558', display: 'Fabry disease' },
      ]);
      expect(session.close).toHaveBeenCalled();
      expect(setEx).toHaveBeenCalledWith(
        'orpha:search:fabry',
        3600,
        JSON.stringify(res.body)
      );
    });

    it('filters out records that normalize to null (missing code and display)', async () => {
      const session = fakeSession([
        record({ d: { properties: { code: '', nome: '' } } }),
      ]);
      const app = loadRouteWithMocks({ session });

      const res = await request(app).get('/api/dictionary/search?query=x');
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    });

    it('returns a cached payload without hitting Neo4j on a cache hit', async () => {
      const cachedPayload = { results: [{ system: 's', code: 'c', display: 'd' }] };
      const session = fakeSession([]);
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(JSON.stringify(cachedPayload)),
          setEx: vi.fn(),
        }),
      });

      const res = await request(app).get('/api/dictionary/search?query=cached');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(cachedPayload);
      expect(session.run).not.toHaveBeenCalled();
    });

    it('returns 500 with the error message when the Neo4j session throws', async () => {
      const session = {
        run: vi.fn().mockRejectedValue(new Error('neo4j down')),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const app = loadRouteWithMocks({ session });
      const res = await request(app).get('/api/dictionary/search?query=x');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'neo4j down' });
    });
  });

  describe('GET /api/dictionary/suggest', () => {
    it('returns 400 when orphaCode is missing', async () => {
      const app = loadRouteWithMocks({ session: fakeSession([]) });
      const res = await request(app).get('/api/dictionary/suggest');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing orphaCode' });
    });

    it('returns 404 when no matching disease record is found', async () => {
      const session = fakeSession([]);
      const app = loadRouteWithMocks({ session });
      const res = await request(app).get('/api/dictionary/suggest?orphaCode=558');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('returns disease, phenotypes and biomarkers normalized, and caches the payload', async () => {
      const session = fakeSession([
        record({
          d: { properties: { code: 'ORPHA:558', nome: 'Fabry disease' } },
          fenotipos: [{ properties: { code: 'HP:0001', nome: 'Fadiga' } }, null],
          biomarcadores: [{ properties: { code: 'LOINC:1', nome: 'Marker' } }],
        }),
      ]);
      const setEx = vi.fn().mockResolvedValue('OK');
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(null),
          setEx,
        }),
      });

      const res = await request(app).get('/api/dictionary/suggest?orphaCode=558');

      expect(res.status).toBe(200);
      expect(res.body.disease).toEqual({
        system: 'http://www.orpha.net',
        code: 'ORPHA:558',
        display: 'Fabry disease',
      });
      expect(res.body.phenotypes).toEqual([
        { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001', display: 'Fadiga' },
      ]);
      expect(res.body.biomarkers).toEqual([
        { system: 'http://loinc.org', code: 'LOINC:1', display: 'Marker' },
      ]);
      expect(setEx).toHaveBeenCalledWith(
        'orpha:suggest:558',
        3600,
        JSON.stringify(res.body)
      );
      expect(session.run.mock.calls[0][0]).toContain('Doenca_ORPHA');
      expect(session.run.mock.calls[0][1]).toEqual(
        expect.objectContaining({ numericOrpha: '558', prefixedOrpha: 'ORPHA:558' }),
      );
    });

    it('accepts orphaCode with ORPHA: prefix and normalizes the cache key', async () => {
      const session = fakeSession([
        record({
          d: { properties: { code: '324', nome: 'Fabry' } },
          fenotipos: [],
          biomarcadores: [],
        }),
      ]);
      const setEx = vi.fn().mockResolvedValue('OK');
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(null),
          setEx,
        }),
      });

      const res = await request(app).get('/api/dictionary/suggest?orphaCode=ORPHA:324');

      expect(res.status).toBe(200);
      expect(res.body.disease.display).toBe('Fabry');
      expect(setEx).toHaveBeenCalledWith(
        'orpha:suggest:324',
        3600,
        expect.any(String),
      );
      expect(session.run.mock.calls[0][1]).toEqual(
        expect.objectContaining({ numericOrpha: '324', prefixedOrpha: 'ORPHA:324' }),
      );
    });

    it('returns a cached payload without hitting Neo4j on a cache hit', async () => {
      const cachedPayload = { disease: { system: 's', code: 'c', display: 'd' }, phenotypes: [], biomarkers: [] };
      const session = fakeSession([]);
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(JSON.stringify(cachedPayload)),
          setEx: vi.fn(),
        }),
      });

      const res = await request(app).get('/api/dictionary/suggest?orphaCode=cached');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(cachedPayload);
      expect(session.run).not.toHaveBeenCalled();
    });

    it('returns 500 with the error message when the Neo4j session throws', async () => {
      const session = {
        run: vi.fn().mockRejectedValue(new Error('neo4j down')),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const app = loadRouteWithMocks({ session });
      const res = await request(app).get('/api/dictionary/suggest?orphaCode=558');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'neo4j down' });
    });
  });

  describe('redis cache client resilience', () => {
    it('falls back to no cache (still returns results) when redis connect fails', async () => {
      const session = fakeSession([
        record({ d: { properties: { code: 'ORPHA:9', nome: 'No cache disease' } } }),
      ]);
      const app = loadRouteWithMocks({
        session,
        createClientImpl: () => ({
          isOpen: false,
          on: vi.fn(),
          connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          get: vi.fn(),
          setEx: vi.fn(),
        }),
      });

      const res = await request(app).get('/api/dictionary/search?query=nocache');
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([
        { system: 'http://www.orpha.net', code: 'ORPHA:9', display: 'No cache disease' },
      ]);
    });
  });

  // #1323: RNF015 C1 -- each request-path Neo4j read carries the request id
  // as transaction metadata.
  describe('request id as Neo4j transaction metadata', () => {
    it('#1323 /search runs its query with the request id as metadata', async () => {
      const session = fakeSession([]);
      const app = loadRouteWithMocks({ session, withRequestContext: true });
      await request(app).get('/api/dictionary/search?query=x').set('X-Request-Id', 'req-dict-0001');
      expect(session.run).toHaveBeenCalled();
      expect(session.run.mock.calls[0][2]).toEqual({ metadata: { requestId: 'req-dict-0001' } });
    });

    it('#1323 /suggest runs its query with the request id as metadata', async () => {
      const session = fakeSession([]);
      const app = loadRouteWithMocks({ session, withRequestContext: true });
      await request(app).get('/api/dictionary/suggest?orphaCode=1').set('X-Request-Id', 'req-dict-0001');
      expect(session.run).toHaveBeenCalled();
      expect(session.run.mock.calls[0][2]).toEqual({ metadata: { requestId: 'req-dict-0001' } });
    });
  });
});
