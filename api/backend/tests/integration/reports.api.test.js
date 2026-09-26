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
    roles: [{ roleId: 'role-admin', roleCode: 'administrator', roleStatus: 'active', hierarchyLevel: 4 }],
    // ^ #1056: roleCode/roleStatus added. This fixture only ever carried
    // hierarchyLevel, which satisfies resolveUserOrganizationScope's
    // level-4 'global' bypass but NOT isAdministrator, which reads
    // roleCode. So the default caller here was an Administrador to the
    // org resolver and a nobody to every roleCode-based check -- which is
    // how these tests could assert an audit-trail export succeeding.
    // The real seeded Administrador row carries both.
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
  roles: [{ roleId: 'role-admin', roleCode: 'administrator', roleStatus: 'active', hierarchyLevel: 4 }],
    // ^ #1056: roleCode/roleStatus added. This fixture only ever carried
    // hierarchyLevel, which satisfies resolveUserOrganizationScope's
    // level-4 'global' bypass but NOT isAdministrator, which reads
    // roleCode. So the default caller here was an Administrador to the
    // org resolver and a nobody to every roleCode-based check -- which is
    // how these tests could assert an audit-trail export succeeding.
    // The real seeded Administrador row carries both.
};

// Stage 2E: getCanonicalCollection asks for specimens/participants; fixtures
// here still seed samples/patients. Alias both ways for lookup and capture.
const STAGE2E_COLLECTION_ALIASES = {
  samples: 'specimens',
  specimens: 'samples',
  patients: 'participants',
  participants: 'patients',
  sample_movements: 'sampleMovements',
  sampleMovements: 'sample_movements',
};

function resolveSeedDocs(mergedCollections, name) {
  if (Object.prototype.hasOwnProperty.call(mergedCollections, name)) {
    return mergedCollections[name];
  }
  const alias = STAGE2E_COLLECTION_ALIASES[name];
  if (alias && Object.prototype.hasOwnProperty.call(mergedCollections, alias)) {
    return mergedCollections[alias];
  }
  return [];
}

