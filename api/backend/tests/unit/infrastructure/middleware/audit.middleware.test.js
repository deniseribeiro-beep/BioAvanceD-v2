import { describe, it, expect, vi, afterEach } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require().
// audit.middleware.js does plain `const auditLogger = require('../../utils/auditLogger')`
// at module scope, and that module exports a singleton instance. Node's CJS
// module cache guarantees the middleware and this test share the same object
// instance, so we require the real singleton and vi.spyOn() its methods,
// restoring with vi.restoreAllMocks() in afterEach - same pattern as
// tests/unit/consent.enforcement.test.js.
const auditLogger = require('../../../../src/utils/auditLogger');
const { auditRequest } = require('../../../../src/infrastructure/middleware/audit.middleware');

function buildReqRes({ path = '/api/patients', method = 'GET', db = {}, query = {} } = {}) {
  const req = { path, method, query, app: { locals: { db } } };
  const res = { statusCode: 200, send: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

// The logging call happens inside setImmediate() scheduled by res.send. Flush
// the macrotask queue (and the microtasks the async callback then queues) so
// assertions can observe it deterministically.
function flushSetImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auditRequest', () => {
  it('skips logging and calls next immediately for ignored health/keepalive paths', () => {
    const initSpy = vi.spyOn(auditLogger, 'init');
    const { req, res, next } = buildReqRes({ path: '/api/health' });

    auditRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('does not log when req.app.locals.db is missing', async () => {
    const initSpy = vi.spyOn(auditLogger, 'init');
    const logSpy = vi.spyOn(auditLogger, 'log');
    const { req, res, next } = buildReqRes({ db: null });

    auditRequest(req, res, next);
    expect(next).toHaveBeenCalled();

    res.send('body');
    await flushSetImmediate();

    expect(initSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs a successful GET query as a QUERY/success entry, resolving Sample entity/module', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples', method: 'GET' });

    auditRequest(req, res, next);
    res.statusCode = 200;
    res.send('ok');
    await flushSetImmediate();

    expect(auditLogger.init).toHaveBeenCalledWith(req.app.locals.db);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'QUERY',
        resourceType: 'Sample',
        module: 'Amostras',
        status: 'success',
        severity: 'info',
      })
    );
  });

  it('logs a GET with an ObjectId in the path as READ, resolving entity from the resource before it', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/patients/507f1f77bcf86cd799439011', method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ', resourceType: 'Patient', module: 'Cadastro' })
    );
  });

  it('maps a 500 response to an _ERROR action with error severity', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples', method: 'POST' });

    auditRequest(req, res, next);
    res.statusCode = 500;
    res.send('boom');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_ERROR', status: 'error', severity: 'error' })
    );
  });

  // #1119: every other case in this file hands auditRequest a req whose
  // `path` is the FULL path and never changes -- a shape Express only
  // produces for a route registered directly on the app. For a router
  // mounted with app.use('/api/iot', ...), Express strips the mount prefix
  // off req.url for the duration of that router, and the response is sent
  // from INSIDE it. So the wrapper used to see `/telemetry`, determineEntity
  // missed ENTITY_MAP entirely, and the row recorded the 'Sistema'
  // catch-all -- for 57 of the 61 prefixes app.js mounts.
  //
  // This case simulates that strip by rewriting req.path between
  // auditRequest() and res.send(), which is exactly when Express does it.
  it('#1119: resolves the entity from the path as it was at middleware entry, not the router-relative one', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const { req, res, next } = buildReqRes({ path: '/api/iot/telemetry', method: 'POST' });

    auditRequest(req, res, next);

    // Express enters the mounted router and strips the prefix.
    req.path = '/telemetry';
    res.statusCode = 400;
    res.send('body');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'TelemetryReading',
        payload: expect.objectContaining({ path: '/api/iot/telemetry' })
      })
    );
  });

  // The same strip must not cost the module either -- determineModule
  // matches on substrings like '/temperature', which the stripped path of a
  // route under app.use('/api/temperature', ...) no longer contains.
  it('#1119: resolves the module from the entry path too', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const { req, res, next } = buildReqRes({ path: '/api/temperature/system/reading', method: 'POST' });

    auditRequest(req, res, next);

    req.path = '/system/reading';
    res.send('body');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'Temperature', module: 'Monitoramento' })
    );
  });
  it('maps a 401 response to UNAUTHORIZED', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples' });

    auditRequest(req, res, next);
    res.statusCode = 401;
    res.send('nope');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNAUTHORIZED', status: 'error', severity: 'warning' })
    );
  });

  it('maps a 403 response to FORBIDDEN', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples' });

    auditRequest(req, res, next);
    res.statusCode = 403;
    res.send('nope');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FORBIDDEN', status: 'error', severity: 'warning' })
    );
  });

  it('maps a generic 4xx response to an _FAILED action', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples', method: 'PUT' });

    auditRequest(req, res, next);
    res.statusCode = 422;
    res.send('nope');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_FAILED', status: 'error', severity: 'warning' })
    );
  });

  it('recognizes special-path actions (login, export) regardless of HTTP method', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/auth/login', method: 'POST' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN', resourceType: 'Authentication', module: 'Autenticação' })
    );
  });

  it('falls back to Sistema entity/module and DELETE action for an unmapped root resource', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/unmapped-thing', method: 'DELETE' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', resourceType: 'Sistema', module: 'Sistema' })
    );
  });

  it('recurses past a leading ObjectId resource to resolve the entity from the next path segment', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/507f1f77bcf86cd799439011/patients', method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Patient' }));
  });

  it('resolves Sistema when the entire remaining path is just an ObjectId', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/507f1f77bcf86cd799439011', method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Sistema' }));
  });

  it('falls back to a capitalized VALID_ENTITIES match when the resource has no explicit entityMap entry', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    // #1110: was /api/assistant, whose capitalized form left VALID_ENTITIES
    // with the assistant scaffolding. /api/authentication exercises the same
    // fallback -- absent from entityMap, present in VALID_ENTITIES.
    const { req, res, next } = buildReqRes({ path: '/api/authentication', method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Authentication' }));
  });

  // #1110: determineEntity capitalizes an unmapped resource and returns it
  // only if VALID_ENTITIES contains it, else the safe default. Removing the
  // assistant scaffolding from that list is therefore behavioural HERE --
  // unlike Log.js, whose copy of the list is checked in two places with an
  // empty else-if body and so gates nothing.
  it('#1110: falls back to Sistema for the removed assistant entities', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/assistant', method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Sistema' }));
  });

  it('passes through an unrecognized HTTP method verbatim as the action', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples', method: 'OPTIONS' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'OPTIONS' }));
  });

  it.each([
    ['/api/users/logout', 'LOGOUT'],
    ['/api/users/register', 'REGISTER'],
    ['/api/reports/generate', 'GENERATE'],
    ['/api/samples/validate', 'VALIDATE'],
    ['/api/users/reset-mfa', 'MFA'],
  ])('recognizes the %s special-path action as %s', async (path, expectedAction) => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path, method: 'POST' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: expectedAction }));
  });

  it.each([
    ['/api/users', 'Usuários'],
    ['/api/temperature/readings', 'Monitoramento'],
    ['/api/reports', 'Relatórios'],
    ['/api/logs', 'Exportação'],
    ['/api/equipment', 'Configuração'],
  ])('resolves the %s module as %s', async (path, expectedModule) => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path, method: 'GET' });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ module: expectedModule }));
  });

  it('reports query presence via payload.query when query params exist', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const { req, res, next } = buildReqRes({ path: '/api/samples', query: { page: '1' } });

    auditRequest(req, res, next);
    res.send('ok');
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ query: 'present' }) })
    );
  });

  it('swallows a logging failure without rejecting or blocking the response', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockRejectedValue(new Error('log backend down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { req, res, next } = buildReqRes({ path: '/api/samples' });

    auditRequest(req, res, next);
    const sendResult = res.send('ok');
    await flushSetImmediate();
    await flushSetImmediate();

    expect(sendResult).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('Erro ao registrar auditoria:', 'log backend down');
  });
});
