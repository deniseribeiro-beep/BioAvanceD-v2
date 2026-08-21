import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createFamilyHistory, getFamilyHistoryById } = require('../../../src/services/family-history.service');
const { createFakeDb } = require('../ingestion/testHelpers');

describe('family-history.service', () => {
  describe('createFamilyHistory', () => {
    it('persists a family history document', async () => {
      const db = createFakeDb({});

      const stored = await createFamilyHistory(db, { relationship: { code: 'mother' } });

      expect(stored.relationship).toEqual({ code: 'mother' });
      expect(db.collections.familyHistories.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createFamilyHistory(db, {})).rejects.toThrow('relationship é obrigatório para FamilyHistory');
      expect(db.collections.familyHistories?.docs || []).toHaveLength(0);
    });
  });

  describe('getFamilyHistoryById', () => {
    it('resolves by familyHistoryId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createFamilyHistory(db, { familyHistoryId: 'fh-fixed', relationship: { code: 'father' } });

      const resolved = await getFamilyHistoryById(db, created.familyHistoryId);

      expect(resolved.familyHistoryId).toBe('fh-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getFamilyHistoryById(db, null)).toBeNull();
    });
  });
});
