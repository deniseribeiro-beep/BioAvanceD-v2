import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver');
const routePath = require.resolve('../../src/interface/routes/label.routes.js');

const allPaths = [authPath, rbacPath, collectionResolverPath, routePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

// authenticate/requirePermission/getCollection are destructured at
// require-time in label.routes.js; vi.mock() does not reliably intercept
// CJS require() graphs in this repo. Instead: clear the cache, replace the
// dependency modules' exports, then require the route file fresh (same
// workaround as sample.routes.test.js / hpo.routes.test.js).
function loadRoute({ getCollectionImpl } = {}) {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();

  const collectionResolverModule = require(collectionResolverPath);
  collectionResolverModule.getCollection = getCollectionImpl || vi.fn();

  const router = require(routePath);
  return { router };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/labels', router);
  return app;
}

const SAMPLE_WITH_LOCATION = {
  _id: new ObjectId(),
  sampleID: 'S-001',
  barcode: 'BC-001',
  sprec: { sampleType: { code: 'BLD' } },
  storageLocation: { boxId: 'box-1', boxName: 'Box A', position: 'A1' },
};

describe('label routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  describe('GET /samples/:sampleId', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when the sample is not found', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/unknown');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 when the sample has no persisted physical location', async () => {
      const findOne = vi.fn().mockResolvedValue({ ...SAMPLE_WITH_LOCATION, storageLocation: {} });
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('returns json (default format) with zpl/svg embedded', async () => {
      const samplesFindOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const storagePathsFindOne = vi.fn().mockResolvedValue({ path: 'Freezer 1 / Shelf 2' });
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne: samplesFindOne };
        if (key === 'storagePaths') return { findOne: storagePathsFindOne };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sampleId).toBe('S-001');
      expect(res.body.data.barcode).toBe('BC-001');
      expect(res.body.data.qrPayload).toBe('BIOAVANCED:SAMPLE:BC-001');
      expect(res.body.data.location).toContain('Freezer 1 / Shelf 2');
      expect(res.body.data.zpl).toContain('^XA');
      expect(res.body.data.svg).toContain('<svg');
    });

    it('returns zpl format as text/plain', async () => {
      const findOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=zpl');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('^XA');
      expect(res.text).toContain('BC-001');
    });

    it('returns svg format as image/svg+xml', async () => {
      const findOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=svg');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body.toString('utf8')).toContain('<svg');
    });

    it('returns html format as text/html', async () => {
      const findOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<!doctype html>');
    });

    it('escapes xml-special characters in svg/html output', async () => {
      const dangerousSample = {
        ...SAMPLE_WITH_LOCATION,
        sampleID: 'S<001>&"\'',
      };
      const findOne = vi.fn().mockResolvedValue(dangerousSample);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=svg');
      const text = res.body.toString('utf8');

      expect(text).not.toContain('S<001>&"\'');
      expect(text).toContain('S&lt;001&gt;&amp;&quot;&apos;');
    });

    it('returns 500 on unexpected errors from findSample', async () => {
      const getCollectionImpl = vi.fn(async () => {
        throw new Error('boom');
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('boom');
    });
  });

  describe('GET /samples/:sampleId/print-job', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/labels/samples/S-001/print-job');

      expect(res.status).toBe(503);
    });

    it('returns 404 when the sample is not found', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/unknown/print-job');

      expect(res.status).toBe(404);
    });

    it('returns a zpl print job payload on success', async () => {
      const findOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001/print-job');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.format).toBe('zpl');
      expect(res.body.data.printerLanguage).toBe('ZPL');
      expect(res.body.data.zpl).toContain('^XA');
      expect(res.body.data.label.sampleId).toBe('S-001');
    });

    it('returns 409 when the sample has no persisted physical location', async () => {
      const findOne = vi.fn().mockResolvedValue({ ...SAMPLE_WITH_LOCATION, storageLocation: {} });
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001/print-job');

      expect(res.status).toBe(409);
    });
  });
});
