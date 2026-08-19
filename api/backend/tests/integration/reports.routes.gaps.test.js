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
  const mergedCollections = { ...DEFAULT_RBAC_COLLECTIONS, ...collections };

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

      const response = await request(testApp).post('/api/reports/amostra/preview').send({
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
      const washoutResponse = await request(appWithDb(dbWashout)).post('/api/reports/amostra/preview').send({
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
      const blockedResponse = await request(appWithDb(dbBlocked)).post('/api/reports/amostra/preview').send({
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

    const response = await request(testApp).post('/api/reports/paciente/preview').send({ filters: { keyword: 'Ana' } });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.patients).toHaveLength(2);
    expect(response.body.data.previewLimited).toBe(false);
  });

  // RF005/RNF007 (#561/#564): keyword search resolves patientName via
  // ParticipantIdentity instead of a direct Patient-document query —
  // resolved participantIds must flow into the patients query's $or leg.
  it('paciente: keyword search resolves matching participantIds via ParticipantIdentity', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      patients: [{ participantId: 'P1' }],
      participantIdentities: [{ participantId: 'P1', patientName: 'Ana' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/paciente/preview').send({ filters: { keyword: 'Ana' } });

    expect(response.status).toBe(200);
    expect(capturedQueries.participantIdentities).toEqual({ patientName: { $regex: 'Ana', $options: 'i' } });
    // #573: the patients-collection $or leg queries participantId (the
    // canonical field — Patient documents never had `patientID`), not a
    // second, non-existent field.
    expect(capturedQueries.patients.$and).toEqual(
      expect.arrayContaining([
        { $or: [{ participantId: { $in: ['P1'] } }, { participantId: { $regex: 'Ana', $options: 'i' } }] },
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

    const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

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

    const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

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

    const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.analysis.find((item) => item.sampleID === 'SPEC-1').patientID).toBe('P1');
  });

  it('temperatura: sem filtros de data nem alerta crítico usa query vazia e modo report', async () => {
    const { db, capturedQueries } = buildCollectionDb({
      temperature: [{ temperatureValue: '5', readingStatus: 'normal' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/temperatura/preview').send({ filters: {} });

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

      const response = await request(testApp).post('/api/reports/paciente/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
    });

    it('todos os candidatos falsy resulta em 500 ao tentar usar a coleção indefinida', async () => {
      const db = { collection: () => undefined };
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sensor/preview').send({ filters: {} });

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
        .post('/api/reports/withdrawal%20history/preview')
        .send({ filters: { startDate: '2026-01-01' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.sample_movements.createdAt).toEqual({ $gte: new Date('2026-01-01') });
    });

    it('apenas endDate aplica somente $lte', async () => {
      const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
      const testApp = appWithDb(db);

      const response = await request(testApp)
        .post('/api/reports/withdrawal%20history/preview')
        .send({ filters: { endDate: '2026-01-31' } });

      expect(response.status).toBe(200);
      expect(capturedQueries.sample_movements.createdAt.$gte).toBeUndefined();
      expect(capturedQueries.sample_movements.createdAt.$lte).toBeDefined();
    });
  });

  it('amostra: treatmentStatus e status desconhecidos retornam o valor normalizado bruto', async () => {
    const { db, capturedQueries } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/amostra/preview').send({
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
      .post('/api/reports/samplesbypatient/preview')
      .send({ filters: { keyword: 'Ana', atcCode: 'ATC:N02' } });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    const p1 = response.body.data.patients.find((p) => p.participantId === 'P1');
    expect(p1.sampleCount).toBe(1);
  });

  it('paciente: com orphaCode (sem keyword) e matchingPatientIds não vazio', async () => {
    const { db } = buildCollectionDb({
      patients: [{ participantId: 'P1', patientName: 'Ana' }],
      samples: [{ participantId: 'P1', sampleID: 'S1' }],
    });
    const testApp = appWithDb(db);

    const response = await request(testApp)
      .post('/api/reports/paciente/preview')
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

    const response = await request(testApp).post('/api/reports/sampleanalysis/preview').send({ filters: {} });

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
      .post('/api/reports/samplesbypatient/preview')
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

    const response = await request(testApp).post('/api/reports/amostra/preview').send({
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

    const response = await request(testApp).post('/api/reports/tissueoriginhistory/preview').send({ filters: {} });

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(capturedQueries.samples.$or).toBeDefined();
  });

  it('withdrawalhistory: sem filtros de data filtra apenas por type: withdraw', async () => {
    const { db, capturedQueries } = buildCollectionDb({ sample_movements: [{ type: 'withdraw', createdAt: new Date('2026-01-05') }] });
    const testApp = appWithDb(db);

    const response = await request(testApp).post('/api/reports/withdrawal%20history/preview').send({ filters: {} });

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

      const response = await request(testApp).post('/api/reports/withdrawal%20history/preview').send({ filters: {} });

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

      await request(testApp).post('/api/reports/withdrawal%20history/preview').send({ filters: {} });

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
      ['amostra', '/api/reports/amostra/preview'],
      ['paciente', '/api/reports/paciente/preview'],
      ['samplesbypatient', '/api/reports/samplesbypatient/preview'],
      ['sampleanalysis', '/api/reports/sampleanalysis/preview'],
      ['tissueoriginhistory', '/api/reports/tissueoriginhistory/preview'],
      ['resultado', '/api/reports/resultado/preview'],
      ['sensor', '/api/reports/sensor/preview'],
    ])('%s: 403 quando o usuário não tem nenhuma organização atribuída', async (_label, path) => {
      const { db } = buildCollectionDb(NO_ASSIGNMENT_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).post(path).send({ filters: {} });

      expect(response.status).toBe(403);
    });

    it.each([
      ['temperatura', '/api/reports/temperatura/preview'],
      ['equipamento', '/api/reports/equipamento/preview'],
    ])('%s: continua 200 sem organização atribuída (tipo não escopado)', async (_label, path) => {
      const { db } = buildCollectionDb(NO_ASSIGNMENT_RBAC);
      const testApp = appWithDb(db);

      const response = await request(testApp).post(path).send({ filters: {} });

      expect(response.status).toBe(200);
    });

    it('amostra: filtra a query por collectionSite para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, samples: [{ sampleID: 'S1', collectionSite: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/amostra/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ collectionSite: { $in: ['org-1'] } }])
      );
    });

    it('sensor: filtra a query por organizationId para um usuário organization-scoped', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, sensors: [{ sensorId: 'S1', organizationId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/sensor/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.sensors).toEqual({ organizationId: { $in: ['org-1'] } });
    });

    it('paciente: filtra diretamente por clinicalUnitId mesmo sem keyword/orphaCode/matchingPatientIds', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, patients: [{ patientID: 'P1', clinicalUnitId: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/paciente/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.patients.$and).toEqual(
        expect.arrayContaining([{ clinicalUnitId: { $in: ['org-1'] } }])
      );
    });

    it('tissueoriginhistory: combina o filtro de origem com collectionSite via $and', async () => {
      const { db, capturedQueries } = buildCollectionDb({ ...ORG_SCOPED_RBAC, samples: [{ sampleID: 'S1', sampleOrigin: 'Fígado', collectionSite: 'org-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/tissueoriginhistory/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples.$and).toEqual(
        expect.arrayContaining([{ collectionSite: { $in: ['org-1'] } }])
      );
    });

    it('amostra: Administrador (scope global) não recebe filtro de collectionSite', async () => {
      const { db, capturedQueries } = buildCollectionDb({ samples: [{ sampleID: 'S1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/amostra/preview').send({ filters: {} });

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

      const response = await request(testApp).post('/api/reports/resultado/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.samples).toEqual({ collectionSite: { $in: ['org-1'] } });
      expect(capturedQueries.results).toEqual({ specimenId: { $in: ['SPX-1'] } });
    });

    it('resultado: Administrador (scope global) não recebe filtro de specimenId', async () => {
      const { db, capturedQueries } = buildCollectionDb({ results: [{ specimenId: 'SPX-1' }] });
      const testApp = appWithDb(db);

      const response = await request(testApp).post('/api/reports/resultado/preview').send({ filters: {} });

      expect(response.status).toBe(200);
      expect(capturedQueries.results).toEqual({});
    });
  });
});
