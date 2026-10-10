import { describe, it, expect } from 'vitest';

const RetentionPolicyModel = require('../../src/models/RetentionPolicy');

const VALID_PAYLOAD = {
  applicableEntityTypes: ['AuditEvent', 'Log'],
  triggerEvent: 'creation',
  postRetentionAction: 'review',
  retentionPeriod: 'P365D',
  version: 'v1',
  effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
  jurisdiction: 'BR',
  retentionBasis: ['Resolução CNS nº 441/2011, item 11, I'],
  legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
  reviewRequired: true,
};

describe('RetentionPolicyModel', () => {
  // #1315 (RF026 AC1/AC2): jurisdiction, basis, legal-hold rules and review are each required.
  it('requires jurisdiction, retentionBasis, legalHoldRules and reviewRequired, and stores them', () => {
    const { jurisdiction, retentionBasis, legalHoldRules, reviewRequired, ...without } = VALID_PAYLOAD;
    expect(RetentionPolicyModel.validate(without).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('jurisdiction é obrigatório'),
      'retentionBasis é obrigatório e deve ser um array não vazio',
      'legalHoldRules é obrigatório e deve ser um array não vazio',
      'reviewRequired é obrigatório e deve ser booleano',
    ]));
    expect(RetentionPolicyModel.create({ ...VALID_PAYLOAD, jurisdiction: ' BR ' })).toMatchObject({
      jurisdiction: 'BR',
      retentionBasis: ['Resolução CNS nº 441/2011, item 11, I'],
      legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
      reviewRequired: true,
    });
  });

  it('refuses a legal-hold rule on a condition nothing evaluates, or blocking an unknown action, and a basis entry with no text or coding (#1315)', () => {
    const errorsOf = (overrides) => RetentionPolicyModel.validate({ ...VALID_PAYLOAD, ...overrides }).errors;
    expect(errorsOf({ legalHoldRules: [{ when: 'always', block: 'destroy' }] })).toEqual([expect.stringContaining('legalHoldRules[0].when')]);
    expect(errorsOf({ legalHoldRules: [{ when: 'legalHold=true', block: 'shred' }] })).toEqual([expect.stringContaining('legalHoldRules[0].block')]);
    expect(errorsOf({ retentionBasis: [{}] })).toEqual([expect.stringContaining('retentionBasis deve conter')]);
    expect(errorsOf({ retentionBasis: [{ text: 'Contrato de depósito' }, { coding: [{ code: 'legal' }] }] })).toEqual([]);
    expect(errorsOf({ reviewRequired: 'yes' })).toEqual(['reviewRequired é obrigatório e deve ser booleano']);
  });

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
      'retentionPeriod é obrigatório e deve ser uma duração ISO 8601 válida (ex.: "P365D")',
      'version é obrigatório e deve ser um texto válido',
      'effectivePeriod.start é obrigatório e deve ser uma data válida',
    ]));
  });

  it('rejeita postRetentionAction fora do conjunto permitido', () => {
    const result = RetentionPolicyModel.validate({ ...VALID_PAYLOAD, postRetentionAction: 'delete-now' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('postRetentionAction'))).toBe(true);
  });

  it('rejeita retentionPeriod que não seja uma duração ISO 8601 válida', () => {
    expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, retentionPeriod: '365' }).isValid).toBe(false);
    expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, retentionPeriod: 'P' }).isValid).toBe(false);
    expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, retentionPeriod: '' }).isValid).toBe(false);
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
    expect(doc.archiveRetentionPeriod).toBeNull();
    expect(doc.archiveRetentionBasis).toBeNull();
  });

  // #1271: the archive's own period and the obligation it rests on (LGPD
  // art. 16, I), only with 'archive', together, and never shorter than
  // retentionPeriod, since both count from the record.
  describe('#1271: archiveRetentionPeriod and archiveRetentionBasis', () => {
    const ARCHIVE = { ...VALID_PAYLOAD, postRetentionAction: 'archive', archiveRetentionPeriod: 'P5Y', archiveRetentionBasis: 'Obrigação X, art. Y' };

    it('accepts both with an archive policy, and stores them', () => {
      expect(RetentionPolicyModel.validate(ARCHIVE).isValid).toBe(true);
      const doc = RetentionPolicyModel.create({ ...ARCHIVE, archiveRetentionBasis: '  Obrigação X, art. Y  ' });
      expect(doc).toMatchObject({ archiveRetentionPeriod: 'P5Y', archiveRetentionBasis: 'Obrigação X, art. Y' });
    });

    it('accepts an archive policy with neither', () => {
      expect(RetentionPolicyModel.validate({ ...VALID_PAYLOAD, postRetentionAction: 'archive' }).isValid).toBe(true);
    });

    it('refuses one without the other', () => {
      const { archiveRetentionBasis: _b, ...noBasis } = ARCHIVE;
      const { archiveRetentionPeriod: _p, ...noPeriod } = ARCHIVE;
      expect(RetentionPolicyModel.validate(noBasis).errors).toEqual(expect.arrayContaining([expect.stringContaining('vêm juntos')]));
      expect(RetentionPolicyModel.validate(noPeriod).errors).toEqual(expect.arrayContaining([expect.stringContaining('vêm juntos')]));
    });

    it('refuses them on a policy that does not archive', () => {
      expect(RetentionPolicyModel.validate({ ...ARCHIVE, postRetentionAction: 'destroy' }).errors)
        .toEqual(expect.arrayContaining([expect.stringContaining('só se aplicam a postRetentionAction "archive"')]));
    });

    it('refuses an invalid or shorter period, and a blank basis', () => {
      expect(RetentionPolicyModel.validate({ ...ARCHIVE, archiveRetentionPeriod: '5 anos' }).errors)
        .toEqual(expect.arrayContaining([expect.stringContaining('duração ISO 8601')]));
      expect(RetentionPolicyModel.validate({ ...ARCHIVE, archiveRetentionPeriod: 'P30D' }).errors)
        .toEqual(expect.arrayContaining([expect.stringContaining('não pode ser menor que retentionPeriod')]));
      expect(RetentionPolicyModel.validate({ ...ARCHIVE, archiveRetentionBasis: '   ' }).errors)
        .toEqual(expect.arrayContaining([expect.stringContaining('deve citar a obrigação')]));
    });
  });
});
