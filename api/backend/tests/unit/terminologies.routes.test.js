import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const terminologySyncService = require('../../src/services/terminologySync.service');

function cursor(rows) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function buildDb({
  terminologiesFind = [],
  terminologiesCount = 0,
  cids = [],
  orphanetDiseases = [],
} = {}) {
  const terminologiesBulkWrite = vi.fn().mockResolvedValue({});
  const orphanetBulkWrite = vi.fn().mockResolvedValue({});
  const cidsFind = vi.fn(() => cursor(cids));
  const orphanetFind = vi.fn(() => cursor(orphanetDiseases));
  const terminologiesFindFn = vi.fn(() => cursor(terminologiesFind));
  const terminologiesCountFn = vi.fn().mockResolvedValue(terminologiesCount);

  const db = {
    collection: vi.fn((name) => {
      if (name === 'cids') return { find: cidsFind };
      if (name === 'orphanet_diseases') return { find: orphanetFind, bulkWrite: orphanetBulkWrite };
      if (name === 'terminologies') {
        return {
          find: terminologiesFindFn,
          countDocuments: terminologiesCountFn,
          bulkWrite: terminologiesBulkWrite,
        };
      }
      return { find: vi.fn(() => cursor([])), bulkWrite: vi.fn() };
    }),
  };

  return { db, terminologiesBulkWrite, orphanetBulkWrite, cidsFind, orphanetFind, terminologiesFindFn, terminologiesCountFn };
}

function loadRouter() {
  delete require.cache[require.resolve('../../src/interface/routes/terminologies.routes')];
  return require('../../src/interface/routes/terminologies.routes');
}

function buildApp(db) {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/terminologies', router);
  return app;
}

