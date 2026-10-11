import { describe, it, expect } from 'vitest';
const AccessModel = require('../../../src/models/Access');

describe('AccessModel', () => {
  it('deve validar um access válido', () => {
    const result = AccessModel.validate({
      reportID: 1,
      reportType: 'Relatório de Auditoria',
      accessType: 3,
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('deve rejeitar quando reportID está ausente', () => {
    const result = AccessModel.validate({
      reportType: 'Relatório de Auditoria',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('reportID é obrigatório');
  });

  it('deve rejeitar quando reportType está ausente', () => {
    const result = AccessModel.validate({
      reportID: 1,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('reportType é obrigatório e deve ser string');
  });

  it('deve rejeitar accessType inválido', () => {
    const result = AccessModel.validate({
      reportID: 1,
      reportType: 'Relatório de Auditoria',
      accessType: 99,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('accessType inválido');
  });

  it('deve criar registro com defaults esperados', () => {
    const created = AccessModel.create({
      reportID: 2,
      reportType: 'Relatório Clínico',
    });

    expect(created.accessGrantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(created.permissionCodes).toEqual(['viewReports']);
    expect(created.reportID).toBe(2);
    expect(created.reportType).toBe('Relatório Clínico');
    expect(created.accessType).toBe(1);
    expect(created.grantedAt).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    // #1202: AccessGrant canonical fields.
    expect(created.resourceType).toBe('report');
    expect(created.resourceId).toBe(2);
    expect(created.grantStatus).toBe('active');
    expect(created.grantedBy).toBeNull();
    expect(created.revokedAt).toBeNull();
  });

  // #1201: dict-02 AccessGrant names (P1X-0238, P1X-0239, P1X-0243).
  describe('#1201: canonical AccessGrant names', () => {
    it('create() writes userAccountId, accessGrantId and permissionCodes and no legacy name', () => {
      const created = AccessModel.create({ reportID: 3, reportType: 'equipment', userId: 'user-1', accessID: 'grant-1' });

      expect(created).toMatchObject({ userAccountId: 'user-1', accessGrantId: 'grant-1', permissionCodes: ['viewReports'] });
      expect(created).not.toHaveProperty('userId');
      expect(created).not.toHaveProperty('accessID');
    });

    it('create() takes userAccountId over userId and a known permissionCodes list', () => {
      const created = AccessModel.create({
        reportID: 3, reportType: 'equipment', userAccountId: 'user-2', userId: 'user-1', permissionCodes: ['viewReports', 'uploadFiles'],
      });

      expect(created.userAccountId).toBe('user-2');
      expect(created.permissionCodes).toEqual(['viewReports', 'uploadFiles']);
    });

    it('validate() refuses an empty or unknown permissionCodes list', () => {
      const base = { reportID: 1, reportType: 'equipment' };
      const message = 'permissionCodes deve ser uma lista não vazia de códigos de permissão conhecidos';

      expect(AccessModel.validate({ ...base, permissionCodes: [] }).errors).toContain(message);
      expect(AccessModel.validate({ ...base, permissionCodes: ['noSuchCode'] }).errors).toContain(message);
      expect(AccessModel.validate({ ...base, permissionCodes: 'viewReports' }).errors).toContain(message);
      expect(AccessModel.validate({ ...base, permissionCodes: ['viewReports'] }).isValid).toBe(true);
    });

    it('the accessors read the canonical name first, then the legacy one', () => {
      expect(AccessModel.userAccountIdOf({ userAccountId: 'a', userId: 'b' })).toBe('a');
      expect(AccessModel.userAccountIdOf({ userId: 'b' })).toBe('b');
      expect(AccessModel.accessGrantIdOf({ accessGrantId: 'g', accessID: 7 })).toBe('g');
      expect(AccessModel.accessGrantIdOf({ accessID: 7 })).toBe(7);
      expect(AccessModel.userAccountIdOf(null)).toBeUndefined();
    });

    it('apiViewOf() puts a grant back under accessID and userId', () => {
      const view = AccessModel.apiViewOf({ _id: 'x', accessGrantId: 'g', userAccountId: 'u', permissionCodes: ['viewReports'] });

      expect(view).toEqual({ _id: 'x', accessID: 'g', userId: 'u', permissionCodes: ['viewReports'] });
      expect(AccessModel.apiViewOf({ accessID: 7, userId: 'b' })).toEqual({ accessID: 7, userId: 'b' });
    });
  });

  it('deve mapear descrição de tipo de acesso para número', () => {
    expect(AccessModel.validateAccessType('Visualizador')).toBe(1);
    expect(AccessModel.validateAccessType('Operador')).toBe(2);
    expect(AccessModel.validateAccessType('Coordenador')).toBe(3);
    expect(AccessModel.validateAccessType('Administrador')).toBe(4);
  });
});
