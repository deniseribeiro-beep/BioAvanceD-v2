import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createMedicationExposure, getMedicationExposureById } = require('../../../src/services/medication-exposure.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const ATC_CODING = { systemUri: 'http://www.whocc.no/atc', code: 'N02BE01' };

describe('medication-exposure.service', () => {
  describe('createMedicationExposure', () => {
    it('persists a medication exposure document', async () => {
      const db = createFakeDb({});

      const stored = await createMedicationExposure(db, {
        medicationCoding: [ATC_CODING],
        recordType: 'administered',
        medicationStatus: 'active',
      });

      expect(stored.medicationCoding).toEqual([ATC_CODING]);
      expect(db.collections.medicationExposures.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createMedicationExposure(db, {})).rejects.toThrow('medicationCoding é obrigatório para MedicationExposure');
      expect(db.collections.medicationExposures?.docs || []).toHaveLength(0);
    });
  });

  describe('getMedicationExposureById', () => {
    it('resolves by medicationRecordId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createMedicationExposure(db, {
        medicationRecordId: 'med-fixed',
        medicationCoding: [ATC_CODING],
        recordType: 'administered',
        medicationStatus: 'active',
      });

      const resolved = await getMedicationExposureById(db, created.medicationRecordId);

      expect(resolved.medicationRecordId).toBe('med-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getMedicationExposureById(db, null)).toBeNull();
    });
  });
});
