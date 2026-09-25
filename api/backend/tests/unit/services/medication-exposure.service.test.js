import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createMedicationExposure, getMedicationExposureById } = require('../../../src/services/medication-exposure.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const ATC_SYSTEM_URI = 'http://www.whocc.no/atc';
const ATC_CODE = 'N02BE01';
const ATC_CODING = { systemUri: ATC_SYSTEM_URI, code: ATC_CODE };

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      {
        systemUri: ATC_SYSTEM_URI,
        code: ATC_CODE,
        version: '2026-01',
        conceptStatus: 'active',
        referenceDatasetReleaseId: 'release-atc',
      },
    ],
    referenceDatasetReleases: [
      { referenceDatasetReleaseId: 'release-atc', datasetCode: 'ATC', releaseStatus: 'active' },
    ],
    ...overrides,
  };
}

describe('medication-exposure.service', () => {
  describe('createMedicationExposure', () => {
    it('(RF005 AC#4 / #714) persists a medication exposure whose coding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createMedicationExposure(db, {
        medicationCoding: [ATC_CODING],
        recordType: 'administered',
        medicationStatus: 'active',
      });

      expect(stored.medicationCoding).toMatchObject([ATC_CODING]);
      expect(db.collections.medicationExposures.docs).toHaveLength(1);
    });

    it('(RF005 AC#4 / #714) rejects a coding with no active release, without persisting', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [
            { referenceDatasetReleaseId: 'release-atc', datasetCode: 'ATC', releaseStatus: 'superseded' },
          ],
        })
      );

      await expect(
        createMedicationExposure(db, {
          medicationCoding: [ATC_CODING],
          recordType: 'administered',
          medicationStatus: 'active',
        })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.medicationExposures?.docs || []).toHaveLength(0);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createMedicationExposure(db, {})).rejects.toThrow('medicationCoding é obrigatório para MedicationExposure');
      expect(db.collections.medicationExposures?.docs || []).toHaveLength(0);
    });
  });

  describe('getMedicationExposureById', () => {
    it('resolves by medicationRecordId, not Mongo _id', async () => {
      const db = createFakeDb(activeConceptAndRelease());
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
