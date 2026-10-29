import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// #1394: the first require of the route's module tree costs over a second, so
// it is paid here, at import time, rather than inside the first case's
// timeout. The three entries loadDictionaryRouter() stubs are cleared again.
require('../../src/routes/dictionary');
delete require.cache[require.resolve('../../src/routes/dictionary')];
delete require.cache[require.resolve('../../src/database/neo4j')];
delete require.cache[require.resolve('redis')];

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function loadDictionaryRouter() {
  const routerPath = require.resolve('../../src/routes/dictionary');
  const neo4jPath = require.resolve('../../src/database/neo4j');
  const redisPath = require.resolve('redis');

  delete require.cache[routerPath];
  delete require.cache[neo4jPath];
  delete require.cache[redisPath];

  require.cache[neo4jPath] = {
    id: neo4jPath,
    filename: neo4jPath,
    loaded: true,
    exports: {
      getNeo4jDriver: vi.fn(() => {
        throw new Error('neo4j unavailable');
      }),
    },
  };

  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: {
      createClient: vi.fn(() => ({
        isOpen: true,
        on: vi.fn(),
        connect: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        setEx: vi.fn().mockResolvedValue('OK'),
      })),
    },
  };

  return require('../../src/routes/dictionary');
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/dictionary', loadDictionaryRouter());
  return app;
}

