import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const cidControllerPath = require.resolve('../../src/controllers/cid.controller');
const routePath = require.resolve('../../src/interface/routes/cid.routes.js');

const allPaths = [authPath, rbacPath, cidControllerPath, routePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function loadRoute({ searchHandler } = {}) {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { id: 'user-1', roleLevel: 4 };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requireRole = () => (req, res, next) => next();

  const cidControllerModule = require(cidControllerPath);
  cidControllerModule.search = searchHandler || ((req, res) => res.status(200).json({ success: true, data: [] }));

  const router = require(routePath);
  return { router };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/cids', router);
  return app;
}

describe('cid.routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  describe('GET /', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/cids');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });

    it('returns normalized CID documents sorted by the collection query', async () => {
      const toArray = vi.fn().mockResolvedValue([
        {
          _id: '1',
          chapter: 'Cap 1',
          code: 'A00',
          description: 'Cholera',
          cid10: 'A00.0',
          orphaCode: 'ORPHA1',
          omim_code: 'OMIM1',
          is_active: 'nao'
        }
      ]);
      const sort = vi.fn().mockReturnValue({ toArray });
      const find = vi.fn().mockReturnValue({ sort });
      const db = { collection: vi.fn().mockReturnValue({ find }) };

      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/cids');

      expect(res.status).toBe(200);
      expect(find).toHaveBeenCalledWith({});
      expect(sort).toHaveBeenCalledWith({ Codigo_Tabulacao: 1, Codigos_CID10: 1, Descricao: 1 });
      expect(res.body.data).toEqual([
        {
          _id: '1',
          Capitulo: 'Cap 1',
          Codigo_Tabulacao: 'A00',
          Descricao: 'Cholera',
          Codigos_CID10: 'A00.0',
          ORPHA: 'ORPHA1',
          OMIM: 'OMIM1',
          active: false,
          createdAt: undefined,
          updatedAt: undefined
        }
      ]);
    });

    it('falls back to Codigo_Tabulacao for Codigos_CID10 when neither cid10 field is present', async () => {
      const toArray = vi.fn().mockResolvedValue([
        { _id: '2', Codigo_Tabulacao: 'B01', Descricao: 'Varicela' }
      ]);
      const sort = vi.fn().mockReturnValue({ toArray });
      const find = vi.fn().mockReturnValue({ sort });
      const db = { collection: vi.fn().mockReturnValue({ find }) };

      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/cids');

      expect(res.status).toBe(200);
      expect(res.body.data[0].Codigos_CID10).toBe('B01');
      expect(res.body.data[0].active).toBe(true);
    });

    it('returns 500 when the query throws', async () => {
      const toArray = vi.fn().mockRejectedValue(new Error('db down'));
      const sort = vi.fn().mockReturnValue({ toArray });
      const find = vi.fn().mockReturnValue({ sort });
      const db = { collection: vi.fn().mockReturnValue({ find }) };

      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/cids');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /search', () => {
    it('delegates to cidController.search', async () => {
      const searchHandler = vi.fn((req, res) => res.status(200).json({ success: true, data: ['result'] }));
      const { router } = loadRoute({ searchHandler });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/cids/search').query({ q: 'cholera' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(['result']);
      expect(searchHandler).toHaveBeenCalled();
    });
  });

  describe('read-only write routes', () => {
    it('POST / returns 405 method not allowed', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/cids').send({});

      expect(res.status).toBe(405);
      expect(res.body).toEqual(
        expect.objectContaining({ success: false, error: 'Método não permitido' })
      );
    });

    it('PUT /:id returns 405 method not allowed', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).put('/api/cids/1').send({});

      expect(res.status).toBe(405);
    });

    it('PATCH /:id returns 405 method not allowed', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).patch('/api/cids/1').send({});

      expect(res.status).toBe(405);
    });
  });
});
