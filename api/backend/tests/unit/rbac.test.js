import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { requireRole, requirePermission, permissions } = require('../../src/infrastructure/middleware/rbac');
const auditLogger = require('../../src/utils/auditLogger');

function flushSetImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('RBAC middleware', () => {
  const createRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  });

  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { user: null, app: { locals: {} } };
    res = createRes();
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve negar acesso sem usuário autenticado em requireRole', () => {
    requireRole(4)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve permitir administrador em requireRole(4)', () => {
    req.user = { userID: '1', accessType: 4, roleName: 'Administrador' };

    requireRole(4)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve negar técnico em requireRole(4)', () => {
    req.user = { userID: '2', accessType: 2, roleName: 'Técnico' };

    requireRole(4)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve permitir coordenador em requirePermission(createUser)', () => {
    req.user = { userID: '3', accessType: 3, roleName: 'Coordenador' };

    requirePermission('createUser')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve negar usuário externo em requirePermission(createUser)', () => {
    req.user = { userID: '4', accessType: 1, roleName: 'Usuário Externo' };

    requirePermission('createUser')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve retornar 500 para permissão inexistente', () => {
    req.user = { userID: '5', accessType: 4, roleName: 'Administrador' };

    requirePermission('doesNotExist')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve expor mapa de permissões esperado', () => {
    expect(permissions.createUser).toEqual([3, 4]);
    expect(permissions.manageBackup).toEqual([4]);
    expect(permissions.viewReports).toEqual([1, 2, 3, 4]);
  });

  it('deve resolver role via roleName (accentuated) quando accessType está ausente', () => {
    req.user = { userID: '6', roleName: 'Coordenador' };

    requireRole(3)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve negar acesso quando userRole não está entre allowedRoles (caminho não-admin)', () => {
    req.user = { userID: '7', accessType: 1, roleName: 'Usuário Externo' };

    requireRole(2, 3)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Você não tem permissão para acessar este recurso'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('deve negar acesso sem usuário autenticado em requirePermission', () => {
    requirePermission('createUser')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve registrar tentativa de acesso negado no audit log quando db está disponível', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    req.user = { userID: '8', accessType: 1, roleName: 'Usuário Externo' };
    req.app.locals.db = {};

    requirePermission('createUser')(req, res, next);
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FORBIDDEN',
      entity: 'Access'
    }));
  });

  it('deve resolver role via user.role quando roleName está ausente', () => {
    req.user = { userID: '10', role: 'tecnico' };

    requireRole(2)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve assumir role 1 (padrão) quando nenhum accessType/role/roleName reconhecido está presente', () => {
    req.user = { userID: '11' };

    requireRole(1)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve assumir role 1 (padrão) para roleName não mapeado', () => {
    req.user = { userID: '12', roleName: 'Gerente' };

    requireRole(1)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('não deve registrar audit log quando db não está disponível', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    req.user = { userID: '9', accessType: 1, roleName: 'Usuário Externo' };

    requirePermission('createUser')(req, res, next);
    await flushSetImmediate();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
