import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const neo4jModulePath = require.resolve('../../src/database/neo4j');
const redisModulePath = require.resolve('redis');
const dictionaryRoutePath = require.resolve('../../src/routes/dictionary');

// Same require-cache-swap pattern as dictionary-search-suggest.test.js:
// dictionary.js destructures getNeo4jDriver at require-time, so it must be
// mocked before a fresh require() of the route module.
function loadRouteWithMocks({ session, createClientImpl } = {}) {
  delete require.cache[neo4jModulePath];
  delete require.cache[redisModulePath];
  delete require.cache[dictionaryRoutePath];

  const neo4jModule = require(neo4jModulePath);
  neo4jModule.getNeo4jDriver = vi.fn().mockReturnValue({
    session: () => session,
  });

  // Stage 2E flake fix: spyOn alone can miss CJS redis under parallel suites and
  // leave getRedisClient awaiting a real localhost connect until testTimeout.
  require.cache[redisModulePath] = {
    id: redisModulePath,
    filename: redisModulePath,
    loaded: true,
    exports: {
      createClient: createClientImpl
        || vi.fn(() => ({
          isOpen: true,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(null),
          setEx: vi.fn().mockResolvedValue('OK'),
        })),
    },
  };

  const router = require(dictionaryRoutePath);
  const app = express();
  app.use('/api/dictionary', router);
  return app;
}

