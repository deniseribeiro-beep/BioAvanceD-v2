import { describe, it, expect } from 'vitest';

const OmicsQualificationModel = require('../../../src/models/OmicsQualification');

describe('OmicsQualificationModel (RF027 AC#6, dict-02 ELM-0337..0342)', () => {
  const baseQualification = {
    targetAssay: 'RNA-seq',
    qcRuleSetVersion: 'RNA_QC_1.0',
    qcMetrics: [{ metric: 'RIN', value: 8.2 }],
    qualificationDecision: 'eligible',
  };

  describe('validate', () => {
    it('valid payload -> isValid true, no errors', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['targetAssay', { targetAssay: '' }],
      ['qcRuleSetVersion', { qcRuleSetVersion: '' }],
      ['qcMetrics', { qcMetrics: [] }],
      ['qcMetrics', { qcMetrics: 'not-an-array' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, ...override });
      expect(result.isValid).toBe(false);
    });

    it('qcMetrics entry not an object -> isValid false', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, qcMetrics: ['not-an-object'] });
      expect(result.isValid).toBe(false);
    });

    it('qualificationDecision missing -> isValid false', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, qualificationDecision: undefined });
      expect(result.isValid).toBe(false);
    });

    it('qualificationDecision out of enum -> isValid false', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, qualificationDecision: 'maybe' });
      expect(result.isValid).toBe(false);
    });

    it.each(['eligible', 'ineligible', 'conditional', 'review_required'])('qualificationDecision %s -> isValid true', (qualificationDecision) => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, qualificationDecision });
      expect(result.isValid).toBe(true);
    });

    it('limitations omitted -> still valid (0..1 per dict-02)', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification });
      expect(result.isValid).toBe(true);
    });

    it('limitations not a string -> isValid false', () => {
      const result = OmicsQualificationModel.validate({ ...baseQualification, limitations: 42 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('generates a uuid omicsQualificationId, preserves required fields, defaults limitations', () => {
      const result = OmicsQualificationModel.create({ ...baseQualification });

      expect(result.omicsQualificationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.targetAssay).toBe('RNA-seq');
      expect(result.qcRuleSetVersion).toBe('RNA_QC_1.0');
      expect(result.qcMetrics).toEqual([{ metric: 'RIN', value: 8.2 }]);
      expect(result.qualificationDecision).toBe('eligible');
      expect(result.limitations).toBeNull();
    });

    it('does not mutate the caller-provided qcMetrics array', () => {
      const qcMetrics = [{ metric: 'RIN', value: 8.2 }];
      const result = OmicsQualificationModel.create({ ...baseQualification, qcMetrics });

      result.qcMetrics.push({ metric: 'coverage', value: 30 });
      expect(qcMetrics).toEqual([{ metric: 'RIN', value: 8.2 }]);
    });

    it('limitations provided -> preserved', () => {
      const result = OmicsQualificationModel.create({ ...baseQualification, limitations: 'Low input RNA quality' });
      expect(result.limitations).toBe('Low input RNA quality');
    });
  });
});
