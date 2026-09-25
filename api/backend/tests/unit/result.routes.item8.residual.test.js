import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

const express = require('express');
const request = require('supertest');
const ResultModel = require('../../src/models/Result');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  consent: require.resolve('../../src/infrastructure/middleware/consent.enforcement'),
  audit: require.resolve('../../src/utils/auditLogger'),
  route: require.resolve('../../src/interface/routes/result.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

describe('result.routes item 8 residual canonical branches', () => {
  let currentScope;
  let auditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    currentScope = { scope: 'global', organizationIds: [] };
    auditLogger = { init: vi.fn(), log: vi.fn().mockResolvedValue() };

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, {
      authenticate: (req, _res, next) => {
        req.user = { userID: 'user-1', name: 'Tester' };
        next();
      },
    });
    setCachedModule(modulePaths.rbac, {
      requirePermission: () => (_req, _res, next) => next(),
      requireOrganizationScope: (req, _res, next) => {
        req.organizationScope = currentScope;
        next();
      },
    });
    setCachedModule(modulePaths.consent, {
      enforceCommercialConsent: () => (_req, _res, next) => next(),
    });
    setCachedModule(modulePaths.audit, auditLogger);
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  function buildApp(db) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.app.locals.db = db;
      next();
    });
    app.use('/api/results', require(modulePaths.route));
    return app;
  }

  function buildDb({
    results = [],
    samples = [],
    scopedSpecimenIds = [],
    updateResult = { matchedCount: 1 },
    deleteResult = { deletedCount: 1 },
  } = {}) {
    const captured = {
      resultFindQuery: null,
      update: null,
      delete: null,
      sampleFindQueries: [],
      distinctQuery: null,
    };

    const resultsCollection = {
      find: vi.fn((query = {}) => {
        captured.resultFindQuery = query;
        return { toArray: vi.fn().mockResolvedValue(results) };
      }),
      findOne: vi.fn(async () => results[0] || null),
      updateOne: vi.fn(async (query, update) => {
        captured.update = { query, update };
        return updateResult;
      }),
      deleteOne: vi.fn(async (query) => {
        captured.delete = query;
        return deleteResult;
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'result-new' }),
    };

    const samplesCollection = {
      distinct: vi.fn(async (_field, query) => {
        captured.distinctQuery = query;
        return scopedSpecimenIds;
      }),
      findOne: vi.fn(async (query) => {
        captured.sampleFindQueries.push(query);
        if (query.specimenId !== undefined) {
          return samples.find((sample) => String(sample.specimenId) === String(query.specimenId)) || null;
        }
        if (query.sampleID !== undefined) {
          return samples.find((sample) => Number(sample.sampleID) === Number(query.sampleID)) || null;
        }
        if (query._id !== undefined) {
          return samples.find((sample) => String(sample._id) === String(query._id)) || null;
        }
        return null;
      }),
    };

    return {
      db: {
        collection: vi.fn((name) => {
          if (name === 'results') return resultsCollection;
          // Stage 2E: production uses specimens (legacy amostras/samples alias only in db.factory)
          if (name === 'specimens' || name === 'amostras' || name === 'samples') {
            return samplesCollection;
          }
          throw new Error(`unexpected collection: ${name}`);
        }),
      },
      captured,
      resultsCollection,
      samplesCollection,
    };
  }

  it('scopes list results by canonical Sample.collectionSite and combines importJobID', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const { db, captured, samplesCollection } = buildDb({
      results: [{ specimenId: 'SPEC-1', importJobID: 'job-1' }],
      scopedSpecimenIds: ['SPEC-1'],
    });

    const res = await request(buildApp(db)).get('/api/results?importJobID=job-1');

    expect(res.status).toBe(200);
    expect(samplesCollection.distinct).toHaveBeenCalledWith(
      'specimenId',
      { collectionSite: { $in: ['org-1'] } }
    );
    expect(captured.resultFindQuery).toEqual({
      specimenId: { $in: ['SPEC-1'] },
      importJobID: 'job-1',
    });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'QUERY',
      resourceType: 'Result',
      status: 'success',
    }));
  });

  it('keeps the global result list unfiltered when no importJobID is supplied', async () => {
    const { db, captured, samplesCollection } = buildDb({ results: [{ specimenId: 'SPEC-1' }] });

    const res = await request(buildApp(db)).get('/api/results');

    expect(res.status).toBe(200);
    expect(captured.resultFindQuery).toEqual({});
    expect(samplesCollection.distinct).not.toHaveBeenCalled();
  });

  it('returns 403 for an organization-scoped result whose specimen has no canonical Sample', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = '507f1f77bcf86cd799439011';
    const { db } = buildDb({ results: [{ _id: id, specimenId: 'SPEC-MISSING' }] });

    const res = await request(buildApp(db)).get(`/api/results/${id}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acesso negado');
  });

  it('returns an external download target only after a successful scope check', async () => {
    const id = '507f1f77bcf86cd799439012';
    const { db } = buildDb({
      results: [{ _id: id, specimenId: 'SPEC-1', filePath: 'https://example.invalid/result.csv' }],
    });

    const res = await request(buildApp(db)).get(`/api/results/${id}/download`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      redirect: true,
      url: 'https://example.invalid/result.csv',
    });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DOWNLOAD',
      status: 'success',
    }));
  });

  it('returns 404 when a scoped download has no persisted file path', async () => {
    const id = '507f1f77bcf86cd799439013';
    const { db } = buildDb({ results: [{ _id: id, specimenId: 'SPEC-1', filePath: null }] });

    const res = await request(buildApp(db)).get(`/api/results/${id}/download`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Arquivo de analise não encontrado');
  });

  it('updates only the Result allowlist and never re-parents specimenId through generic PUT', async () => {
    const id = '507f1f77bcf86cd799439014';
    const { db, captured } = buildDb({
      results: [{ _id: id, specimenId: 'SPEC-1' }],
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({
        description: 'updated',
        method: 'ELISA',
        specimenId: 'SPEC-OTHER',
        arbitraryInjectedField: 'blocked',
      });

    expect(res.status).toBe(200);
    expect(captured.update.update.$set).toMatchObject({
      description: 'updated',
      method: 'ELISA',
    });
    expect(captured.update.update.$set.specimenId).toBeUndefined();
    expect(captured.update.update.$set.arbitraryInjectedField).toBeUndefined();
    expect(captured.update.update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('returns 404 before a link-sample destination lookup when the source Result does not exist', async () => {
    const id = '507f1f77bcf86cd799439015';
    const { db, samplesCollection } = buildDb({ results: [] });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: 'SPEC-2' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Arquivo de analise não encontrado');
    expect(samplesCollection.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 when delete sees no source Result and does not execute deleteOne', async () => {
    const id = '507f1f77bcf86cd799439016';
    const { db, resultsCollection } = buildDb({ results: [] });

    const res = await request(buildApp(db)).delete(`/api/results/${id}`);

    expect(res.status).toBe(404);
    expect(resultsCollection.deleteOne).not.toHaveBeenCalled();
  });

  function getUploadHandler() {
    const router = require(modulePaths.route);
    const layer = router.stack.find((entry) => entry.route?.path === '/upload' && entry.route.methods?.post);
    if (!layer) throw new Error('POST /upload not found');
    return layer.route.stack.at(-1).handle;
  }

  function makeUploadRes() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  it('rejects an invalid upload extension and unlinks the temp file', async () => {
    const { db } = buildDb({ samples: [{ specimenId: 'SPEC-1', collectionSite: 'org-1' }] });
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const handler = getUploadHandler();
    const req = {
      app: { locals: { db } },
      body: { specimenId: 'SPEC-1' },
      file: { path: '/tmp/bad.exe', originalname: 'bad.exe', size: 10 },
      organizationScope: { scope: 'global', organizationIds: [] },
      user: { userID: 'user-1' },
    };
    const res = makeUploadRes();

    await handler(req, res);

    expect(unlink).toHaveBeenCalledWith('/tmp/bad.exe');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Tipo de arquivo inválido',
    });
  });

  it('rejects ResultModel.validate failure and unlinks the temp file', async () => {
    const { db } = buildDb({ samples: [{ specimenId: 'SPEC-1', collectionSite: 'org-1' }] });
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(ResultModel, 'validate').mockReturnValue({
      isValid: false,
      errors: ['resultFilePath é obrigatório e deve ser string'],
    });

    const handler = getUploadHandler();
    const req = {
      app: { locals: { db } },
      body: { specimenId: 'SPEC-1' },
      file: { path: '/tmp/ok.pdf', originalname: 'ok.pdf', size: 10 },
      organizationScope: { scope: 'global', organizationIds: [] },
      user: { userID: 'user-1' },
    };
    const res = makeUploadRes();

    await handler(req, res);

    expect(unlink).toHaveBeenCalledWith('/tmp/ok.pdf');
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Dados inválidos',
      message: 'resultFilePath é obrigatório e deve ser string',
    });
  });
});
