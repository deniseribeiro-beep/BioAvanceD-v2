import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const hpoServicePath = require.resolve('../../src/services/hpoService');
const hpoRoutePath = require.resolve('../../src/routes/hpo');
const loggerPath = require.resolve('../../src/utils/logger');

// hpo.js takes `authenticate` when it is required (#1553): every case loads it
// signed in, but the 401 ones, which restore the real gate first.
const authModule = require('../../src/infrastructure/middleware/auth');
const realAuthenticate = authModule.authenticate;
const signedIn = (req, res, next) => {
  req.user = { id: 'user-1' };
  next();
};
authModule.authenticate = signedIn;

// hpo.js destructures `searchHpoLocal`, `searchHpoExternal`,
// `isExternalHpoLookupEnabled` from ../services/hpoService at require-time.
// vi.spyOn() on the hpoService module's exports AFTER hpo.js has already
// been required (and cached) has no effect on those already-captured local
// bindings. Workaround (confirmed in this repo, see saveTelemetryPoint.test.js):
// clear the require cache for both hpoService and hpo.js, replace the
// hpoService module's exports with mocks, then require hpo.js fresh so its
// destructuring picks up the mocked functions.
function loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled, db }) {
  delete require.cache[hpoServicePath];
  delete require.cache[hpoRoutePath];
  delete require.cache[loggerPath];

  const hpoServiceModule = require(hpoServicePath);
  if (searchHpoLocal) hpoServiceModule.searchHpoLocal = searchHpoLocal;
  if (searchHpoExternal) hpoServiceModule.searchHpoExternal = searchHpoExternal;
  if (isExternalHpoLookupEnabled) hpoServiceModule.isExternalHpoLookupEnabled = isExternalHpoLookupEnabled;

  const loggerModule = require(loggerPath);
  vi.spyOn(loggerModule, 'info').mockImplementation(() => {});
  vi.spyOn(loggerModule, 'warn').mockImplementation(() => {});
  vi.spyOn(loggerModule, 'error').mockImplementation(() => {});

  const router = require(hpoRoutePath);
  const app = express();
  app.locals.db = db || {};
  app.use('/api/hpo', router);
  return app;
}

