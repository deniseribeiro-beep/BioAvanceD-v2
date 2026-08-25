import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const { SYSTEM_REPORT_TEMPLATES } = require('../../src/services/report-template-seed.service');

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  rbac: require.resolve('../../src/infrastructure/middleware/rbac'),
  controller: require.resolve('../../src/interface/routes/reports.routes'),
};

// #726: see the identical constant in reports.api.test.js — buildPreviewData
// now dispatches by looking up a ReportTemplate via `code`, so every test
// app in this file needs the real system-defined rows available under
// 'reportTemplates'.
const REPORT_TEMPLATE_DOCS = SYSTEM_REPORT_TEMPLATES.map((entry) => ({ ...entry, templateStatus: 'active' }));

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

// #341: resolveUserOrganizationScope (rbac-assignment.service.js, real
// module — not stubbed like auth/rbac above) needs userRoleAssignments/
// roles data for req.user.userID ('user-1', set by this file's own
// `authenticate` stub) to resolve anything other than 'none'. Default to
// an Administrador/'global'-scope assignment so every pre-existing test in
// this file (none of which are about org-scope) keeps its prior
// unfiltered/unblocked behavior — a test caller passes its own
// `userRoleAssignments`/`roles` entries to exercise organization-scoped or
// org-less behavior specifically.
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
        async insertOne(doc) {
          const inserted = { ...doc, _id: `generated-${docs.length + 1}` };
          docs.push(inserted);
          return { insertedId: inserted._id };
        },
        // #637: GET /api/reports/:id (and any other single-record lookup)
        // needs findOne -- simple equality match, same semantics as find's
        // own query shape above (this file's mocks don't need $in here).
        async findOne(query = {}) {
          capturedQueries[`${name}.findOne`] = query;
          return docs.find((doc) => Object.entries(query).every(([key, value]) => doc[key] === value)) || null;
        },
      };
    },
  };

  return { db, capturedQueries };
}

function buildThrowingDb() {
  return {
    collection() {
      throw new Error('boom collection');
    },
  };
}

