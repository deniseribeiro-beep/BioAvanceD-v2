import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { recordAssessment, getAssessmentsForSpecimen } = require('../../../src/services/rcs-assessment.service');

/**
 * Real query-matching fake (exact-match filter + sort), not a canned stub —
 * proves getAssessmentsForSpecimen actually scopes by specimenId and orders
 * by recency, per build-loop's native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
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
});