function buildCollectionDb(collections = {}) {
  const capturedQueries = {};
  const mergedCollections = { reportTemplates: REPORT_TEMPLATE_DOCS, ...DEFAULT_RBAC_COLLECTIONS, ...collections };

  const db = {
    collection(name) {
      const docs = resolveSeedDocs(mergedCollections, name);
      return {
        find(query = {}) {
          capturedQueries[name] = query;
          const alias = STAGE2E_COLLECTION_ALIASES[name];
          if (alias) capturedQueries[alias] = query;
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
          const alias = STAGE2E_COLLECTION_ALIASES[name];
          if (alias) capturedQueries[`${alias}.count`] = query;
          return docs.length;
        },
        async distinct(field, query = {}) {
          capturedQueries[`${name}.distinct`] = query;
          const alias = STAGE2E_COLLECTION_ALIASES[name];
          if (alias) capturedQueries[`${alias}.distinct`] = query;
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

  // #732/#1218: catalog resolved per handlerKey — `audit` → auditEvents
  // (date range only, same as accessLogs).
  it('GET /api/reports/:type/filters devolve o catálogo do handler do tipo', async () => {
    const response = await request(app).get('/api/reports/audit/filters');

    expect(response.status).toBe(200);
    expect(response.body.handlerKey).toBe('auditEvents');
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
    expect(response.body.data).toEqual({ total: 0, events: [], previewLimited: false });
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
      data: { total: 0, events: [], previewLimited: false },
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
          { participantId: 'P1', specimenId: 'S1', clinical_data: { orphaCode: '558' } },
          { participantId: 'P1', specimenId: 'S2', clinical_data: { orphaCode: '558' } },
          { participantId: 'P2', specimenId: 'S3', clinical_data: { orphaCode: '558' } },
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
          { participantId: 'P1', specimenId: 'S1' },
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
        samples: [{ participantId: 'P1', specimenId: 'S1', specimenId: 'SPEC-1' }],
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
      const { db, capturedQueries } = buildCollectionDb({ sampleMovements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
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
        samples: [{ specimenId: 'S1', linkedProject: 'Rede Extracelular X' }],
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
      expect(response.body.data.analysis.find((item) => item.specimenId === 'S1').hasResults).toBe(true);
      expect(response.body.data.analysis.find((item) => item.specimenId === 'S2').hasResults).toBe(false);
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
      expect(response.body.data.analysis.find((item) => item.specimenId === 'S1').status).toBe('depleted');
      // No specimenStatus recorded: falls back to the schema default
      // ('available'), not the stale legacy fields.
      expect(response.body.data.analysis.find((item) => item.specimenId === 'S2').status).toBe('available');
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

    // #1061: this asserted `lines[0] === 'id,name'` -- the header derived
    // from Object.keys(rows[0]) -- against a two-field fixture carrying
    // neither of Equipment's canonical identifiers. It was a genuine pin
    // of the defect, so it is un-weakened rather than deleted: the header
    // is now the declared EXPORT_CATALOG.equipment column list, and the
    // fixture uses real Equipment fields so the row means something.
    it('export CSV: gera linhas reais com as colunas declaradas para o handlerKey', async () => {
      const { db } = buildCollectionDb({
        equipment: [
          { equipmentID: 'EQ-1', equipmentDescription: 'Freezer -80', name: 'Freezer A', status: 'active' },
          { equipmentID: 'EQ-2', equipmentDescription: 'Freezer -20', name: 'Freezer B', status: 'maintenance' },
        ],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/equipment/export');

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).toBe('equipmentID,equipmentDescription,name,model,serialNumber,type,status,purchaseDate,createdAt');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe('"EQ-1","Freezer -80","Freezer A","","","","active","",""');
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

  // #1056: the `logs` collection is the RNF009 audit trail, and TWO routers
  // read it. logs.routes.js gates every read behind requireAuditReader
  // (administrator or the `auditor` roleCode). reports.routes.js reached the
  // same collection through handleAccessLogs behind nothing but
  // `viewReports` -- which is UsuarioExterno's ENTIRE permission set
  // (rbac-catalog-seed.service.js), so the lowest role in the system could
  // export the raw audit trail while the router purpose-built for that data
  // admits only admins and auditors.
  //
  // The gate lives in buildPreviewData keyed by `handlerKey`, not by the
  // `:type` path parameter, for the same reason SCOPED_HANDLER_KEYS does:
  // BOTH the `audit` and `access_logs` template codes map to the single
  // `accessLogs` handler, so a code-keyed table would have to list both and
  // could drift. Keying on handlerKey makes that impossible by construction,
  // and covers /preview, /export, /export/pdf and /generate in one place.
  describe('#1056: relatórios de trilha de auditoria exigem Admin ou Auditor', () => {
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

    // Every caller here already holds `viewReports` -- this file's
    // requirePermission stub passes unconditionally. The variable under test
    // is the RBAC roleCode alone, which is the whole point: `viewReports` is
    // exactly what UsuarioExterno has and it must no longer be sufficient.
    // The assignment is organization-scoped for everyone (hierarchyLevel 4
    // still resolves to 'global' on its own) so that no case here can 403 on
    // requireOrganizationScope's org-less path instead of on the audit gate.
    // Getting this wrong is what made the first draft's non-audit CONTROL red
    // before the fix, which would have hidden a setup failure as a real one.
    function rbacFor(roleCode, hierarchyLevel = null) {
      return {
        userRoleAssignments: [{ userAccountId: 'user-1', roleId: `role-${roleCode}`, assignmentStatus: 'active', validUntil: null, scopeType: 'organization', scopeId: 'org-1' }],
        roles: [{ roleId: `role-${roleCode}`, roleCode, roleStatus: 'active', hierarchyLevel }],
      };
    }

    // buildCollectionDb's generic collection has no insertOne, so
    // POST /generate would 500 on persistence rather than reaching its
    // assertion -- a red for the wrong reason. This makes the pre-fix run
    // return a real 201, so that case discriminates the gate and nothing else.
    function withReportInsert(db) {
      const inner = db.collection.bind(db);
      return {
        collection(name) {
          if (name === 'reports') {
            return { ...inner(name), insertOne: async () => ({ insertedId: 'r-1' }) };
          }
          return inner(name);
        },
      };
    }

    const AUDIT_ROWS = [{ logId: 'L-1', userName: 'alice', action: 'LOGIN', ipSource: '10.0.0.9', auditHash: 'deadbeef' }];

    it('CONTROL: um administrador continua exportando access_logs', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('administrator', 4), logs: AUDIT_ROWS });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/access_logs/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('alice');
    });

    it('CONTROL: um auditor continua exportando access_logs', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('auditor'), logs: AUDIT_ROWS });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/access_logs/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('alice');
    });

    it('CONTROL: um usuário externo continua exportando um relatório NÃO-auditoria', async () => {
      const { db } = buildCollectionDb({
        ...rbacFor('external_user', 1),
        equipment: [{ id: '1', name: 'Freezer A' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/equipment/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Freezer A');
    });

    it('usuário externo recebe 403 em GET /access_logs/export e nenhuma linha da trilha', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('external_user', 1), logs: AUDIT_ROWS });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/access_logs/export');

      expect(response.status).toBe(403);
      expect(response.text).not.toContain('alice');
      expect(response.text).not.toContain('deadbeef');
    });

    // #1218: `audit` uses auditEvents; `access_logs` stays on accessLogs.
    // Gating by handlerKey still covers both.
    it('usuário externo recebe 403 no código `audit`, não apenas em `access_logs`', async () => {
      const { db } = buildCollectionDb({
        ...rbacFor('external_user', 1),
        audit_events: [{ eventId: 'E-1', actorPseudonym: 'alice', action: 'LOGIN' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/audit/export');

      expect(response.status).toBe(403);
      expect(response.text).not.toContain('alice');
    });

    it('técnico recebe 403 no preview da trilha de auditoria', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('technician', 2), logs: AUDIT_ROWS });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/access_logs/preview').send({ filters: {} });

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('alice');
    });

    // The PDF route returns previewData verbatim as JSON with no CSV layer,
    // so it is the leakiest of the three and must be gated too.
    it('coordenador recebe 403 no export/pdf da trilha de auditoria', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('coordinator', 3), logs: AUDIT_ROWS });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/audit/export/pdf');

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('alice');
    });

    it('CONTROL: POST /generate de um relatório NÃO-auditoria continua sendo persistido', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('external_user', 1), equipment: [{ id: '1', name: 'Freezer A' }] });
      const testApp = appWithDb(withReportInsert(db));

      const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'equipment' });

      expect(response.status).toBe(201);
    });

    it('POST /generate não persiste a trilha de auditoria para um usuário externo', async () => {
      const { db } = buildCollectionDb({ ...rbacFor('external_user', 1), logs: AUDIT_ROWS });
      const testApp = appWithDb(withReportInsert(db));

      const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'audit' });

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('alice');
    });
  });

  // #1058 / #1061 / #1050 piece 2. One change, three issues, and they cannot
  // be separated: #1058 alone (adding the missing row keys) would make three
  // currently-empty exports start emitting RAW Mongo documents, including
  // sample_movements' ipAddress/userAgent/hash. So the column allow-list has
  // to land in the same commit that makes those exports produce anything.
  //
  // RNF007 AC#4 (Crítica) is the mandate: "Logs, relatórios e exportações
  // omitem ou pseudonimizam identificadores diretos por padrão" -- deny by
  // default. RF008 AC#6 ("sem depender de uma lista fixa") is why the catalog
  // keys on handlerKey (12 handler functions) rather than on the template
  // code (14 rows, two colliding onto one handler): a new ReportTemplate
  // pointing at an existing handler inherits its columns with no code change.
  // The guard that makes EXPORT_CATALOG's deny-by-default safe. A
  // handlerKey with no catalog entry exports nothing, which is the right
  // posture for a leak but is exactly #1058's own symptom -- a silently
  // empty export -- if someone adds a handler and forgets the entry. This
  // walks every SYSTEM_REPORT_TEMPLATES code, seeds one document in the
  // collection its handler reads, and asserts the export is not the
  // no-data fallback. It fails for a missing entry, a wrong rowKey, and a
  // renamed handler return key -- the three ways #1058 happened.
  describe('#1058: every seeded report type exports rows when its collection has data', () => {
    const SEEDS = {
      samples_by_patient: { patients: [{ participantId: 'P-1', status: 'active' }] },
      patients: { patients: [{ participantId: 'P-1', status: 'active' }] },
      samples: { samples: [{ specimenId: 'S-1', sampleType: 'blood' }] },
      sample_analysis: { samples: [{ specimenId: 'S-1', barcode: 'B-1' }], results: [{ specimenId: 'S-1', resultID: 'R-1' }] },
      temperature: { temperature: [{ logId: 'T-1', sensorId: 'SEN-1', temperatureValue: -80 }] },
      temperature_control: { temperature: [{ logId: 'T-1', sensorId: 'SEN-1', temperatureValue: -80 }] },
      sensors: { sensors: [{ sensorId: 'SEN-1', sensorType: 'temperature' }] },
      equipment: { equipment: [{ equipmentID: 'EQ-1', name: 'Freezer A' }] },
      results: { results: [{ resultID: 'R-1', specimenId: 'S-1' }] },
      audit: {
        audit_events: [{
          eventId: 'E-1',
          sequenceNumber: 1,
          occurredAt: '2026-01-01T00:00:00.000Z',
          recordedAt: '2026-01-01T00:00:01.000Z',
          actorPseudonym: 'USR-abc',
          action: 'LOGIN',
          entityType: 'User',
          result: 'success',
          source: 'api',
        }],
      },
      access_logs: { logs: [{ logId: 'L-1', action: 'LOGIN', timestamp: '2026-01-01' }] },
      withdrawal_history: { sampleMovements: [{ movementId: 'M-1', specimenId: 'S-1', type: 'withdrawal' }] },
      tissue_origin_history: { samples: [{ specimenId: 'S-1', sampleType: 'tissue' }] },
      extracellular_network: { samples: [{ specimenId: 'S-1', sampleType: 'plasma' }] },
    };

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

    it('covers every code SYSTEM_REPORT_TEMPLATES seeds', () => {
      const seeded = SYSTEM_REPORT_TEMPLATES.map((entry) => entry.code).sort();
      expect(Object.keys(SEEDS).sort()).toEqual(seeded);
    });

    it.each(Object.entries(SEEDS))('%s exports rows rather than the no-data fallback', async (code, collections) => {
      const { db } = buildCollectionDb(collections);
      const response = await request(appWithDb(db)).get(`/api/reports/${code}/export`);

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).not.toBe('total,message');
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe('#1058/#1061/#1050: CSV export is declared per handlerKey', () => {
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

    it('#1058: sample_analysis exports real rows instead of "Sem dados"', async () => {
      const { db } = buildCollectionDb({
        samples: [{ specimenId: 'S-1', barcode: 'B-1', sampleType: 'blood', participantId: 'P-1' }],
        results: [{ specimenId: 'S-1', resultID: 'R-1' }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/sample_analysis/export');

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).not.toBe('total,message');
      expect(lines).toHaveLength(2);
      expect(response.text).toContain('S-1');
    });

    it('#1058: temperature exports real rows instead of "Sem dados"', async () => {
      const { db } = buildCollectionDb({
        temperature: [{ logId: 'T-1', sensorId: 'SEN-1', temperatureValue: -80, temperatureUnit: 'C' }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/temperature/export');

      expect(response.status).toBe(200);
      expect(response.text.split('\n')[0]).not.toBe('total,message');
      expect(response.text).toContain('SEN-1');
    });

    it('#1058: withdrawal_history exports real rows instead of "Sem dados"', async () => {
      const { db } = buildCollectionDb({
        sampleMovements: [{ movementId: 'M-1', specimenId: 'S-1', type: 'withdrawal', quantity: 2 }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/withdrawal_history/export');

      expect(response.status).toBe(200);
      expect(response.text.split('\n')[0]).not.toBe('total,message');
      expect(response.text).toContain('M-1');
    });

    // The sequencing hazard, pinned. sample_movements is the custody ledger:
    // operator identity, operator network identifiers and the ledger's own
    // integrity hashes all live on the same document as the movement.
    it('#1050: the withdrawal export omits operator identity, network identifiers and ledger hashes', async () => {
      const { db } = buildCollectionDb({
        sampleMovements: [{
          movementId: 'M-1',
          specimenId: 'S-1',
          type: 'withdrawal',
          quantity: 2,
          userId: 'user-9',
          userName: 'Alice Operator',
          userRole: 'Tecnico',
          responsible: 'Alice Operator',
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0 leaky-agent',
          hash: 'deadbeefcafe',
          previousHash: 'feedfacebeef',
        }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/withdrawal_history/export');

      expect(response.status).toBe(200);
      // CONTROL: the row is genuinely present -- otherwise the negatives below
      // pass vacuously against the empty-data fallback, which is exactly the
      // state this issue is fixing.
      expect(response.text).toContain('M-1');

      for (const leaked of ['Alice Operator', '203.0.113.7', 'leaky-agent', 'deadbeefcafe', 'feedfacebeef', 'user-9']) {
        expect(response.text).not.toContain(leaked);
      }
      const header = response.text.split('\n')[0];
      for (const column of ['ipAddress', 'userAgent', 'hash', 'previousHash', 'userName', 'userId', 'responsible']) {
        expect(header).not.toContain(column);
      }
    });

    it('#1061: a column absent from the FIRST row is still exported for later rows', async () => {
      const { db } = buildCollectionDb({
        samples: [
          { specimenId: 'S-1' },
          { specimenId: 'S-2', sampleType: 'plasma', barcode: 'B-2' },
        ],
      });
      const response = await request(appWithDb(db)).get('/api/reports/samples/export');

      expect(response.status).toBe(200);
      const [header, , secondRow] = response.text.split('\n');
      expect(header).toContain('sampleType');
      expect(secondRow).toContain('plasma');
      expect(secondRow).toContain('B-2');
    });

    // CONTROLS: unchanged by this fix, green before and after. A red here is
    // the fixture, not the bug (#695).
    it('CONTROL: an empty collection still yields the no-data fallback', async () => {
      const { db } = buildCollectionDb({ equipment: [] });
      const response = await request(appWithDb(db)).get('/api/reports/equipment/export');

      expect(response.status).toBe(200);
      expect(response.text.split('\n')[0]).toBe('total,message');
    });

    it('CONTROL: the patients export still omits consentToken', async () => {
      const { db } = buildCollectionDb({
        patients: [{ participantId: 'P-1', consentToken: 'TOKEN-SHOULD-NOT-LEAK', status: 'active' }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/patients/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('P-1');
      expect(response.text).not.toContain('TOKEN-SHOULD-NOT-LEAK');
      // Exact column match, not a substring: consentTokenExpiresAt is
      // deliberately KEPT (#1045 keeps it for the directory badge and the
      // resend UI), and it CONTAINS the string 'consentToken'.
      const patientHeader = response.text.split('\n')[0].split(',');
      expect(patientHeader).not.toContain('consentToken');
      expect(patientHeader).not.toContain('consentTokenCreatedAt');
    });

    // #1218: audit export reads audit_events; non-USR-* actor → USR-SYSTEM;
    // hashes / entityId / civil names omitted.
    it('#1218: audit CSV uses audit_events allow-list and USR-SYSTEM for non-pseudonym actors', async () => {
      const { db } = buildCollectionDb({
        audit_events: [
          {
            eventId: 'E-civil',
            sequenceNumber: 1,
            occurredAt: '2026-01-01T00:00:00.000Z',
            recordedAt: '2026-01-01T00:00:01.000Z',
            actorPseudonym: 'Maria Silva',
            action: 'LOGIN',
            entityType: 'User',
            entityId: 'secret-entity',
            result: 'success',
            source: 'api',
            eventHash: 'deadbeef',
            previousEventHash: 'cafe',
          },
          {
            eventId: 'E-usr',
            sequenceNumber: 2,
            occurredAt: '2026-01-02T00:00:00.000Z',
            recordedAt: '2026-01-02T00:00:01.000Z',
            actorPseudonym: 'USR-abc123',
            action: 'UPDATE',
            entityType: 'Sample',
            result: 'success',
            source: 'api',
          },
        ],
      });
      const response = await request(appWithDb(db)).get('/api/reports/audit/export');

      expect(response.status).toBe(200);
      const [header, ...rows] = response.text.split('\n').filter(Boolean);
      expect(header.split(',')).toEqual([
        'eventId', 'sequenceNumber', 'occurredAt', 'recordedAt', 'actorPseudonym',
        'action', 'entityType', 'result', 'source',
      ]);
      expect(response.text).toContain('USR-SYSTEM');
      expect(response.text).toContain('USR-abc123');
      expect(response.text).not.toContain('Maria Silva');
      expect(response.text).not.toContain('deadbeef');
      expect(response.text).not.toContain('secret-entity');
      expect(rows.length).toBe(2);
    });

    // NOT a control -- this one only holds after the catalog lands, and
    // it is the assertion that stops 'strip the whole consent block'
    // masquerading as a fix. #1045 kept consentTokenExpiresAt on purpose.
    it('#1050: the declared patient columns KEEP consentTokenExpiresAt', async () => {
      const { db } = buildCollectionDb({
        patients: [{ participantId: 'P-1', consentTokenExpiresAt: '2026-12-31', status: 'active' }],
      });
      const response = await request(appWithDb(db)).get('/api/reports/patients/export');

      expect(response.status).toBe(200);
      expect(response.text.split('\n')[0].split(',')).toContain('consentTokenExpiresAt');
      expect(response.text).toContain('2026-12-31');
    });
  });
});
