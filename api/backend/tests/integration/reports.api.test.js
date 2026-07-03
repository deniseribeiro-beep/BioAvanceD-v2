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
      if (Object.prototype.hasOwnProperty.call(filter, '_id')) {
        return reports.find((report) => String(report._id) === String(filter._id)) || null;
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
      {
        _id: '5f8d0d55b54764421b7156c3',
        reportID: 7,
        reportType: 'temperature',
        generatedAt: new Date('2026-04-02T10:00:00.000Z'),
        createdAt: new Date('2026-04-02T09:59:00.000Z'),
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
    expect(response.body).toHaveLength(2);
    expect(response.body.map((report) => report.reportID).sort()).toEqual([2, 7]);
  });

  it('POST /api/reports/generate cria relatório com próximo ID sequencial', async () => {
    const response = await request(app).post('/api/reports/generate').send({
      reportType: 'audit',
      filters: { keyword: 'acesso' },
    });

    expect(response.status).toBe(201);
    expect(response.body.reportID).toBe(8);
    expect(response.body.reportType).toBe('audit');
    expect(mockDb.reports).toHaveLength(3);
    expect(mockDb.reports[2].generatedBy).toBe('user-1');
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

  it('GET /api/reports/:id resolve por reportID numérico', async () => {
    const response = await request(app).get('/api/reports/2');

    expect(response.status).toBe(200);
    expect(response.body.reportID).toBe(2);
    expect(response.body.reportType).toBe('patients');
  });

  it('GET /api/reports/:id cai para busca por _id (ObjectId) quando não numérico', async () => {
    const response = await request(app).get('/api/reports/5f8d0d55b54764421b7156c3');

    expect(response.status).toBe(200);
    expect(response.body.reportID).toBe(7);
    expect(response.body.reportType).toBe('temperature');
  });

  it('GET /api/reports/:id retorna 404 quando não resolve por reportID nem por _id', async () => {
    const response = await request(app).get('/api/reports/000000000000000000000000');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Relatório não encontrado');
  });

  it('DELETE /api/reports/:id remove por reportID numérico', async () => {
    const response = await request(app).delete('/api/reports/2');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockDb.reports.some((report) => report.reportID === 2)).toBe(false);
  });

  it('DELETE /api/reports/:id cai para remoção por _id (ObjectId) quando não numérico', async () => {
    const response = await request(app).delete('/api/reports/5f8d0d55b54764421b7156c3');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockDb.reports.some((report) => report._id === '5f8d0d55b54764421b7156c3')).toBe(false);
  });

  it('DELETE /api/reports/:id retorna 404 quando deletedCount é 0 em ambas as tentativas', async () => {
    const response = await request(app).delete('/api/reports/999');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Relatório não encontrado');
  });

  it('POST /api/reports/:type/preview retorna envelope de sucesso com dados', async () => {
    const response = await request(app).post('/api/reports/audit/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.reportType).toBe('audit');
    expect(typeof response.body.generatedAt).toBe('string');
    expect(response.body.data).toEqual({ total: 0, logs: [], previewLimited: false });
  });

  it('GET /api/reports/:type/export retorna CSV com cabeçalho', async () => {
    const response = await request(app).get('/api/reports/audit/export');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/csv/);
    expect(response.text.split('\n')[0]).toBe('total,message');
  });

  it('GET /api/reports/:type/export/pdf retorna envelope PDF', async () => {
    const response = await request(app).get('/api/reports/audit/export/pdf');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      format: 'pdf',
      data: { total: 0, logs: [], previewLimited: false },
    });
  });

  describe('quando o banco de dados não está disponível', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.app.locals.db = null;
        next();
      });
      const reportsRouter = require(modulePaths.controller);
      app.use('/api/reports', reportsRouter);
    });

    it('GET /api/reports retorna 503 quando o db não está disponível', async () => {
      const response = await request(app).get('/api/reports');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Banco de dados não disponível');
    });
  });
});
