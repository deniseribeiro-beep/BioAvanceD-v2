import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  recordProfile,
  getProfilesForSpecimen,
  getProfileById,
  getCurrentProfilesForSpecimens,
  findSpecimenIdsWithCurrentProfileMatching,
} = require('../../../src/services/specimen-preanalytics.service');

/**
 * Real query-matching fake (exact-match filter + sort, plus $in for the
 * batched getCurrentProfilesForSpecimens path), not a canned stub — proves
 * getProfilesForSpecimen actually scopes by specimenId and orders by
 * recency, per build-loop's native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matchesCondition = (value, condition) => {
    if (condition && typeof condition === 'object' && condition.$in) {
      return condition.$in.some((candidate) => String(value) === String(candidate));
    }
    return value === condition;
  };
  const matches = (doc, filter) => Object.keys(filter).every((key) => matchesCondition(doc[key], filter[key]));
  return {
    docs,
    async insertOne(doc) {
      // Mirrors the real MongoDB driver, which mutates the passed document
      // with the generated _id — recordProfile's callers rely on this to
      // pin a sample to the returned snapshot's _id (#502).
      doc._id = `fake-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      let current = docs.filter((doc) => matches(doc, filter));
      const cursor = {
        sort(criteria = {}) {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const left = a?.[field]?.getTime ? a[field].getTime() : a?.[field];
            const right = b?.[field]?.getTime ? b[field].getTime() : b?.[field];
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        },
        async toArray() {
          return current;
        },
      };
      return cursor;
    },
  };
}

function createFakeDb() {
  const collections = { specimenPreanalytics: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('specimen-preanalytics.service', () => {
  describe('recordProfile', () => {
    it('persists a versioned snapshot referenced by specimenId', async () => {
      const db = createFakeDb();

      const stored = await recordProfile(db, 'SPEC-1', {
        matrixType: 'fluid',
        sampleType: 'BLD',
        primaryContainer: 'PED',
        longTermStorage: 'F',
      });

      expect(stored.specimenId).toBe('SPEC-1');
      expect(stored.matrixType).toBe('fluid');
      expect(db.collections.specimenPreanalytics.docs).toHaveLength(1);
      expect(db.collections.specimenPreanalytics.docs[0].specimenId).toBe('SPEC-1');
    });

    it('does not overwrite a prior snapshot — each call adds a new versioned record', async () => {
      const db = createFakeDb();

      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid' });
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid' });

      expect(db.collections.specimenPreanalytics.docs).toHaveLength(2);
    });
  });

  describe('getProfilesForSpecimen', () => {
    it('scopes results to the requested specimenId only', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid' });
      await recordProfile(db, 'SPEC-2', { matrixType: 'solid' });

      const profiles = await getProfilesForSpecimen(db, 'SPEC-1');

      expect(profiles).toHaveLength(1);
      expect(profiles[0].specimenId).toBe('SPEC-1');
    });

    it('returns snapshots newest-first', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid', recordedAt: '2026-01-01' });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid', recordedAt: '2026-06-01' });

      const profiles = await getProfilesForSpecimen(db, 'SPEC-1');

      expect(profiles.map((p) => p.matrixType)).toEqual(['solid', 'fluid']);
    });
  });

  describe('getProfileById', () => {
    it('resolves the exact snapshot by _id, not the newest one for its specimenId (#502)', async () => {
      const db = createFakeDb();
      const older = await recordProfile(db, 'SPEC-1', { matrixType: 'fluid' });
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid' });

      const resolved = await getProfileById(db, older._id);

      expect(resolved.matrixType).toBe('fluid');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb();
      expect(await getProfileById(db, null)).toBeNull();
    });
  });

  describe('getCurrentProfilesForSpecimens', () => {
    it('resolves the newest profile per specimenId in one batched query (#517)', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid', recordedAt: '2026-01-01' });
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid', recordedAt: '2026-06-01' });
      await recordProfile(db, 'SPEC-2', { matrixType: 'fluid', recordedAt: '2026-03-01' });

      const result = await getCurrentProfilesForSpecimens(db, [
        { specimenId: 'SPEC-1' },
        { specimenId: 'SPEC-2' },
      ]);

      expect(result.get('SPEC-1').matrixType).toBe('solid');
      expect(result.get('SPEC-2').matrixType).toBe('fluid');
    });

    it('resolves the sealed-pinned snapshot instead of the newest one when sealedSpecimenPreanalyticsId is set (#502 precedent)', async () => {
      const db = createFakeDb();
      const older = await recordProfile(db, 'SPEC-1', { matrixType: 'fluid', recordedAt: '2026-01-01' });
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid', recordedAt: '2026-06-01' });

      const result = await getCurrentProfilesForSpecimens(db, [
        { specimenId: 'SPEC-1', sealedSpecimenPreanalyticsId: older._id },
      ]);

      expect(result.get('SPEC-1').matrixType).toBe('fluid');
    });

    it('maps a specimen with no recorded profile to null rather than omitting the key', async () => {
      const db = createFakeDb();

      const result = await getCurrentProfilesForSpecimens(db, [{ specimenId: 'SPEC-NONE' }]);

      expect(result.has('SPEC-NONE')).toBe(true);
      expect(result.get('SPEC-NONE')).toBeNull();
    });

    it('returns an empty map without querying when given no samples', async () => {
      const db = createFakeDb();

      const result = await getCurrentProfilesForSpecimens(db, []);

      expect(result.size).toBe(0);
    });
  });

  describe('findSpecimenIdsWithCurrentProfileMatching', () => {
    it('matches on the newest profile per specimenId, not a stale earlier one (#525)', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid', recordedAt: '2026-01-01' });
      await recordProfile(db, 'SPEC-1', { matrixType: 'solid', recordedAt: '2026-06-01' });
      await recordProfile(db, 'SPEC-2', { matrixType: 'fluid', recordedAt: '2026-03-01' });

      const solidMatches = await findSpecimenIdsWithCurrentProfileMatching(db, { matrixType: 'solid' });
      const fluidMatches = await findSpecimenIdsWithCurrentProfileMatching(db, { matrixType: 'fluid' });

      expect(solidMatches).toEqual(['SPEC-1']);
      expect(fluidMatches).toEqual(['SPEC-2']);
    });

    it('requires every given field to match on the same current profile', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid', sampleType: 'BLD', recordedAt: '2026-01-01' });
      await recordProfile(db, 'SPEC-2', { matrixType: 'fluid', sampleType: 'PLM', recordedAt: '2026-01-01' });

      const matches = await findSpecimenIdsWithCurrentProfileMatching(db, { matrixType: 'fluid', sampleType: 'BLD' });

      expect(matches).toEqual(['SPEC-1']);
    });

    it('returns null instead of scanning the collection when no field conditions are given', async () => {
      const db = createFakeDb();
      await recordProfile(db, 'SPEC-1', { matrixType: 'fluid' });

      const matches = await findSpecimenIdsWithCurrentProfileMatching(db, {});

      expect(matches).toBeNull();
    });
  });
});
