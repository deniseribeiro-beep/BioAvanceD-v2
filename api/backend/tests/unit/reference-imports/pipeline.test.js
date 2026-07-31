import { describe, it, expect } from 'vitest';
const { runImport } = require('../../../src/reference-data/reference-imports/pipeline');
const hpoSource = require('../../../src/reference-data/reference-imports/sources/hpo');
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHpo');

/**
 * Small in-memory Mongo-collection fake matching the exact-key filters
 * pipeline.js actually issues (systemUri+code+version, datasetCode+
 * releaseStatus, idempotencyKey, etc.) — real query-matching for the shapes
 * this pipeline uses, not a stub returning canned data (per
 * build-loop's local-env "real backend" proof bar for a native-only slice).
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id || 'fake-id' };
    },
    async insertMany(newDocs) {
      docs.push(...newDocs);
      return { insertedCount: newDocs.length };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(filter = {}) {
      return docs.filter((doc) => matches(doc, filter)).length;
    },
  };
}

function createFakeDb() {
  const collections = {
    referenceDatasetReleases: createFakeCollection(),
    referenceImportRuns: createFakeCollection(),
    referenceImportIssues: createFakeCollection(),
    referenceImportStaging: createFakeCollection(),
    terminologyConcepts: createFakeCollection(),
    terminologyRelations: createFakeCollection(),
  };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('reference-imports pipeline runImport (HPO)', () => {
  it('promotes the bundled HPO sample end to end on first run', async () => {
    const fakeDb = createFakeDb();

    const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

    expect(result.idempotent).toBe(false);
    expect(result.approved).toBe(true);

    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
    expect(fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('active');
    expect(fakeDb.collections.referenceDatasetReleases.docs[0].sourceChecksum).toBe(hpoSource.expectedChecksum);

    expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
    expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
    expect(fakeDb.collections.referenceImportIssues.docs.map((i) => i.errorCode)).toEqual(['MISSING_CODE', 'MISSING_DISPLAY']);

    const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
    expect(runDoc.runStatus).toBe('completed');
    expect(runDoc.recordsRead).toBe(10);
    expect(runDoc.recordsValidated).toBe(8);
    expect(runDoc.recordsRejected).toBe(2);
    expect(runDoc.initiatedBy).toBe('test-actor');

    // every promoted relation resolves to a real, previously-promoted concept id
    const conceptIds = new Set(fakeDb.collections.terminologyConcepts.docs.map((c) => c.terminologyConceptId));
    for (const relation of fakeDb.collections.terminologyRelations.docs) {
      expect(conceptIds.has(relation.sourceConceptId)).toBe(true);
      expect(conceptIds.has(relation.targetConceptId)).toBe(true);
    }
  });

  it('is idempotent on a second run against the same content and version', async () => {
    const fakeDb = createFakeDb();

    await runImport({ db: fakeDb, source: hpoSource, normalizeRecord });
    const second = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord });

    expect(second.idempotent).toBe(true);
    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
    expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
    expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
    expect(fakeDb.collections.referenceImportRuns.docs).toHaveLength(1);
  });

  it('blocks promotion and records a fatal CHECKSUM_MISMATCH issue when integrity fails (AC 10)', async () => {
    const fakeDb = createFakeDb();
    const tamperedSource = { ...hpoSource, expectedChecksum: 'sha256-does-not-match' };

    const result = await runImport({ db: fakeDb, source: tamperedSource, normalizeRecord });

    expect(result.approved).toBe(false);
    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(0);
    expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);

    const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
    expect(runDoc.runStatus).toBe('failed');

    const issue = fakeDb.collections.referenceImportIssues.docs[0];
    expect(issue).toMatchObject({ errorCode: 'CHECKSUM_MISMATCH', severity: 'fatal' });
  });

  it('stages but does not promote on a dry run', async () => {
    const fakeDb = createFakeDb();

    const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, dryRun: true });

    expect(result.approved).toBe(true);
    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(0);
    expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
    expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(0);
    expect(fakeDb.collections.referenceImportStaging.docs).toHaveLength(8);

    const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
    expect(runDoc.importMode).toBe('dry_run');
    expect(runDoc.runStatus).toBe('validated');
  });

  it('allows a dry run and a full run of the same content to both proceed (distinct idempotency keys)', async () => {
    const fakeDb = createFakeDb();

    const dryResult = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, dryRun: true });
    const fullResult = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, dryRun: false });

    expect(dryResult.idempotent).toBe(false);
    expect(fullResult.idempotent).toBe(false);
    expect(fakeDb.collections.referenceImportRuns.docs).toHaveLength(2);
    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
  });
});
