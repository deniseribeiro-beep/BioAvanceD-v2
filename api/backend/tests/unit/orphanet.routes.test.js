import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function buildApp(db) {
  const router = require('../../src/routes/orphanet');
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/orphanet', router);
  return app;
}

function loadRouteWithEnv(env = {}) {
  process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC || 'false';
  process.env.ORPHADATA_BASE_URL = env.ORPHADATA_BASE_URL || '';
  delete require.cache[require.resolve('../../src/routes/orphanet')];
  return buildApp;
}

describe('orphanet.routes', () => {
  const originalFetch = global.fetch;
  const originalAllowExternal = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
  const originalBaseUrl = process.env.ORPHADATA_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = originalAllowExternal;
    process.env.ORPHADATA_BASE_URL = originalBaseUrl;
    global.fetch = originalFetch;
    delete require.cache[require.resolve('../../src/routes/orphanet')];
  });

  it('busca no banco local e retorna ORPHA, CID-10 e OMIM para fallback offline', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return {
            find: vi.fn(() => cursor([{
              ORPHA: '324',
              OMIM: '301500',
              Codigos_CID10: 'E75.2',
              Descricao: 'Doenca de Fabry',
              aliases: ['Fabry'],
            }])),
          };
        }

        if (name === 'orphanet_diseases') {
          return {
            find: vi.fn(() => cursor([])),
            bulkWrite: vi.fn(),
          };
        }

        if (name === 'terminologies') {
          return { bulkWrite: vi.fn() };
        }

        return { find: vi.fn(() => cursor([])), bulkWrite: vi.fn() };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&lang=pt');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
    });
  });

  it('cacheia resultado externo em orphanet_diseases e terminologies', async () => {
    loadRouteWithEnv({
      ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true',
      ORPHADATA_BASE_URL: 'https://orphadata.test',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          results: [{
            ORPHAcode: '324',
            'Preferred term': 'Fabry disease',
            ExternalReference: [
              { Source: 'ICD-10', Reference: 'E75.2' },
              { Source: 'OMIM', Reference: '301500' },
            ],
            Synonym: [{ label: 'Anderson-Fabry disease' }],
          }],
        },
      }),
    });

    const orphanetBulkWrite = vi.fn().mockResolvedValue({});
    const terminologiesBulkWrite = vi.fn().mockResolvedValue({});

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return { find: vi.fn(() => cursor([])) };
        }

        if (name === 'orphanet_diseases') {
          return {
            find: vi.fn(() => cursor([])),
            bulkWrite: orphanetBulkWrite,
          };
        }

        if (name === 'terminologies') {
          return { bulkWrite: terminologiesBulkWrite };
        }

        return { find: vi.fn(() => cursor([])), bulkWrite: vi.fn() };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&lang=pt');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
    });
    expect(orphanetBulkWrite).toHaveBeenCalledTimes(1);
    expect(terminologiesBulkWrite).toHaveBeenCalledTimes(1);
    expect(orphanetBulkWrite.mock.calls[0][0][0].updateOne.filter).toEqual({ code: '324' });
    expect(terminologiesBulkWrite.mock.calls[0][0][0].updateOne.filter).toEqual({
      sistema: 'ORPHA',
      codigo: 'ORPHA:324',
    });
  });

  it('quando API externa falha, usa fallback local sem retornar erro', async () => {
    loadRouteWithEnv({
      ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true',
      ORPHADATA_BASE_URL: 'https://orphadata.test',
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return {
            find: vi.fn(() => cursor([{
              ORPHA: '324',
              OMIM: '301500',
              Codigos_CID10: 'E75.2',
              Descricao: 'Doenca de Fabry',
            }])),
          };
        }

        return {
          find: vi.fn(() => cursor([])),
          bulkWrite: vi.fn(),
        };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&lang=pt');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
    });
  });
});
