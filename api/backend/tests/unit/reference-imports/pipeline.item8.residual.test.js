import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const hpoSource = require('../../../src/reference-data/reference-imports/sources/hpo');
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHpo');
const { getCanonicalCollectionName } = require('../../../src/config/canonicalEntityCollections.v2');
const { runImport, rollbackRelease } = require('../../../src/reference-data/reference-imports/pipeline');

function createFakeCollection() {
  const docs = [];
  const calls = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    calls,
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
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)) };
    },
    async updateOne(filter, update, options = {}) {
      calls.push({ method: 'updateOne', filter, update });
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
        const newDoc = { ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
        docs.push(newDoc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
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
    [getCanonicalCollectionName('ReferenceDatasetRelease')]: createFakeCollection(),
    [getCanonicalCollectionName('ReferenceImportRun')]: createFakeCollection(),
    [getCanonicalCollectionName('ReferenceImportIssue')]: createFakeCollection(),
    referenceImportStaging: createFakeCollection(),
    [getCanonicalCollectionName('TerminologyConcept')]: createFakeCollection(),
    [getCanonicalCollectionName('TerminologyRelation')]: createFakeCollection(),
    graph_projection_outbox: createFakeCollection(),
  };
  // Keep legacy aliases used by the shared pipeline test harness naming.
  collections.referenceDatasetReleases = collections[getCanonicalCollectionName('ReferenceDatasetRelease')];
  collections.referenceImportRuns = collections[getCanonicalCollectionName('ReferenceImportRun')];
  collections.referenceImportIssues = collections[getCanonicalCollectionName('ReferenceImportIssue')];
  collections.terminologyConcepts = collections[getCanonicalCollectionName('TerminologyConcept')];
  collections.terminologyRelations = collections[getCanonicalCollectionName('TerminologyRelation')];
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('reference-imports pipeline item 8 residual branches', () => {
  it('reuses the same active release on a replay after clearing the terminal run (sameRelease)', async () => {
    const fakeDb = createFakeDb();
    await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

    const runs = fakeDb.collections.referenceImportRuns;
    runs.docs.splice(0, runs.docs.length);
    const staging = fakeDb.collections.referenceImportStaging;
    staging.docs.splice(0, staging.docs.length);

    const second = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

    expect(second.idempotent).toBe(false);
    expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
    expect(fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('active');
  });

  it('records ORPHAN_RELATION during promote when a staged relation endpoint is missing', async () => {
    const processRecordsPath = require.resolve('../../../src/reference-data/reference-imports/processRecords');
    const pipelinePath = require.resolve('../../../src/reference-data/reference-imports/pipeline');
    delete require.cache[pipelinePath];

    const processRecordsModule = require(processRecordsPath);
    const originalProcessRecords = processRecordsModule.processRecords;
    const processSpy = vi.spyOn(processRecordsModule, 'processRecords').mockImplementation((rawLines, normalize) => {
      const result = originalProcessRecords(rawLines, normalize);
      const firstCode = result.concepts.keys().next().value;
      result.relations.push({
        sourceCode: 'HP:ORPHAN-SOURCE',
        targetCode: firstCode,
        relationType: 'is_a',
      });
      return result;
    });

    try {
      const { runImport: runImportFresh } = require(pipelinePath);
      const orphanDb = createFakeDb();
      const result = await runImportFresh({
        db: orphanDb,
        source: hpoSource,
        normalizeRecord,
        initiatedBy: 'test-actor',
      });

      expect(result.approved).toBe(true);
      const orphanIssues = orphanDb.collections.referenceImportIssues.docs.filter(
        (issue) => issue.errorCode === 'ORPHAN_RELATION'
      );
      expect(orphanIssues.length).toBeGreaterThan(0);
    } finally {
      processSpy.mockRestore();
      delete require.cache[pipelinePath];
    }
  });

  it('skips already-promoted relations on a sameRelease replay', async () => {
    const fakeDb = createFakeDb();
    await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
    const relationCountAfterFirst = fakeDb.collections.terminologyRelations.docs.length;

    fakeDb.collections.referenceImportRuns.docs.splice(0, fakeDb.collections.referenceImportRuns.docs.length);
    fakeDb.collections.referenceImportStaging.docs.splice(0, fakeDb.collections.referenceImportStaging.docs.length);

    await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

    expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(relationCountAfterFirst);
  });

  it('reports previous_release_not_found when the prior release id is missing', async () => {
    const fakeDb = createFakeDb();
    fakeDb.collections.referenceDatasetReleases.docs.push({
      referenceDatasetReleaseId: 'active-1',
      datasetCode: hpoSource.datasetCode,
      releaseStatus: 'active',
      previousReleaseId: 'missing-previous',
      sourceChecksum: 'x',
    });

    const result = await rollbackRelease({
      db: fakeDb,
      datasetCode: hpoSource.datasetCode,
      initiatedBy: 'test-actor',
    });

    expect(result).toEqual({ rolledBack: false, reason: 'previous_release_not_found' });
  });
});
