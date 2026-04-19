import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
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

function buildDb(seedReports = []) {
  const reports = [...seedReports];

  const reportsCollection = {
    find() {
      return {
        sort() {
          const ordered = [...reports].sort((left, right) => Number(right.reportID || 0) - Number(left.reportID || 0));
          return {
            toArray: async () => ordered,
            limit() {
              return {
                toArray: async () => ordered.slice(0, 1),
              };
            },
          };
        },
      };
    },
    async findOne(filter) {
      if (Object.prototype.hasOwnProperty.call(filter, 'reportID')) {
        return reports.find((report) => Number(report.reportID) === Number(filter.reportID)) || null;
      }
      return null;
    },
    async insertOne(doc) {
      reports.push({ ...doc, _id: '507f1f77bcf86cd799439099' });
      return { insertedId: '507f1f77bcf86cd799439099' };
    },
    async deleteOne(filter) {
      const index = reports.findIndex((report) => {
        if (filter.reportID !== undefined) {
          return Number(report.reportID) === Number(filter.reportID);
        }
        if (filter._id) {
          return String(report._id) === String(filter._id);
        }
        return false;
      });

      if (index === -1) {
        return { deletedCount: 0 };
      }

      reports.splice(index, 1);
      return { deletedCount: 1 };
    },
  };

  const db = {
    collection(name) {
      if (name === 'reports') return reportsCollection;
      return {
        find() {
          return {
            sort() {
              return {
                limit() {
                  return { toArray: async () => [] };
                },
              };
            },
          };
        },
        distinct: async () => [],
        countDocuments: async () => 0,
      };
    },
  };

  return { db, reports, reportsCollection };
}

describe('Reports API integration', () => {
  let app;
  let mockDb;
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

    mockDb = buildDb([
      {
        _id: '507f1f77bcf86cd799439001',
        reportID: 2,
        reportType: 'patients',
        generatedAt: new Date('2026-04-01T10:00:00.000Z'),
        createdAt: new Date('2026-04-01T09:59:00.000Z'),
      },
    ]);

    setCachedModule(modulePaths.auth, { authenticate });
    setCachedModule(modulePaths.rbac, { requirePermission });
    delete require.cache[modulePaths.controller];

    const reportsRouter = require(modulePaths.controller);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.app.locals.db = mockDb.db;
      next();
    });
    app.use('/api/reports', reportsRouter);
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  it('GET /api/reports lista relatórios normalizados', async () => {
    const response = await request(app).get('/api/reports');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].reportID).toBe(2);
  });

  it('POST /api/reports/generate cria relatório com próximo ID sequencial', async () => {
    const response = await request(app).post('/api/reports/generate').send({
      reportType: 'audit',
      filters: { keyword: 'acesso' },
    });

    expect(response.status).toBe(201);
    expect(response.body.reportID).toBe(3);
    expect(response.body.reportType).toBe('audit');
    expect(mockDb.reports).toHaveLength(2);
    expect(mockDb.reports[1].generatedBy).toBe('user-1');
  });

  it('GET /api/reports/:type/filters retorna opções padrão', async () => {
    const response = await request(app).get('/api/reports/audit/filters');

    expect(response.status).toBe(200);
    expect(response.body.filters).toEqual([
      { name: 'startDate', label: 'Data Inicial', type: 'date' },
      { name: 'endDate', label: 'Data Final', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] },
      { name: 'keyword', label: 'Palavra-chave', type: 'text' },
    ]);
  });
});