describe('reports.routes.js gaps', () => {
  let app;
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
    delete require.cache[modulePaths.controller];
  });

  afterEach(() => {
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

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

  function appWithThrowingCollection() {
    const db = {
      collection() {
        return {
          find() {
            throw new Error('find blew up');
          },
          async countDocuments() {
            throw new Error('count blew up');
          },
          async findOne() {
            throw new Error('findOne blew up');
          },
          async insertOne() {
            throw new Error('insertOne blew up');
          },
          async deleteOne() {
            throw new Error('deleteOne blew up');
          },
        };
      },
    };
    return appWithDb(db);
  }

  describe('db indisponível (503) em cada rota', () => {
    it('GET /api/reports/:id retorna 503', async () => {
      const response = await request(appWithDb(null)).get('/api/reports/2');
      expect(response.status).toBe(503);
    });

    it('DELETE /api/reports/:id retorna 503', async () => {
      const response = await request(appWithDb(null)).delete('/api/reports/2');
      expect(response.status).toBe(503);
    });

    it('POST /api/reports/generate retorna 503', async () => {
      const response = await request(appWithDb(null)).post('/api/reports/generate').send({ reportType: 'audit' });
      expect(response.status).toBe(503);
    });

    it('POST /api/reports/:type/preview retorna 503 com envelope success:false', async () => {
      const response = await request(appWithDb(null)).post('/api/reports/audit/preview').send({});
      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });

    it('GET /api/reports/:type/export retorna 503', async () => {
      const response = await request(appWithDb(null)).get('/api/reports/audit/export');
      expect(response.status).toBe(503);
    });

    it('GET /api/reports/:type/export/pdf retorna 503', async () => {
      const response = await request(appWithDb(null)).get('/api/reports/audit/export/pdf');
      expect(response.status).toBe(503);
    });
  });

  describe('erro 500 (catch) em cada rota', () => {
    it('GET /api/reports retorna 500 quando a coleção lança', async () => {
      const response = await request(appWithThrowingCollection()).get('/api/reports');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao listar relatórios');
    });

    it('GET /api/reports/:id retorna 500 quando a coleção lança', async () => {
      const response = await request(appWithThrowingCollection()).get('/api/reports/2');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao buscar relatório');
    });

    it('POST /api/reports/generate retorna 500 quando falha', async () => {
      const response = await request(appWithThrowingCollection()).post('/api/reports/generate').send({ reportType: 'audit' });
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao gerar relatório');
    });

    it('DELETE /api/reports/:id retorna 500 quando falha', async () => {
      const response = await request(appWithThrowingCollection()).delete('/api/reports/2');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao remover relatório');
    });

    it('POST /api/reports/:type/preview retorna 500 quando falha', async () => {
      const response = await request(appWithThrowingCollection()).post('/api/reports/audit/preview').send({});
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it('GET /api/reports/:type/export retorna 500 quando falha', async () => {
      const response = await request(appWithThrowingCollection()).get('/api/reports/audit/export');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao exportar relatório CSV');
    });

    it('GET /api/reports/:type/export/pdf retorna 500 quando falha', async () => {
      const response = await request(appWithThrowingCollection()).get('/api/reports/audit/export/pdf');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao exportar relatório PDF');
    });
  });

  it('POST /api/reports/generate retorna 400 quando reportType está ausente', async () => {
    const { db } = buildCollectionDb({});
    const response = await request(appWithDb(db)).post('/api/reports/generate').send({ filters: {} });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('reportType é obrigatório');
  });

  describe('buildSampleQuery: filtros sprec e qualidade não cobertos no arquivo principal', () => {
    it('combina sprecSampleType, primaryContainer, preCentrifugation, centrifugation, secondCentrifugation, postCentrifugationDelay, longTermStorage e qualityCategory', async () => {
      // #525: these filters now resolve through the canonical
      // SpecimenPreanalytics/RcsAssessment entities instead of querying
      // `sprec.*`/`final_grade` directly off Sample — one combined
      // specimenId $in condition per entity, not one per field.
      const { db, capturedQueries } = buildCollectionDb({
        samples: [{ sampleID: 'S1' }],
        specimenPreanalytics: [{
          specimenId: 'SPEC-1',
          sampleType: 'WHOLE BLOOD',
          primaryContainer: 'EDTA TUBE',
          preCentrifugation: '2H',
          centrifugation: '10MIN',
          secondCentrifugation: 'NONE',
          postCentrifugationDelay: '30MIN',
          longTermStorage: '-80C',
          recordedAt: new Date('2026-01-01'),
        }],
        rcsAssessments: [{ specimenId: 'SPEC-2', finalGrade: 'A', assessedAt: new Date('2026-01-01') }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/samples/preview').send({
        filters: {
          sprecSampleType: 'whole blood',
          sprecPrimaryContainer: 'edta tube',
          sprecPreCentrifugation: '2h',
          sprecCentrifugation: '10min',
          sprecSecondCentrifugation: 'none',
          sprecPostCentrifugationDelay: '30min',
          sprecLongTermStorage: '-80c',
          sprecCategory: 'a',
        },
      });

      expect(response.status).toBe(200);
      const query = capturedQueries.samples;
      expect(query.$and).toEqual(
        expect.arrayContaining([
          { specimenId: { $in: ['SPEC-1'] } },
          { specimenId: { $in: ['SPEC-2'] } },
        ])
      );
    });

    it('normaliza treatmentStatus WASHOUT e releaseStatus QUARANTINE/BLOCKED', async () => {
      const { db: dbWashout, capturedQueries: capturedWashout } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
      const washoutResponse = await request(appWithDb(dbWashout)).post('/api/reports/samples/preview').send({
        filters: { treatmentStatus: 'lavagem', status: 'em quarentena' },
      });
      expect(washoutResponse.status).toBe(200);
      expect(capturedWashout.samples.$and).toEqual(
        expect.arrayContaining([
          { 'pharmacologyData.treatmentStatus': 'WASHOUT' },
          { specimenStatus: 'quarantined' },
        ])
      );

      const { db: dbBlocked, capturedQueries: capturedBlocked } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
      const blockedResponse = await request(appWithDb(dbBlocked)).post('/api/reports/samples/preview').send({
        filters: { status: 'bloqueada' },
      });
      expect(blockedResponse.status).toBe(200);
      expect(capturedBlocked.samples.$and).toEqual(
        expect.arrayContaining([{ specimenStatus: 'unavailable' }])
      );
    });
  });

  it('paciente: retorna lista paginada de pacientes sem o agrupamento samplesbypatient', async () => {
    const { db } = buildCollectionDb({
      patients: [
        { patientID: 'P1', patientName: 'Ana' },
        { patientID: 'P2', patientName: 'Bruno' },
      ],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: { keyword: 'Ana' } });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.patients).toHaveLength(2);
    expect(response.body.data.previewLimited).toBe(false);
  });

  // RF005/RNF007 (#574): keyword search no longer resolves against
  // ParticipantIdentity.patientName (civil identity) — dropped per #574's
  // resolution (RF008's filter list doesn't include name search, RNF002
  // AC#2 forbids the full-collection scan a substring search over
  // encrypted patientName would require, RNF007 AC#4 requires reports to
  // omit/pseudonymize direct identifiers by default). Only the
  // pseudonymized participantId itself is still keyword-searchable.
  it('paciente: keyword search matches participantId only, no ParticipantIdentity lookup', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      patients: [{ participantId: 'P1' }],
      participantIdentities: [{ participantId: 'P1', patientName: 'Ana' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: { keyword: 'P1' } });

    expect(response.status).toBe(200);
    expect(capturedQueries.participantIdentities).toBeUndefined();
    expect(capturedQueries.patients.$and).toEqual(
      expect.arrayContaining([
        { participantId: { $regex: 'P1', $options: 'i' } },
      ])
    );
  });

  // #633: Sample documents only ever have `specimenId` (the canonical
  // field) — `sampleID` doesn't exist on the real model. This fixture
  // deliberately has no `sampleID` at all, matching a real Sample
  // document shape, to prove the join actually works rather than
  // relying on a mock that happens to carry the buggy field name.
  it('sampleanalysis: amostra com specimenId e resultado correspondente mostra hasResults true', async () => {
    const { db } = buildCollectionDb({
      samples: [{ specimenId: 'SPEC-1', barcode: 'B1' }],
      results: [{ specimenId: 'SPEC-1' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    const row = response.body.data.analysis.find((item) => item.barcode === 'B1');
    expect(row.hasResults).toBe(true);
    expect(row.resultCount).toBe(1);
    expect(row.sampleID).toBe('SPEC-1');
  });

  it('sampleanalysis: amostras sem specimenId são ignoradas no agrupamento de resultados', async () => {
    const { db } = buildCollectionDb({
      samples: [
        { specimenId: 'SPEC-1', barcode: 'B1' },
        { specimenId: null, barcode: 'B2' },
      ],
      results: [{ specimenId: 'SPEC-1' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.analysis.find((item) => item.barcode === 'B2').hasResults).toBe(false);
  });

  // #595: patientID isn't a real field on Sample documents (Sample.js uses
  // participantId) — the preview row must resolve from participantId, not
  // always output null.
  it('sampleanalysis: linha de análise resolve patientID a partir de participantId', async () => {
    const { db } = buildCollectionDb({
      samples: [{ specimenId: 'SPEC-1', barcode: 'B1', participantId: 'P1' }],
      results: [],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.analysis.find((item) => item.sampleID === 'SPEC-1').patientID).toBe('P1');
  });

  it('temperatura: sem filtros de data nem alerta crítico usa query vazia e modo report', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      temperature: [{ temperatureValue: '5', readingStatus: 'normal' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/temperature/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.mode).toBe('report');
    expect(capturedQueries.temperature).toEqual({});
  });

  describe('normalizeReport: fallbacks de reportID/generatedAt ausentes', () => {
    it('lista relatório sem reportID (default 0) e sem generatedAt (usa createdAt)', async () => {
      const { db } = buildCollectionDb({
        reports: [{ _id: '1', reportType: 'x', createdAt: new Date('2026-01-01') }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports');

      expect(response.status).toBe(200);
      expect(response.body[0].reportID).toBe(0);
      expect(new Date(response.body[0].generatedAt)).toEqual(new Date('2026-01-01'));
    });

    it('lista relatório sem generatedAt nem createdAt (usa new Date())', async () => {
      const { db } = buildCollectionDb({
        reports: [{ _id: '1', reportID: 5, reportType: 'x' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports');

      expect(response.status).toBe(200);
      expect(response.body[0].generatedAt).toBeTruthy();
    });
  });

  describe('resolveCollection: candidato falsy sem lançar', () => {
    it('cai para o segundo candidato quando o primeiro collection() retorna falsy', async () => {
      const db = {
        collection(name) {
          if (name === 'reportTemplates') {
            return { findOne: async (filter) => REPORT_TEMPLATE_DOCS.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null };
          }
          if (name === 'patients') return undefined;
          if (name === 'pacientes') {
            return {
              find() {
                const chain = {
                  toArray: async () => [{ patientID: 'P1', patientName: 'Ana' }],
                  limit() {
                    return chain;
                  },
                };
                return chain;
              },
              async countDocuments() {
                return 1;
              },
            };
          }
          if (name === 'samples' || name === 'amostras') {
            return { distinct: async () => [] };
          }
          // #341: resolveUserOrganizationScope needs these two to resolve
          // 'global' (not 'none') for req.user.userID 'user-1' — see the
          // DEFAULT_RBAC_COLLECTIONS comment above.
          if (name === 'userRoleAssignments') {
            return { find: () => ({ toArray: async () => DEFAULT_RBAC_COLLECTIONS.userRoleAssignments }) };
          }
          if (name === 'roles') {
            return { find: () => ({ toArray: async () => DEFAULT_RBAC_COLLECTIONS.roles }) };
          }
          return { find: () => ({ toArray: async () => [] }), async countDocuments() { return 0; } };
        },
      };
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
    });

    it('todos os candidatos falsy resulta em 500 ao tentar usar a coleção indefinida', async () => {
      const db = { collection: () => undefined };
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sensors/preview').send({ filters: {} });

      expect(response.status).toBe(500);
    });
  });

  describe('buildDateQuery: apenas um limite informado', () => {
    // #620: withdrawalhistory reads from sample_movements (type: 'withdraw')
    // now, not the never-written 'withdrawals' collection — see the
    // dedicated describe block below for the full fix coverage.
    it('apenas startDate aplica somente $gte', async () => {
      const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/withdrawal_history/preview')
        .send({ filters: { startDate: '2026-01-01' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.sample_movements.createdAt).toEqual({ $gte: new Date('2026-01-01') });
    });

    it('apenas endDate aplica somente $lte', async () => {
      const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/withdrawal_history/preview')
        .send({ filters: { endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.sample_movements.createdAt.$gte).toBeUndefined();
      expect(capturedQueries.sample_movements.createdAt.$lte).toBeDefined();
    });
  });

  it('amostra: treatmentStatus e status desconhecidos retornam o valor normalizado bruto', async () => {
    const { db, capturedQueries } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/samples/preview').send({
      filters: { treatmentStatus: 'foo bar', status: 'baz qux' },
    });

    expect(response.status).toBe(200);
    expect(capturedQueries.samples.$and).toEqual(
      expect.arrayContaining([
        { 'pharmacologyData.treatmentStatus': 'FOO_BAR' },
        { specimenStatus: 'baz_qux' },
      ])
    );
  });

  it('samplesbypatient: sem orphaCode, com keyword e matchingPatientIds não vazio', async () => {
    const { db } = buildCollectionDb({
      patients: [{ participantId: 'P1', patientName: 'Ana' }],
      samples: [
        { participantId: 'P1', sampleID: 'S1' },
        { participantId: 'P2', sampleID: 'S2' },
      ],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/samples_by_patient/preview')
      .send({ filters: { keyword: 'Ana', atcCode: 'ATC:N02' } });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    const p1 = response.body.data.patients.find((p) => p.participantId === 'P1');
    expect(p1.sampleCount).toBe(1);
  });

  // #732: GET /:type/filters accepted a `:type` param and ignored it --
  // the handler's own first argument was named `_req` -- returning the same
  // hardcoded 4-entry list for every report type, with a `status` option
  // set ('Ativo'/'Inativo') that matches nothing the query layer accepts.
  // The catalog now resolves the type to its ReportTemplate handlerKey and
  // returns what that handler actually consumes.
  describe('#732: GET /:type/filters is per-type', () => {
    it('um tipo enraizado em amostras devolve as seis dimensoes do AC#1', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/samples/filters');

      expect(response.status).toBe(200);
      expect(response.body.handlerKey).toBe('sample');
      const names = response.body.filters.map((entry) => entry.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'startDate',
          'endDate',
          'collectionId',
          'sampleType',
          'sampleOrigin',
          'status',
          'storageBoxId',
        ])
      );

      // The status options must be the vocabulary normalizeReleaseStatus
      // actually accepts (#531), not the old 'Ativo'/'Inativo' pair.
      const status = response.body.filters.find((entry) => entry.name === 'status');
      expect(status.options).toEqual(['AVAILABLE', 'QUARANTINE', 'BLOCKED']);

      // Selects must carry the real MIABIS id vocabularies.
      const sampleType = response.body.filters.find((entry) => entry.name === 'sampleType');
      expect(sampleType.options).toContain('PLASMA');
      const sampleOrigin = response.body.filters.find((entry) => entry.name === 'sampleOrigin');
      expect(sampleOrigin.options).toContain('VENOUS_BLOOD');
    });

    it('um tipo enraizado em pacientes acrescenta keyword', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/samples_by_patient/filters');

      expect(response.status).toBe(200);
      expect(response.body.handlerKey).toBe('samplesByPatient');
      expect(response.body.filters.map((entry) => entry.name)).toContain('keyword');
    });

    it('um relatorio de temperatura devolve periodo e criticalAlertsOnly, nao filtros de amostra', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/temperature/filters');

      expect(response.status).toBe(200);
      const names = response.body.filters.map((entry) => entry.name);
      expect(names).toEqual(['startDate', 'endDate', 'criticalAlertsOnly']);
      expect(names).not.toContain('sampleType');
    });

    // handleSensor/handleEquipment/handleResult/handleTissueOriginHistory/
    // handleExtracellularNetwork read nothing off `filters` except the
    // organizationScope the server resolves itself. An empty catalog is the
    // truthful answer -- four generic fields that are silently ignored is
    // strictly worse for anyone building a filter UI.
    it('um tipo que nao consome filtro nenhum devolve uma lista vazia', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/equipment/filters');

      expect(response.status).toBe(200);
      expect(response.body.filters).toEqual([]);
      expect(response.body.handlerKey).toBe('equipment');
    });

    it('tipos diferentes nao devolvem mais o mesmo catalogo', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const samples = await request(testApp).get('/api/reports/samples/filters');
      const logs = await request(testApp).get('/api/reports/access_logs/filters');

      expect(samples.status).toBe(200);
      expect(logs.status).toBe(200);
      expect(logs.body.filters).not.toEqual(samples.body.filters);
      expect(logs.body.filters.map((entry) => entry.name)).toEqual(['startDate', 'endDate']);
    });

    it('um tipo desconhecido devolve 404', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/nao_existe/filters');

      expect(response.status).toBe(404);
    });

    it('sem banco devolve 503', async () => {
      const response = await request(appWithDb(null)).get('/api/reports/samples/filters');

      expect(response.status).toBe(503);
    });
  });

  // #739 (RF008 AC#1): "Aplicar filtros por periodo, colecao, tipo, origem,
  // estado e localizacao." Only `estado` (status -> specimenStatus) was
  // wired into buildSampleQuery; the other five were accepted by the API
  // and silently ignored, so e.g. `GET /:type/export?startDate=...`
  // returned the unfiltered set. Each dimension gets its own captured-query
  // assertion below, plus the guards that make the new conditions safe.
  describe('#739: buildSampleQuery honours all six AC#1 filter dimensions', () => {
    it('periodo: startDate/endDate filtram registeredAt ou createdAt', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { startDate: '2026-01-01', endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      const dateCondition = capturedQueries.samples.$and.find((part) => part.$or);
      expect(dateCondition).toBeDefined();
      expect(dateCondition.$or).toHaveLength(2);
      expect(dateCondition.$or[0].registeredAt.$gte).toEqual(new Date('2026-01-01'));
      expect(dateCondition.$or[1].createdAt.$gte).toEqual(new Date('2026-01-01'));
      // buildDateQuery pushes $lte to the very end of the closing day.
      expect(dateCondition.$or[0].registeredAt.$lte.getHours()).toBe(23);
    });

    it('colecao: collectionId entra na query', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { collectionId: 'COL-42' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ collectionId: 'COL-42' }])
      );
    });

    it('tipo e origem: normalizados para os ids MIABIS em caixa alta', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { sampleType: ' plasma ', sampleOrigin: 'oral_mucosa' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ sampleType: 'PLASMA' }, { sampleOrigin: 'ORAL_MUCOSA' }])
      );
    });

    it('localizacao: storageBoxId vira um ObjectId em storageLocation.boxId', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { storageBoxId: '507f1f77bcf86cd799439011', storagePosition: 'A1' } });

      expect(response.status).toBe(200);
      const locationCondition = capturedQueries.samples.$and.find((part) => part['storageLocation.boxId']);
      expect(locationCondition).toBeDefined();
      expect(String(locationCondition['storageLocation.boxId'])).toBe('507f1f77bcf86cd799439011');
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ 'storageLocation.position': 'A1' }])
      );
    });

    // A boxId that isn't a valid ObjectId must fail closed (match nothing),
    // not throw a 500 and not silently drop the location filter -- dropping
    // it is the exact #741 failure mode one dimension over.
    it('localizacao: storageBoxId invalido nao derruba a rota nem o filtro', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { storageBoxId: 'not-an-objectid' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ 'storageLocation.boxId': { $in: [] } }])
      );
    });

    // The dimensions must also reach the patient-rooted handlers, which
    // share buildSampleQuery through getMatchingPatientIds.
    it('os filtros novos chegam a samples_by_patient pela query de amostras', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        patients: [{ participantId: 'P1' }],
        samples: [{ participantId: 'P1', specimenId: 'SPEC-1' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples_by_patient/preview')
        .send({ filters: { sampleType: 'SERUM', collectionId: 'COL-7' } });

      expect(response.status).toBe(200);
      expect(capturedQueries['samples.distinct'].$and).toEqual(
        expect.arrayContaining([{ sampleType: 'SERUM' }, { collectionId: 'COL-7' }])
      );
    });

    // Guard against over-filtering: an empty/whitespace value must not
    // become a condition that matches nothing.
    it('valores vazios nao viram condicoes', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ specimenId: 'SPEC-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/samples/preview')
        .send({ filters: { sampleType: '   ', sampleOrigin: '', collectionId: '', storageBoxId: '' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples).toEqual({});
    });
  });

  // #741: an *active* sample-level filter that matches no sample at all
  // must still narrow the patient list (`$in: []`), the same way the #341
  // org-scope guard already refuses to let an empty id list mean
  // "unfiltered". Gating the `$in` push on matchingPatientIds being
  // non-empty made the filter silently stop applying whenever nothing
  // matched, so "patients with quarantined samples" on a database with no
  // quarantined specimens returned the entire patient directory.
  it('samplesbypatient: filtro de amostra sem correspondência restringe pacientes a $in vazio', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      patients: [{ participantId: 'P1' }, { participantId: 'P2' }],
      samples: [],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/samples_by_patient/preview')
      .send({ filters: { status: 'QUARANTINE' } });

    expect(response.status).toBe(200);
    expect(capturedQueries.patients.$and).toEqual(
      expect.arrayContaining([{ participantId: { $in: [] } }])
    );
  });

  it('paciente: filtro de amostra sem correspondência restringe pacientes a $in vazio', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      patients: [{ participantId: 'P1' }, { participantId: 'P2' }],
      samples: [],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/patients/preview')
      .send({ filters: { status: 'QUARANTINE' } });

    expect(response.status).toBe(200);
    expect(capturedQueries.patients.$and).toEqual(
      expect.arrayContaining([{ participantId: { $in: [] } }])
    );
  });

  // #741: the complementary half — with no sample-level filter active at
  // all, an empty matchingPatientIds must NOT become `$in: []`, or every
  // unfiltered patients report would return nothing.
  it('paciente: sem filtro de amostra não injeta $in vazio', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      patients: [{ participantId: 'P1' }],
      samples: [],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(capturedQueries.patients).toEqual({});
  });

  it('paciente: com orphaCode (sem keyword) e matchingPatientIds não vazio', async () => {
    const { db } = buildCollectionDb({
      patients: [{ participantId: 'P1', patientName: 'Ana' }],
      samples: [{ participantId: 'P1', sampleID: 'S1' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/patients/preview')
      .send({ filters: { orphaCode: 'ORPHA:558', atcCode: 'ATC:N02' } });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
  });

  it('sampleanalysis: resultado sem specimenId é ignorado no agrupamento', async () => {
    const { db } = buildCollectionDb({
      samples: [{ specimenId: 'SPEC-1', barcode: 'B1' }],
      results: [{ specimenId: 'SPEC-1' }, { specimenId: null }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/sample_analysis/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.analysis[0].hasResults).toBe(true);
  });

  it('samplesbypatient: amostra com participantId vazio não é agrupada', async () => {
    const { db } = buildCollectionDb({
      patients: [{ participantId: 'P1', patientName: 'Ana' }],
      samples: [
        { participantId: 'P1', sampleID: 'S1' },
        { participantId: '', sampleID: 'S2' },
      ],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/samples_by_patient/preview')
      .send({ filters: {} });

    expect(response.status).toBe(200);
    const p1 = response.body.data.patients.find((p) => p.participantId === 'P1');
    expect(p1.sampleCount).toBe(1);
  });

  it('logs/audit: aplica intervalo de datas na query', async () => {
    const { db, capturedQueries } = buildCollectionDb({ logs: [{ dateTime: new Date('2026-01-05') }] });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/audit/preview')
      .send({ filters: { startDate: '2026-01-01', endDate: '2026-01-31' } });

    expect(response.status).toBe(200);
    expect(capturedQueries.logs.$or).toBeDefined();
  });

  it('amostra: treatmentStatus NAIVE/INICIAL é normalizado', async () => {
    const { db, capturedQueries } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/samples/preview').send({
      filters: { treatmentStatus: 'inicial' },
    });

    expect(response.status).toBe(200);
    expect(capturedQueries.samples.$and).toEqual(
      expect.arrayContaining([{ 'pharmacologyData.treatmentStatus': 'NAIVE' }])
    );
  });

  it('tissueoriginhistory: filtra amostras com sampleOrigin/linkedProject existentes', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      samples: [{ sampleID: 'S1', sampleOrigin: 'Fígado' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/tissue_origin_history/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(capturedQueries.samples.$or).toBeDefined();
  });

  it('withdrawalhistory: sem filtros de data filtra apenas por type: withdraw', async () => {
    const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/withdrawal_history/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(capturedQueries.sample_movements).toEqual({ type: 'withdraw' });
  });

  describe('#620: withdrawalhistory lê do ledger de movimentações, não da coleção "withdrawals" (nunca escrita)', () => {
    it('retorna apenas movimentações type: withdraw, ignorando outras (return/adjust/move)', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        sample_movements: [
          { type: 'withdraw', specimenId: 'SP1', quantity: 5, createdAt: new Date('2026-01-05') },
        ],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/withdrawal_history/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.withdrawals).toEqual([
        { type: 'withdraw', specimenId: 'SP1', quantity: 5, createdAt: new Date('2026-01-05').toISOString() },
      ]);
      expect(capturedQueries.sample_movements).toEqual({ type: 'withdraw' });
    });

    it('nunca consulta a coleção "withdrawals" (dead collection, #620)', async () => {
      const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      await request(testApp).post('/api/reports/withdrawal_history/preview').send({ filters: {} });

      expect(capturedQueries.withdrawals).toBeUndefined();
    });
  });

  it('generate: usa reportID 1 quando não há relatórios anteriores', async () => {
    const { db } = buildCollectionDb({});
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'auditoria' });

    expect(response.status).toBe(201);
    expect(response.body.reportID).toBe(1);
  });

  // #341 (RF003 AC#3): org-scope enforcement on the report types rooted in
  // samples/patients. Only these types resolve organizationScope at all —
  // an org-less/unusable-scope caller still gets 200 for a non-sample-
  // rooted type (temperature, equipamento, ...), matching the product
  // decision that those entities have no organization concept yet.
  // #634: `sensor` moved out of the unscoped bucket now that
  // Sensor.organizationId exists — see reports.routes.js's own comment.
  describe('org-scope enforcement (#341)', () => {
    const NO_ASSIGNMENT_RBAC = { userRoleAssignments: [], roles: [] };
    const ORG_SCOPED_RBAC = {
      userRoleAssignments: [{ userAccountId: 'user-1', roleId: 'role-coord', assignmentStatus: 'active', validUntil: null, scopeType: 'organization', scopeId: 'org-1' }],
      roles: [{ roleId: 'role-coord', hierarchyLevel: 3 }],
    };

    it.each([
      ['amostra', '/api/reports/samples/preview'],
      ['paciente', '/api/reports/patients/preview'],
      ['samplesbypatient', '/api/reports/samples_by_patient/preview'],
      ['sampleanalysis', '/api/reports/sample_analysis/preview'],
      ['tissueoriginhistory', '/api/reports/tissue_origin_history/preview'],
      ['resultado', '/api/reports/results/preview'],
      ['sensor', '/api/reports/sensors/preview'],
      ['equipamento', '/api/reports/equipment/preview'],
      ['temperatura', '/api/reports/temperature/preview'],
    ])('%s: 403 quando o usuário não tem nenhuma organização atribuída', async (_label, path) => {
      const { db } = buildCollectionDb(NO_ASSIGNMENT_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).post(path).send({ filters: {} });

      expect(response.status).toBe(403);
    });

    // #636: every entity-rooted report type this repo currently scopes
    // (sample/patient-rooted, Result, Sensor, Equipment, Temperature) is
    // now covered by the it.each above -- no "deliberately unscoped"
    // types remain in this file's own coverage (access-log/withdrawal-
    // history are unscoped by design but tested separately elsewhere,
    // see the #620 describe block below).

    it('amostra: filtra a query por collectionSite para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, samples: [{ sampleID: 'S1', collectionSite: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/samples/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ collectionSite: { $in: ['org-1'] } }])
      );
    });

    it('sensor: filtra a query por organizationId para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, sensors: [{ sensorId: 'S1', organizationId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sensors/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.sensors).toEqual({ organizationId: { $in: ['org-1'] } });
    });

    it('equipamento: filtra a query por organizationId para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, equipment: [{ equipmentID: 1, organizationId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/equipment/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.equipment).toEqual({ organizationId: { $in: ['org-1'] } });
    });

    it('temperatura: filtra a query por organizationId para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, temperature: [{ sensorId: 'S1', organizationId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/temperature/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.temperature).toEqual({ $and: [{ organizationId: { $in: ['org-1'] } }] });
    });

    it('paciente: filtra diretamente por clinicalUnitId mesmo sem keyword/orphaCode/matchingPatientIds', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, patients: [{ patientID: 'P1', clinicalUnitId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/patients/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.patients.$and).toEqual(
        expect.arrayContaining([{ clinicalUnitId: { $in: ['org-1'] } }])
      );
    });

    it('tissueoriginhistory: combina o filtro de origem com collectionSite via $and', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, samples: [{ sampleID: 'S1', sampleOrigin: 'Fígado', collectionSite: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/tissue_origin_history/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ collectionSite: { $in: ['org-1'] } }])
      );
    });

    it('amostra: Administrador (scope global) não recebe filtro de collectionSite', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/samples/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples).toEqual({});
    });

    // #621: Result has no organization reference of its own — scope is
    // derived by joining through its linked Sample's collectionSite.
    // #628: Result.specimenId is now the sole canonical shape (every
    // write path writes it, existing documents backfilled), so the join
    // matches on specimenId alone — not the dual _id/specimenId check
    // #621 originally needed while the field was still stale.
    it('resultado: filtra por amostras da organização via join specimenId -> Sample.specimenId', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        ...ORG_SCOPED_RBAC,
        samples: [{ _id: 'sample-1', specimenId: 'SPX-1', collectionSite: 'org-1' }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/results/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples).toEqual({ collectionSite: { $in: ['org-1'] } });
      expect(capturedQueries.results).toEqual({ specimenId: { $in: ['SPX-1'] } });
    });

    it('resultado: Administrador (scope global) não recebe filtro de specimenId', async () => {
      const { db, capturedQueries } = buildCollectionDb({ results: [{ specimenId: 'SPX-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/results/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.results).toEqual({});
    });
  });

  // #637: saved Report documents get their own organizationIds (an array
  // -- a single report can span multiple scoped organizations, unlike
  // every other entity's single-org field, since a caller can hold more
  // than one active organization-scoped assignment at once), stamped at
  // generation time from the requesting user's own resolved scope. No
  // backfill for reports generated before this field existed -- they get
  // organizationIds: [] and are hidden from organization-scoped viewers,
  // same F3-G09 treatment #634/#635/#636 already gave Sensor/Equipment/
  // Temperature's own organizationId: null.
  describe('Report.organizationIds (#637)', () => {
    const NO_ASSIGNMENT_RBAC = { userRoleAssignments: [], roles: [] };
    const ORG_SCOPED_RBAC = {
      userRoleAssignments: [{ userAccountId: 'user-1', roleId: 'role-coord', assignmentStatus: 'active', validUntil: null, scopeType: 'organization', scopeId: 'org-1' }],
      roles: [{ roleId: 'role-coord', hierarchyLevel: 3 }],
    };
    // #637: a caller with two active organization-scoped assignments
    // (e.g. their primary role plus an additively-granted role scoped to
    // a different organization, per #429/grantAdditionalRole) resolves
    // to multiple organizationIds even though they aren't Administrador.
    const MULTI_ORG_SCOPED_RBAC = {
      userRoleAssignments: [
        { userAccountId: 'user-1', roleId: 'role-coord', assignmentStatus: 'active', validUntil: null, scopeType: 'organization', scopeId: 'org-1' },
        { userAccountId: 'user-1', roleId: 'role-auditor', assignmentStatus: 'active', validUntil: null, scopeType: 'organization', scopeId: 'org-2' },
      ],
      roles: [
        { roleId: 'role-coord', hierarchyLevel: 3 },
        { roleId: 'role-auditor', hierarchyLevel: null },
      ],
    };

    it('generate: estampa organizationIds a partir do escopo do usuário (organization-scoped)', async () => {
      const { db } = buildCollectionDb(ORG_SCOPED_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'audit' });

      expect(response.status).toBe(201);
      expect(response.body.organizationIds).toEqual(['org-1']);
    });

    it('generate: estampa todas as organizationIds do usuário quando há múltiplas assignments organization-scoped', async () => {
      const { db } = buildCollectionDb(MULTI_ORG_SCOPED_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'audit' });

      expect(response.status).toBe(201);
      expect(response.body.organizationIds.sort()).toEqual(['org-1', 'org-2']);
    });

    it('generate: estampa organizationIds vazio para Administrador (scope global)', async () => {
      const { db } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/generate').send({ reportType: 'audit' });

      expect(response.status).toBe(201);
      expect(response.body.organizationIds).toEqual([]);
    });

    it('GET /api/reports: 403 quando o usuário não tem nenhuma organização atribuída', async () => {
      const { db } = buildCollectionDb(NO_ASSIGNMENT_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports');

      expect(response.status).toBe(403);
    });

    it('GET /api/reports: filtra por organizationIds para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({
        ...ORG_SCOPED_RBAC,
        reports: [{ reportID: 1, reportType: 'audit', organizationIds: ['org-1'] }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports');

      expect(response.status).toBe(200);
      expect(capturedQueries.reports).toEqual({ organizationIds: { $in: ['org-1'] } });
    });

    it('GET /api/reports: Administrador (scope global) não recebe filtro', async () => {
      const { db, capturedQueries } = buildCollectionDb({});
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports');

      expect(response.status).toBe(200);
      expect(capturedQueries.reports).toEqual({});
    });

    it('GET /api/reports/:id: 403 quando o usuário não tem nenhuma organização atribuída', async () => {
      const { db } = buildCollectionDb(NO_ASSIGNMENT_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/1');

      expect(response.status).toBe(403);
    });

    it('GET /api/reports/:id: 403 quando o relatório pertence a outra organização (inclui organizationIds: [] legado)', async () => {
      const { db } = buildCollectionDb({
        ...ORG_SCOPED_RBAC,
        reports: [{ reportID: 1, reportType: 'audit', organizationIds: ['org-9'] }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/1');

      expect(response.status).toBe(403);
    });

    it('GET /api/reports/:id: 200 quando o relatório está no escopo do usuário', async () => {
      const { db } = buildCollectionDb({
        ...ORG_SCOPED_RBAC,
        reports: [{ reportID: 1, reportType: 'audit', organizationIds: ['org-1'] }],
      });
      const testApp = appWithDb(db);

      const response = await request(testApp).get('/api/reports/1');

      expect(response.status).toBe(200);
      expect(response.body.reportID).toBe(1);
    });
  });
});
