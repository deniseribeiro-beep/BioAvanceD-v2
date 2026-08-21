import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createCondition, getConditionsForParticipant, getConditionById } = require('../../../src/services/condition.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const SYSTEM_URI = 'http://id.who.int/icd/release/11/mms';
const CODE = 'ICD11:1A00';

function activeConceptAndRelease(overrides = {}) {
  return {
    terminologyConcepts: [
      { systemUri: SYSTEM_URI, code: CODE, version: '2026-01', conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
    ],
    referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'ICD11', releaseStatus: 'active' }],
    ...overrides,
  };
}

describe('condition.service', () => {
  describe('createCondition', () => {
    it('persists a condition whose coding resolves to an active release', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      const stored = await createCondition(db, {
        participantId: 'PART-1',
        conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }],
      });

      expect(stored.participantId).toBe('PART-1');
      expect(db.collections.conditions.docs).toHaveLength(1);
    });

    it('rejects (RF005 AC#4) a coding whose release is not active, without persisting anything', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          referenceDatasetReleases: [{ referenceDatasetReleaseId: 'release-1', datasetCode: 'ICD11', releaseStatus: 'superseded' }],
        })
      );

      await expect(
        createCondition(db, { participantId: 'PART-1', conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }] })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.conditions?.docs || []).toHaveLength(0);
    });

    it('rejects an unknown code (no matching TerminologyConcept at all)', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });

      await expect(
        createCondition(db, { participantId: 'PART-1', conditionCoding: [{ systemUri: SYSTEM_URI, code: 'ICD11:UNKNOWN' }] })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
    });

    it('propagates model validation failures before ever touching the code check', async () => {
      const db = createFakeDb({});

      await expect(createCondition(db, {})).rejects.toThrow('participantId é obrigatório para Condition');
      expect(db.collections.conditions?.docs || []).toHaveLength(0);
    });
  });

  describe('getConditionsForParticipant', () => {
    it('scopes results to the requested participantId only', async () => {
      const db = createFakeDb(activeConceptAndRelease());
      await createCondition(db, { participantId: 'PART-1', conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }] });
      await createCondition(db, { participantId: 'PART-2', conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }] });

      const conditions = await getConditionsForParticipant(db, 'PART-1');

      expect(conditions).toHaveLength(1);
      expect(conditions[0].participantId).toBe('PART-1');
    });
  });

  describe('getConditionById', () => {
    it('resolves by conditionId, not Mongo _id', async () => {
      const db = createFakeDb(activeConceptAndRelease());
      const created = await createCondition(db, {
        conditionId: 'cond-fixed',
        participantId: 'PART-1',
        conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }],
      });

      const resolved = await getConditionById(db, created.conditionId);

      expect(resolved.conditionId).toBe('cond-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getConditionById(db, null)).toBeNull();
    });
  });
});
