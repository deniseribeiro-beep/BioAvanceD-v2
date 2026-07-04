import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import { MongoClient } from 'mongodb';

const require = createRequire(import.meta.url);

const hpoServicePath = require.resolve('../../src/services/hpoService');
const hpoRoutePath = require.resolve('../../src/routes/hpo');
const loggerPath = require.resolve('../../src/utils/logger');

// hpo.js destructures `searchHpoLocal`, `searchHpoExternal`,
// `isExternalHpoLookupEnabled` from ../services/hpoService at require-time.
// vi.spyOn() on the hpoService module's exports AFTER hpo.js has already
// been required (and cached) has no effect on those already-captured local
// bindings. Workaround (confirmed in this repo, see saveTelemetryPoint.test.js):
// clear the require cache for both hpoService and hpo.js, replace the
// hpoService module's exports with mocks, then require hpo.js fresh so its
// destructuring picks up the mocked functions.
function loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled }) {
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

    it('returns local results with 200 and does not call external when local search succeeds', async () => {
      const localResults = [{ hpoId: 'HP:0000001', label: 'Local term' }];
      const searchHpoLocal = vi.fn().mockResolvedValue(localResults);
      const searchHpoExternal = vi.fn();
      const isExternalHpoLookupEnabled = vi.fn().mockReturnValue(true);
      const app = loadRouteWithMocks({ searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled });

      const res = await request(app).get('/api/hpo/search').query({ q: 'term' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(localResults);
      expect(searchHpoLocal).toHaveBeenCalledTimes(1);
      expect(searchHpoLocal).toHaveBeenCalledWith('term');
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

  describe('GET /:id', () => {
    it('returns the term with 200 when found', async () => {
      const term = { hpoId: 'HP:0000118', label: 'Phenotypic abnormality' };
      const findOne = vi.fn().mockResolvedValue(term);
      const collection = vi.fn().mockReturnValue({ findOne });
      const db = vi.fn().mockReturnValue({ collection });

      vi.spyOn(MongoClient.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(MongoClient.prototype, 'db').mockImplementation(db);
      vi.spyOn(MongoClient.prototype, 'close').mockResolvedValue(undefined);

      // no hpoService mocking needed for this route, load it fresh normally
      delete require.cache[hpoRoutePath];
      const router = require(hpoRoutePath);
      const app = express();
      app.use('/api/hpo', router);

      const res = await request(app).get('/api/hpo/HP:0000118');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(term);
      expect(MongoClient.prototype.connect).toHaveBeenCalledTimes(1);
      expect(db).toHaveBeenCalledTimes(1);
      expect(collection).toHaveBeenCalledWith('hpo_terms');
      expect(findOne).toHaveBeenCalledWith({ hpoId: 'HP:0000118' });
      expect(MongoClient.prototype.close).toHaveBeenCalledTimes(1);
    });

    it('returns 404 with Not found when the term does not exist', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const collection = vi.fn().mockReturnValue({ findOne });
      const db = vi.fn().mockReturnValue({ collection });

      vi.spyOn(MongoClient.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(MongoClient.prototype, 'db').mockImplementation(db);
      vi.spyOn(MongoClient.prototype, 'close').mockResolvedValue(undefined);

      delete require.cache[hpoRoutePath];
      const router = require(hpoRoutePath);
      const app = express();
      app.use('/api/hpo', router);

      const res = await request(app).get('/api/hpo/HP:9999999');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
      expect(findOne).toHaveBeenCalledWith({ hpoId: 'HP:9999999' });
      expect(MongoClient.prototype.close).toHaveBeenCalledTimes(1);
    });
  });
});
