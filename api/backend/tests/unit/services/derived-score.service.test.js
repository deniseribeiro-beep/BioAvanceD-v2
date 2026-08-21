import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createDerivedScore, getDerivedScoreById } = require('../../../src/services/derived-score.service');
const { createFakeDb } = require('../ingestion/testHelpers');

const CHARLSON_COMPONENTS = [{ condition: 'diabetes', weight: 1 }];

describe('derived-score.service', () => {
  describe('createDerivedScore', () => {
    it('persists a score document', async () => {
      const db = createFakeDb({});

      const stored = await createDerivedScore(db, {
        scoreType: { code: 'CCI' },
        scoreValue: 4,
        algorithmVersion: 'CCI-original',
        scoreComponents: CHARLSON_COMPONENTS,
      });

      expect(stored.scoreValue).toBe(4);
      expect(db.collections.derivedScores.docs).toHaveLength(1);
    });

    it('propagates model validation failures (e.g. empty scoreComponents) instead of persisting', async () => {
      const db = createFakeDb({});

      await expect(
        createDerivedScore(db, { scoreType: { code: 'CCI' }, scoreValue: 4, algorithmVersion: 'CCI-original', scoreComponents: [] })
      ).rejects.toThrow('scoreComponents é obrigatório');
      expect(db.collections.derivedScores?.docs || []).toHaveLength(0);
    });
  });

  describe('getDerivedScoreById', () => {
    it('resolves by derivedScoreId, not Mongo _id', async () => {
      const db = createFakeDb({});
      const created = await createDerivedScore(db, {
        derivedScoreId: 'score-fixed',
        scoreType: { code: 'CCI' },
        scoreValue: 4,
        algorithmVersion: 'CCI-original',
        scoreComponents: CHARLSON_COMPONENTS,
      });

      const resolved = await getDerivedScoreById(db, created.derivedScoreId);

      expect(resolved.derivedScoreId).toBe('score-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getDerivedScoreById(db, null)).toBeNull();
    });
  });
});
