import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// orphanet.js takes `authenticate` when it is required (#1553): every case
// loads it signed in, but the 401 one, which restores the real gate first.
const authModule = require('../../src/infrastructure/middleware/auth');
const realAuthenticate = authModule.authenticate;
const signedIn = (req, res, next) => {
  req.user = { id: 'user-1' };
  next();
};
authModule.authenticate = signedIn;

const COLLECTION_NAME = 'orphanet_diseases';

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

describe('orphanet.routes authentication (#1553)', () => {
  it('answers 401 to GET /search with no token', async () => {
    const routerPath = require.resolve('../../src/routes/orphanet');
    authModule.authenticate = realAuthenticate;
    delete require.cache[routerPath];
    try {
      // No database: a request that reached the handler would answer 503.
      const app = buildApp(undefined);
      const res = await request(app).get('/api/orphanet/search?q=Fabry');
      expect(res.status).toBe(401);
    } finally {
      authModule.authenticate = signedIn;
      delete require.cache[routerPath];
    }
  });
});

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

  it('não escreve no banco ao retornar resultado externo em orphanet', async () => {
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
    expect(orphanetBulkWrite).not.toHaveBeenCalled();
    expect(terminologiesBulkWrite).not.toHaveBeenCalled();
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

  it('retorna 400 quando o parametro q esta ausente', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const app = buildApp({ collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) });

    const response = await request(app).get('/api/orphanet/search');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing query' });
  });

  it('retorna 503 quando app.locals.db esta indefinido', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const app = buildApp(undefined);

    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Database unavailable' });
  });

  it('retorna 503 quando db.collection nao e uma funcao', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const app = buildApp({ collection: 'not-a-function' });

    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Database unavailable' });
  });

  it('limita o parametro limit ao maximo de 50 e passa isso para as queries', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const cidsCursor = cursor([]);
    const orphanetCursor = cursor([]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cidsCursor) };
        return { find: vi.fn(() => orphanetCursor) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&limit=99999');

    expect(response.status).toBe(200);
    expect(cidsCursor.limit).toHaveBeenCalledWith(50);
    expect(orphanetCursor.limit).toHaveBeenCalledWith(50);
  });

  it('usa limit padrao de 20 quando o parametro limit nao e numerico', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const cidsCursor = cursor([]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cidsCursor) };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&limit=not-a-number');

    expect(response.status).toBe(200);
    expect(cidsCursor.limit).toHaveBeenCalledWith(20);
  });

  it('impoe limit minimo de 1 quando o parametro limit e zero ou negativo', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });
    const cidsCursor = cursor([]);
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cidsCursor) };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&limit=-5');

    expect(response.status).toBe(200);
    expect(cidsCursor.limit).toHaveBeenCalledWith(1);
  });

  it('amplia a busca sem filtro de idioma quando nenhum resultado bate com o lang solicitado', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    let orphanetCallCount = 0;
    const orphanetFind = vi.fn(() => {
      orphanetCallCount += 1;
      if (orphanetCallCount === 1) return cursor([]);
      return cursor([{
        ORPHA: '324',
        name: 'Fabry disease',
        lang: 'en',
      }]);
    });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) return { find: orphanetFind };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&lang=fr');

    expect(response.status).toBe(200);
    expect(orphanetFind).toHaveBeenCalledTimes(2);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].orphaCode).toBe('ORPHA:324');
  });

  it('trata lang apenas espacos em branco como ausente, aplicando o filtro default pt (issue #231)', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const orphanetFind = vi.fn(() => cursor([{ ORPHA: '324', name: 'Fabry disease', lang: 'pt' }]));
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) return { find: orphanetFind };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry&lang=%20');

    expect(response.status).toBe(200);
    expect(orphanetFind).toHaveBeenCalledTimes(1);
    const calledFilter = orphanetFind.mock.calls[0][0];
    expect(calledFilter.lang).toEqual({ $in: ['pt', '', null] });
  });

  it('retorna lista vazia quando nao ha resultados locais nem externos', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=NoMatchTerm');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('adiciona o filtro numerico de ORPHA no $or quando a busca e puramente numerica', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const cidsFind = vi.fn(() => cursor([]));
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: cidsFind };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=324');

    expect(response.status).toBe(200);
    const filter = cidsFind.mock.calls[0][0];
    // Base $or has 19 entries; a purely-numeric search adds exactly 1 more
    // (the numericOrpha boundary regex), since stripKnownCodePrefix is a no-op here.
    expect(filter.$or).toHaveLength(20);
  });

  it('adiciona filtros extras de codigo no $or quando a busca tem prefixo ORPHA/OMIM conhecido', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const cidsFind = vi.fn(() => cursor([]));
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: cidsFind };
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=ORPHA:324');

    expect(response.status).toBe(200);
    const filter = cidsFind.mock.calls[0][0];
    // Base 19 + 4 (codeRegex clauses, since stripped "324" !== "ORPHA:324") + 1 (numericOrpha) = 24
    expect(filter.$or).toHaveLength(24);
  });

  it('funde registros duplicados preservando CID e OMIM do registro anterior quando o novo os omite', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return { find: vi.fn(() => cursor([{ ORPHA: '324', Codigos_CID10: 'E75.2', Descricao: 'Fabry' }])) };
        }
        if (name === COLLECTION_NAME) {
          return { find: vi.fn(() => cursor([{ ORPHA: '324', OMIM: '301500', name: 'Fabry disease' }])) };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
    });
  });

  it('nao consulta a API externa quando ORPHADATA_BASE_URL nao esta configurada, mesmo com sync habilitado', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: '' });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignora resultado remoto quando a API externa responde com status de erro', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'internal error' }),
    });

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('trata timeout (AbortError) da API externa sem propagar erro ao cliente', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('consulta duas URLs externas (codigo e nome) quando a busca e um ORPHA numerico', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    global.fetch = fetchMock;

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=324');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/rd-cross-referencing/orphacodes/324');
  });

  it('interpreta payload externo como objeto unico quando a API retorna dados sem envelope de lista', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ORPHAcode: '324',
        'Preferred term': 'Fabry disease',
      }),
    });

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].orphaCode).toBe('ORPHA:324');
  });

  it('trata Source/source ausentes em ExternalReference retornando string vazia para CID/OMIM via pickReference', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          ORPHAcode: '324',
          'Preferred term': 'Fabry disease',
          ExternalReference: [{ Reference: 'no-source-here' }],
        }],
      }),
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].Codigos_CID10).toBe('');
    expect(response.body[0].OMIM).toBe('');
  });

  it('usa payload.error quando a resposta externa nao-ok nao possui message', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });
    const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'bad gateway upstream' }),
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad gateway upstream'));
    warnSpy.mockRestore();
  });

  it('usa o fallback HTTP <status> quando a resposta externa nao-ok nao possui message nem error', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });
    const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    warnSpy.mockRestore();
  });

  it('trata payload externo nulo/nao-objeto retornando lista vazia em extractOrphadataResults', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('nao consulta a API externa quando o sync esta desabilitado, mesmo com ORPHADATA_BASE_URL configurada', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const db = {
      collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retorna 500 quando a busca local falha inicialmente e o fallback local tambem falha', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return {
            find: vi.fn(() => {
              throw new Error('cids query failed');
            }),
          };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to search orphanet diseases' });
  });

  it('descarta documentos do orphanet sem nenhum campo de codigo ORPHA reconhecivel', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return { find: vi.fn(() => cursor([{ name: 'Sem codigo orpha' }])) };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    // Fixed (issue #259): a doc with no ORPHA-derivable code normalizes to
    // `null` in searchLocal's map; dedupeRecords now guards against `null`
    // entries instead of re-normalizing them, so the doc is silently
    // excluded and the request still succeeds.
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('resolve sinonimos a partir de Label, campo _ ou string simples quando label esta ausente', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return {
            find: vi.fn(() => cursor([{
              ORPHA: '324',
              name: 'Fabry disease',
              Synonym: [{ Label: 'Anderson-Fabry' }, { _: 'Fabry alt' }, 'Plain synonym'],
            }])),
          };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].synonyms).toEqual(
      expect.arrayContaining(['Anderson-Fabry', 'Fabry alt', 'Plain synonym'])
    );
  });

  it('usa preferredTerm (camelCase) e por fim o proprio ORPHA como nome quando nenhum outro campo de nome existe', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return { find: vi.fn(() => cursor([{ ORPHA: '324', preferredTerm: 'Fabry via preferredTerm' }])) };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].name).toBe('Fabry via preferredTerm');
  });

  it('usa o proprio codigo ORPHA como nome quando nenhum campo de nome ou termo preferido existe', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return { find: vi.fn(() => cursor([{ ORPHA: '324' }])) };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].name).toBe('ORPHA:324');
  });

  it('funde registros preservando CID10/OMIM/relacoes/sinonimos do segundo registro quando o primeiro os omite', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return { find: vi.fn(() => cursor([{ ORPHA: '324', name: 'Fabry disease' }])) };
        }
        if (name === COLLECTION_NAME) {
          return {
            find: vi.fn(() => cursor([{
              ORPHA: '324',
              Codigos_CID10: 'E75.2',
              OMIM: '301500',
              synonyms: ['Fabry alt'],
              aliases: ['Fabry alias'],
            }])),
          };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      orphaCode: 'ORPHA:324',
      Codigos_CID10: 'E75.2',
      OMIM: 'OMIM:301500',
    });
    expect(response.body[0].synonyms).toEqual(expect.arrayContaining(['Fabry alt']));
    expect(response.body[0].aliases).toEqual(expect.arrayContaining(['Fabry alias']));
  });

  it('recupera via fallback local quando a primeira tentativa de busca local lanca erro', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    let cidsCallCount = 0;
    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') {
          return {
            find: vi.fn(() => {
              cidsCallCount += 1;
              if (cidsCallCount === 1) {
                throw new Error('transient failure');
              }
              return cursor([{ ORPHA: '324', Codigos_CID10: 'E75.2', Descricao: 'Fabry' }]);
            }),
          };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].orphaCode).toBe('ORPHA:324');
  });

  it('trata ExternalReference como objeto unico (nao-array) ao extrair CID/OMIM', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          ORPHAcode: '324',
          'Preferred term': 'Fabry disease',
          ExternalReference: { Source: 'ICD-10', Reference: 'E75.2' },
        }],
      }),
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].Codigos_CID10).toBe('E75.2');
  });

  it('resolve Source/Reference de ExternalReference a partir dos campos em minusculas', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'true', ORPHADATA_BASE_URL: 'https://orphadata.test' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          ORPHAcode: '324',
          'Preferred term': 'Fabry disease',
          ExternalReference: [
            { source: 'ICD-10', reference: 'E75.2' },
            { source: 'OMIM', reference: '301500' },
          ],
        }],
      }),
    });

    const db = { collection: vi.fn(() => ({ find: vi.fn(() => cursor([])) })) };
    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].Codigos_CID10).toBe('E75.2');
    expect(response.body[0].OMIM).toBe('OMIM:301500');
  });

  it('usa icdCode e relacoes.omim como fallback quando os campos primarios de CID/OMIM estao ausentes', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return {
            find: vi.fn(() => cursor([{
              ORPHA: '324',
              name: 'Fabry disease',
              icdCode: 'E75.2',
              relacoes: { omim: '301500' },
            }])),
          };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].Codigos_CID10).toBe('E75.2');
    expect(response.body[0].OMIM).toBe('OMIM:301500');
  });

  it('gera o id a partir do codigo ORPHA quando o documento nao possui _id nem id', async () => {
    loadRouteWithEnv({ ALLOW_EXTERNAL_TERMINOLOGY_SYNC: 'false' });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'cids') return { find: vi.fn(() => cursor([])) };
        if (name === COLLECTION_NAME) {
          return { find: vi.fn(() => cursor([{ ORPHA: '324', name: 'Fabry disease' }])) };
        }
        return { find: vi.fn(() => cursor([])) };
      }),
    };

    const app = buildApp(db);
    const response = await request(app).get('/api/orphanet/search?q=Fabry');

    expect(response.status).toBe(200);
    expect(response.body[0].id).toBe('orpha-324');
  });
});
