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

    it('reports inactive_release with release:null when the referenced release no longer resolves', async () => {
      const db = createFakeDb({
        terminologyConcepts: [activeConcept({ referenceDatasetReleaseId: 'missing-release' })],
        referenceDatasetReleases: [],
      });
      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });
      expect(result).toMatchObject({ active: false, status: 'inactive_release', release: null });
    });

    it('returns unknown for an explicit version that has no matching concept row', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });
      const result = await checkActiveCode(db, {
        systemUri: SYSTEM_URI,
        code: 'HP:0000001',
        version: '1900-01-01',
      });
      expect(result).toEqual({ active: false, status: 'unknown', concept: null, release: null });
    });

    it('requires systemUri and code', async () => {
      const db = createFakeDb({});
      await expect(checkActiveCode(db, { code: 'HP:0000001' })).rejects.toThrow(/systemUri e code/);
    });

    // #676: no reference-import normalizer ever sets TerminologyConcept's
    // validFrom (models/TerminologyConcept.js only reads data.validFrom,
    // which nothing in reference-data/reference-imports/normalize*.js
    // populates), so an unversioned lookup's old `sort: { validFrom: -1 }`
    // tiebreak never actually discriminated between concept rows left by
    // different dataset versions -- it silently fell back to whichever
    // insertion order Mongo happened to return, which can be the
    // now-superseded release instead of the current active one.
    it('#676: resolves the concept belonging to the active release, not insertion order, when a code has rows from a superseded release too', async () => {
      const supersededConcept = activeConcept({
        terminologyConceptId: 'concept-old',
        version: '2025-01-01',
        referenceDatasetReleaseId: 'release-old',
      });
      const currentConcept = activeConcept({
        terminologyConceptId: 'concept-new',
        version: '2026-01-01',
        referenceDatasetReleaseId: 'release-new',
      });
      const db = createFakeDb({
        // Superseded row seeded first, matching real insertion order (the
        // old release's concepts were written before the new import ran).
        terminologyConcepts: [supersededConcept, currentConcept],
        referenceDatasetReleases: [
          activeRelease({ referenceDatasetReleaseId: 'release-old', releaseStatus: 'superseded' }),
          activeRelease({ referenceDatasetReleaseId: 'release-new', releaseStatus: 'active' }),
        ],
      });

      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });

      expect(result.active).toBe(true);
      expect(result.status).toBe('active');
      expect(result.concept.terminologyConceptId).toBe('concept-new');
    });

    it('#676: reports ambiguous_active_release when two concept rows both belong to an active release (upstream data bug)', async () => {
      const conceptA = activeConcept({ terminologyConceptId: 'concept-a', referenceDatasetReleaseId: 'release-a' });
      const conceptB = activeConcept({ terminologyConceptId: 'concept-b', referenceDatasetReleaseId: 'release-b' });
      const db = createFakeDb({
        terminologyConcepts: [conceptA, conceptB],
        referenceDatasetReleases: [
          activeRelease({ referenceDatasetReleaseId: 'release-a', releaseStatus: 'active' }),
          activeRelease({ referenceDatasetReleaseId: 'release-b', releaseStatus: 'active' }),
        ],
      });

      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001' });

      expect(result.active).toBe(false);
      expect(result.status).toBe('ambiguous_active_release');
    });

    it('#676: an explicit version still resolves that exact concept row directly, unaffected by other versions', async () => {
      const supersededConcept = activeConcept({
        terminologyConceptId: 'concept-old',
        version: '2025-01-01',
        referenceDatasetReleaseId: 'release-old',
      });
      const currentConcept = activeConcept({
        terminologyConceptId: 'concept-new',
        version: '2026-01-01',
        referenceDatasetReleaseId: 'release-new',
      });
      const db = createFakeDb({
        terminologyConcepts: [supersededConcept, currentConcept],
        referenceDatasetReleases: [
          activeRelease({ referenceDatasetReleaseId: 'release-old', releaseStatus: 'superseded' }),
          activeRelease({ referenceDatasetReleaseId: 'release-new', releaseStatus: 'active' }),
        ],
      });

      const result = await checkActiveCode(db, { systemUri: SYSTEM_URI, code: 'HP:0000001', version: '2025-01-01' });

      expect(result.concept.terminologyConceptId).toBe('concept-old');
      expect(result.status).toBe('inactive_release');
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

    it('uses systemUri|code and the code itself when an inactive entry has no display label', async () => {
      const db = createFakeDb({ terminologyConcepts: [], referenceDatasetReleases: [] });
      const result = await validateActiveCodes(db, [{ systemUri: SYSTEM_URI, code: 'HP:9999999' }]);

      expect(result.violations[0].field).toBe(`${SYSTEM_URI}|HP:9999999`);
      expect(result.violations[0].message).toContain('HP:9999999');
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