describe('hpo routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[hpoServicePath];
    delete require.cache[hpoRoutePath];
    delete require.cache[loggerPath];
  });

  describe('GET /search', () => {
    it('returns 400 when q is missing', async () => {
      const searchHpoLocal = vi.fn();
      const app = loadRouteWithMocks({ searchHpoLocal });
      const res = await request(app).get('/api/hpo/search');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing query' });
      expect(searchHpoLocal).not.toHaveBeenCalled();
    });

    it('returns 400 when q is blank/whitespace', async () => {
      const searchHpoLocal = vi.fn();
      const app = loadRouteWithMocks({ searchHpoLocal });
      const res = await request(app).get('/api/hpo/search').query({ q: '   ' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing query' });
      expect(searchHpoLocal).not.toHaveBeenCalled();
    });

    it('returns 400 when q is repeated (#1415)', async () => {
      const searchHpoLocal = vi.fn();
      const app = loadRouteWithMocks({ searchHpoLocal });
      const res = await request(app).get('/api/hpo/search?q=a&q=b').timeout(2000);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid query' });
      expect(searchHpoLocal).not.toHaveBeenCalled();
    });

    it('returns local results with 200 and does not call external when local search succeeds', async () => {
      const localResults = [{ hpoId: 'HP:0000001', label: 'Local term' }];
      const searchHpoLocal = vi.fn().mockResolvedValue(localResults);
      const searchHpoExternal = vi.fn();
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const db = { collection: vi.fn() };
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled, db });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(localResults);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoLocal).toHaveBeenCalledWith('term', db);
      expect(searchHpoExternal).not.toHaveBeenCalled();
    });

    it('falls back to external results when local search returns empty array and external lookup is enabled', async () => {
      const externalResults = [{ hpoId: 'HP:0000002', label: 'External term' }];
      const searchHpoLocal = vi.fn().mockResolvedValue([]);
      const searchHpoExternal = vi.fn().mockResolvedValue(externalResults);
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(externalResults);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).toHaveBeenCalledWith('term');
    });

    it('returns the empty local results as-is when local search returns empty array and external lookup is disabled', async () => {
      const searchHpoLocal = vi.fn().mockResolvedValue([]);
      const searchHpoExternal = vi.fn();
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(false);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).not.toHaveBeenCalled();
    });

    it('returns [] with 200 when local search throws and external lookup is disabled', async () => {
      const searchHpoLocal = vi.fn().mockRejectedValue(new Error('local db down'));
      const searchHpoExternal = vi.fn();
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(false);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).not.toHaveBeenCalled();
    });

    it('falls back to external and returns its results when local search throws and external lookup is enabled and succeeds', async () => {
      const externalResults = [{ hpoId: 'HP:0000003', label: 'Recovered term' }];
      const searchHpoLocal = vi.fn().mockRejectedValue(new Error('local db down'));
      const searchHpoExternal = vi.fn().mockResolvedValue(externalResults);
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(externalResults);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).toHaveBeenCalledTimes(1);
    });

    it('logs the info-level result count even on the throw-then-external-succeeds fallback path (#57)', async () => {
      const externalResults = [{ hpoId: 'HP:0000003', label: 'Recovered term' }];
      const searchHpoLocal = vi.fn().mockRejectedValue(new Error('local db down'));
      const searchHpoExternal = vi.fn().mockResolvedValue(externalResults);
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      await request(app).get('/api/hpo/search').query({ q: 'term' });

      const loggerModule = require(loggerPath);
      expect(loggerModule.info).toHaveBeenCalledWith(
        expect.stringContaining(`retornou ${externalResults.length} resultados`)
      );
    });

    it('returns 500 with the Portuguese error message when both local search and the external retry throw', async () => {
      const searchHpoLocal = vi.fn().mockRejectedValue(new Error('local db down'));
      const searchHpoExternal = vi.fn().mockRejectedValue(new Error('external api down'));
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Erro ao buscar termos HPO' });
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoExternal).toHaveBeenCalledTimes(1);
    });
  });

  describe('authentication (#1553)', () => {
    it.each(['/api/hpo/search?q=term', '/api/hpo/HP:0001250'])('answers 401 to GET %s with no token', async (url) => {
      authModule.authenticate = realAuthenticate;
      try {
        const searchHpoLocal = vi.fn();
        const app = loadRouteWithMocks({ searchHpoLocal });
        // No database: authenticate's audit write of the refusal is skipped,
        // and a request that reached a handler would call searchHpoLocal or
        // answer 500.
        app.locals.db = undefined;
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
        expect(searchHpoLocal).not.toHaveBeenCalled();
      } finally {
        authModule.authenticate = signedIn;
      }
    });
  });

  describe('GET /:id', () => {
    // #57: GET /:id now reuses the shared req.app.locals.db handle instead of opening
    // its own raw MongoClient connection per request.
    it('returns the term with 200 when found, using the shared db handle (no per-request MongoClient)', async () => {
      const term = { hpoId: 'HP:0000118', label: 'Phenotypic abnormality' };
      const findOne = vi.fn().mockResolvedValue(term);
      const collection = vi.fn().mockReturnValue({ findOne });
      const db = { collection };

      delete require.cache[hpoRoutePath];
      const router = require(hpoRoutePath);
      const app = express();
      app.locals.db = db;
      app.use('/api/hpo', router);

      const res = await request(app).get('/api/hpo/HP:0000118');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(term);
      expect(collection).toHaveBeenCalledWith('hpo_terms');
      expect(findOne).toHaveBeenCalledWith({ hpoId: 'HP:0000118' });
    });

    it('returns 404 with Not found when the term does not exist', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const collection = vi.fn().mockReturnValue({ findOne });
      const db = { collection };

      delete require.cache[hpoRoutePath];
      const router = require(hpoRoutePath);
      const app = express();
      app.locals.db = db;
      app.use('/api/hpo', router);

      const res = await request(app).get('/api/hpo/HP:9999999');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
      expect(findOne).toHaveBeenCalledWith({ hpoId: 'HP:9999999' });
    });

    // #834 (found by #829's sweep): this handler had no try/catch, so a
    // rejected findOne -- Mongo unreachable, a driver timeout, a topology
    // change -- was an unhandled promise rejection, which Node answers by
    // *exiting the process*. A brief database blip took the whole API down
    // instead of failing one endpoint. The sibling GET /search handler above
    // has had a try/catch all along.
    it('returns 500 when the lookup throws, instead of rejecting unhandled', async () => {
      const findOne = vi.fn().mockRejectedValue(new Error('connection timed out'));
      const collection = vi.fn().mockReturnValue({ findOne });
      const db = { collection };

      delete require.cache[hpoRoutePath];
      const router = require(hpoRoutePath);
      const app = express();
      app.locals.db = db;
      app.use('/api/hpo', router);

      const res = await request(app).get('/api/hpo/HP:0000118');

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/HPO/i);
    });
  });
});
