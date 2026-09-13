import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAllergyIntolerance, getAllergyIntoleranceById } = require('../../../src/services/allergy-intolerance.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const DCB_CODING = { systemUri: 'http://dcb.example', code: 'DCB:0001' };

describe('allergy-intolerance.service', () => {
  describe('createAllergyIntolerance', () => {
    it('persists an allergy document', async () => {
      const db = createFakeDb({});

      const stored = await createAllergyIntolerance(db, { allergenCoding: DCB_CODING });

      expect(stored.allergenCoding).toEqual(DCB_CODING);
      expect(db.collections.allergyIntolerances.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createAllergyIntolerance(db, {})).rejects.toThrow('allergenCoding é obrigatório para AllergyIntolerance');
      expect(db.collections.allergyIntolerances?.docs || []).toHaveLength(0);
    });
  });

  describe('getAllergyIntoleranceById', () => {
    it('resolves by allergyId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createAllergyIntolerance(db, { allergyId: 'allergy-fixed', allergenCoding: DCB_CODING });

      const resolved = await getAllergyIntoleranceById(db, created.allergyId);

      expect(resolved.allergyId).toBe('allergy-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getAllergyIntoleranceById(db, null)).toBeNull();
    });
  });
});
