import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AllergyIntoleranceModel = require('../../../src/models/AllergyIntolerance');

const DCB_CODING = { systemUri: 'http://dcb.example', code: 'DCB:0001' };

describe('AllergyIntoleranceModel', () => {
  describe('create', () => {
    it('requires allergenCoding', () => {
      expect(() => AllergyIntoleranceModel.create({})).toThrow(
        'allergenCoding é obrigatório para AllergyIntolerance (systemUri e code)'
      );
    });

    it('rejects an allergenCoding missing systemUri or code', () => {
      expect(() => AllergyIntoleranceModel.create({ allergenCoding: { code: 'DCB:0001' } })).toThrow(
        'allergenCoding é obrigatório'
      );
    });

    it('builds a full allergy document with a generated allergyId', () => {
      const doc = AllergyIntoleranceModel.create({ allergenCoding: DCB_CODING });

      expect(doc.allergyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.allergenCoding).toEqual(DCB_CODING);
      expect(doc.reaction).toEqual([]);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('carries reaction entries when given', () => {
      const doc = AllergyIntoleranceModel.create({
        allergenCoding: DCB_CODING,
        reaction: [{ manifestation: 'urticaria', severity: 'moderate' }],
      });

      expect(doc.reaction).toEqual([{ manifestation: 'urticaria', severity: 'moderate' }]);
    });
  });
});
