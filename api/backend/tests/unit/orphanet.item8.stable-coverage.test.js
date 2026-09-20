import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalAllowExternal = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
const originalBaseUrl = process.env.ORPHADATA_BASE_URL;
const originalFetch = global.fetch;

// Load one instrumented router instance for the whole residual suite. The
// main route suite deliberately reloads the module to test the captured base
// URL under different environments; V8 coverage does not reliably merge all
// of those identical script instances. This file keeps one instance and
// exercises only executable contracts.
process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
process.env.ORPHADATA_BASE_URL = 'https://orphadata.item8.test';
delete require.cache[require.resolve('../../src/routes/orphanet')];
const stableRouter = require('../../src/routes/orphanet');

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function buildApp({ cids = [], orphanet = [] } = {}) {
  const db = {
    collection: vi.fn((name) => {
      if (name === 'cids') {
        return { find: vi.fn(() => cursor(cids)) };
      }
      if (name === 'orphanet_diseases') {
        return { find: vi.fn(() => cursor(orphanet)) };
      }
      return { find: vi.fn(() => cursor([])) };
    }),
  };

  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/orphanet', stableRouter);
  return { app, db };
}

describe('orphanet item 8 stable executable branch coverage', () => {
  beforeEach(() => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = originalAllowExternal;
    process.env.ORPHADATA_BASE_URL = originalBaseUrl;
    global.fetch = originalFetch;
    delete require.cache[require.resolve('../../src/routes/orphanet')];
  });

  it('uses direct CID/OMIM fields and the request defaults on the stable router instance', async () => {
    const { app } = buildApp({
      cids: [{
        _id: 'cid-item8',
        ORPHA: '324',
        Codigos_CID10: 'E75.2',
        OMIM: '301500',
        Descricao: 'Fabry synthetic',
      }],
    });

    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'cid-item8',
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
      lang: 'pt',
    });
  });

  it('uses icdCode, lower-case omim, generated id and explicit lang/limit on a local orphanet document', async () => {
    const { app } = buildApp({
      orphanet: [{
        ORPHA: '777',
        name: 'Synthetic orphanet disease',
        icdCode: 'A77.7',
        omim: '700777',
        lang: 'en',
      }],
    });

    const response = await request(app)
      .get('/api/orphanet/search?q=Synthetic&lang=en&limit=3');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'orpha-777',
      orphaCode: 'ORPHA:777',
      Codigos_CID10: 'A77.7',
      OMIM: 'OMIM:700777',
      lang: 'en',
    });
  });

  it('merges duplicate local records while preserving the previous canonical relationships', async () => {
    const { app } = buildApp({
      cids: [{
        ORPHA: '888',
        Codigos_CID10: 'B88.8',
        OMIM: '800888',
        Descricao: 'Synthetic duplicate',
      }],
      orphanet: [{
        ORPHA: '888',
        name: 'Synthetic duplicate enriched',
        synonyms: ['duplicate synonym'],
      }],
    });

    const response = await request(app).get('/api/orphanet/search?q=888');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      Codigos_CID10: 'B88.8',
      OMIM: 'OMIM:800888',
      relacoes: {
        cid: 'B88.8',
        cid10: 'B88.8',
        omim: 'OMIM:800888',
        orpha: 'ORPHA:888',
      },
    });
    expect(response.body[0].synonyms).toContain('duplicate synonym');
  });

  it('resolves CID/OMIM through ExternalReference on the same stable instrumented module', async () => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          ORPHAcode: '999',
          'Preferred term': 'Remote synthetic disease',
          ExternalReference: [
            { Reference: 'ignored-without-source' },
            { source: 'ICD-10', reference: 'C99.9' },
            { source: 'OMIM', reference: '900999' },
          ],
        }],
      }),
    });
    const { app } = buildApp();

    const response = await request(app)
      .get('/api/orphanet/search?q=Remote&lang=pt&limit=5');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:999',
      Codigos_CID10: 'C99.9',
      OMIM: 'OMIM:900999',
    });
    expect(global.fetch).toHaveBeenCalled();
  });

  it('takes the external-sync disabled branch without consulting fetch', async () => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const { app } = buildApp();

    const response = await request(app)
      .get('/api/orphanet/search?q=NoStableMatch&lang=pt&limit=2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
