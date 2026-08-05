import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { createCollectionMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

const TOKEN_USER_ID = 'audit-user-1';

// #426: requireAuditReader now resolves admin status via
// UserRoleAssignment -> Role for TOKEN_USER_ID, not req.user.accessType --
// merge in an active `administrator` assignment when the scenario needs one.
function dbWithRbac({ accessType, collections = {} } = {}) {
  const rbac = buildRbacCollections(accessType == null ? [] : [{ userAccountId: TOKEN_USER_ID, accessType }]);
  return {
    collection: (name) => collections[name] || rbac[name] || createCollectionMock(),
  };
}

const modulePaths = {
  auth: require.resolve('../../src/infrastructure/middleware/auth'),
  logService: require.resolve('../../src/services/log.service'),
  controller: require.resolve('../../src/interface/routes/logs.routes'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

describe('logs.routes.js', () => {
  let currentUser;
  let logServiceMock;

  const authenticate = (req, _res, next) => {
    req.user = currentUser;
    next();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { userID: TOKEN_USER_ID, accessType: 4 };
    logServiceMock = {
      getLogs: vi.fn(async () => ({ logs: [], total: 0 })),
      createLog: vi.fn(async (_db, body) => ({ ...body, _id: 'new-log' })),
    };

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    setCachedModule(modulePaths.auth, { authenticate });
    setCachedModule(modulePaths.logService, logServiceMock);
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
    const logsRouter = require(modulePaths.controller);
    testApp.use('/api/logs', logsRouter);
    return testApp;
  }

  function appWithThrowingCollection() {
    const rbac = dbWithRbac({ accessType: 4 });
    const db = {
      collection(name) {
        if (name === 'roles' || name === 'permissions' || name === 'userRoleAssignments') {
          return rbac.collection(name);
        }
        return {
          async findOne() {
            throw new Error('findOne blew up');
          },
        };
      },
    };
    return appWithDb(db);
  }

  describe('requireAuditReader', () => {
    it('permite acesso para usuário com role administrator ativa', async () => {
      currentUser = { userID: TOKEN_USER_ID, accessType: 4 };
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs');
      expect(response.status).toBe(200);
    });

    // #426: roleName no JWT deixou de ser fonte de verdade para o gate de
    // admin -- sem uma assignment RBAC ativa, "Admin" no token não basta.
    it('nega acesso quando roleName do JWT diz "Admin" mas não há assignment administrator ativa', async () => {
      currentUser = { userID: TOKEN_USER_ID, accessType: 1, roleName: 'Admin' };
      const response = await request(appWithDb(dbWithRbac({ accessType: 1 }))).get('/api/logs');
      expect(response.status).toBe(403);
    });

    it('nega acesso quando roleName do JWT diz "Administradór" mas não há assignment administrator ativa', async () => {
      currentUser = { userID: TOKEN_USER_ID, accessType: 1, roleName: 'Administradór' };
      const response = await request(appWithDb(dbWithRbac({ accessType: 1 }))).get('/api/logs');
      expect(response.status).toBe(403);
    });

    it('permite acesso via role contendo auditor (sem role dedicada no catálogo RBAC ainda)', async () => {
      currentUser = { userID: TOKEN_USER_ID, accessType: 1, role: 'Auditor Sênior' };
      const response = await request(appWithDb(dbWithRbac({ accessType: 1 }))).get('/api/logs');
      expect(response.status).toBe(200);
    });

    it('nega acesso para perfil sem permissão', async () => {
      currentUser = { userID: TOKEN_USER_ID, accessType: 1, roleName: 'tecnico' };
      const response = await request(appWithDb(dbWithRbac({ accessType: 1 }))).get('/api/logs');
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        error: 'Acesso negado',
        message: 'Apenas perfis Admin ou Auditor podem acessar trilhas de auditoria.',
      });
    });

    it('nega acesso quando req.user está ausente', async () => {
      currentUser = undefined;
      const response = await request(appWithDb(dbWithRbac({}))).get('/api/logs');
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/logs', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).get('/api/logs');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
    });

    it('retorna 200 com os logs', async () => {
      logServiceMock.getLogs.mockResolvedValueOnce({ logs: [{ action: 'login' }], total: 1 });
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs?page=2');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { logs: [{ action: 'login' }], total: 1 } });
      expect(logServiceMock.getLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ page: '2' }));
    });

    it('retorna 500 quando o serviço falha', async () => {
      logServiceMock.getLogs.mockRejectedValueOnce(new Error('boom'));
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: 'Erro ao buscar logs', message: 'boom' });
    });
  });

  describe('GET /api/logs/all', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).get('/api/logs/all');
      expect(response.status).toBe(503);
    });

    it('retorna 200 aplicando limite padrão de 5000 e page 1', async () => {
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/all');
      expect(response.status).toBe(200);
      expect(logServiceMock.getLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 5000, page: 1 }));
    });

    it('respeita limite explícito da query', async () => {
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/all?limit=10');
      expect(response.status).toBe(200);
      expect(logServiceMock.getLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: '10', page: 1 }));
    });

    it('retorna 500 quando o serviço falha', async () => {
      logServiceMock.getLogs.mockRejectedValueOnce(new Error('boom-all'));
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/all');
      expect(response.status).toBe(500);
      expect(response.body.message).toBe('boom-all');
    });
  });

  describe('POST /api/logs/query', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).post('/api/logs/query').send({ action: 'x' });
      expect(response.status).toBe(503);
    });

    it('retorna 200 usando o corpo como filtros', async () => {
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).post('/api/logs/query').send({ action: 'login' });
      expect(response.status).toBe(200);
      expect(logServiceMock.getLogs).toHaveBeenCalledWith(expect.anything(), { action: 'login' });
    });

    it('retorna 500 quando o serviço falha', async () => {
      logServiceMock.getLogs.mockRejectedValueOnce(new Error('boom-query'));
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).post('/api/logs/query').send({});
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao consultar logs');
    });
  });

  describe('POST /api/logs/register', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).post('/api/logs/register').send({ action: 'create' });
      expect(response.status).toBe(503);
    });

    it('retorna 201 com o log criado', async () => {
      const response = await request(appWithDb({})).post('/api/logs/register').send({ action: 'create' });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ success: true, data: { action: 'create', _id: 'new-log' } });
    });

    it('não exige requireAuditReader (perfil sem permissão ainda registra)', async () => {
      currentUser = { accessType: 1, roleName: 'tecnico' };
      const response = await request(appWithDb({})).post('/api/logs/register').send({ action: 'create' });
      expect(response.status).toBe(201);
    });

    it('retorna 400 quando o serviço falha', async () => {
      logServiceMock.createLog.mockRejectedValueOnce(new Error('invalid payload'));
      const response = await request(appWithDb({})).post('/api/logs/register').send({});
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ success: false, error: 'Erro ao registrar log', message: 'invalid payload' });
    });
  });

  describe('GET /api/logs/export/csv', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).get('/api/logs/export/csv');
      expect(response.status).toBe(503);
    });

    it('retorna csv com cabeçalhos e linhas escapadas', async () => {
      logServiceMock.getLogs.mockResolvedValueOnce({
        logs: [
          { timestamp: '2026-01-01', userName: 'A "B"', action: 'login', entity: 'user', result: 'ok', severity: 'low', module: 'auth', ipSource: '127.0.0.1', message: 'msg' },
        ],
      });
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/export/csv');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment; filename=logs_');
      expect(response.text).toContain('"A ""B"""');
      expect(logServiceMock.getLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 10000, page: 1 }));
    });

    it('usa lista vazia quando o serviço não retorna logs', async () => {
      logServiceMock.getLogs.mockResolvedValueOnce({});
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/export/csv');
      expect(response.status).toBe(200);
      expect(response.text.split('\n')).toHaveLength(1);
    });

    it('retorna 500 quando o serviço falha', async () => {
      logServiceMock.getLogs.mockRejectedValueOnce(new Error('boom-csv'));
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/export/csv');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao exportar logs CSV');
    });
  });

  describe('GET /api/logs/export/xlsx', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).get('/api/logs/export/xlsx');
      expect(response.status).toBe(503);
    });

    it('retorna 200 com content-type xlsx', async () => {
      logServiceMock.getLogs.mockResolvedValueOnce({ logs: [] });
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/export/xlsx');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toContain('attachment; filename=logs_');
    });

    it('retorna 500 quando o serviço falha', async () => {
      logServiceMock.getLogs.mockRejectedValueOnce(new Error('boom-xlsx'));
      const response = await request(appWithDb(dbWithRbac({ accessType: 4 }))).get('/api/logs/export/xlsx');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao exportar logs XLSX');
    });
  });

  describe('GET /api/logs/:id', () => {
    it('retorna 503 quando o db não está disponível', async () => {
      const response = await request(appWithDb(null)).get('/api/logs/abc');
      expect(response.status).toBe(503);
    });

    it('encontra log por ObjectId válido', async () => {
      const found = { _id: new ObjectId(), action: 'login' };
      const db = dbWithRbac({
        accessType: 4,
        collections: { logs: { findOne: vi.fn(async (query) => (query._id ? found : null)) } },
      });
      const response = await request(appWithDb(db)).get(`/api/logs/${found._id.toString()}`);
      expect(response.status).toBe(200);
      expect(response.body.data.action).toBe('login');
    });

    it('cai para busca por logId quando ObjectId inválido', async () => {
      const found = { logId: 'not-an-object-id', action: 'export' };
      const db = dbWithRbac({
        accessType: 4,
        collections: { logs: { findOne: vi.fn(async (query) => (query.logId === 'not-an-object-id' ? found : null)) } },
      });
      const response = await request(appWithDb(db)).get('/api/logs/not-an-object-id');
      expect(response.status).toBe(200);
      expect(response.body.data.action).toBe('export');
    });

    it('cai para busca por logId quando ObjectId válido não encontra documento', async () => {
      const validId = new ObjectId().toString();
      const found = { logId: validId, action: 'fallback' };
      const db = dbWithRbac({
        accessType: 4,
        collections: { logs: { findOne: vi.fn(async (query) => (query.logId === validId ? found : null)) } },
      });
      const response = await request(appWithDb(db)).get(`/api/logs/${validId}`);
      expect(response.status).toBe(200);
      expect(response.body.data.action).toBe('fallback');
    });

    it('retorna 404 quando nenhum log é encontrado', async () => {
      const db = dbWithRbac({
        accessType: 4,
        collections: { logs: { findOne: vi.fn(async () => null) } },
      });
      const response = await request(appWithDb(db)).get('/api/logs/missing-id');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ success: false, error: 'Log não encontrado' });
    });

    it('retorna 500 quando a consulta falha', async () => {
      const response = await request(appWithThrowingCollection()).get('/api/logs/abc');
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Erro ao buscar log');
    });
  });
});
