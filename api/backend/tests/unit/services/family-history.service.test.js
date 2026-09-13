import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createFamilyHistory, getFamilyHistoryById } = require('../../../src/services/family-history.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const ORPHA_SYSTEM_URI = 'http://www.orpha.net';
const ORPHA_CODE = 'ORPHA:558';

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      { systemUri: ORPHA_SYSTEM_URI, code: ORPHA_CODE, version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
    ],
    referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'ORPHA', releaseStatus: 'active' }],
    ...overrides,
  };
}

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

    it('(RF005 AC#4) persists a familyCondition entry whose coding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createFamilyHistory(db, {
        relationship: { code: 'mother' },
        familyCondition: [{ condition: { systemUri: ORPHA_SYSTEM_URI, code: ORPHA_CODE }, onset: '30 anos' }],
      });

      expect(stored.familyCondition).toHaveLength(1);
      expect(db.collections.familyHistories.docs).toHaveLength(1);
    });

    it('(RF005 AC#4) rejects a familyCondition entry whose code has no active release, without persisting anything', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'ORPHA', releaseStatus: 'superseded' }],
        })
      );

      await expect(
        createFamilyHistory(db, {
          relationship: { code: 'mother' },
          familyCondition: [{ condition: { systemUri: ORPHA_SYSTEM_URI, code: ORPHA_CODE } }],
        })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.familyHistories?.docs || []).toHaveLength(0);
    });

    it('passes an uncoded free-text familyCondition entry through untouched (no systemUri/code, no gate applied)', async () => {
      const db = createFakeDb({});

      const stored = await createFamilyHistory(db, {
        relationship: { code: 'mother' },
        familyCondition: [{ condition: { display: 'Marfan syndrome' }, onset: '30 anos' }],
      });

      expect(stored.familyCondition).toEqual([{ condition: { display: 'Marfan syndrome' }, onset: '30 anos' }]);
      expect(db.collections.familyHistories.docs).toHaveLength(1);
    });

    it('(RF005 AC#5) stamps the resolved TerminologyConcept version onto familyCondition when the caller omitted it', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      await createFamilyHistory(db, {
        relationship: { code: 'mother' },
        familyCondition: [{ condition: { systemUri: ORPHA_SYSTEM_URI, code: ORPHA_CODE } }],
      });

      expect(db.collections.familyHistories.docs[0].familyCondition[0].condition.version).toBe('2026-01');
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
