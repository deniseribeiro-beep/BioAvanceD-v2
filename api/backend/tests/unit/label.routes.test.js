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
const qualityDomainPath = require.resolve('../../src/services/quality-domain.service');
// MongoStorageRepository destructures `getCollection` from collectionResolver
// at require-time (same gotcha documented in intakeWizard.routes.governance.test.js)
// — if it's already cached from an earlier-run test file, its binding stays
// pointed at the stale getCollection forever. Bust it too so each loadRoute()
// re-requires it fresh, picking up the currently-installed mock.
const mongoStorageRepositoryPath = require.resolve('../../src/infrastructure/persistence/mongo/MongoStorageRepository');

const allPaths = [authPath, rbacPath, collectionResolverPath, routePath, qualityDomainPath, mongoStorageRepositoryPath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

// authenticate/requirePermission/getCollection are destructured at
// require-time in label.routes.js; vi.mock() does not reliably intercept
// CJS require() graphs in this repo. Instead: clear the cache, replace the
// dependency modules' exports, then require the route file fresh (same
// workaround as sample.routes.test.js / hpo.routes.test.js).
function loadRoute({ getCollectionImpl, buildSprecCodeImpl } = {}) {
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

  if (buildSprecCodeImpl) {
    require(qualityDomainPath).buildSprecCode = buildSprecCodeImpl;
  }

  const router = require(routePath);
  return { router };
}

function router_test() {
  return loadRoute().router._test;
}

// MongoStorageRepository.getSampleStorageLocation (now sitting behind
// label.routes.js's storage-location reads, per #452) resolves the
// 'samples' collection through the mocked getCollection above, but reads
// 'storagePaths' directly off the raw db object (that collection has no
// canonical-name mapping) — so the db passed to the app needs its own
// `.collection('storagePaths')`, independent of getCollectionImpl.
function buildApp(router, db = {}, { storagePathsFindOne } = {}) {
  const app = express();
  app.use(express.json());
  if (db) {
    db.collection = vi.fn((name) => {
      if (name === 'storagePaths') {
        return { findOne: storagePathsFindOne || vi.fn().mockResolvedValue(null) };
      }
      throw new Error(`unexpected raw db.collection(${name})`);
    });
  }
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
      const getCollectionImpl = vi.fn(async () => ({ findOne: samplesFindOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {}, { storagePathsFindOne });

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

    it('falls back to "SPREC N/A" and includes the locationID segment when sprecCode is empty', async () => {
      const findOne = vi.fn().mockResolvedValue({
        ...SAMPLE_WITH_LOCATION,
        sprec_code: undefined,
        locationID: 'LOC-9',
      });
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl, buildSprecCodeImpl: () => '' });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=zpl');

      expect(res.status).toBe(200);
      expect(res.text).toContain('SPREC N/A');
      expect(res.text).toContain('Loc LOC-9');
    });

    it('uses error.status (not statusCode) for the response status when present', async () => {
      const getCollectionImpl = vi.fn(async () => {
        const error = new Error('rate limited');
        error.status = 429;
        throw error;
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(429);
    });

    it('falls back to a default error message when the thrown value has no message', async () => {
      const getCollectionImpl = vi.fn(async () => {
        throw { statusCode: 400 };
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Falha ao gerar etiqueta.');
    });

    it('falls back to "SPREC N/A" in the svg output when sprecCode is empty', async () => {
      const findOne = vi.fn().mockResolvedValue(SAMPLE_WITH_LOCATION);
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl, buildSprecCodeImpl: () => '' });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001?format=svg');

      expect(res.status).toBe(200);
      expect(res.body.toString('utf8')).toContain('SPREC N/A');
    });

    it('handles a sample with no storageLocation field at all as a 409', async () => {
      const findOne = vi.fn().mockResolvedValue({ sampleID: 'S-002', barcode: 'BC-002' });
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-002');

      expect(res.status).toBe(409);
    });

    it('falls back to _id.toString() and to the raw barcode-less _id when sampleID/barcode are absent', async () => {
      const rawId = new ObjectId();
      const findOne = vi.fn().mockResolvedValue({
        _id: rawId,
        storageLocation: { boxId: 'box-1', position: 'A1' },
      });
      const getCollectionImpl = vi.fn(async (_db, key) => {
        if (key === 'samples') return { findOne };
        if (key === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected key ${key}`);
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/whatever');

      expect(res.status).toBe(200);
      expect(res.body.data.sampleId).toBe(rawId.toString());
      expect(res.body.data.barcode).toBe(rawId.toString());
    });

    it('returns 409 when the sample has no _id (storage location can no longer be resolved via the repository)', async () => {
      // #452: storage location now resolves through GetSampleStorageLocationUseCase,
      // which requires the sample's _id — a persisted sample document always has
      // one, so this "no _id at all" shape is unreachable in production, but it's
      // worth pinning: without an _id, buildLabel now treats the sample as having
      // no persisted physical location (409) rather than trusting an inline field.
      const findOne = vi.fn().mockResolvedValue({
        barcode: 'BC-003',
        storageLocation: { boxId: 'box-1', position: 'A1' },
      });
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/whatever');

      expect(res.status).toBe(409);
    });
  });

  describe('findSample (router._test)', () => {
    it('includes an _id query variant when sampleId is a valid ObjectId', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const getCollectionImpl = vi.fn(async () => ({ findOne }));
      const { router } = loadRoute({ getCollectionImpl });

      const validId = new ObjectId().toString();
      await router._test.findSample({}, validId);

      const [{ $or: queries }] = findOne.mock.calls[0];
      expect(queries.some((q) => q._id instanceof ObjectId && q._id.toString() === validId)).toBe(true);
    });
  });

  describe('resolveStorageLocation (router._test)', () => {
    it('returns null when the sample has no _id', async () => {
      const { router } = loadRoute();

      const result = await router._test.resolveStorageLocation({}, {});

      expect(result).toBeNull();
    });

    it('returns null when the persisted sample has no box location', async () => {
      const sampleId = new ObjectId();
      const samplesFindOne = vi.fn().mockResolvedValue({ _id: sampleId, storageLocation: {} });
      const getCollectionImpl = vi.fn(async () => ({ findOne: samplesFindOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) };

      const result = await router._test.resolveStorageLocation(db, { _id: sampleId });

      expect(result).toBeNull();
    });

    it('resolves the box and path via the storage repository (GetSampleStorageLocationUseCase)', async () => {
      const sampleId = new ObjectId();
      const boxObjectId = new ObjectId();
      const samplesFindOne = vi.fn().mockResolvedValue({
        _id: sampleId,
        storageLocation: { boxId: boxObjectId.toString(), boxName: 'Box A', position: 'A1' },
      });
      const getCollectionImpl = vi.fn(async () => ({ findOne: samplesFindOne }));
      const storagePathsFindOne = vi.fn().mockResolvedValue({ path: 'Freezer 2 / Shelf 1' });
      const { router } = loadRoute({ getCollectionImpl });
      const db = { collection: vi.fn(() => ({ findOne: storagePathsFindOne })) };

      const result = await router._test.resolveStorageLocation(db, { _id: sampleId });

      expect(result.path).toBe('Freezer 2 / Shelf 1');
      expect(result.box).toEqual({ boxId: boxObjectId.toString(), boxName: 'Box A', position: 'A1' });
    });

    it('falls back to storageLocation.readable when no storagePath document matches', async () => {
      const sampleId = new ObjectId();
      const samplesFindOne = vi.fn().mockResolvedValue({
        _id: sampleId,
        storageLocation: { boxId: 'box-1', position: 'A1', readable: 'Freezer manual note' },
      });
      const getCollectionImpl = vi.fn(async () => ({ findOne: samplesFindOne }));
      const { router } = loadRoute({ getCollectionImpl });
      const db = { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) };

      const result = await router._test.resolveStorageLocation(db, { _id: sampleId });

      expect(result.path).toBe('N/A');
      expect(result.readable).toBe('Freezer manual note');
    });
  });

  describe('buildLocationText (router._test)', () => {
    it('includes the locationID segment when present', () => {
      const text = router_test().buildLocationText(
        { locationID: 'LOC-9' },
        { box: { boxId: 'b1', position: 'A1' } }
      );

      expect(text).toContain('Loc LOC-9');
    });

    it('omits the position segment when position is missing', () => {
      const text = router_test().buildLocationText(
        {},
        { box: { boxId: 'b1' } }
      );

      expect(text).not.toContain('Pos ');
    });

    it('falls back to "Localizacao pendente" when every segment is absent', () => {
      const text = router_test().buildLocationText({}, { box: {} });

      expect(text).toBe('Localizacao pendente');
    });

    it('falls back to "Localizacao pendente" when storageLocation is null', () => {
      const text = router_test().buildLocationText({}, null);

      expect(text).toBe('Localizacao pendente');
    });
  });

  describe('normalizeString (router._test)', () => {
    it('returns an empty string for falsy input', () => {
      expect(router_test().normalizeString(undefined)).toBe('');
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

    it('uses error.status (not statusCode) for the response status when present', async () => {
      const getCollectionImpl = vi.fn(async () => {
        const error = new Error('rate limited');
        error.status = 429;
        throw error;
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001/print-job');

      expect(res.status).toBe(429);
    });

    it('falls back to a default error message when the thrown value has no message', async () => {
      const getCollectionImpl = vi.fn(async () => {
        throw { statusCode: 400 };
      });
      const { router } = loadRoute({ getCollectionImpl });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/labels/samples/S-001/print-job');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Falha ao preparar job de impressão.');
    });
  });
});