describe('dictionary suggest fallback', () => {
  afterEach(() => {
    delete require.cache[require.resolve('../../src/routes/dictionary')];
    delete require.cache[require.resolve('../../src/database/neo4j')];
    delete require.cache[require.resolve('redis')];
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The release gate (#885): `concepts` stands in for terminologyConcepts and
  // `releases` for referenceDatasetReleases, both keyed the way
  // activeCodeValidator.checkActiveCode reads them.
  function buildFabryDb({ concepts = [], releases = [] } = {}) {
    return {
      collection: vi.fn((name) => {
        if (name === 'terminologyConcepts') {
          return {
            find: vi.fn(({ systemUri, code }) => cursor(
              concepts.filter((c) => c.systemUri === systemUri && c.code === code)
            )),
          };
        }

        if (name === 'referenceDatasetReleases') {
          return {
            findOne: vi.fn(async ({ referenceDatasetReleaseId }) => (
              releases.find((r) => r.referenceDatasetReleaseId === referenceDatasetReleaseId) || null
            )),
          };
        }

        if (name === 'disease_dictionary') {
          return {
            findOne: vi.fn().mockResolvedValue({
              orpha_code: '324',
              name: 'Doenca de Fabry',
              phenotypes: [{ hpoId: 'HP:0001066', label: 'Angioqueratoma' }],
              active: true,
            }),
          };
        }

        // The filter is ignored on purpose: whatever a lax query could return
        // reaches the route, which must offer only the valid ORPHA:324 row.
        if (name === 'biomarkerAssociations') {
          return { find: vi.fn(() => cursor(ASSOCIATIONS)) };
        }

        if (name === 'terminologies') {
          return {
            find: vi.fn(() => cursor([{
              sistema: 'HPO',
              codigo: 'HP:0012471',
              descricao: 'Acroparestesia',
              relacoes: { orpha: '324', hpo: 'HP:0012471' },
              ativo: true,
            }])),
          };
        }

        return {
          find: vi.fn(() => cursor([])),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };
  }

  const HPO = 'http://purl.obolibrary.org/obo/hp.owl';
  // #1206: each row names its own analyte, since uniqueCodings dedupes on
  // system+code and would hide a bad row that shared the valid one's.
  const fabryAssociation = {
    biomarkerId: 'bm-1',
    analyte: { systemUri: 'http://www.genenames.org', code: 'HGNC:4065', display: 'GLA' },
    associatedCondition: [{ systemUri: 'http://www.orpha.net', code: 'ORPHA:324' }],
    biomarkerRole: 'diagnostic',
    contextOfUse: 'Diagnóstico de Fabry',
    evidenceReferences: [{ system: 'PMID', value: '12345678' }],
  };
  const ASSOCIATIONS = [
    fabryAssociation,
    {
      ...fabryAssociation,
      biomarkerId: 'bm-2',
      analyte: { ...fabryAssociation.analyte, code: 'HGNC:0002' },
      evidenceReferences: [{ system: ['DOI'], value: '10.1000/x' }],
    },
    {
      ...fabryAssociation,
      biomarkerId: 'bm-3',
      analyte: { ...fabryAssociation.analyte, code: 'HGNC:0003' },
      associatedCondition: [{ systemUri: ['http://www.orpha.net'], code: 'ORPHA:324' }],
    },
    {
      ...fabryAssociation,
      biomarkerId: 'bm-4',
      analyte: { ...fabryAssociation.analyte, code: 'HGNC:0004' },
      associatedCondition: [{ systemUri: 'http://www.orpha.net', code: 'ORPHA:355' }],
    },
  ];
  const activeRelease = { referenceDatasetReleaseId: 'hpo-2026-08', releaseStatus: 'active' };
  const retiredRelease = { referenceDatasetReleaseId: 'hpo-2025-01', releaseStatus: 'retired' };

  it('retorna HPO do cache local e só os biomarcadores das BiomarkerAssociation válidas de ORPHA:324 quando Neo4j esta indisponivel (#1206)', async () => {
    const db = buildFabryDb({
      concepts: [
        { systemUri: HPO, code: 'HP:0001066', version: '2026-08-01', referenceDatasetReleaseId: 'hpo-2026-08' },
        { systemUri: HPO, code: 'HP:0012471', version: '2026-08-01', referenceDatasetReleaseId: 'hpo-2026-08' },
      ],
      releases: [activeRelease],
    });

    const response = await request(buildApp(db)).get('/api/dictionary/suggest?orphaCode=324');

    expect(response.status).toBe(200);
    expect(response.body.disease).toMatchObject({ code: '324', display: 'Doenca de Fabry' });
    expect(response.body.phenotypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'HP:0001066', display: 'Angioqueratoma' }),
        expect.objectContaining({ code: 'HP:0012471', display: 'Acroparestesia' }),
      ])
    );
    // Not row 2 (an array evidence system), row 3 (an array condition
    // systemUri) or row 4 (another disease).
    expect(response.body.biomarkers).toEqual([
      { system: 'http://www.genenames.org', code: 'HGNC:4065', display: 'GLA' },
    ]);
  });

  it('offers only phenotypes from an active release, stamps their version, and lists the rest as excluded (#885)', async () => {
    const db = buildFabryDb({
      concepts: [
        // Active: offered, carrying the version the write side would stamp.
        { systemUri: HPO, code: 'HP:0001066', version: '2026-08-01', referenceDatasetReleaseId: 'hpo-2026-08' },
        // Only in a retired release: phenotype-observation.service would skip it.
        { systemUri: HPO, code: 'HP:0012471', version: '2025-01-01', referenceDatasetReleaseId: 'hpo-2025-01' },
      ],
      releases: [activeRelease, retiredRelease],
    });

    const response = await request(buildApp(db)).get('/api/dictionary/suggest?orphaCode=324');

    expect(response.status).toBe(200);
    expect(response.body.phenotypes).toEqual([
      { system: HPO, code: 'HP:0001066', display: 'Angioqueratoma', version: '2026-08-01' },
    ]);
    expect(response.body.releaseGate).toEqual({
      status: 'applied',
      excluded: [
        { system: HPO, code: 'HP:0012471', display: 'Acroparestesia', status: 'inactive_release' },
      ],
    });
    // Biomarkers are analyte Codings from BiomarkerAssociation (#1206), not
    // gated on write: annotated, never dropped.
    expect(response.body.biomarkers.map((b) => b.code)).toEqual(['HGNC:4065']);
    expect(response.body.biomarkers.every((b) => !('version' in b))).toBe(true);
  });

  it('excludes a phenotype with no TerminologyConcept at all as unknown (#885)', async () => {
    const db = buildFabryDb({ concepts: [], releases: [] });

    const response = await request(buildApp(db)).get('/api/dictionary/suggest?orphaCode=324');

    expect(response.status).toBe(200);
    expect(response.body.phenotypes).toEqual([]);
    expect(response.body.releaseGate.excluded.map((e) => [e.code, e.status])).toEqual([
      ['HP:0001066', 'unknown'],
      ['HP:0012471', 'unknown'],
    ]);
  });

  it('answers 500 when the release lookup itself fails, rather than offering ungated codes (#885)', async () => {
    const db = buildFabryDb();
    const base = db.collection.getMockImplementation();
    db.collection.mockImplementation((name) => (
      name === 'terminologyConcepts'
        ? { find: vi.fn(() => ({ toArray: vi.fn().mockRejectedValue(new Error('mongo down')) })) }
        : base(name)
    ));

    const response = await request(buildApp(db)).get('/api/dictionary/suggest?orphaCode=324');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'mongo down' });
  });
});
