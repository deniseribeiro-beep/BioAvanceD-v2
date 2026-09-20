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

  describe('item 8 list/download/error alternates', () => {
    it('GET / applies organization specimenIds plus importJobID and audits the filtered list', async () => {
      currentScope = { scope: 'organization', organizationIds: ['org-1'] };
      const find = vi.fn((query) => ({
        toArray: vi.fn().mockResolvedValue([{ _id: 'r1', specimenId: 'S1', importJobID: 'J1' }]),
      }));
      const distinct = vi.fn().mockResolvedValue(['S1', 'S2']);
      const db = {
        collection: vi.fn((name) => {
          if (name === 'results') return { find };
          if (name === 'amostras') return { distinct };
          throw new Error('unexpected');
        }),
      };

      const res = await request(buildApp(db)).get('/api/results?importJobID=J1');

      expect(res.status).toBe(200);
      expect(find).toHaveBeenCalledWith({
        specimenId: { $in: ['S1', 'S2'] },
        importJobID: 'J1',
      });
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUERY',
        payload: expect.objectContaining({ total: 1 }),
      }));
    });

    it('GET / maps collection failures to 500', async () => {
      const db = {
        collection: vi.fn((name) => {
          if (name === 'results') {
            return { find: vi.fn(() => ({ toArray: vi.fn().mockRejectedValue(new Error('list down')) })) };
          }
          throw new Error('unexpected');
        }),
      };

      const res = await request(buildApp(db)).get('/api/results');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('list down');
    });

    it('GET /:id and /:id/download map malformed ObjectIds to their 500 catch branches', async () => {
      const { db } = buildDb();

      const getRes = await request(buildApp(db)).get('/api/results/not-an-object-id');
      expect(getRes.status).toBe(500);

      const downloadRes = await request(buildApp(db)).get('/api/results/not-an-object-id/download');
      expect(downloadRes.status).toBe(500);
    });

    it('download returns an external URL after the scope check and audits success', async () => {
      const id = new ObjectId().toString();
      const { db } = buildDb({
        result: { _id: id, specimenId: 'SPEC-1', filePath: 'https://example.test/result.csv' },
      });

      const res = await request(buildApp(db)).get('/api/results/' + id + '/download');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirect: true, url: 'https://example.test/result.csv' });
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'DOWNLOAD',
        status: 'success',
      }));
    });

    it('download returns 404 when a local path is absent', async () => {
      const id = new ObjectId().toString();
      const { db } = buildDb({
        result: { _id: id, specimenId: 'SPEC-1', filePath: '/definitely/missing/item8-result.csv' },
      });

      const res = await request(buildApp(db)).get('/api/results/' + id + '/download');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Arquivo de analise não encontrado');
    });

    it('PUT, link-sample and DELETE map malformed source ids through defensive catch branches', async () => {
      const { db } = buildDb({ result: { specimenId: 'SPEC-1' } });
      const app = buildApp(db);

      expect((await request(app).put('/api/results/bad').send({ description: 'x' })).status).toBe(400);
      expect((await request(app).put('/api/results/bad/link-sample').send({ specimenId: 'SPEC-1' })).status).toBe(400);
      expect((await request(app).delete('/api/results/bad')).status).toBe(400);
    });

    it('link-sample and DELETE skip success audit when there is no authenticated principal', async () => {
      currentUser = null;
      const id = new ObjectId().toString();
      const { db } = buildDb({
        result: { _id: id, specimenId: 'SPEC-OLD' },
        samples: [{ specimenId: 'SPEC-NEW', collectionSite: 'org-1' }],
      });
      const app = buildApp(db);

      const link = await request(app)
        .put('/api/results/' + id + '/link-sample')
        .send({ specimenId: 'SPEC-NEW' });
      expect(link.status).toBe(200);

      const del = await request(app).delete('/api/results/' + id);
      expect(del.status).toBe(200);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('fails closed for an orphan Result under organization scope', async () => {
      currentScope = { scope: 'organization', organizationIds: ['org-1'] };
      const id = new ObjectId().toString();
      const { db } = buildDb({
        result: { _id: id, specimenId: 'ORPHAN' },
        samples: [],
      });

      const res = await request(buildApp(db)).get('/api/results/' + id);

      expect(res.status).toBe(403);
    });
  });

});
