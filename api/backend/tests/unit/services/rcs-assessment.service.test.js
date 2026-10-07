import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  recordAssessment,
  getAssessmentsForSpecimen,
  getAssessmentById,
  getCurrentAssessmentsForSpecimens,
  findSpecimenIdsWithCurrentAssessmentMatching,
} = require('../../../src/services/rcs-assessment.service');

/**
 * Real query-matching fake (exact-match filter + sort, plus $in for the
 * batched getCurrentAssessmentsForSpecimens path), not a canned stub —
 * proves getAssessmentsForSpecimen actually scopes by specimenId and orders
 * by recency, per this repo's native-only "real backend" proof bar.
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
      // with the generated _id — recordAssessment's callers rely on this to
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
  const collections = { rcsAssessments: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('rcs-assessment.service', () => {
  describe('recordAssessment', () => {
    it('persists a versioned snapshot referenced by specimenId', async () => {
      const db = createFakeDb();

      const stored = await recordAssessment(db, 'SPEC-1', {
        model_version: 'RCS-GOV-1.0',
        matrix_type: 'fluid',
        governance_status: 1,
        rcs_score: 88,
        final_grade: 'B',
        axis_penalties: [],
        calculation_trace: {},
      });

      expect(stored.specimenId).toBe('SPEC-1');
      expect(stored.rcsScore).toBe(88);
      expect(db.collections.rcsAssessments.docs).toHaveLength(1);
      expect(db.collections.rcsAssessments.docs[0].specimenId).toBe('SPEC-1');
    });

    it('does not overwrite a prior snapshot — each call adds a new versioned record', async () => {
      const db = createFakeDb();

      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, final_grade: 'C' });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, final_grade: 'A' });

      expect(db.collections.rcsAssessments.docs).toHaveLength(2);
    });
  });

  describe('getAssessmentsForSpecimen', () => {
    it('scopes results to the requested specimenId only', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-2', { rcs_score: 40 });

      const assessments = await getAssessmentsForSpecimen(db, 'SPEC-1');

      expect(assessments).toHaveLength(1);
      expect(assessments[0].specimenId).toBe('SPEC-1');
    });

    it('returns snapshots newest-first', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, calculation_trace: { assessedAt: '2026-06-01' } });

      const assessments = await getAssessmentsForSpecimen(db, 'SPEC-1');

      expect(assessments.map((a) => a.rcsScore)).toEqual([95, 70]);
    });
  });

  describe('getAssessmentById', () => {
    it('resolves the exact snapshot by _id, not the newest one for its specimenId (#502)', async () => {
      const db = createFakeDb();
      const older = await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95 });

      const resolved = await getAssessmentById(db, older._id);

      expect(resolved.rcsScore).toBe(70);
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb();
      expect(await getAssessmentById(db, null)).toBeNull();
    });
  });

  describe('getCurrentAssessmentsForSpecimens', () => {
    it('resolves the newest assessment per specimenId in one batched query (#525)', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, calculation_trace: { assessedAt: '2026-06-01' } });
      await recordAssessment(db, 'SPEC-2', { rcs_score: 40 });

      const result = await getCurrentAssessmentsForSpecimens(db, [
        { specimenId: 'SPEC-1' },
        { specimenId: 'SPEC-2' },
      ]);

      expect(result.get('SPEC-1').rcsScore).toBe(95);
      expect(result.get('SPEC-2').rcsScore).toBe(40);
    });

    it('resolves the sealed-pinned snapshot instead of the newest one when sealedRcsAssessmentId is set (#502 precedent)', async () => {
      const db = createFakeDb();
      const older = await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95 });

      const result = await getCurrentAssessmentsForSpecimens(db, [
        { specimenId: 'SPEC-1', sealedRcsAssessmentId: older._id },
      ]);

      expect(result.get('SPEC-1').rcsScore).toBe(70);
    });

    it('maps a specimen with no recorded assessment to null rather than omitting the key', async () => {
      const db = createFakeDb();

      const result = await getCurrentAssessmentsForSpecimens(db, [{ specimenId: 'SPEC-NONE' }]);

      expect(result.has('SPEC-NONE')).toBe(true);
      expect(result.get('SPEC-NONE')).toBeNull();
    });

    it('returns an empty map without querying when given no samples', async () => {
      const db = createFakeDb();

      const result = await getCurrentAssessmentsForSpecimens(db, []);

      expect(result.size).toBe(0);
    });
  });

  describe('findSpecimenIdsWithCurrentAssessmentMatching', () => {
    it('matches on the newest assessment per specimenId, not a stale earlier one (#525)', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { final_grade: 'C', calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { final_grade: 'A', calculation_trace: { assessedAt: '2026-06-01' } });
      await recordAssessment(db, 'SPEC-2', { final_grade: 'C' });

      const matches = await findSpecimenIdsWithCurrentAssessmentMatching(db, { finalGrade: 'A' });

      expect(matches).toEqual(['SPEC-1']);
    });

    it('returns null instead of scanning the collection when no field conditions are given', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { final_grade: 'A' });

      const matches = await findSpecimenIdsWithCurrentAssessmentMatching(db, {});

      expect(matches).toBeNull();
    });
  });
});
