import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

function cursor(rows = []) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function buildApp(router, db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/terminologies', router);
  return app;
}

function loadRouter() {
  const path = require.resolve('../../src/interface/routes/terminologies.routes');
  delete require.cache[path];
  return require(path);
}

function sequentialTerminologiesCollection({ first = [], second = [], firstCount = 0, secondCount = 0 } = {}) {
  let findCalls = 0;
  let countCalls = 0;
  const bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

  return {
    collection: {
      find: vi.fn(() => {
        findCalls += 1;
        return cursor(findCalls === 1 ? first : second);
      }),
      countDocuments: vi.fn(async () => {
        countCalls += 1;
        return countCalls === 1 ? firstCount : secondCount;
      }),
      bulkWrite,
    },
    bulkWrite,
  };
}

describe('terminologies.routes.js item 8 residual compatibility branches', () => {
  const originalAllow = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
  const originalBaseUrl = process.env.ORPHADATA_BASE_URL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
    process.env.ORPHADATA_BASE_URL = '';
    global.fetch = originalFetch;
  });

  afterEach(() => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = originalAllow;
    process.env.ORPHADATA_BASE_URL = originalBaseUrl;
    global.fetch = originalFetch;
    delete require.cache[require.resolve('../../src/interface/routes/terminologies.routes')];
  });

  it('accepts the search alias and treats limit=0 as the documented default limit', async () => {
    const term = {
      _id: 'term-1',
      codigo: 'ORPHA:777',
      sistema: 'ORPHA',
      descricao: 'Rare disease',
      label: 'Rare disease label',
      lang: 'pt',
      sinonimos: ['alias-a'],
      aliases: ['alias-b'],
      relacoes: { cid: 'Q00.1' },
      ativo: true,
    };
    const find = vi.fn(() => cursor([term]));
    const db = {
      collection(name) {
        expect(name).toBe('terminologies');
        return {
          find,
          countDocuments: vi.fn().mockResolvedValue(1),
        };
      },
    };

    const response = await request(buildApp(loadRouter(), db))
      .get('/api/terminologies?search=ORPHA%3A777&limit=0');

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ total: 1, limit: 100 });
    expect(response.body.data[0]).toMatchObject({
      codigo: 'ORPHA:777',
      label: 'Rare disease label',
      lang: 'pt',
      sinonimos: ['alias-a'],
      aliases: ['alias-b'],
      relacoes: { cid: 'Q00.1' },
      ativo: true,
    });

    const filter = find.mock.calls[0][0];
    expect(filter.$or).toHaveLength(12);
  });

  it('hydrates CID redundancy through Codigo_Tabulacao/namePt and preserves active=false across split ORPHA codes', async () => {
    const stored = [
      { _id: 't-777', codigo: 'ORPHA:777', sistema: 'ORPHA', descricao: 'Doença rara PT', ativo: false },
      { _id: 't-778', codigo: 'ORPHA:778', sistema: 'ORPHA', descricao: 'Doença rara PT', ativo: false },
    ];
    const terminology = sequentialTerminologiesCollection({
      first: [],
      second: stored,
      firstCount: 0,
      secondCount: 2,
    });
    const cidsFind = vi.fn(() => cursor([{
      ORPHA: '777|778',
      Codigo_Tabulacao: 'Q77.7',
      namePt: 'Doença rara PT',
      alternativeNames: ['Nome alternativo'],
      active: false,
    }]));
    const orphanetFind = vi.fn(() => cursor([]));

    const db = {
      collection(name) {
        if (name === 'terminologies') return terminology.collection;
        if (name === 'cids') return { find: cidsFind };
        if (name === 'orphanet_diseases') return { find: orphanetFind, bulkWrite: vi.fn() };
        throw new Error(`unexpected collection: ${name}`);
      },
    };

    const response = await request(buildApp(loadRouter(), db))
      .get('/api/terminologies?q=ORPHA%3A777');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(terminology.bulkWrite).toHaveBeenCalledTimes(1);

    const operations = terminology.bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.updateOne.filter.codigo)).toEqual(['ORPHA:777', 'ORPHA:778']);
    expect(operations[0].updateOne.update.$set).toMatchObject({
      descricao: 'Doença rara PT',
      aliases: ['Nome alternativo'],
      relacoes: {
        cid: 'Q77.7',
        orpha: 'ORPHA:777',
      },
      ativo: false,
    });
  });

  it('hydrates orphanet_diseases through orphaCode/description/icdCode/omimCode aliases', async () => {
    const stored = [{
      _id: 't-999',
      codigo: 'ORPHA:999',
      sistema: 'ORPHA',
      descricao: 'Alias-only disease',
      ativo: true,
    }];
    const terminology = sequentialTerminologiesCollection({
      first: [],
      second: stored,
      firstCount: 0,
      secondCount: 1,
    });

    const db = {
      collection(name) {
        if (name === 'terminologies') return terminology.collection;
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === 'orphanet_diseases') {
          return {
            find: vi.fn(() => cursor([{
              orphaCode: '999',
              description: 'Alias-only disease',
              synonyms: ['Alias 999'],
              icdCode: 'Q99.9',
              omimCode: '999001',
            }])),
            bulkWrite: vi.fn(),
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    };

    const response = await request(buildApp(loadRouter(), db))
      .get('/api/terminologies?q=Alias-only');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    const operation = terminology.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({ sistema: 'ORPHA', codigo: 'ORPHA:999' });
    expect(operation.update.$set).toMatchObject({
      descricao: 'Alias-only disease',
      aliases: ['Alias 999'],
      relacoes: {
        cid: 'Q99.9',
        cid10: 'Q99.9',
        omim: 'OMIM:999001',
        orpha: 'ORPHA:999',
      },
    });
  });

  it('normalizes a single-object external reference from the live Orphadata fallback', async () => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
    process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

    const stored = [{
      _id: 't-live',
      codigo: 'ORPHA:166',
      sistema: 'ORPHA',
      descricao: 'Remote disease',
      relacoes: { omim: 'OMIM:123456' },
      ativo: true,
    }];
    const terminology = sequentialTerminologiesCollection({
      first: [],
      second: stored,
      firstCount: 0,
      secondCount: 1,
    });
    const orphanetBulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: {
          ORPHAcode: '166',
          preferredTerm: 'Remote disease',
          ExternalReference: {
            source: 'OMIM',
            reference: '123456',
          },
          Synonym: 'not-an-array',
        },
      }),
    });

    const db = {
      collection(name) {
        if (name === 'terminologies') return terminology.collection;
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === 'orphanet_diseases') {
          return {
            find: vi.fn(() => cursor([])),
            bulkWrite: orphanetBulkWrite,
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    };

    const response = await request(buildApp(loadRouter(), db))
      .get('/api/terminologies?q=remote-disease');

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(terminology.bulkWrite).toHaveBeenCalledTimes(1);
    expect(orphanetBulkWrite).toHaveBeenCalledTimes(1);

    const terminologyRecord = terminology.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(terminologyRecord).toMatchObject({
      sistema: 'ORPHA',
      codigo: 'ORPHA:166',
      descricao: 'Remote disease',
      sinonimos: [],
      aliases: [],
      relacoes: {
        cid: '',
        cid10: '',
        omim: 'OMIM:123456',
        orpha: 'ORPHA:166',
      },
    });
  });
});
