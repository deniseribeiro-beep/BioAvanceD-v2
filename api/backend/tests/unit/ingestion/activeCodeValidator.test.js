import { describe, it, expect } from 'vitest';
const { checkActiveCode, validateActiveCodes } = require('../../../src/ingestion/activeCodeValidator');
const { createFakeDb } = require('./testHelpers');

const SYSTEM_URI = 'http://purl.obolibrary.org/obo/hp.owl';

function activeConcept(overrides = {}) {
  return {
    terminologyConceptId: 'concept-1',
    systemUri: SYSTEM_URI,
    code: 'HP:0000001',
    version: '2026-01-01',
    conceptStatus: 'active',
    referenceDatasetReleaseId: 'release-1',
    ...overrides,
  };
}

function activeRelease(overrides = {}) {
  return {
    referenceDatasetReleaseId: 'release-1',
    datasetCode: 'HPO',
    releaseStatus: 'active',
    ...overrides,
  };
}

describe('ingestion/activeCodeValidator (RF029 AC 4)', () => {
  describe('checkActiveCode', () => {
    it('reports active when the concept is active and its release is active', async () => {
      const db = createFakeDb({
        terminologyConcepts: [activeConcept()],
        referenceDatasetReleases: [activeRelease()],
      });
      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });
      expect(result).toMatchObject({ active: true, status: 'active' });
    });

    it('reports unknown when no concept matches systemUri+code at all', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });
      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:9999999' });
      expect(result).toMatchObject({ active: false, status: 'unknown', concept: null });
    });

    it('reports inactive_concept when the concept itself is deprecated', async () => {
      const db = createFakeDb({
        terminologyConcepts: [activeConcept({ conceptStatus: 'deprecated' })],
        referenceDatasetReleases: [activeRelease()],
      });
      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });
      expect(result.active).toBe(false);
      expect(result.status).toBe('inactive_concept');
    });

    it('reports inactive_release when the concept is active but its release has been superseded', async () => {
      const db = createFakeDb({
        terminologyConcepts: [activeConcept()],
        referenceDatasetReleases: [activeRelease({ releaseStatus: 'superseded' })],
      });
      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });
      expect(result.active).toBe(false);
      expect(result.status).toBe('inactive_release');
    });

    it('requires systemUri and code', async () => {
      const db = createFakeDb({});
      await expect(checkActiveCode(db, { code: 'HP:0000001' })).rejects.toThrow(/systemUri e code/);
    });
  });

  describe('validateActiveCodes', () => {
    it('produces no violations for an active code', async () => {
      const db = createFakeDb({
        terminologyConcepts: [activeConcept()],
        referenceDatasetReleases: [activeRelease()],
      });
      const result = await validateActiveCodes(db, [{ systemUri: SYSTEM_URI, code: 'HP:0000001', label: 'icdCode' }]);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('produces INACTIVE_OR_UNKNOWN_CODE for an unresolvable code', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });
      const result = await validateActiveCodes(db, [{ systemUri: SYSTEM_URI, code: 'HP:9999999', label: 'icdCode' }]);
      expect(result.valid).toBe(false);
      expect(result.violations[0]).toMatchObject({ code: 'INACTIVE_OR_UNKNOWN_CODE', field: 'icdCode' });
    });

    it('does not turn an inactive code into a violation when allowControlledReview is set', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });
      const result = await validateActiveCodes(db, [
        { systemUri: SYSTEM_URI, code: 'HP:9999999', label: 'icdCode', allowControlledReview: true },
      ]);
      expect(result.valid).toBe(true);
      expect(result.results[0]).toMatchObject({ active: false, status: 'unknown' });
    });

    it('skips an entry with no systemUri/code (a presence concern elsewhere)', async () => {
      const db = createFakeDb({});
      const result = await validateActiveCodes(db, [{ label: 'icdCode' }]);
      expect(result.valid).toBe(true);
      expect(result.results).toEqual([]);
    });
  });
});
