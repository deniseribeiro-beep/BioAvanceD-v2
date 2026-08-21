import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FamilyHistoryModel = require('../../../src/models/FamilyHistory');

describe('FamilyHistoryModel', () => {
  describe('create', () => {
    it('requires relationship', () => {
      expect(() => FamilyHistoryModel.create({})).toThrow('relationship é obrigatório para FamilyHistory');
    });

    it('builds a full family history document with a generated familyHistoryId', () => {
      const doc = FamilyHistoryModel.create({ relationship: { code: 'mother' } });

      expect(doc.familyHistoryId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.relationship).toEqual({ code: 'mother' });
      expect(doc.familyCondition).toEqual([]);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('carries familyCondition entries when given', () => {
      const doc = FamilyHistoryModel.create({
        relationship: { code: 'father' },
        familyCondition: [{ systemUri: 'http://www.orpha.net', code: 'ORPHA:558', onsetAge: 45 }],
      });

      expect(doc.familyCondition).toEqual([{ systemUri: 'http://www.orpha.net', code: 'ORPHA:558', onsetAge: 45 }]);
    });
  });
});
