import { describe, it, expect } from 'vitest';

const LegalHoldModel = require('../../../src/models/LegalHold');

describe('LegalHoldModel (RF026 AC#2/#6)', () => {
  const baseHold = {
    targetEntityType: 'Sample',
    targetEntityIds: ['specimen-1'],
    reason: 'Investigação em andamento (ordem judicial)',
    imposedBy: 'user-1',
  };

  describe('validate', () => {
    it('valid payload -> isValid true, no errors', () => {
      const result = LegalHoldModel.validate({ ...baseHold });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['targetEntityType', { targetEntityType: '' }],
      ['targetEntityIds', { targetEntityIds: [] }],
      ['targetEntityIds', { targetEntityIds: 'not-an-array' }],
      ['reason', { reason: '' }],
      ['imposedBy', { imposedBy: '' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = LegalHoldModel.validate({ ...baseHold, ...override });
      expect(result.isValid).toBe(false);
    });

    it('targetEntityIds with a non-string entry -> isValid false', () => {
      const result = LegalHoldModel.validate({ ...baseHold, targetEntityIds: ['specimen-1', 42] });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('opens active, with null release fields', () => {
      const result = LegalHoldModel.create({ ...baseHold });

      expect(result.legalHoldId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.status).toBe('active');
      expect(result.releasedBy).toBeNull();
      expect(result.releasedAt).toBeNull();
      expect(result.releaseReason).toBeNull();
      expect(result.imposedAt).toBeInstanceOf(Date);
    });

    it('does not mutate the caller-provided targetEntityIds array', () => {
      const targetEntityIds = ['specimen-1'];
      const result = LegalHoldModel.create({ ...baseHold, targetEntityIds });

      result.targetEntityIds.push('specimen-2');
      expect(targetEntityIds).toEqual(['specimen-1']);
    });

    it('preserves a caller-supplied legalHoldId instead of discarding it', () => {
      const result = LegalHoldModel.create({ ...baseHold, legalHoldId: 'legal-hold-fixed-1' });
      expect(result.legalHoldId).toBe('legal-hold-fixed-1');
    });

    it('generates a uuid legalHoldId when none is supplied', () => {
      const result = LegalHoldModel.create({ ...baseHold });
      expect(result.legalHoldId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});