describe('terminologies.routes', () => {
  const originalFetch = global.fetch;
  const originalAllow = process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
  const originalBaseUrl = process.env.ORPHADATA_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
    process.env.ORPHADATA_BASE_URL = '';
  });

  afterEach(() => {
    process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = originalAllow;
    process.env.ORPHADATA_BASE_URL = originalBaseUrl;
    global.fetch = originalFetch;
  });

  describe('GET /', () => {
    it('retorna 503 quando o banco não está disponível', async () => {
      const app = buildApp(null);
      const response = await request(app).get('/api/terminologies');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
    });

    it('lista terminologias sem filtro de busca', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [{
          _id: 'abc',
          codigo: 'ORPHA:324',
          sistema: 'ORPHA',
          descricao: 'Fabry',
          sincronizadoEm: new Date('2020-01-01'),
        }],
        terminologiesCount: 1,
      });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: 'abc',
        codigo: 'ORPHA:324',
        label: 'Fabry',
        ativo: false,
        sinonimos: [],
        aliases: [],
      });
      expect(response.body.pagination).toEqual({ total: 1, limit: 100 });
      expect(terminologiesFindFn).toHaveBeenCalledWith({});
    });

    it('aplica filtro por sistema e limite customizado, respeitando o teto de 500', async () => {
      const { db, terminologiesFindFn } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?sistema=orpha&limit=9999');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(500);
      expect(terminologiesFindFn).toHaveBeenCalledWith({ sistema: 'ORPHA' });
    });

    it('usa limite mínimo de 1 quando o limit informado é inválido', async () => {
      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?limit=-5');
      expect(response.body.pagination.limit).toBe(1);
    });

    it('monta filtro $or com codeRegex quando a busca tem prefixo ORPHA/OMIM conhecido', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry' }],
        terminologiesCount: 1,
      });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=ORPHA:324');

      expect(response.status).toBe(200);
      const filterArg = terminologiesFindFn.mock.calls[0][0];
      expect(filterArg.$or.some((clause) => clause.codigo && clause.codigo.source)).toBe(true);
      expect(filterArg.$or).toHaveLength(12);
    });

    it('monta filtro $or sem codeRegex quando a busca não tem prefixo conhecido', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry' }],
        terminologiesCount: 1,
      });
      const app = buildApp(db);
      await request(app).get('/api/terminologies?q=Fabry');

      const filterArg = terminologiesFindFn.mock.calls[0][0];
      expect(filterArg.$or).toHaveLength(9);
    });

    it('faz hidratação local quando não há resultados e busca dados de cids', async () => {
      const { db, terminologiesFindFn, terminologiesBulkWrite, cidsFind } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{
          ORPHA: '324',
          OMIM: '301500',
          Codigos_CID10: 'E75.2',
          Descricao: 'Doenca de Fabry',
          aliases: ['Fabry disease'],
        }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Doenca de Fabry',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(cidsFind).toHaveBeenCalled();
      expect(terminologiesBulkWrite).toHaveBeenCalled();
      expect(response.body.data).toHaveLength(1);
    });

    it('hidrata CIDs cujo vínculo ORPHA existe apenas no relacoes.orpha canônico', async () => {
      const { db, terminologiesFindFn, terminologiesBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{
          relacoes: { orpha: '324' },
          Descricao: 'Doença de Fabry sintética',
        }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: 'rel-orpha-1',
          codigo: 'ORPHA:324',
          sistema: 'ORPHA',
          descricao: 'Doença de Fabry sintética',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(terminologiesBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: { sistema: 'ORPHA', codigo: 'ORPHA:324' },
            }),
          }),
        ]),
        { ordered: false }
      );
    });

    it('usa o próprio código ORPHA como descrição quando a redundância orphanet não traz rótulo', async () => {
      const { db, terminologiesFindFn, terminologiesBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [],
        orphanetDiseases: [{ code: '999999' }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: 'orpha-code-only',
          codigo: 'ORPHA:999999',
          sistema: 'ORPHA',
          descricao: 'ORPHA:999999',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=999999');

      expect(response.status).toBe(200);
      const operations = terminologiesBulkWrite.mock.calls[0][0];
      expect(operations[0].updateOne.update.$set).toMatchObject({
        codigo: 'ORPHA:999999',
        descricao: 'ORPHA:999999',
        label: 'ORPHA:999999',
      });
    });

    it('cai para orphanet_diseases quando cids não preenche o limite', async () => {
      const { db, terminologiesFindFn, orphanetFind } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [],
        orphanetDiseases: [{
          code: '324',
          name: 'Fabry disease',
          synonyms: ['Fabry'],
        }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: '2', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(orphanetFind).toHaveBeenCalled();
      expect(response.body.data).toHaveLength(1);
    });

    it('ignora documentos orphanet_diseases sem código resolvível', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [],
        orphanetDiseases: [{ name: 'Sem codigo' }],
      });

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=xyz');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
      expect(terminologiesFindFn).toHaveBeenCalledTimes(1);
    });

    it('não hidrata a partir de redundância local quando o sistema não é ORPHA', async () => {
      const { db, cidsFind, orphanetFind } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry&sistema=OMIM');

      expect(response.status).toBe(200);
      expect(cidsFind).not.toHaveBeenCalled();
      expect(orphanetFind).not.toHaveBeenCalled();
    });

    it('busca remota Orphadata quando local está vazio e sync está habilitado', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            results: [{
              ORPHAcode: '324',
              'Preferred term': 'Fabry disease',
              Synonym: [{ label: 'Fabry' }],
              ExternalReference: [
                { Source: 'ICD-10', Reference: 'E75.2' },
                { Source: 'OMIM', Reference: '301500' },
              ],
            }],
          },
        }),
      });

      const { db, terminologiesFindFn, terminologiesBulkWrite, orphanetBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: '3', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalled();
      expect(terminologiesBulkWrite).toHaveBeenCalled();
      expect(orphanetBulkWrite).toHaveBeenCalled();
      expect(response.body.data).toHaveLength(1);
    });

    it('ignora referência externa sem Source/source antes de resolver referências válidas do Orphadata', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            ORPHAcode: '324',
            'Preferred term': 'Fabry disease',
            ExternalReference: [
              { Reference: 'sem-fonte' },
              { source: 'ICD-10', reference: 'E75.2' },
              { source: 'OMIM', reference: '301500' },
            ],
          }],
        }),
      });

      const { db, terminologiesFindFn, terminologiesBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
      });
      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{
          _id: 'remote-ref-1',
          codigo: 'ORPHA:324',
          sistema: 'ORPHA',
          descricao: 'Fabry disease',
        }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      const operations = terminologiesBulkWrite.mock.calls[0][0];
      expect(operations[0].updateOne.update.$set.relacoes).toMatchObject({
        cid: 'E75.2',
        omim: 'OMIM:301500',
      });
    });

    it('não busca remoto quando ALLOW_EXTERNAL_TERMINOLOGY_SYNC está desabilitado', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'false';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn();

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('não busca remoto quando ORPHADATA_BASE_URL não está configurado', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = '';
      global.fetch = vi.fn();

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      await request(app).get('/api/terminologies?q=Fabry');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('não busca remoto quando não há termo de busca (fallback só ocorre com search)', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn();

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      await request(app).get('/api/terminologies');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('registra falha do Orphadata e continua sem lançar quando fetch rejeita', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('trata timeout de abort como erro de timeout tratado (não propaga)', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('trata resposta HTTP não-ok do Orphadata usando a mensagem de erro do payload', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' }),
      });

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('ignora resultado Orphadata sem ORPHAcode resolvível', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ label: 'no code here' }] }),
      });

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('retorna 500 quando ocorre erro inesperado', async () => {
      const db = {
        collection: vi.fn(() => {
          throw new Error('boom');
        }),
      };
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: 'Erro ao listar terminologias' });
    });
  });

  describe('POST /sync', () => {
    it('retorna 503 quando o banco não está disponível', async () => {
      const app = buildApp(null);
      const response = await request(app).post('/api/terminologies/sync');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ success: false, error: 'Banco de dados não disponível para sincronização' });
    });

    it('sincroniza com sucesso e repassa o resultado do serviço', async () => {
      vi.spyOn(terminologySyncService, 'syncFromOrphadata').mockResolvedValue({ synced: 5 });

      const { db } = buildDb();
      const app = buildApp(db);
      const response = await request(app).post('/api/terminologies/sync');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, synced: 5 });
    });

    it('retorna 500 quando o serviço de sincronização lança erro', async () => {
      vi.spyOn(terminologySyncService, 'syncFromOrphadata').mockRejectedValue(new Error('sync failed'));

      const { db } = buildDb();
      const app = buildApp(db);
      const response = await request(app).post('/api/terminologies/sync');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: 'Erro ao sincronizar terminologias' });
    });
  });

  describe('branch coverage: helper fallback chains via GET /', () => {
    it('normaliza um cid usando os campos alternativos de descricao/aliases/ORPHA minusculo e multiplos codigos', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{
          orpha: '324;325',
          OMIM: '301500,301600',
          cid: 'E75.2',
          nameEn: 'Fabry disease',
          synonyms: ['Angiokeratoma'],
          alternativeNames: ['Anderson-Fabry'],
        }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([
          { _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease' },
          { _id: '2', codigo: 'ORPHA:325', sistema: 'ORPHA', descricao: 'Fabry disease' },
        ]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('usa fallback de descricao/codigo quando o cid não tem nenhum campo de nome/aliases', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{ ORPHA: '900' }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:900', sistema: 'ORPHA', descricao: 'ORPHA:900' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=900');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('não consulta orphanet_diseases quando cids já preenche o limite', async () => {
      const { db, orphanetFind, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{ ORPHA: '324', Descricao: 'Fabry' }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry&limit=1');

      expect(response.status).toBe(200);
      expect(orphanetFind).not.toHaveBeenCalled();
    });

    it('normaliza um doc de orphanet_diseases usando campos alternativos (ORPHAcode, descricao, aliases, relacoes)', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [],
        orphanetDiseases: [{
          ORPHAcode: '324',
          descricao: 'Fabry disease',
          aliases: ['Fabry'],
          relacoes: { cid10: 'E75.2', omim: 'OMIM:301500' },
        }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('resolve rawCode de orphanet_diseases via relacoes.orpha quando os demais campos estão ausentes', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [],
        orphanetDiseases: [{ relacoes: { orpha: '324' }, description: 'Fabry disease' }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('reconhece prefixo OMIM na busca e aplica o codeRegex correspondente', async () => {
      const { db, terminologiesFindFn } = buildDb({
        terminologiesFind: [{ _id: '1', codigo: 'OMIM:301500', sistema: 'OMIM', descricao: 'Fabry' }],
        terminologiesCount: 1,
      });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=OMIM:301500');

      expect(response.status).toBe(200);
      const filterArg = terminologiesFindFn.mock.calls[0][0];
      expect(filterArg.$or).toHaveLength(12);
    });

    it('resolve codigo numerico ORPHA via redundância local com regex delimitado', async () => {
      const { db, terminologiesFindFn, cidsFind } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [{ ORPHA: '324;900', Descricao: 'Fabry' }],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(cidsFind).toHaveBeenCalled();
      const findArg = cidsFind.mock.calls[0][0];
      expect(findArg.$or.some((clause) => clause.ORPHA && clause.ORPHA.source && clause.ORPHA.source.includes('|'))).toBe(true);
    });

    it('extrai referencias externas a partir de externalReferences (objeto único) e usa fallback code/id/value', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            orpha: '324',
            name: 'Fabry disease',
            externalReferences: { source: 'omim', code: '301500' },
          }],
        }),
      });

      const { db, terminologiesFindFn } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('usa fallback de codigo/label/name e ignora Synonym quando não é array em resultados Orphadata', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { codigo: '324', name: 'Fabry disease' } }),
      });

      const { db, terminologiesFindFn } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([{ _id: '1', codigo: 'ORPHA:324', sistema: 'ORPHA', descricao: 'Fabry disease' }]));

      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=324');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('trata payload de erro do Orphadata sem message/error usando o status HTTP', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('retorna array vazio de extractOrphadataResults quando o payload não é objeto nem array', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      const { db } = buildDb({ terminologiesFind: [], terminologiesCount: 0 });
      const app = buildApp(db);
      const response = await request(app).get('/api/terminologies?q=Fabry');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('hydrates local CID redundancy from orphaCode/ORPHAcode and alternate CID description fields', async () => {
      const { db, terminologiesFindFn, terminologiesBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
        cids: [
          { orphaCode: '901', icdCode: 'E90.1', description: 'Synthetic one' },
          { ORPHAcode: '902', Codigo_Tabulacao: 'E90.2', label: 'Synthetic two' },
        ],
      });

      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([
          { _id: '901', codigo: 'ORPHA:901', sistema: 'ORPHA', descricao: 'Synthetic one' },
          { _id: '902', codigo: 'ORPHA:902', sistema: 'ORPHA', descricao: 'Synthetic two' },
        ]));

      const response = await request(buildApp(db)).get('/api/terminologies?q=Synthetic');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      const operations = terminologiesBulkWrite.mock.calls[0][0];
      expect(operations.map((operation) => operation.updateOne.filter.codigo))
        .toEqual(expect.arrayContaining(['ORPHA:901', 'ORPHA:902']));
      expect(operations.map((operation) => operation.updateOne.update.$set.relacoes.cid))
        .toEqual(expect.arrayContaining(['E90.1', 'E90.2']));
    });

    it('normalizes all supported Orphadata synonym/reference aliases before redundant ORPHA upsert', async () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      process.env.ORPHADATA_BASE_URL = 'https://orphadata.test';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            ORPHAcode: '903',
            preferredTerm: 'Synthetic remote terminology',
            Synonym: [
              { Label: 'Upper-label synonym' },
              { _: 'Underscore synonym' },
              'Raw synonym',
            ],
            externalReferences: [
              { source: 'ICD-10', reference: 'E90.3' },
              { source: 'OMIM', id: '100903' },
            ],
          }],
        }),
      });

      const { db, terminologiesFindFn, orphanetBulkWrite } = buildDb({
        terminologiesFind: [],
        terminologiesCount: 0,
      });
      terminologiesFindFn
        .mockImplementationOnce(() => cursor([]))
        .mockImplementationOnce(() => cursor([
          { _id: '903', codigo: 'ORPHA:903', sistema: 'ORPHA', descricao: 'Synthetic remote terminology' },
        ]));

      const response = await request(buildApp(db)).get('/api/terminologies?q=remote');

      expect(response.status).toBe(200);
      expect(orphanetBulkWrite).toHaveBeenCalledTimes(1);
      const persisted = orphanetBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(persisted).toMatchObject({
        code: '903',
        Codigos_CID10: 'E90.3',
        OMIM: 'OMIM:100903',
        source: 'orphadata-live',
      });
      expect(persisted.aliases).toEqual(expect.arrayContaining([
        'Upper-label synonym',
        'Underscore synonym',
        'Raw synonym',
      ]));
    });
  });
});
