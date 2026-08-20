import { describe, it, expect } from 'vitest';

const NonconformanceModel = require('../../../src/models/Nonconformance');

describe('NonconformanceModel (RF025 AC#5/#6, dict-02 ELM-0377..0387)', () => {
  const baseNonconformance = {
    nonconformanceType: 'deviation',
    detectedAt: '2026-08-20T10:00:00.000Z',
    detectedBy: 'user-1',
    description: 'Temperatura do freezer fora da faixa durante o ensaio',
    affectedEntityIds: ['assay-1'],
  };

  describe('validate', () => {
    it('valid minimal payload -> isValid true, no errors', () => {
      const result = NonconformanceModel.validate({ ...baseNonconformance });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['nonconformanceType', { nonconformanceType: '' }],
      ['detectedBy', { detectedBy: '' }],
      ['description', { description: '' }],
      ['affectedEntityIds', { affectedEntityIds: [] }],
      ['affectedEntityIds', { affectedEntityIds: 'not-an-array' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = NonconformanceModel.validate({ ...baseNonconformance, ...override });
      expect(result.isValid).toBe(false);
    });

    it('missing detectedAt -> isValid false', () => {
      const result = NonconformanceModel.validate({ ...baseNonconformance, detectedAt: undefined });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('detectedAt é obrigatório e deve ser uma data válida');
    });

    it('affectedEntityIds with a non-string entry -> isValid false', () => {
      const result = NonconformanceModel.validate({ ...baseNonconformance, affectedEntityIds: ['assay-1', 42] });
      expect(result.isValid).toBe(false);
    });

    it('immediateActions/rootCause omitted -> still valid (0..* / 0..1 per dict-02)', () => {
      const result = NonconformanceModel.validate({ ...baseNonconformance });
      expect(result.isValid).toBe(true);
    });

    it('immediateActions not an array -> isValid false', () => {
      const result = NonconformanceModel.validate({ ...baseNonconformance, immediateActions: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('opens with status open and null corrective-action/verification fields', () => {
      const result = NonconformanceModel.create({ ...baseNonconformance });

      expect(result.nonconformanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.status).toBe('open');
      expect(result.correctiveAction).toBeNull();
      expect(result.effectivenessVerification).toBeNull();
      expect(result.closureDate).toBeNull();
      expect(result.immediateActions).toEqual([]);
      expect(result.rootCause).toBeNull();
    });

    it('does not mutate the caller-provided affectedEntityIds array', () => {
      const affectedEntityIds = ['assay-1'];
      const result = NonconformanceModel.create({ ...baseNonconformance, affectedEntityIds });

      result.affectedEntityIds.push('assay-2');
      expect(affectedEntityIds).toEqual(['assay-1']);
    });
  });

  describe('validateCorrectiveAction', () => {
    it('valid payload -> isValid true', () => {
      const result = NonconformanceModel.validateCorrectiveAction({
        description: 'Recalibrar sensor e revisar protocolo',
        responsible: 'user-2',
      });
      expect(result.isValid).toBe(true);
    });

    it.each([
      ['description', { description: '' }],
      ['responsible', { responsible: '' }],
    ])('missing %s -> isValid false', (_field, override) => {
      const result = NonconformanceModel.validateCorrectiveAction({
        description: 'x',
        responsible: 'user-2',
        ...override,
      });
      expect(result.isValid).toBe(false);
    });

    it('invalid dueDate -> isValid false', () => {
      const result = NonconformanceModel.validateCorrectiveAction({
        description: 'x',
        responsible: 'user-2',
        dueDate: 'not-a-date',
      });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateEffectivenessVerification', () => {
    it('valid effective payload -> isValid true', () => {
      const result = NonconformanceModel.validateEffectivenessVerification({
        verifiedBy: 'user-3',
        outcome: 'effective',
      });
      expect(result.isValid).toBe(true);
    });

    it('rejects an outcome outside the enum', () => {
      const result = NonconformanceModel.validateEffectivenessVerification({
        verifiedBy: 'user-3',
        outcome: 'maybe',
      });
      expect(result.isValid).toBe(false);
    });

    it('missing verifiedBy -> isValid false', () => {
      const result = NonconformanceModel.validateEffectivenessVerification({ outcome: 'effective' });
      expect(result.isValid).toBe(false);
    });
  });
});