function fakeSession(records) {
  return {
    run: vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function record(map) {
  return { get: (key) => map[key] };
}

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function throwingSession() {
  return {
    run: vi.fn().mockRejectedValue(new Error('neo4j down')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function buildFallbackDb({ disease = null, terminologyRows = [] } = {}) {
  return {
    collection: vi.fn((name) => {
      if (name === 'diseaseDictionary') {
        return { findOne: vi.fn().mockResolvedValue(disease) };
      }
      if (name === 'terminologies') {
        return { find: vi.fn(() => cursor(terminologyRows)) };
      }
      return { find: vi.fn(() => cursor([])), findOne: vi.fn().mockResolvedValue(null) };
    }),
  };
}

describe('dictionary.js branch coverage - Neo4j success-path display fallbacks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[neo4jModulePath];
    delete require.cache[redisModulePath];
    delete require.cache[dictionaryRoutePath];
  });

  it('falls back to `name` for disease/phenotype/biomarker display when `nome` is absent', async () => {
    const session = fakeSession([
      record({
        d: { properties: { code: 'ORPHA:9', name: 'English Disease Name' } },
        fenotipos: [{ properties: { code: 'HP:1', name: 'English Phenotype' } }],
        biomarcadores: [{ properties: { name: 'English Biomarker' } }],
      }),
    ]);
    const app = loadRouteWithMocks({ session });

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=9');

    expect(res.status).toBe(200);
    expect(res.body.disease.display).toBe('English Disease Name');
    expect(res.body.phenotypes[0].display).toBe('English Phenotype');
    // biomarker has neither `code` nor `nome`, so it normalizes to null and is filtered.
    expect(res.body.biomarkers).toEqual([]);
  });

  it('falls back to `nome` for biomarker code when `code` is absent', async () => {
    const session = fakeSession([
      record({
        d: { properties: { code: 'ORPHA:9', nome: 'Disease' } },
        fenotipos: [],
        biomarcadores: [{ properties: { nome: 'MarkerAsCode' } }],
      }),
    ]);
    const app = loadRouteWithMocks({ session });

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=9');

    expect(res.status).toBe(200);
    expect(res.body.biomarkers).toEqual([
      { system: 'http://loinc.org', code: 'MarkerAsCode', display: 'MarkerAsCode' },
    ]);
  });
});

describe('dictionary.js branch coverage - /suggest local fallback (buildLocalSemanticSuggestions)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[neo4jModulePath];
    delete require.cache[redisModulePath];
    delete require.cache[dictionaryRoutePath];
  });

  it('returns 404 when the local fallback finds no disease, phenotypes, or biomarkers', async () => {
    const db = buildFallbackDb({ disease: null, terminologyRows: [] });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('returns 404 when normalizeOrphaCode strips the orphaCode down to empty (ORPHA: only)', async () => {
    const db = buildFallbackDb();
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=ORPHA:');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('builds a disease using the "ORPHA {code}" fallback display when disease has no name, sourced from HPO terminology rows alone', async () => {
    const db = buildFallbackDb({
      disease: null,
      terminologyRows: [{
        sistema: 'HPO',
        codigo: 'HP:0001',
        descricao: 'Some phenotype',
        relacoes: { orpha: '77', hpo: 'HP:0001' },
        ativo: true,
      }],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=77');
    expect(res.status).toBe(200);
    expect(res.body.disease).toEqual({
      system: 'http://www.orpha.net',
      code: '77',
      display: 'ORPHA 77',
    });
  });

  it('returns 500 with the fallback error message when the local fallback query itself throws', async () => {
    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockRejectedValue(new Error('mongo fallback exploded')),
        find: vi.fn(() => cursor([])),
      })),
    };
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'mongo fallback exploded' });
  });

  it('falls back to the original Neo4j error message when the fallback error has none', async () => {
    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockRejectedValue('a plain string rejection, no .message'),
        find: vi.fn(() => cursor([])),
      })),
    };
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'neo4j down' });
  });

  it('normalizes a disease.phenotypes entry with no code source at all (hpoId/code/codigo/relacoes.hpo all absent) to an empty code', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '67',
        name: 'No-code phenotype disease',
        phenotypes: [{ label: 'Codeless phenotype' }],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=67');
    expect(res.status).toBe(200);
    // normalizeCoding requires a non-empty code, so this entry is dropped.
    expect(res.body.phenotypes).toEqual([]);
  });

  it('normalizes an HPO terminology row phenotype using `label`/`descricao` and a non-HP-prefixed `codigo`', async () => {
    const db = buildFallbackDb({
      disease: null,
      terminologyRows: [{
        sistema: 'HPO',
        codigo: '12345',
        label: 'Labelled phenotype',
        relacoes: {},
        ativo: true,
      }],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=55');
    expect(res.status).toBe(200);
    expect(res.body.phenotypes).toEqual([
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: '12345', display: 'Labelled phenotype' },
    ]);
  });

  it('includes a terminology row via `system` (not `sistema`) key and via relacoes.hpo when system is not HPO', async () => {
    const db = buildFallbackDb({
      disease: null,
      terminologyRows: [
        { system: 'HPO', codigo: 'HP:1111', descricao: 'Via system key', relacoes: {}, ativo: true },
        { sistema: 'OUTRO', codigo: 'HP:2222', descricao: 'Via relacoes.hpo', relacoes: { hpo: 'HP:2222' }, ativo: true },
      ],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=61');
    expect(res.status).toBe(200);
    expect(res.body.phenotypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HP:1111', display: 'Via system key' }),
      expect.objectContaining({ code: 'HP:2222', display: 'Via relacoes.hpo' }),
    ]));
  });

  it('dedupes a disease.phenotypes entry against a terminology row sharing the same HPO code', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '62',
        name: 'Dup disease',
        phenotypes: [{ hpoId: 'HP:3333', label: 'From disease record' }],
      },
      terminologyRows: [
        { sistema: 'HPO', codigo: 'HP:3333', descricao: 'From terminology row', relacoes: { hpo: 'HP:3333' }, ativo: true },
      ],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=62');
    expect(res.status).toBe(200);
    expect(res.body.phenotypes).toHaveLength(1);
    expect(res.body.phenotypes[0].display).toBe('From disease record');
  });

  it('normalizes a disease.phenotypes entry using codigo/relacoes.hpo for code and descricao/name/nome for display', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '63',
        name: 'Fallback disease',
        phenotypes: [{ codigo: '9999', descricao: 'Via descricao' }],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=63');
    expect(res.status).toBe(200);
    expect(res.body.phenotypes).toEqual([
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: '9999', display: 'Via descricao' },
    ]);
  });

  it('normalizes a biomarker entry using biomarkerType/id/codigo for code and label/name/nome for display', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '64',
        name: 'Biomarker disease',
        biomarkers: [{ id: 'BM-1', label: 'Labelled biomarker' }],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=64');
    expect(res.status).toBe(200);
    expect(res.body.biomarkers).toEqual([
      { system: 'http://loinc.org', code: 'BM-1', display: 'Labelled biomarker' },
    ]);
  });

  it('normalizes a disease.phenotypes entry code via relacoes.hpo alone (no hpoId/code/codigo) and display via name/nome/code fallbacks', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '65',
        name: 'Relacoes disease',
        phenotypes: [
          { relacoes: { hpo: 'HP:7001' }, name: 'Via name field' },
          { relacoes: { hpo: 'HP:7002' }, nome: 'Via nome field' },
          { relacoes: { hpo: 'HP:7003' } },
        ],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=65');
    expect(res.status).toBe(200);
    expect(res.body.phenotypes).toEqual(expect.arrayContaining([
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:7001', display: 'Via name field' },
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:7002', display: 'Via nome field' },
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:7003', display: 'HP:7003' },
    ]));
  });

  it('normalizes disease.biomarkers entries via codigo-only code and nome-only display, falling back to the code itself when no display field is set', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '66',
        name: 'Biomarker fallback disease',
        biomarkers: [
          { codigo: 'BM-CODIGO', nome: 'Via nome' },
          { codigo: 'BM-BARE' },
        ],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=66');
    expect(res.status).toBe(200);
    expect(res.body.biomarkers).toEqual(expect.arrayContaining([
      { system: 'http://loinc.org', code: 'BM-CODIGO', display: 'Via nome' },
      { system: 'http://loinc.org', code: 'BM-BARE', display: 'BM-BARE' },
    ]));
  });

  it('normalizes disease.phenotypes entries via Synonym/name fallback chains and biomarkers via string entries', async () => {
    const db = buildFallbackDb({
      disease: {
        orpha_code: '558',
        name: 'Fabry',
        biomarkers: ['alphaGal'],
      },
      terminologyRows: [],
    });
    const app = loadRouteWithMocks({ session: throwingSession() });
    app.locals.db = db;

    const res = await request(app).get('/api/dictionary/suggest?orphaCode=558');
    expect(res.status).toBe(200);
    expect(res.body.disease).toEqual({
      system: 'http://www.orpha.net',
      code: '558',
      display: 'Fabry',
    });
    expect(res.body.biomarkers).toEqual([
      { system: 'http://loinc.org', code: 'alphaGal', display: 'alphaGal' },
    ]);
  });
});

