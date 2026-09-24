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

    expect(created.accessID).toBeNull();
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

  it('deve mapear descrição de tipo de acesso para número', () => {
    expect(AccessModel.validateAccessType('Visualizador')).toBe(1);
    expect(AccessModel.validateAccessType('Operador')).toBe(2);
    expect(AccessModel.validateAccessType('Coordenador')).toBe(3);
    expect(AccessModel.validateAccessType('Administrador')).toBe(4);
  });
});
