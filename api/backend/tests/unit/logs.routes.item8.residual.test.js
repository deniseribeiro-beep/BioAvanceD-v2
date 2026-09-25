import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const rbacAssignmentPath = require.resolve('../../src/services/rbac-assignment.service');
const routePath = require.resolve('../../src/interface/routes/logs.routes');
const logServicePath = require.resolve('../../src/services/log.service');
const loggerPath = require.resolve('../../src/utils/logger');

function clearRouteCache() {
  delete require.cache[routePath];
}

function loadRouteHandlers(path, method) {
  clearRouteCache();
  const router = require(routePath);
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return {
    requireAuditReader: layer.route.stack[1].handle,
    handler: layer.route.stack.at(-1).handle,
  };
}

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearRouteCache();
});

describe('logs.routes item 8 residual branches', () => {
  it('covers isAuditReader throw with and without message', async () => {
    const rbac = require(rbacAssignmentPath);
    const logger = require(loggerPath);
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const isAuditReader = vi.spyOn(rbac, 'isAuditReader');

    isAuditReader.mockRejectedValueOnce(new Error('rbac blew up'));
    let { requireAuditReader } = loadRouteHandlers('/', 'get');
    let res = makeRes();
    await requireAuditReader({ app: { locals: { db: {} } }, user: { userID: 'u1' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Erro ao verificar permissao de auditoria:',
      'rbac blew up'
    );

    isAuditReader.mockRejectedValueOnce('plain rbac failure');
    ({ requireAuditReader } = loadRouteHandlers('/', 'get'));
    res = makeRes();
    await requireAuditReader({ app: { locals: { db: {} } }, user: { userID: 'u1' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Erro ao verificar permissao de auditoria:',
      'plain rbac failure'
    );
  });

  it('covers getLogs reject without message on /, /all and /query', async () => {
    const logService = require(logServicePath);
    const logger = require(loggerPath);
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const getLogs = vi.spyOn(logService, 'getLogs');

    const root = loadRouteHandlers('/', 'get').handler;
    const all = loadRouteHandlers('/all', 'get').handler;
    const query = loadRouteHandlers('/query', 'post').handler;

    getLogs.mockRejectedValueOnce('root plain failure');
    let res = makeRes();
    await root({ app: { locals: { db: {} } }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith('Erro ao buscar logs:', 'root plain failure');

    getLogs.mockRejectedValueOnce('all plain failure');
    res = makeRes();
    await all({ app: { locals: { db: {} } }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith('Erro ao buscar todos os logs:', 'all plain failure');

    getLogs.mockRejectedValueOnce('query plain failure');
    res = makeRes();
    await query({ app: { locals: { db: {} } }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerSpy).toHaveBeenCalledWith('Erro ao consultar logs:', 'query plain failure');
  });
});