describe('dictionary.js branch coverage - normalizeMedicationRecord fallback chains via /medications/search', () => {
  function buildDb(rows) {
    const findChain = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    };
    const collection = {
      find: vi.fn().mockReturnValue(findChain),
      createIndex: vi.fn().mockResolvedValue(true),
    };
    return { collection: vi.fn().mockReturnValue(collection) };
  }

  function buildApp(db) {
    const dictionaryRouter = require('../../src/routes/dictionary.js');
    const app = express();
    app.locals.db = db;
    app.use('/api/dictionary', dictionaryRouter);
    return app;
  }

  it('derives atc_code from `code` (ATC: prefix) when `atc_code` is absent', async () => {
    const app = buildApp(buildDb([{ code: 'ATC:x12', name: 'Med' }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].atc_code).toBe('X12');
  });

  it('falls back name -> generic_name -> display, and generic_name -> name -> display, when the primary field is absent', async () => {
    const app = buildApp(buildDb([{ code: 'C1', display: 'Display Only Name' }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].name).toBe('Display Only Name');
    expect(res.body.medications[0].generic_name).toBe('Display Only Name');
  });

  it('derives code from atc_code (ATC: prefix) when `code` itself is absent', async () => {
    const app = buildApp(buildDb([{ atc_code: 'y99' }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].code).toBe('ATC:Y99');
  });

  it('derives atc_level_1 from the first character of atc_code when atc_level_1 is absent', async () => {
    const app = buildApp(buildDb([{ code: 'C1', atc_code: 'a10bx06' }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].atc_level_1).toBe('A');
  });

  it('defaults atc_classifications to [atcCode] when atc_classifications is absent but an atc_code exists', async () => {
    const app = buildApp(buildDb([{ code: 'C1', atc_code: 'b02bx04' }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].atc_classifications).toEqual(['B02BX04']);
  });

  it('drops falsy entries when mapping atc_classifications, synonyms, and disease_categories arrays', async () => {
    const app = buildApp(buildDb([{
      code: 'C1',
      atc_classifications: ['a01ad05', null, ''],
      synonyms: ['Real Synonym', null, ''],
      disease_categories: ['Real Category', null, ''],
    }]));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(200);
    expect(res.body.medications[0].atc_classifications).toEqual(['A01AD05']);
    expect(res.body.medications[0].synonyms).toEqual(['Real Synonym']);
    expect(res.body.medications[0].disease_categories).toEqual(['Real Category']);
  });
});
