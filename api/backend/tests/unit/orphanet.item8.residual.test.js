import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function loadApp(db, env = {}) {
  process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC ?? 'false';
  process.env.ORPHADATA_BASE_URL = env.ORPHADATA_BASE_URL ?? '';
  const routePath = require.resolve('../../src/routes/orphanet');
  delete require.cache[routePath];
  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/orphanet', router);
  return app;
}

describe('orphanet item 8 residual normalization branches', () => {
  const originalFetch = global.fetch;
  const originalAllowExternal = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
  const originalBaseUrl = process.env.ORPHADATA_BASE_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAllowExternal === undefined) delete process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
    else process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = originalAllowExternal;
    if (originalBaseUrl === undefined) delete process.env.ORPHADATA_BASE_URL;
    else process.env.ORPHADATA_BASE_URL = originalBaseUrl;
    delete require.cache[require.resolve('../../src/routes/orphanet')];
    vi.restoreAllMocks();
  });

  it('normalizes active local ORPHA aliases, relation fields, language and source fallbacks', async () => {
    const records = [
      {
        id: 'local-111',
        orpha: '111',
        namePt: 'Doenca sintetica PT',
        cid10: 'A11.1',
        omimCode: '100111',
        language: 'EN',
        source: 'synthetic-seed',
      },
      {
        _id: 'local-222',
        code: '222',
        nameEn: 'Synthetic disease EN',
        cid: 'B22.2',
        OMIM: 'OMIM:100222',
        lang: 'es',
      },
      {
        codigo: '333',
        nameEs: 'Enfermedad sintetica ES',
        relacoes: {
          orpha: '333',
          cid10: 'C33.3',
          omim: '100333',
        },
      },
    ];

    const orphanetFind = vi.fn((filter) => {
      expect(filter.lang).toEqual({ $in: ['pt', '', null] });
      return cursor(records);
    });
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === 'orphanet_diseases') return { find: orphanetFind };
        throw new Error(`unexpected collection: ${name}`);
      }),
    };

    const response = await request(loadApp(db))
      .get('/api/orphanet/search?q=synthetic&lang=pt');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local-111',
        code: '111',
        orphaCode: 'ORPHA:111',
        name: 'Doenca sintetica PT',
        Codigos_CID10: 'A11.1',
        OMIM: 'OMIM:100111',
        lang: 'en',
        source: 'synthetic-seed',
      }),
      expect.objectContaining({
        id: 'local-222',
        code: '222',
        orphaCode: 'ORPHA:222',
        name: 'Synthetic disease EN',
        Codigos_CID10: 'B22.2',
        OMIM: 'OMIM:100222',
        lang: 'es',
        source: 'local-orphanet',
      }),
      expect.objectContaining({
        id: 'orpha-333',
        code: '333',
        orphaCode: 'ORPHA:333',
        name: 'Enfermedad sintetica ES',
        Codigos_CID10: 'C33.3',
        OMIM: 'OMIM:100333',
        lang: 'pt',
        source: 'local-orphanet',
      }),
    ]));
  });

  it('normalizes externalReferences aliases and code/id reference payloads from Orphadata', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          orphaCode: '444',
          label: 'Synthetic remote disease',
          externalReferences: [
            { source: 'ICD-10', code: 'D44.4' },
            { source: 'OMIM', id: '100444' },
          ],
          aliases: ['Remote alias'],
        }],
      }),
    });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids' || name === 'orphanet_diseases') {
          return { find: vi.fn(() => cursor([])) };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    };

    const response = await request(loadApp(db, {
      ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true',
      ORPHADATA_BASE_URL: 'https://orphadata.example.invalid/',
    }))
      .get('/api/orphanet/search?q=remote');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      code: '444',
      orphaCode: 'ORPHA:444',
      name: 'Synthetic remote disease',
      Codigos_CID10: 'D44.4',
      OMIM: 'OMIM:100444',
      aliases: expect.arrayContaining(['Remote alias']),
      source: 'orphadata-live',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://orphadata.example.invalid/rd-cross-referencing/orphacodes/names/remote',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.anything(),
      })
    );
  });

  it('normalizes singular externalReference and value fallback without inventing missing CID data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          ORPHA: '555',
          description: 'Synthetic singular reference',
          externalReference: {
            Source: 'OMIM',
            value: '100555',
          },
        },
      }),
    });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids' || name === 'orphanet_diseases') {
          return { find: vi.fn(() => cursor([])) };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    };

    const response = await request(loadApp(db, {
      ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true',
      ORPHADATA_BASE_URL: 'https://orphadata.example.invalid',
    }))
      .get('/api/orphanet/search?q=singular');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      code: '555',
      name: 'Synthetic singular reference',
      Codigos_CID10: '',
      OMIM: 'OMIM:100555',
    });
  });

  it('covers canonical local aliases and duplicate-record enrichment without losing existing values', async () => {
    const records = [
      {
        id: 'base-777',
        ORPHA: '777',
        Codigos_CID10: '',
        OMIM: '',
        name: 'Synthetic duplicate base',
        synonyms: ['base synonym'],
      },
      {
        id: 'enriched-777',
        ORPHAcode: '777',
        ICD_10: 'E77.7',
        omim: '100777',
        label: 'Synthetic duplicate enriched',
        aliases: ['enriched alias'],
      },
      {
        id: 'icd-888',
        ORPHA: '888',
        ICD10: 'E88.8',
        OMIM: 'OMIM:100888',
        preferredTerm: 'Synthetic ICD alias',
      },
    ];

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === 'orphanet_diseases') return { find: vi.fn(() => cursor(records)) };
        throw new Error(`unexpected collection: ${name}`);
      }),
    };

    const response = await request(loadApp(db))
      .get('/api/orphanet/search?q=synthetic&lang=pt');

    expect(response.status).toBe(200);
    const merged = response.body.find((item) => item.code === '777');
    expect(merged).toMatchObject({
      code: '777',
      Codigos_CID10: 'E77.7',
      OMIM: 'OMIM:100777',
    });
    expect(merged.synonyms).toEqual(expect.arrayContaining(['base synonym', 'enriched alias']));

    expect(response.body.find((item) => item.code === '888')).toMatchObject({
      Codigos_CID10: 'E88.8',
      OMIM: 'OMIM:100888',
    });
  });

  it('returns an empty local result when external terminology sync is disabled', async () => {
    global.fetch = vi.fn();
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids' || name === 'orphanet_diseases') {
          return { find: vi.fn(() => cursor([])) };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    };

    const response = await request(loadApp(db, {
      ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false',
      ORPHADATA_BASE_URL: 'https://orphadata.example.invalid',
    }))
      .get('/api/orphanet/search?q=no-match');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('applies the default language and clamps explicit search limits', async () => {
    const seenFilters = [];
    const seenLimits = [];
    const db = {
      collection: vi.fn((name) => ({
        find: vi.fn((filter) => {
          seenFilters.push({ name, filter });
          return {
            limit(value) {
              seenLimits.push(value);
              return this;
            },
            toArray: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
    };

    let response = await request(loadApp(db)).get('/api/orphanet/search?q=none&limit=100');
    expect(response.status).toBe(200);
    expect(seenLimits).toContain(50);
    expect(seenFilters.find((entry) => entry.name === 'orphanet_diseases')?.filter.lang)
      .toEqual({ $in: ['pt', '', null] });

    seenLimits.length = 0;
    response = await request(loadApp(db)).get('/api/orphanet/search?q=none&limit=-5');
    expect(response.status).toBe(200);
    expect(seenLimits).toContain(1);
  });

});
