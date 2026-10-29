import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAllergyIntolerance, getAllergyIntoleranceById } = require('../../../src/services/allergy-intolerance.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const DCB_SYSTEM_URI = 'https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb';
const DCB_CODE = 'DCB:0001';
const DCB_CODING = { systemUri: DCB_SYSTEM_URI, code: DCB_CODE };

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      { systemUri: DCB_SYSTEM_URI, code: DCB_CODE, version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
    ],
    referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'DCB', releaseStatus: 'active' }],
    ...overrides,
  };
}

describe('allergy-intolerance.service', () => {
  describe('createAllergyIntolerance', () => {
    it('(RF005 AC#4) persists an allergy document whose allergenCoding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createAllergyIntolerance(db, { allergenCoding: DCB_CODING });

      expect(stored.allergenCoding).toMatchObject(DCB_CODING);
      expect(db.collections.allergyIntolerances.docs).toHaveLength(1);
    });

    it('propagates model validation failures instead of persisting an invalid document', async () => {
      const db = createFakeDb({});

      await expect(createAllergyIntolerance(db, {})).rejects.toThrow('allergenCoding é obrigatório para AllergyIntolerance');
      expect(db.collections.allergyIntolerances?.docs || []).toHaveLength(0);
    });

    it('(RF005 AC#4) rejects an allergenCoding with an unknown code, without persisting anything', async () => {
      const db = createFakeDb({});

      await expect(
        createAllergyIntolerance(db, { allergenCoding: { systemUri: DCB_SYSTEM_URI, code: 'DCB:UNKNOWN' } })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.allergyIntolerances?.docs || []).toHaveLength(0);
    });

    it('(RF005 AC#4) rejects an allergenCoding whose release is inactive, without persisting anything', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'DCB', releaseStatus: 'superseded' }],
        })
      );

      await expect(createAllergyIntolerance(db, { allergenCoding: DCB_CODING })).rejects.toThrow(
        /não pertence a uma release de referência ativa/
      );
      expect(db.collections.allergyIntolerances?.docs || []).toHaveLength(0);
    });

    it('(RF005 AC#5) stamps the resolved TerminologyConcept version onto allergenCoding when the caller omitted it', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createAllergyIntolerance(db, { allergenCoding: DCB_CODING });

      expect(stored.allergenCoding.version).toBe('2026-01');
    });
  });

  describe('getAllergyIntoleranceById', () => {
    it('resolves by allergyId, not Mongo _id', async () => {
      const db = createFakeDb(activeConceptAndRelease());
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
