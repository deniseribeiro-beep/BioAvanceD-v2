import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const { SYSTEM_REPORT_TEMPLATES } = require('../../src/services/report-template-seed.service');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  controller: require.resolve('../../src/interface/routes/reports.routes'),
};

// #726: buildPreviewData now dispatches by looking up a ReportTemplate via
// `code` -- every test app in this file needs the real system-defined rows
// available under 'reportTemplates' for its preview/export/generate
// requests (keyed by the same `code` values report-template-seed.service.js
// seeds in production) to resolve to a handler at all.
const REPORT_TEMPLATE_DOCS = SYSTEM_REPORT_TEMPLATES.map((entry) => ({ ...entry, templateStatus: 'active' }));

function findReportTemplate(filter = {}) {
  return REPORT_TEMPLATE_DOCS.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null;
}

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

  // #637: resolveUserOrganizationScope needs userRoleAssignments/roles data
  // for req.user.userID ('user-1', this file's stubbed authenticate) to
  // resolve anything other than 'none' -- default to Administrador/'global'
  // so this file's pre-existing tests (none about org-scope) keep their
  // prior unfiltered behavior, same convention buildCollectionDb below
  // already uses.
  const rbacCollections = {
    userRoleAssignments: [{ userAccountId: 'user-1', roleId: 'role-admin', assignmentStatus: 'active', validUntil: null, scopeType: 'global', scopeId: null }],
    roles: [{ roleId: 'role-admin', hierarchyLevel: 4 }],
  };

  const db = {
    collection(name) {
      if (name === 'reports') return reportsCollection;
      if (name === 'reportTemplates') return { findOne: async (filter) => findReportTemplate(filter) };
      if (rbacCollections[name]) {
        const docs = rbacCollections[name];
        return {
          find(query = {}) {
            const matches = (doc) => Object.entries(query).every(([key, cond]) => {
              if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
              return doc[key] === cond;
            });
            return { toArray: async () => docs.filter(matches) };
          },
        };
      }
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

// #341: see the identical helper's comment in reports.routes.gaps.test.js
// — resolveUserOrganizationScope needs userRoleAssignments/roles data for
// req.user.userID ('user-1') to resolve anything other than 'none'.
// Default to an Administrador/'global' scope so this file's pre-existing
// tests (none about org-scope) keep their prior unfiltered behavior.
const DEFAULT_RBAC_COLLECTIONS = {
  userRoleAssignments: [{ userAccountId: 'user-1', roleId: 'role-admin', assignmentStatus: 'active', validUntil: null, scopeType: 'global', scopeId: null }],
  roles: [{ roleId: 'role-admin', hierarchyLevel: 4 }],
};

function buildCollectionDb(collections = {}) {
  const capturedQueries = {};
  const mergedCollections = { reportTemplates: REPORT_TEMPLATE_DOCS, ...DEFAULT_RBAC_COLLECTIONS, ...collections };

  const db = {
    collection(name) {
      const docs = mergedCollections[name] || [];
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
        async findOne(filter = {}) {
          capturedQueries[`${name}.findOne`] = filter;
          return docs.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null;
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

  // #732: this used to assert one hardcoded list that every `:type`
  // returned. The catalog is now resolved per report type through the
  // template's handlerKey, so `audit` gets the accessLogs handler's own
  // filters -- a date range, and nothing else, because handleAccessLogs
  // reads nothing else off `filters`.
  it('GET /api/reports/:type/filters devolve o catálogo do handler do tipo', async () => {
    const response = await request(app).get('/api/reports/audit/filters');

    expect(response.status).toBe(200);
    expect(response.body.handlerKey).toBe('accessLogs');
    expect(response.body.filters).toEqual([
      { name: 'startDate', label: 'Data inicial', type: 'date' },
      { name: 'endDate', label: 'Data final', type: 'date' },
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
        .post('/api/reports/samples_by_patient/preview')
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
        .post('/api/reports/samples_by_patient/preview')
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
      const response = await request(testApp).post('/api/reports/samples/preview').send({
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

    // #864: readingStatus's whole vocabulary is valid|invalid|suspicious
    // (Temperature.js) and no writer of the temperature collection ever
    // sets `severity` -- so a doc whose only "critical" signal is
    // readingStatus (verified never true in production) must NOT count
    // toward statistics.alerts. What does count: a threshold breach
    // (minThreshold/maxThreshold both non-null and temperatureValue outside
    // them) and a faulty/maintenance sensorStatus. A null-threshold doc,
    // the honest majority state today since no bulk writer persists
    // thresholds (they live on Policy), must not count either.
    it('temperatura: calcula estatísticas e conta alertas críticos via limiar de threshold e sensorStatus, não readingStatus (#864)', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        temperature: [
          { temperatureValue: 2.5, readingStatus: 'normal', sensorStatus: 'normal', minThreshold: null, maxThreshold: null },
          { temperatureValue: 10, readingStatus: 'critical', sensorStatus: 'normal', minThreshold: null, maxThreshold: null },
          { temperatureValue: 15, readingStatus: 'valid', sensorStatus: 'normal', minThreshold: 2, maxThreshold: 8 },
          { temperatureValue: 5, readingStatus: 'valid', sensorStatus: 'faulty', minThreshold: null, maxThreshold: null },
        ],
      });

      const testApp = appWithDb(db);
      const response = await request(testApp)
        .post('/api/reports/temperature/preview')
        .send({ filters: { criticalAlertsOnly: 'true', startDate: '2026-01-01', endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      // Only the threshold-breach doc and the faulty-sensor doc count; the
      // readingStatus:'critical' doc (dead leg, removed) does not.
      expect(response.body.data.statistics).toEqual({ average: (2.5 + 10 + 15 + 5) / 4, min: 2.5, max: 15, alerts: 2 });

      // The impossible readingStatus/severity regex legs are gone; the $or
      // now carries only the sensorStatus leg and the two non-null-guarded
      // threshold-breach $and legs.
      expect(capturedQueries.temperature.$and[1].$or).toEqual([
        { sensorStatus: { $regex: 'faulty|maintenance', $options: 'i' } },
        { $and: [{ minThreshold: { $ne: null } }, { $expr: { $lt: ['$temperatureValue', '$minThreshold'] } }] },
        { $and: [{ maxThreshold: { $ne: null } }, { $expr: { $gt: ['$temperatureValue', '$maxThreshold'] } }] },
      ]);
    });

    // #620: withdrawalhistory reads from sample_movements (type: 'withdraw'
    // ledger entries, sample.service.js#withdrawSample) — the 'withdrawals'
    // collection this test previously mocked is never written anywhere.
    it('historico de retirada: aplica intervalo de datas e ordena', async () => {
      const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/withdrawal_history/preview')
        .send({ filters: { startDate: '2026-01-01', endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
      expect(capturedQueries.sample_movements.createdAt.$gte).toEqual(new Date('2026-01-01'));
    });

    it('rede extracelular: filtra amostras por linkedProject/sampleOrigin com regex', async () => {
      const { db } = buildCollectionDb({
        samples: [{ sampleID: 'S1', linkedProject: 'Rede Extracelular X' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/extracellular_network/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
    });

    it('sampleanalysis: agrupa amostras com/sem resultados (issue #78)', async () => {
      const { db } = buildCollectionDb({
        samples: [
          { specimenId: 'S1', barcode: 'B1' },
          { specimenId: 'S2', barcode: 'B2' },
        ],
        results: [{ specimenId: 'S1' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

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
          { specimenId: 'S1', specimenStatus: 'depleted', currentStatus: 'Available', status: 'AVAILABLE' },
          { specimenId: 'S2', currentStatus: 'Available', status: 'AVAILABLE' },
        ],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

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

      const sensorRes = await request(testApp).post('/api/reports/sensors/preview').send({ filters: {} });
      expect(sensorRes.body.data.total).toBe(1);

      const equipRes = await request(testApp).post('/api/reports/equipment/preview').send({ filters: {} });
      expect(equipRes.body.data.total).toBe(2);

      const resultRes = await request(testApp).post('/api/reports/results/preview').send({ filters: {} });
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

      const response = await request(testApp).get('/api/reports/equipment/export');

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).toBe('id,name');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe('"1","Freezer A"');
    });
  });

  // #1050: pins the WIRING of #1045's PatientModel.stripConsentSecrets call
  // inside handlePatient and handleSamplesByPatient (reports.routes.js), not
  // the helper itself -- stripConsentSecrets already has its own unit tests,
  // so the strip logic is covered; what #1045's own response-boundary spec
  // (consent-token-response-leak.1045.test.js) does NOT cover is these two
  // handlers, which are gated on `viewReports` (a broader population than
  // the `createPatient`-gated routes #1045 examined) and whose raw documents
  // feed a CSV an operator can download and keep. A future edit that drops
  // either handler's stripConsentSecrets call must go red here.
  describe('#1050: relatórios de paciente não vazam segredos de consentimento', () => {
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

    // Distinctive from every other fixture in this suite, so "token absent"
    // can't pass by accident (nothing else in this file's collections could
    // coincidentally match it).
    const LEAKED_SECRET = 'c'.repeat(64);

    function seededPatient(overrides = {}) {
      return {
        participantId: 'P-CONSENT-1050',
        status: 'PENDING_CONSENT',
        clinicalUnitId: 'unit-1',
        consentToken: LEAKED_SECRET,
        consentTokenCreatedAt: new Date('2026-09-02T15:45:01.834Z'),
        consentTokenExpiresAt: new Date('2026-09-09T15:45:01.834Z'),
        consentNotifiedAt: new Date('2026-09-02T15:45:02.000Z'),
        ...overrides,
      };
    }

    // Same shape as consent-token-response-leak.1045.test.js's own
    // expectNoConsentSecret: serialize first, so one check covers the
    // secret showing up as a nested field (preview JSON) OR as a bare CSV
    // column name (toCsvRows derives headers from Object.keys(rows[0]) with
    // no allow-list).
    function expectNoConsentSecret(serializedBody) {
      expect(serializedBody).not.toContain(LEAKED_SECRET);
      expect(serializedBody).not.toContain('consentTokenCreatedAt');
    }

    it('patient preview (handlePatient): não devolve consentToken/consentTokenCreatedAt', async () => {
      const { db } = buildCollectionDb({ patients: [seededPatient()] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expectNoConsentSecret(JSON.stringify(response.body));
      // Not-empty guard: a handler that silently returned nothing would
      // also pass a bare "no consentToken" check.
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.patients).toHaveLength(1);
      expect(response.body.data.patients[0].participantId).toBe('P-CONSENT-1050');
      // CONTROL: the two harmless consent fields #1045 deliberately keeps
      // must survive -- proves this isn't "strip the whole consent block".
      expect(response.body.data.patients[0].consentTokenExpiresAt).toBeTruthy();
    });

    it('patient export CSV (handlePatient): consentToken não aparece nem como coluna nem como valor', async () => {
      const { db } = buildCollectionDb({ patients: [seededPatient()] });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/patients/export');

      expect(response.status).toBe(200);
      expectNoConsentSecret(response.text);
      const headers = response.text.split('\n')[0].split(',');
      expect(headers).not.toContain('consentToken');
      expect(headers).not.toContain('consentTokenCreatedAt');
      expect(headers).toContain('participantId');
      expect(response.text.split('\n')).toHaveLength(2);
    });

    it('samplesbypatient preview (handleSamplesByPatient): não devolve consentToken/consentTokenCreatedAt', async () => {
      const { db } = buildCollectionDb({ patients: [seededPatient()] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/samples_by_patient/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expectNoConsentSecret(JSON.stringify(response.body));
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.patients).toHaveLength(1);
      expect(response.body.data.patients[0].participantId).toBe('P-CONSENT-1050');
      expect(response.body.data.patients[0].consentTokenExpiresAt).toBeTruthy();
    });

    it('samplesbypatient export CSV (handleSamplesByPatient): consentToken não aparece nem como coluna nem como valor', async () => {
      const { db } = buildCollectionDb({ patients: [seededPatient()] });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/samples_by_patient/export');

      expect(response.status).toBe(200);
      expectNoConsentSecret(response.text);
      const headers = response.text.split('\n')[0].split(',');
      expect(headers).not.toContain('consentToken');
      expect(headers).not.toContain('consentTokenCreatedAt');
      expect(headers).toContain('participantId');
      expect(response.text.split('\n')).toHaveLength(2);
    });
  });
});
