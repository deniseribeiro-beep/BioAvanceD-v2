import { describe, it, expect, beforeEach, vi } from 'vitest';

const securityRoutesModule = await import('../../src/interface/routes/security.routes');
const securityRoutes = securityRoutesModule.default || securityRoutesModule;

const securityServiceModule = await import('../../src/services/security.service');
const securityService = securityServiceModule.default || securityServiceModule;

const notificationServiceModule = await import('../../src/services/notification.service');
const notificationService = notificationServiceModule.default || notificationServiceModule;

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

function createRequest({ body = {}, query = {}, user = { userID: 'admin-1', accessType: 4, roleName: 'Administrador' } } = {}) {
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
    t: (key) => key,
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

  it('GET /logs/export deve retornar CSV e header correto', async () => {
    const handler = getHandler(securityRoutes, 'get', '/logs/export');
    vi.spyOn(securityService, 'exportLogs').mockResolvedValue('timestamp,userID\n2026-01-01,admin');

    const req = createRequest({ query: { format: 'csv', severity: 'warning' } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'] || '')).toContain('text/csv');
    expect(String(res.payload)).toContain('timestamp,userID');
  });

  it('GET /permissions deve listar permissões', async () => {
    const handler = getHandler(securityRoutes, 'get', '/permissions');
    vi.spyOn(securityService, 'getPermissions').mockResolvedValue({ '4': { manageSecurity: true } });

    const req = createRequest();
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data['4'].manageSecurity).toBe(true);
  });

  it('PUT /permissions deve atualizar permissões', async () => {
    const handler = getHandler(securityRoutes, 'put', '/permissions');
    vi.spyOn(securityService, 'getPermissions').mockResolvedValue({ '4': { manageSecurity: true } });
    vi.spyOn(securityService, 'updatePermissions').mockResolvedValue({ '4': { manageSecurity: false } });

    const req = createRequest({ body: { '4': { manageSecurity: false } } });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
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
});
