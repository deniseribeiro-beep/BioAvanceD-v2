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

function buildCollectionDb(collections = {}) {
  const capturedQueries = {};

  const db = {
    collection(name) {
      const docs = collections[name] || [];
      return {
        find(query = {}) {
          capturedQueries[name] = query;
          const chain = {
            toArray: async () => docs,
            sort() {
              return chain;
            },
            limit() {
              return chain;
            },
          };
          return chain;
        },
        async countDocuments(query = {}) {
          capturedQueries[`${name}.count`] = query;
          return docs.length;
        },
        async distinct(field, query = {}) {
          capturedQueries[`${name}.distinct`] = query;
          return [...new Set(docs.map((doc) => doc[field]).filter((value) => value !== undefined))];
        },
      };
    },
  };

  return { db, capturedQueries };
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

  describe('buildPreviewData por tipo de relatório', () => {
    function appWithDb(db) {
      const testApp = express();
      testApp.use(express.json());
      testApp.use((req, _res, next) => {
        req.app.locals.db = db;
        next();
      });
      const reportsRouter = require(modulePaths.controller);
      testApp.use('/api/reports', reportsRouter);
      return testApp;
    }

    it('samplesbypatient: agrupa amostras por paciente e aplica filtro de keyword/orphaCode', async () => {
      const { db } = buildCollectionDb({
        patients: [
          { participantId: 'P1', patientName: 'Ana' },
          { participantId: 'P2', patientName: 'Bruno' },
        ],
        samples: [
          { participantId: 'P1', sampleID: 'S1', clinical_data: { orphaCode: '558' } },
          { participantId: 'P1', sampleID: 'S2', clinical_data: { orphaCode: '558' } },
          { participantId: 'P2', sampleID: 'S3', clinical_data: { orphaCode: '558' } },
        ],
      });

      const testApp = appWithDb(db);
      const response = await request(testApp)
        .post('/api/reports/samplesbypatient/preview')
        .send({ filters: { orphaCode: 'ORPHA:558' } });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(2);
      const p1 = response.body.data.patients.find((p) => p.participantId === 'P1');
      expect(p1.sampleCount).toBe(2);
      expect(p1.samples).toHaveLength(2);
    });

    it('samplesbypatient: usa fallback vazio para paciente sem participantId e sem amostras correspondentes', async () => {
      const { db } = buildCollectionDb({
        patients: [
          { patientName: 'Sem ID' },
          { participantId: 'P9', patientName: 'Sem Amostras' },
        ],
        samples: [
          { participantId: 'P1', sampleID: 'S1' },
        ],
      });

      const testApp = appWithDb(db);
      const response = await request(testApp)
        .post('/api/reports/samplesbypatient/preview')
        .send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(2);
      const semId = response.body.data.patients.find((p) => p.patientName === 'Sem ID');
      expect(semId.sampleCount).toBe(0);
      expect(semId.samples).toEqual([]);
      const semAmostras = response.body.data.patients.find((p) => p.participantId === 'P9');
      expect(semAmostras.sampleCount).toBe(0);
      expect(semAmostras.samples).toEqual([]);
    });

    it('amostra: aplica buildSampleQuery com múltiplos filtros combinados via $and', async () => {
      // #525: sprecMatrixType now resolves through the canonical
      // SpecimenPreanalytics entity instead of querying `sprec.matrixType`
      // directly off Sample — seed a matching profile so the resolved
      // `specimenId: { $in: [...] }` condition is non-empty.
      const { db, capturedQueries } = buildCollectionDb({
        samples: [{ patientID: 'P1', sampleID: 'S1', specimenId: 'SPEC-1' }],
        specimenPreanalytics: [{ specimenId: 'SPEC-1', matrixType: 'plasma', recordedAt: new Date('2026-01-01') }],
      });

      const testApp = appWithDb(db);
      const response = await request(testApp).post('/api/reports/amostra/preview').send({
        filters: {
          atcCode: 'ATC:N02',
          treatmentStatus: 'em tratamento',
          sprecMatrixType: 'Plasma',
          status: 'ativa',
        },
      });

      expect(response.status).toBe(200);
      const query = capturedQueries.samples;
      expect(query.$and).toEqual(
        expect.arrayContaining([
          {
            $or: [
              { 'pharmacologyData.atcCode': expect.any(RegExp) },
              { 'pharmacologyData.medicationName': expect.any(RegExp) },
              { 'pharmacologyData.atcClass': expect.any(RegExp) },
            ],
          },
          { 'pharmacologyData.treatmentStatus': 'ON_TREATMENT' },
          { specimenId: { $in: ['SPEC-1'] } },
          { specimenStatus: 'available' },
        ])
      );
    });

    it('temperatura: calcula estatísticas e filtra apenas alertas críticos quando solicitado', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        temperature: [
          { temperatureValue: '2.5', readingStatus: 'normal' },
          { temperatureValue: '10', readingStatus: 'critical' },
        ],
      });

      const testApp = appWithDb(db);
      const response = await request(testApp)
        .post('/api/reports/temperatura/preview')
        .send({ filters: { criticalAlertsOnly: 'true', startDate: '2026-01-01', endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      expect(response.body.data.statistics).toEqual({ average: 6.25, min: 2.5, max: 10, alerts: 1 });
      expect(capturedQueries.temperature.$and[0].$or).toBeDefined();
    });

    it('historico de retirada: aplica intervalo de datas e ordena', async () => {
      const { db, capturedQueries } = buildCollectionDb({ withdrawals: [{ withdrawalDate: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/withdrawal%20history/preview')
        .send({ filters: { startDate: '2026-01-01', endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
      expect(capturedQueries.withdrawals.$or[0].withdrawalDate.$gte).toEqual(new Date('2026-01-01'));
    });

    it('rede extracelular: filtra amostras por linkedProject/sampleOrigin com regex', async () => {
      const { db } = buildCollectionDb({
        samples: [{ sampleID: 'S1', linkedProject: 'Rede Extracelular X' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/extracellularnetwork/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
    });

    it('sampleanalysis: agrupa amostras com/sem resultados (issue #78)', async () => {
      const { db } = buildCollectionDb({
        samples: [
          { sampleID: 'S1', barcode: 'B1' },
          { sampleID: 'S2', barcode: 'B2' },
        ],
        results: [{ sampleID: 'S1' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.withResults).toBe(1);
      expect(response.body.data.withoutResults).toBe(1);
      expect(response.body.data.analysis).toHaveLength(2);
      expect(response.body.data.analysis.find((item) => item.sampleID === 'S1').hasResults).toBe(true);
      expect(response.body.data.analysis.find((item) => item.sampleID === 'S2').hasResults).toBe(false);
    });

    // #539: this used to read the legacy currentStatus/status fields
    // (`sample.currentStatus || sample.status || null`), which
    // canonical-data-contract-v1.md's "Legacy Fields Prohibited" list bans —
    // derives from the canonical specimenStatus (dict-02 ELM-0123) instead.
    it('sampleanalysis: deriva status de specimenStatus, ignorando currentStatus/status legados', async () => {
      const { db } = buildCollectionDb({
        samples: [
          { sampleID: 'S1', specimenStatus: 'depleted', currentStatus: 'Available', status: 'AVAILABLE' },
          { sampleID: 'S2', currentStatus: 'Available', status: 'AVAILABLE' },
        ],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.analysis.find((item) => item.sampleID === 'S1').status).toBe('depleted');
      // No specimenStatus recorded: falls back to the schema default
      // ('available'), not the stale legacy fields.
      expect(response.body.data.analysis.find((item) => item.sampleID === 'S2').status).toBe('available');
    });

    it('sensor/equipamento/resultado: retornam coleções genéricas com total', async () => {
      const { db } = buildCollectionDb({
        sensors: [{ id: 1 }],
        equipment: [{ id: 1 }, { id: 2 }],
        results: [{ id: 1 }],
      });
      const testApp = appWithDb(db);

      const sensorRes = await request(testApp).post('/api/reports/sensor/preview').send({ filters: {} });
      expect(sensorRes.body.data.total).toBe(1);

      const equipRes = await request(testApp).post('/api/reports/equipamento/preview').send({ filters: {} });
      expect(equipRes.body.data.total).toBe(2);

      const resultRes = await request(testApp).post('/api/reports/resultado/preview').send({ filters: {} });
      expect(resultRes.body.data.total).toBe(1);
    });

    it('tipo desconhecido retorna mensagem padrão sem dados', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/tipo-inexistente/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        total: 0,
        message: 'Tipo de relatório disponível, mas sem pré-visualização específica para este formato.',
        type: 'tipo-inexistente',
      });
    });

    it('export CSV: gera linhas reais quando há dados em uma das coleções conhecidas', async () => {
      const { db } = buildCollectionDb({
        equipment: [
          { id: '1', name: 'Freezer A' },
          { id: '2', name: 'Freezer B' },
        ],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/equipamento/export');

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).toBe('id,name');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe('"1","Freezer A"');
    });
  });
});
