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

    it('#706: rejects the whole write when one of several codings is invalid, even though the others are active (RF005 AC#4\'s "somente" gates the write, not a per-coding drop)', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      await expect(
        createCondition(db, {
          participantId: 'PART-1',
          conditionCoding: [
            { systemUri: SYSTEM_URI, code: CODE },
            { systemUri: 'http://www.orpha.net', code: 'ORPHA:DOES-NOT-EXIST' },
          ],
        })
      ).rejects.toThrow(/não pertence a uma release de referência ativa/);
      expect(db.collections.conditions?.docs || []).toHaveLength(0);
    });

    it('#866 (RF005 AC#5): stamps the resolved TerminologyConcept version onto conditionCoding when the caller omitted it', async () => {
      const db = createFakeDb(activeConceptAndRelease());

      await createCondition(db, {
        participantId: 'PART-1',
        conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }],
      });

      expect(db.collections.conditions.docs[0].conditionCoding[0].version).toBe('2026-01');
    });

    it('#866: never overwrites a version the caller explicitly supplied', async () => {
      // checkActiveCode resolves an explicit version via an exact
      // systemUri+code+version match, so the seeded concept's version must
      // equal the caller-supplied one for the code check to pass at all --
      // this still proves the caller's own value reaches the stored
      // document untouched, via the `if (!coding.version)` guard, rather
      // than being unconditionally re-assigned from the validator result.
      const db = createFakeDb(
        activeConceptAndRelease({
          terminologyConcepts: [
            {
              systemUri: SYSTEM_URI,
              code: CODE,
              version: 'caller-supplied-version',
              conceptStatus: 'active',
              referenceDatasetReleaseId: 'release-1',
            },
          ],
        })
      );

      await createCondition(db, {
        participantId: 'PART-1',
        conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE, version: 'caller-supplied-version' }],
      });

      expect(db.collections.conditions.docs[0].conditionCoding[0].version).toBe('caller-supplied-version');
    });

    it('#866: leaves version absent (not null/invented) when the validator resolves the code without a version', async () => {
      const db = createFakeDb(
        activeConceptAndRelease({
          terminologyConcepts: [
            { systemUri: SYSTEM_URI, code: CODE, conceptStatus: 'active', referenceDatasetReleaseId: 'release-1' },
          ],
        })
      );

      await createCondition(db, {
        participantId: 'PART-1',
        conditionCoding: [{ systemUri: SYSTEM_URI, code: CODE }],
      });

      expect(db.collections.conditions.docs).toHaveLength(1);
      expect('version' in db.collections.conditions.docs[0].conditionCoding[0]).toBe(false);
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
