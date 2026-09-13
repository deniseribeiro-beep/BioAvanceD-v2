import { describe, it, expect } from 'vitest';

const DispositionActionModel = require('../../../src/models/DispositionAction');

describe('DispositionActionModel (RF026 AC#3/#4/#5, dict-02 ELM-0411..0415)', () => {
  const baseDisposition = {
    retentionPolicyId: '65f0a1b2c3d4e5f6a7b8c9d0',
    entityType: 'Log',
    affectedRecordIds: ['log-1', 'log-2'],
    dispositionAction: 'destroy',
    performedBy: 'user-1',
  };

  describe('validate', () => {
    it('valid minimal payload -> isValid true, no errors', () => {
      const result = DispositionActionModel.validate({ ...baseDisposition });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['retentionPolicyId', { retentionPolicyId: '' }],
      ['entityType', { entityType: '' }],
      ['affectedRecordIds', { affectedRecordIds: [] }],
      ['affectedRecordIds', { affectedRecordIds: 'not-an-array' }],
      ['performedBy', { performedBy: '' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = DispositionActionModel.validate({ ...baseDisposition, ...override });
      expect(result.isValid).toBe(false);
    });

    it('dispositionAction outside the enum -> isValid false', () => {
      const result = DispositionActionModel.validate({ ...baseDisposition, dispositionAction: 'delete' });
      expect(result.isValid).toBe(false);
    });

    it.each(['transfer', 'return', 'destroy', 'anonymize', 'preserve'])(
      'dispositionAction "%s" is a valid enum value',
      (value) => {
        const result = DispositionActionModel.validate({ ...baseDisposition, dispositionAction: value });
        expect(result.isValid).toBe(true);
      }
    );

    it('dispositionMethod/dispositionCertificateUri omitted -> still valid (0..1 per dict-02)', () => {
      const result = DispositionActionModel.validate({ ...baseDisposition });
      expect(result.isValid).toBe(true);
    });
  });

  describe('create', () => {
    it('generates a uuid dispositionActionId and a default certificate URI', () => {
      const result = DispositionActionModel.create({ ...baseDisposition });

      expect(result.dispositionActionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.dispositionCertificateUri).toBe(`/api/disposition-actions/${result.dispositionActionId}/certificate`);
      expect(result.dispositionDateTime).toBeInstanceOf(Date);
      expect(result.legalHold).toBe(false);
    });

    it('preserves a caller-provided dispositionCertificateUri instead of defaulting', () => {
      const result = DispositionActionModel.create({ ...baseDisposition, dispositionCertificateUri: 'objstore://certs/custom.pdf' });
      expect(result.dispositionCertificateUri).toBe('objstore://certs/custom.pdf');
    });

    it('records legalHold truthfully when passed true', () => {
      const result = DispositionActionModel.create({ ...baseDisposition, legalHold: true });
      expect(result.legalHold).toBe(true);
    });

    it('does not mutate the caller-provided affectedRecordIds array', () => {
      const affectedRecordIds = ['log-1'];
      const result = DispositionActionModel.create({ ...baseDisposition, affectedRecordIds });

      result.affectedRecordIds.push('log-2');
      expect(affectedRecordIds).toEqual(['log-1']);
    });

    it('preserves a caller-supplied dispositionActionId instead of discarding it', () => {
      const result = DispositionActionModel.create({ ...baseDisposition, dispositionActionId: 'disposition-fixed-1' });
      expect(result.dispositionActionId).toBe('disposition-fixed-1');
    });

    it('generates a uuid dispositionActionId when none is supplied', () => {
      const result = DispositionActionModel.create({ ...baseDisposition });
      expect(result.dispositionActionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});
