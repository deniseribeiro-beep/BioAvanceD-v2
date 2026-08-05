import { describe, it, expect } from 'vitest';

const RetentionPolicyModel = require('../../src/models/RetentionPolicy');

const VALID_PAYLOAD = {
  applicableEntityTypes: ['AuditEvent', 'Log'],
  triggerEvent: 'creation',
  postRetentionAction: 'review',
  retentionDurationDays: 365,
  version: 'v1',
  effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
};

describe('RetentionPolicyModel', () => {
  it('valida um payload completo', () => {
    const result = RetentionPolicyModel.validate(VALID_PAYLOAD);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita payload vazio com todos os campos obrigatórios apontados', () => {
    const result = RetentionPolicyModel.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'applicableEntityTypes é obrigatório e deve ser um array não vazio',
      'triggerEvent é obrigatório e deve ser um código de texto válido',
      expect.stringContaining('postRetentionAction é obrigatório'),
      'retentionDurationDays é obrigatório e deve ser um inteiro positivo',
      'version é obrigatório e deve ser um texto válido',
      'effectivePeriod.start é obrigatório e deve ser uma data válida',
    ]));
  });

  it('rejeita postRetentionAction fora do conjunto permitido', () => {
    const result = RetentionPolicyModel.validate({ ...VALID_PAYLOAD, postRetentionAction: 'delete-now' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('postRetentionAction'))).toBe(true);
  });

  it('rejeita retentionDurationDays não inteiro ou não positivo', () => {
    expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, retentionDurationDays: 0 }).isValid).toBe(false);
    expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, retentionDurationDays: 1.5 }).isValid).toBe(false);
  });

  it('rejeita effectivePeriod.end anterior a effectivePeriod.start', () => {
    const result = RetentionPolicyModel.validate({
      ...VALID_PAYLOAD,
      effectivePeriod: { start: '2026-06-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('effectivePeriod.end deve ser maior ou igual a effectivePeriod.start');
  });

  it('cria o documento normalizando datas e default active=true', () => {
    const doc = RetentionPolicyModel.create(VALID_PAYLOAD);
    expect(doc.active).toBe(true);
    expect(doc.effectivePeriod.start).toBeInstanceOf(Date);
    expect(doc.effectivePeriod.end).toBeNull();
    expect(doc.applicableEntityTypes).toEqual(['AuditEvent', 'Log']);
  });
});
