import { describe, it, expect, vi, beforeEach } from 'vitest';
const { requireRole, requirePermission, permissions } = require('../../src/infrastructure/middleware/rbac');

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
});
