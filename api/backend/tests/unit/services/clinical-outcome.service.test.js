import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createClinicalOutcome, getClinicalOutcomeById } = require('../../../src/services/clinical-outcome.service');
const { createFakeDb } = require('../ingestion/testHelpers');

describe('clinical-outcome.service', () => {
  describe('createClinicalOutcome', () => {
    it('persists an outcome document', async () => {
      const db = createFakeDb({});

      const stored = await createClinicalOutcome(db, { outcomeType: { code: 'progression' }, outcomeDate: '2026-01-01' });

      expect(stored.outcomeType).toEqual({ code: 'progression' });
      expect(db.collections.clinicalOutcomes.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createClinicalOutcome(db, {})).rejects.toThrow('outcomeType é obrigatório para ClinicalOutcome');
      expect(db.collections.clinicalOutcomes?.docs || []).toHaveLength(0);
    });
  });

  describe('getClinicalOutcomeById', () => {
    it('resolves by outcomeId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createClinicalOutcome(db, { outcomeId: 'outcome-fixed', outcomeType: { code: 'remission' }, outcomeDate: '2026-01-01' });

      const resolved = await getClinicalOutcomeById(db, created.outcomeId);

      expect(resolved.outcomeId).toBe('outcome-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getClinicalOutcomeById(db, null)).toBeNull();
    });
  });
});
