import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  assignments: require.resolve('../../src/services/rbac-assignment.service'),
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

describe('result.routes item 8 more residual canonical branches', () => {
  let currentScope;
  let currentUser;
  let auditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    currentScope = { scope: 'global', organizationIds: [] };
    currentUser = { userID: 'user-1', name: 'Tester' };
    auditLogger = { init: vi.fn(), log: vi.fn().mockResolvedValue() };

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, {
      authenticate: (req, _res, next) => {
        req.user = currentUser;
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
    setCachedModule(modulePaths.assignments, {
      applyOrganizationScopeFilter: vi.fn((query, scope, field) => (
        scope?.scope === 'global'
          ? query
          : { ...query, [field]: { $in: scope?.organizationIds || [] } }
      )),
      isRecordInOrganizationScope: vi.fn((record, scope, field) => (
        !scope
        || scope.scope === 'global'
        || (record && (scope.organizationIds || []).includes(String(record[field])))
      )),
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
    result = null,
    samples = [],
    updateResult = { matchedCount: 1 },
    deleteResult = { deletedCount: 1 },
  } = {}) {
    const captured = {
      updates: [],
      deletes: [],
      sampleFindQueries: [],
    };

    const resultsCollection = {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(result ? [result] : []) })),
      findOne: vi.fn().mockImplementation(async () => result),
      updateOne: vi.fn().mockImplementation(async (query, update) => {
        captured.updates.push({ query, update });
        return updateResult;
      }),
      deleteOne: vi.fn().mockImplementation(async (query) => {
        captured.deletes.push(query);
        return deleteResult;
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    const samplesCollection = {
      distinct: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockImplementation(async (query) => {
        captured.sampleFindQueries.push(query);
        if (query._id !== undefined) {
          return samples.find((sample) => String(sample._id) === String(query._id)) || null;
        }
        if (query.specimenId !== undefined) {
          return samples.find((sample) => String(sample.specimenId) === String(query.specimenId)) || null;
        }
        if (query.sampleID !== undefined) {
          return samples.find((sample) => Number(sample.sampleID) === Number(query.sampleID)) || null;
        }
        return null;
      }),
    };

    return {
      db: {
        collection: vi.fn((name) => {
          if (name === 'results') return resultsCollection;
          if (name === 'amostras') return samplesCollection;
          throw new Error(`unexpected collection: ${name}`);
        }),
      },
      captured,
      resultsCollection,
      samplesCollection,
    };
  }

  it('GET /:id audits and returns 404 when the Result does not exist', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb();

    const res = await request(buildApp(db)).get(`/api/results/${id}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Arquivo de analise não encontrado');
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'QUERY',
      resourceType: 'Result',
      status: 'error',
    }));
  });

  it('GET /:id returns an organization-scoped Result when its Sample is in scope', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const result = { _id: id, specimenId: 'SPEC-1', description: 'ok' };
    const { db } = buildDb({
      result,
      samples: [{ specimenId: 'SPEC-1', collectionSite: 'org-1' }],
    });

    const res = await request(buildApp(db)).get(`/api/results/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ specimenId: 'SPEC-1', description: 'ok' });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'QUERY',
      resourceId: id,
      status: 'success',
    }));
  });

  it('GET /:id denies an organization-scoped Result when its Sample belongs to another organization', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db } = buildDb({
      result: { _id: id, specimenId: 'SPEC-2' },
      samples: [{ specimenId: 'SPEC-2', collectionSite: 'org-2' }],
    });

    const res = await request(buildApp(db)).get(`/api/results/${id}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: 'Acesso negado' });
  });

  it('download audits and returns 404 when the Result does not exist', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb();

    const res = await request(buildApp(db)).get(`/api/results/${id}/download`);

    expect(res.status).toBe(404);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DOWNLOAD',
      status: 'error',
    }));
  });

  it('download refuses an out-of-scope Result before exposing its external URL', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db } = buildDb({
      result: { _id: id, specimenId: 'SPEC-2', filePath: 'https://example.invalid/private.csv' },
      samples: [{ specimenId: 'SPEC-2', collectionSite: 'org-2' }],
    });

    const res = await request(buildApp(db)).get(`/api/results/${id}/download`);

    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
    expect(auditLogger.log).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('PUT /:id returns 404 before updateOne when the source Result does not exist', async () => {
    const id = new ObjectId().toString();
    const { db, resultsCollection } = buildDb();

    const res = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({ description: 'new' });

    expect(res.status).toBe(404);
    expect(resultsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('PUT /:id refuses an out-of-scope source before updateOne', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db, resultsCollection } = buildDb({
      result: { _id: id, specimenId: 'SPEC-2' },
      samples: [{ specimenId: 'SPEC-2', collectionSite: 'org-2' }],
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({ description: 'new' });

    expect(res.status).toBe(403);
    expect(resultsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('PUT /:id returns 404 when the guarded update no longer matches a document', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb({
      result: { _id: id, specimenId: 'SPEC-1' },
      updateResult: { matchedCount: 0 },
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({ description: 'new' });

    expect(res.status).toBe(404);
  });

  it('PUT /:id audits a successful update for an authenticated caller', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb({ result: { _id: id, specimenId: 'SPEC-1' } });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({ description: 'new' });

    expect(res.status).toBe(200);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceId: id,
      status: 'success',
    }));
  });

  it('link-sample rejects a request without specimenId before reading the source Result', async () => {
    const id = new ObjectId().toString();
    const { db, resultsCollection } = buildDb({ result: { _id: id, specimenId: 'SPEC-1' } });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('specimenId é obrigatório');
    expect(resultsCollection.findOne).not.toHaveBeenCalled();
  });

  it('link-sample refuses an out-of-scope source before looking up the destination', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db, samplesCollection } = buildDb({
      result: { _id: id, specimenId: 'SPEC-OLD' },
      samples: [{ specimenId: 'SPEC-OLD', collectionSite: 'org-2' }],
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: 'SPEC-NEW' });

    expect(res.status).toBe(403);
    expect(samplesCollection.findOne).toHaveBeenCalledTimes(1);
    expect(samplesCollection.findOne).toHaveBeenCalledWith({ specimenId: 'SPEC-OLD' });
  });

  it('link-sample returns 404 when the destination Sample cannot be resolved', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb({ result: { _id: id, specimenId: 'SPEC-OLD' } });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: 'SPEC-MISSING' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Amostra não encontrada');
  });

  it('link-sample refuses a destination Sample outside the caller organization', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db, resultsCollection } = buildDb({
      result: { _id: id, specimenId: 'SPEC-OLD' },
      samples: [
        { specimenId: 'SPEC-OLD', collectionSite: 'org-1' },
        { specimenId: 'SPEC-NEW', collectionSite: 'org-2' },
      ],
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: 'SPEC-NEW' });

    expect(res.status).toBe(403);
    expect(resultsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('link-sample returns 404 when the destination update loses its match', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb({
      result: { _id: id, specimenId: 'SPEC-OLD' },
      samples: [{ specimenId: 'SPEC-NEW', collectionSite: 'org-1' }],
      updateResult: { matchedCount: 0 },
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: 'SPEC-NEW' });

    expect(res.status).toBe(404);
  });

  it('link-sample updates to the canonical destination specimenId and audits success', async () => {
    const id = new ObjectId().toString();
    const { db, captured } = buildDb({
      result: { _id: id, specimenId: 'SPEC-OLD' },
      samples: [{ specimenId: 'SPEC-CANONICAL', sampleID: 77, collectionSite: 'org-1' }],
    });

    const res = await request(buildApp(db))
      .put(`/api/results/${id}/link-sample`)
      .send({ specimenId: '77' });

    expect(res.status).toBe(200);
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0].update.$set.specimenId).toBe('SPEC-CANONICAL');
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceId: id,
      payload: { specimenId: 'SPEC-CANONICAL' },
    }));
  });

  it('DELETE /:id refuses an out-of-scope source before deleteOne', async () => {
    currentScope = { scope: 'organization', organizationIds: ['org-1'] };
    const id = new ObjectId().toString();
    const { db, resultsCollection } = buildDb({
      result: { _id: id, specimenId: 'SPEC-2' },
      samples: [{ specimenId: 'SPEC-2', collectionSite: 'org-2' }],
    });

    const res = await request(buildApp(db)).delete(`/api/results/${id}`);

    expect(res.status).toBe(403);
    expect(resultsCollection.deleteOne).not.toHaveBeenCalled();
  });

  it('DELETE /:id returns 404 when deleteOne reports no deleted document', async () => {
    const id = new ObjectId().toString();
    const { db } = buildDb({
      result: { _id: id, specimenId: 'SPEC-1' },
      deleteResult: { deletedCount: 0 },
    });

    const res = await request(buildApp(db)).delete(`/api/results/${id}`);

    expect(res.status).toBe(404);
  });

  it('DELETE /:id audits a successful deletion', async () => {
    const id = new ObjectId().toString();
    const { db, captured } = buildDb({ result: { _id: id, specimenId: 'SPEC-1' } });

    const res = await request(buildApp(db)).delete(`/api/results/${id}`);

    expect(res.status).toBe(200);
    expect(captured.deletes).toHaveLength(1);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      resourceId: id,
      status: 'success',
    }));
  });

  it('successful mutation routes still work without an authenticated audit principal', async () => {
    currentUser = null;
    const id = new ObjectId().toString();
    const { db } = buildDb({ result: { _id: id, specimenId: 'SPEC-1' } });

    const putRes = await request(buildApp(db))
      .put(`/api/results/${id}`)
      .send({ description: 'no-audit' });

    expect(putRes.status).toBe(200);
    expect(auditLogger.log).not.toHaveBeenCalled();
  });
});
