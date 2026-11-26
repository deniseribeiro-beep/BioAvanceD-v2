import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const securityRoutes = require('../../src/interface/routes/security.routes');
const securityService = require('../../src/services/security.service');
const notificationService = require('../../src/services/notification.service');
const auditLogger = require('../../src/utils/auditLogger');

function getHandler(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    },
  };
}

function createRequest({ body = {}, query = {}, user = { userID: 'admin-1', accessType: 4, roleName: 'Administrador' }, t = (key) => key } = {}) {
  return {
    body,
    query,
    user,
    method: 'GET',
    path: '/api/security',
    headers: {
      authorization: 'Bearer token',
      'x-forwarded-for': '127.0.0.1',
      'user-agent': 'vitest',
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    t,
    app: {
      locals: {
        db: {
          collection: vi.fn((name) => {
            if (name === 'logs') {
              return {
                insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
                find: vi.fn(() => ({
                  sort: vi.fn(() => ({
                    limit: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
                  })),
                })),
              };
            }
            return {
              findOne: vi.fn(),
              updateOne: vi.fn(),
              insertOne: vi.fn(),
              find: vi.fn(),
            };
          }),
        },
      },
    },
  };
}

describe('Security routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve aplicar middlewares de authenticate e controle por role no router', () => {
    const globalMiddlewares = securityRoutes.stack.filter((entry) => !entry.route);

    expect(globalMiddlewares.length).toBeGreaterThanOrEqual(2);
    expect(globalMiddlewares[0].handle.name).toBe('authenticate');
  });

  it('GET /config deve retornar configurações', async () => {
    const handler = getHandler(securityRoutes, 'get', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({ authentication: { requireMFA: true } });

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
  });

  it('GET /config deve retornar 503 quando o banco de dados não está disponível', async () => {
    const handler = getHandler(securityRoutes, 'get', '/config');
    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload.success).toBe(false);
  });

  it('GET /config deve retornar 500 quando o serviço lança erro', async () => {
    const handler = getHandler(securityRoutes, 'get', '/config');
    vi.spyOn(securityService, 'getConfig').mockRejectedValue(new Error('boom'));

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('boom');
  });

  it('PUT /config deve atualizar configurações', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({ metadata: { version: 1 } });
    vi.spyOn(securityService, 'updateConfig').mockResolvedValue({ metadata: { version: 2 } });

    const req = createRequest({ body: { authentication: { requireMFA: false } } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
  });

  it('PUT /config deve retornar 400 quando o serviço lança erro', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({ metadata: { version: 1 } });
    vi.spyOn(securityService, 'updateConfig').mockRejectedValue(new Error('invalid payload'));

    const req = createRequest({ body: { authentication: { requireMFA: false } } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('invalid payload');
  });

  it('PUT /config deve retornar 503 quando o banco de dados não está disponível', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload.success).toBe(false);
  });

  it('PUT /config passa adiante o 409 de uma ativação concorrente (RF014 AC2)', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({});
    vi.spyOn(securityService, 'updateConfig').mockRejectedValue(Object.assign(new Error('concorrente'), { statusCode: 409 }));
    const res = createResponse();

    await handler(createRequest({ body: { session: { timeoutMinutes: 20 } } }), res);

    expect(res.statusCode).toBe(409);
  });

  it('PUT /config devolve violatedInvariants e violations de uma ConfigurationValidationError (RNF018 AC2)', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({});
    vi.spyOn(securityService, 'updateConfig').mockRejectedValue(Object.assign(new Error('recusada'), {
      statusCode: 422,
      validationRun: { configurationValidationRunId: 'run-1' },
      violatedInvariants: ['INV-SCOPE-001'],
      violations: [{ invariantId: 'INV-SCOPE-001', fieldPath: 'outbox' }],
    }));
    const res = createResponse();

    await handler(createRequest({ body: { outbox: { enabled: false } } }), res);

    expect(res.statusCode).toBe(422);
    expect(res.payload).toMatchObject({
      configurationValidationRunId: 'run-1',
      violatedInvariants: ['INV-SCOPE-001'],
      violations: [{ invariantId: 'INV-SCOPE-001', fieldPath: 'outbox' }],
    });
  });

  it('GET /config/releases lista as releases, com o limite limitado a 200 (RF014 AC4)', async () => {
    const handler = getHandler(securityRoutes, 'get', '/config/releases');
    const list = vi.spyOn(securityService, 'listReleases').mockResolvedValue([{ configurationReleaseId: 'r2' }, { configurationReleaseId: 'r1' }]);
    const res = createResponse();

    await handler(createRequest({ query: { limit: '5000' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.data.map((row) => row.configurationReleaseId)).toEqual(['r2', 'r1']);
    expect(list).toHaveBeenCalledWith(expect.anything(), { limit: 200 });
  });

  it('GET /config/catalog devolve o catálogo de configurações, sem banco (RF014 AC1)', () => {
    const handler = getHandler(securityRoutes, 'get', '/config/catalog');
    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.data.catalogVersion).toBe('1.1.0');
    expect(res.payload.data.settings.find(({ path }) => path === 'session.timeoutMinutes'))
      .toEqual(expect.objectContaining({ type: 'number', scope: 'environment', allowedValues: { kind: 'range', min: 5, max: 480 }, default: 30 }));
  });

  it('POST /config/rollback exige configurationReleaseId e devolve o status do serviço (RF014 AC4)', async () => {
    const handler = getHandler(securityRoutes, 'post', '/config/rollback');
    const rollback = vi.spyOn(securityService, 'rollbackConfig');

    const missing = createResponse();
    await handler(createRequest({ body: {} }), missing);
    expect(missing.statusCode).toBe(400);
    expect(rollback).not.toHaveBeenCalled();

    rollback.mockRejectedValueOnce(Object.assign(new Error('não encontrada'), { statusCode: 404 }));
    const unknown = createResponse();
    await handler(createRequest({ body: { configurationReleaseId: 'nope' } }), unknown);
    expect(unknown.statusCode).toBe(404);

    rollback.mockResolvedValueOnce({ configurationReleaseId: 'r3' });
    const ok = createResponse();
    await handler(createRequest({ body: { configurationReleaseId: 'r1' } }), ok);
    expect(ok.statusCode).toBe(200);
    expect(rollback).toHaveBeenLastCalledWith(expect.anything(), 'r1', expect.anything());
  });

  it('GET /logs/export deve retornar CSV e header correto', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    vi.spyOn(securityService, 'exportLogs').mockResolvedValue('timestamp,userID\n2026-01-01,admin');
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const req = createRequest({ query: { format: 'csv', severity: 'warning' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'] || '')).toContain('text/csv');
    expect(String(res.payload)).toContain('timestamp,userID');
    expect(initSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXPORT', resourceType: 'Logs' }));
  });

  it('GET /logs/export deve retornar JSON e header correto quando format=json', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    vi.spyOn(securityService, 'exportLogs').mockResolvedValue([{ timestamp: '2026-01-01', userID: 'admin' }]);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const req = createRequest({ query: { format: 'json' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'] || '')).toContain('application/json');
    expect(res.payload).toEqual([{ timestamp: '2026-01-01', userID: 'admin' }]);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXPORT', payload: expect.objectContaining({ format: 'json' }) }));
  });

  it('GET /logs/export deve retornar 503 quando o banco de dados não está disponível', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload.success).toBe(false);
  });

  it('GET /logs/export deve retornar 500 quando o serviço lança erro', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    vi.spyOn(securityService, 'exportLogs').mockRejectedValue(new Error('export failed'));

    const req = createRequest({ query: { format: 'csv' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('export failed');
  });

  it('GET /permissions deve listar permissões', async () => {
    const handler = getHandler(securityRoutes, 'get', '/permissions');
    // #1341: the payload is the seeded roles and the permissions they grant.
    const payload = {
      roles: [{ roleCode: 'administrator', displayName: 'Administrador', hierarchyLevel: 4, permissionCodes: ['manageSystem'] }],
      permissions: [{ permissionCode: 'manageSystem', displayName: 'Gerenciar sistema', resourceType: 'System', allowedActions: ['READ'] }],
    };
    vi.spyOn(securityService, 'getPermissions').mockResolvedValue(payload);

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toEqual(payload);
  });

  it('GET /permissions deve retornar 503 quando o banco de dados não está disponível', async () => {
    const handler = getHandler(securityRoutes, 'get', '/permissions');
    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload.success).toBe(false);
  });

  it('GET /permissions deve retornar 500 quando o serviço lança erro', async () => {
    const handler = getHandler(securityRoutes, 'get', '/permissions');
    vi.spyOn(securityService, 'getPermissions').mockRejectedValue(new Error('permissions failed'));

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('permissions failed');
  });

  // #1149: PUT /permissions wrote a `security_permissions` store that no
  // authorization path reads, answered success, and audited a critical change
  // that never took effect. It is removed, not softened; GET stays.
  it('#1149: registers no PUT /permissions, while GET /permissions stays', () => {
    const methodsFor = (path) => securityRoutes.stack
      .filter((entry) => entry.route?.path === path)
      .flatMap((entry) => Object.keys(entry.route.methods));

    expect(methodsFor('/permissions')).toEqual(['get']);
    // control: the neighbouring /config route still accepts both verbs
    expect(methodsFor('/config').sort()).toEqual(['get', 'put']);
  });

  it('GET /consent-queue deve retornar status da fila', async () => {
    const handler = getHandler(securityRoutes, 'get', '/consent-queue');
    vi.spyOn(notificationService, 'getConsentQueueStats').mockResolvedValue({ waiting: 3, active: 1 });

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data.waiting).toBe(3);
  });

  it('GET /consent-queue deve retornar 500 quando o serviço lança erro', async () => {
    const handler = getHandler(securityRoutes, 'get', '/consent-queue');
    vi.spyOn(notificationService, 'getConsentQueueStats').mockRejectedValue(new Error('queue failed'));

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('queue failed');
  });

  it('GET /config usa mensagens padrão quando req.t está ausente (sucesso, 503 e 500)', async () => {
    const handler = getHandler(securityRoutes, 'get', '/config');

    vi.spyOn(securityService, 'getConfig').mockRejectedValue(new Error('boom'));
    const errReq = createRequest({ t: null });
    const errRes = createResponse();
    await handler(errReq, errRes);
    expect(errRes.statusCode).toBe(500);
    expect(errRes.payload.error).toBe('Erro ao buscar configurações de segurança');

    const unavailableReq = createRequest({ t: null });
    unavailableReq.app.locals.db = null;
    const unavailableRes = createResponse();
    await handler(unavailableReq, unavailableRes);
    expect(unavailableRes.statusCode).toBe(503);
    expect(unavailableRes.payload.error).toBe('Banco de dados não disponível');
  });

  it('PUT /config usa mensagens padrão quando req.t está ausente (sucesso, 503 e 400)', async () => {
    const handler = getHandler(securityRoutes, 'put', '/config');
    vi.spyOn(securityService, 'getConfig').mockResolvedValue({ metadata: { version: 1 } });

    vi.spyOn(securityService, 'updateConfig').mockResolvedValue({ metadata: { version: 2 } });
    const okReq = createRequest({ body: { authentication: { requireMFA: false } }, t: null });
    const okRes = createResponse();
    await handler(okReq, okRes);
    expect(okRes.statusCode).toBe(200);
    expect(okRes.payload.message).toBe('Configurações de segurança atualizadas com sucesso');

    vi.spyOn(securityService, 'updateConfig').mockRejectedValue(new Error('invalid payload'));
    const errReq = createRequest({ body: { authentication: { requireMFA: false } }, t: null });
    const errRes = createResponse();
    await handler(errReq, errRes);
    expect(errRes.statusCode).toBe(400);
    expect(errRes.payload.error).toBe('Erro ao atualizar configurações de segurança');

    const unavailableReq = createRequest({ t: null });
    unavailableReq.app.locals.db = null;
    const unavailableRes = createResponse();
    await handler(unavailableReq, unavailableRes);
    expect(unavailableRes.statusCode).toBe(503);
    expect(unavailableRes.payload.error).toBe('Banco de dados não disponível');
  });

  it('GET /logs/export usa format padrão csv e mensagens padrão quando req.t/query.format estão ausentes', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    vi.spyOn(securityService, 'exportLogs').mockResolvedValue('timestamp,userID\n2026-01-01,admin');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const req = createRequest({ t: null });
    const res = createResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(securityService.exportLogs).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'csv');
    const [logPayload] = logSpy.mock.calls[0];
    expect(logPayload.message).toBe('Exportação de logs realizada (formato: csv)');
    expect(logPayload.module).toBe('Segurança');
  });

  it('GET /logs/export usa mensagens padrão quando req.t está ausente (503 e 500)', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');

    vi.spyOn(securityService, 'exportLogs').mockRejectedValue(new Error('export failed'));
    const errReq = createRequest({ t: null });
    const errRes = createResponse();
    await handler(errReq, errRes);
    expect(errRes.statusCode).toBe(500);
    expect(errRes.payload.error).toBe('Erro ao exportar logs');

    const unavailableReq = createRequest({ t: null });
    unavailableReq.app.locals.db = null;
    const unavailableRes = createResponse();
    await handler(unavailableReq, unavailableRes);
    expect(unavailableRes.statusCode).toBe(503);
    expect(unavailableRes.payload.error).toBe('Banco de dados não disponível');
  });

  it('GET /permissions usa mensagens padrão quando req.t está ausente (503 e 500)', async () => {
    const handler = getHandler(securityRoutes, 'get', '/permissions');

    vi.spyOn(securityService, 'getPermissions').mockRejectedValue(new Error('permissions failed'));
    const errReq = createRequest({ t: null });
    const errRes = createResponse();
    await handler(errReq, errRes);
    expect(errRes.statusCode).toBe(500);
    expect(errRes.payload.error).toBe('Erro ao buscar permissões');

    const unavailableReq = createRequest({ t: null });
    unavailableReq.app.locals.db = null;
    const unavailableRes = createResponse();
    await handler(unavailableReq, unavailableRes);
    expect(unavailableRes.statusCode).toBe(503);
    expect(unavailableRes.payload.error).toBe('Banco de dados não disponível');
  });

  it('GET /consent-queue não deve exigir req.app.locals.db (diferente das demais rotas)', async () => {
    const handler = getHandler(securityRoutes, 'get', '/consent-queue');
    vi.spyOn(notificationService, 'getConsentQueueStats').mockResolvedValue({ waiting: 0, active: 0 });

    const req = createRequest();
    req.app.locals.db = null;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
  });
});
