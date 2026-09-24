import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  assignments: require.resolve('../../src/services/rbac-assignment.service'),
  controller: require.resolve('../../src/interface/routes/reports.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function cursor(rows = []) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return rows;
    },
  };
}

describe('reports.routes.js item 8 residual branches', () => {
  const authenticate = (req, _res, next) => {
    req.user = { userID: 'user-1' };
    next();
  };
  const requirePermission = () => (_req, _res, next) => next();

  beforeEach(() => {
    vi.clearAllMocks();

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, { authenticate });
    setCachedModule(modulePaths.rbac, { requirePermission });
    setCachedModule(modulePaths.assignments, {
      resolveUserOrganizationScope: vi.fn(async () => ({ scope: 'global', organizationIds: [] })),
      isOrganizationScopeUsable: vi.fn(() => true),
      applyOrganizationScopeFilter: vi.fn((query) => query),
      isRecordInOrganizationScope: vi.fn(() => true),
      isAuditReader: vi.fn(async () => true),
    });
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  function appWithDb(db) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.app.locals.db = db;
      next();
    });
    app.use('/api/reports', require(modulePaths.controller));
    return app;
  }

  it('GET /:type/filters returns 404 for an empty normalized template code', async () => {
    let collectionCalls = 0;
    const db = {
      collection() {
        collectionCalls += 1;
        throw new Error('collection must not be touched when code is empty');
      },
    };

    const response = await request(appWithDb(db)).get('/api/reports/%20/filters');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'Tipo de relatório desconhecido',
      reportType: '',
    });
    expect(collectionCalls).toBe(0);
  });

  it('GET /:type/filters returns an empty catalog for a valid custom handler without declared filters', async () => {
    const db = {
      collection(name) {
        expect(name).toBe('reportTemplates');
        return {
          async findOne(query) {
            expect(query).toEqual({ code: 'custom_type', templateStatus: 'active' });
            return { code: 'custom_type', handlerKey: 'customHandler', templateStatus: 'active' };
          },
        };
      },
    };

    const response = await request(appWithDb(db)).get('/api/reports/custom_type/filters');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      filters: [],
      reportType: 'custom_type',
      handlerKey: 'customHandler',
    });
  });

  it('GET /:type/filters preserves the route 500 envelope when template lookup fails', async () => {
    const db = {
      collection(name) {
        expect(name).toBe('reportTemplates');
        return {
          async findOne() {
            throw new Error('filter lookup failed');
          },
        };
      },
    };

    const response = await request(appWithDb(db)).get('/api/reports/equipment/filters');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Erro ao obter filtros',
      message: 'filter lookup failed',
    });
  });

  it('GET /:type/export/pdf preserves the generic 500 envelope when the report handler fails', async () => {
    const db = {
      collection(name) {
        if (name === 'reportTemplates') {
          return {
            async findOne(query) {
              expect(query).toEqual({ code: 'equipment', templateStatus: 'active' });
              return { code: 'equipment', handlerKey: 'equipment', templateStatus: 'active' };
            },
          };
        }

        if (name === 'equipment') {
          return {
            find() {
              throw new Error('pdf equipment query failed');
            },
          };
        }

        throw new Error(`unexpected collection: ${name}`);
      },
    };

    const response = await request(appWithDb(db)).get('/api/reports/equipment/export/pdf');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Erro ao exportar relatório PDF',
      message: 'pdf equipment query failed',
    });
  });

  it('DELETE /:id removes a numeric report by reportID', async () => {
    const deleteQueries = [];
    const db = {
      collection(name) {
        expect(name).toBe('reports');
        return {
          async deleteOne(query) {
            deleteQueries.push(query);
            return { deletedCount: 1 };
          },
        };
      },
    };

    const response = await request(appWithDb(db)).delete('/api/reports/17');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(deleteQueries).toEqual([{ reportID: 17 }]);
  });

  it('DELETE /:id falls back to Mongo ObjectId when the id is not numeric', async () => {
    const id = '507f1f77bcf86cd799439011';
    const deleteQueries = [];
    const db = {
      collection(name) {
        expect(name).toBe('reports');
        return {
          async deleteOne(query) {
            deleteQueries.push(query);
            return { deletedCount: 1 };
          },
        };
      },
    };

    const response = await request(appWithDb(db)).delete(`/api/reports/${id}`);

    expect(response.status).toBe(200);
    expect(deleteQueries).toHaveLength(1);
    expect(String(deleteQueries[0]._id)).toBe(id);
  });

  it('DELETE /:id returns 404 without touching Mongo for an invalid id', async () => {
    let deleteCalls = 0;
    const db = {
      collection(name) {
        expect(name).toBe('reports');
        return {
          async deleteOne() {
            deleteCalls += 1;
            return { deletedCount: 1 };
          },
        };
      },
    };

    const response = await request(appWithDb(db)).delete('/api/reports/not-an-id');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Relatório não encontrado');
    expect(deleteCalls).toBe(0);
  });

  it('sample preview accepts documented compatibility aliases without changing canonical query fields', async () => {
    let sampleQuery;
    const db = {
      collection(name) {
        if (name === 'reportTemplates') {
          return {
            async findOne(query) {
              expect(query).toEqual({ code: 'samples', templateStatus: 'active' });
              return { code: 'samples', handlerKey: 'sample', templateStatus: 'active' };
            },
          };
        }

        if (name === 'specimens') {
          return {
            find(query) {
              sampleQuery = query;
              return cursor([]);
            },
            async countDocuments(query) {
              expect(query).toBe(sampleQuery);
              return 0;
            },
          };
        }

        throw new Error(`unexpected collection: ${name}`);
      },
    };

    const response = await request(appWithDb(db))
      .post('/api/reports/samples/preview')
      .send({
        filters: {
          disease: 'ORPHA:123',
          drug: 'ATC:A01',
          treatmentStatus: 'naive',
          specimenType: 'plasma',
          origin: 'venous_blood',
          graphStatus: 'disponivel',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
    expect(sampleQuery).toHaveProperty('$and');

    const conditions = sampleQuery.$and;
    expect(conditions).toEqual(expect.arrayContaining([
      { 'pharmacologyData.treatmentStatus': 'NAIVE' },
      { specimenStatus: 'available' },
      { sampleType: 'PLASMA' },
      { sampleOrigin: 'VENOUS_BLOOD' },
    ]));

    const orphaCondition = conditions.find((condition) => Array.isArray(condition.$or)
      && condition.$or.some((entry) => entry['clinicalData.orphaCode'] === '123'));
    expect(orphaCondition).toBeTruthy();

    const drugCondition = conditions.find((condition) => Array.isArray(condition.$or)
      && condition.$or.some((entry) => entry['pharmacologyData.atcCode'] instanceof RegExp));
    expect(drugCondition).toBeTruthy();
    expect(String(drugCondition.$or[0]['pharmacologyData.atcCode'])).toContain('A01');
  });
});
