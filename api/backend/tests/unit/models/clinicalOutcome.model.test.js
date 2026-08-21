import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ClinicalOutcomeModel = require('../../../src/models/ClinicalOutcome');

describe('ClinicalOutcomeModel', () => {
  describe('create', () => {
    it('requires outcomeType and outcomeDate', () => {
      expect(() => ClinicalOutcomeModel.create({})).toThrow(
        'outcomeType é obrigatório para ClinicalOutcome, outcomeDate é obrigatório para ClinicalOutcome'
      );
    });

    it('builds a full outcome document with a generated outcomeId', () => {
      const doc = ClinicalOutcomeModel.create({ outcomeType: { code: 'progression' }, outcomeDate: '2026-01-01' });

      expect(doc.outcomeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.outcomeType).toEqual({ code: 'progression' });
      expect(doc.outcomeDate).toBeInstanceOf(Date);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('honors an explicit outcomeId instead of generating one', () => {
      const doc = ClinicalOutcomeModel.create({ outcomeId: 'fixed-id', outcomeType: { code: 'remission' }, outcomeDate: '2026-01-01' });
      expect(doc.outcomeId).toBe('fixed-id');
    });
  });
});
