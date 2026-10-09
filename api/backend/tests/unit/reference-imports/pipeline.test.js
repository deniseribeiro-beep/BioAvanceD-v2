import { describe, it, expect } from 'vitest';
const { runImport, rollbackRelease } = require('../../../src/reference-data/reference-imports/pipeline');
const hpoSource = require('../../../src/reference-data/reference-imports/sources/hpo');
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHpo');

/**
 * Small in-memory Mongo-collection fake matching the exact-key filters
 * pipeline.js actually issues (systemUri+code+version, datasetCode+
 * releaseStatus, idempotencyKey, etc.) — real query-matching for the shapes
 * this pipeline uses, not a stub returning canned data (per this
 * repo's "real backend" proof bar for a native-only slice).
 */
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
        // Neo4jOutboxService.appendEvent's upsert-by-eventId shape — needed
        // now that promote() appends a real outbox event per AC9.
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
    referenceDatasetReleases: createFakeCollection(),
    referenceImportRuns: createFakeCollection(),
    referenceImportIssues: createFakeCollection(),
    referenceImportStaging: createFakeCollection(),
    terminologyConcepts: createFakeCollection(),
    terminologyRelations: createFakeCollection(),
    graph_projection_outbox: createFakeCollection(),
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

  describe('outbox → Neo4j projection (AC9)', () => {
    it('appends one TERMINOLOGY_CONCEPT_PROMOTED and one TERMINOLOGY_RELATION_PROMOTED event per promoted record', async () => {
      const fakeDb = createFakeDb();

      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const outboxDocs = fakeDb.collections.graph_projection_outbox.docs;
      expect(outboxDocs).toHaveLength(15); // 8 concepts + 7 relations, matching Mongo promotion counts
      expect(outboxDocs.filter((doc) => doc.eventType === 'TERMINOLOGY_CONCEPT_PROMOTED')).toHaveLength(8);
      expect(outboxDocs.filter((doc) => doc.eventType === 'TERMINOLOGY_RELATION_PROMOTED')).toHaveLength(7);
      expect(outboxDocs.every((doc) => doc.status === 'PENDING')).toBe(true);

      const rootConcept = fakeDb.collections.terminologyConcepts.docs.find((c) => c.code === 'HP:0000001');
      const rootEvent = outboxDocs.find(
        (doc) => doc.eventType === 'TERMINOLOGY_CONCEPT_PROMOTED' && doc.payload.terminologyConceptId === rootConcept.terminologyConceptId,
      );
      expect(rootEvent.aggregateType).toBe('TerminologyConcept');
      expect(rootEvent.aggregateId).toBe(rootConcept.terminologyConceptId);
      expect(rootEvent.payload).toMatchObject({
        systemUri: hpoSource.systemUri,
        code: 'HP:0000001',
        version: hpoSource.datasetVersion,
        display: 'All',
        conceptStatus: 'active',
        referenceDatasetReleaseId: rootConcept.referenceDatasetReleaseId,
      });

      const relationDoc = fakeDb.collections.terminologyRelations.docs[0];
      const relationEvent = outboxDocs.find(
        (doc) => doc.eventType === 'TERMINOLOGY_RELATION_PROMOTED' && doc.payload.terminologyRelationId === relationDoc.terminologyRelationId,
      );
      expect(relationEvent.aggregateType).toBe('TerminologyRelation');
      expect(relationEvent.payload).toMatchObject({
        sourceConceptId: relationDoc.sourceConceptId,
        targetConceptId: relationDoc.targetConceptId,
        relationType: 'is_a',
        relationVersion: hpoSource.datasetVersion,
      });
    });

    // #1313 (RF023 AC3): on a replica set each promoted record and its event
    // are written in one transaction, a transaction per record.
    it('writes each promoted record and its outbox event in the same transaction on a replica set', async () => {
      const fakeDb = createFakeDb();
      let sessionCount = 0;
      fakeDb.client = {
        db: () => ({ command: async () => ({ setName: 'rs0' }) }),
        startSession: () => {
          sessionCount += 1;
          const session = { id: sessionCount };
          return {
            ...session,
            withTransaction: async (fn) => { await fn(); },
            endSession: async () => {},
          };
        },
      };
      const sessionsOf = (collection) => {
        const seen = [];
        const { insertOne, updateOne } = collection;
        collection.insertOne = async (doc, options) => { seen.push(options?.session?.id); return insertOne.call(collection, doc, options); };
        collection.updateOne = async (filter, update, options) => { seen.push(options?.session?.id); return updateOne.call(collection, filter, update, options); };
        return seen;
      };
      const conceptSessions = sessionsOf(fakeDb.collections.terminologyConcepts);
      const relationSessions = sessionsOf(fakeDb.collections.terminologyRelations);
      const outboxSessions = sessionsOf(fakeDb.collections.graph_projection_outbox);

      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const recordSessions = [...conceptSessions, ...relationSessions];
      expect(recordSessions).toHaveLength(15);
      expect(recordSessions.every((id) => typeof id === 'number')).toBe(true);
      expect(new Set(recordSessions).size).toBe(15);
      expect(outboxSessions).toEqual(recordSessions);
    });

    it('does not append duplicate outbox events on a second, idempotent run', async () => {
      const fakeDb = createFakeDb();

      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord });
      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord });

      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(15);
    });

    it('does not append an outbox event for a concept that promote() finds already exists (skip-existing branch)', async () => {
      const fakeDb = createFakeDb();

      // Seed a pre-existing TerminologyConcept matching HP:0000001's exact
      // systemUri+code+version — promote()'s findOne hits this and takes the
      // recordsSkipped branch (no insertOne, so no outbox event either),
      // while the other 7 concepts in the fixture still promote normally.
      fakeDb.collections.terminologyConcepts.docs.push({
        terminologyConceptId: 'pre-existing-root',
        systemUri: hpoSource.systemUri,
        code: 'HP:0000001',
        version: hpoSource.datasetVersion,
        display: 'All',
      });

      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      // 1 pre-seeded + 7 newly inserted (HP:0000001 was skipped, not re-inserted).
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      const conceptEvents = fakeDb.collections.graph_projection_outbox.docs.filter(
        (doc) => doc.eventType === 'TERMINOLOGY_CONCEPT_PROMOTED',
      );
      expect(conceptEvents).toHaveLength(7);
      expect(conceptEvents.some((doc) => doc.payload.terminologyConceptId === 'pre-existing-root')).toBe(false);
    });
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
    // 8 concepts + 7 relations — staging now covers both (#551 AC 7:
    // relations used to be held in memory only and never staged at all).
    expect(fakeDb.collections.referenceImportStaging.docs).toHaveLength(15);

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

  describe('checkpoint/resume (AC 7)', () => {
    it('writes the checkpoint in batches as staging progresses, not once at the end', async () => {
      const fakeDb = createFakeDb();

      // HPO's bundled fixture stages 8 concepts + 7 relations = 15 items;
      // batchSize 5 should produce 3 incremental checkpoint writes (5, 10,
      // 15), not a single one after everything is already staged.
      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', batchSize: 5 });

      const checkpointWrites = fakeDb.collections.referenceImportRuns.calls.filter(
        (call) => call.method === 'updateOne' && call.update.$set && call.update.$set.checkpoint,
      );
      expect(checkpointWrites.length).toBeGreaterThanOrEqual(3);
      expect(checkpointWrites.map((call) => call.update.$set.checkpoint.offset)).toEqual([5, 10, 15]);

      // Final state is still a normal completed run with everything promoted.
      const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
      expect(runDoc.runStatus).toBe('completed');
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
    });

    it('resumes a run left in "running" status from its checkpoint instead of restarting or re-staging', async () => {
      // Learn the real staged shape from a normal, uninterrupted run first.
      const referenceDb = createFakeDb();
      await runImport({ db: referenceDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', batchSize: 5 });
      const referenceRun = referenceDb.collections.referenceImportRuns.docs[0];
      const referenceStaged = referenceDb.collections.referenceImportStaging.docs;
      expect(referenceStaged.length).toBe(15); // 8 concepts + 7 relations

      // Build a resume scenario: a "running" run with a checkpoint at offset
      // 5 (one batch in), and only that first batch actually staged — the
      // rest was never written because the process was interrupted.
      const resumeDb = createFakeDb();
      const seededRunId = 'seeded-run-in-progress';
      resumeDb.collections.referenceImportRuns.docs.push({
        ...referenceRun,
        referenceImportRunId: seededRunId,
        runStatus: 'running',
        completedAt: null,
        checkpoint: { offset: 5 },
      });
      for (const doc of referenceStaged.slice(0, 5)) {
        resumeDb.collections.referenceImportStaging.docs.push({ ...doc, referenceImportRunId: seededRunId });
      }

      const result = await runImport({ db: resumeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', batchSize: 5 });

      // Same run resumed, not a second run created for the same idempotency key.
      expect(resumeDb.collections.referenceImportRuns.docs).toHaveLength(1);
      expect(result.run.referenceImportRunId).toBe(seededRunId);
      expect(result.run.runStatus).toBe('completed');

      // The already-staged first batch was not re-inserted; the remaining
      // 10 items (5 concepts + 5 relations) were staged to reach the same
      // total the uninterrupted run reached.
      expect(resumeDb.collections.referenceImportStaging.docs).toHaveLength(15);

      // Resuming still reaches the exact same promoted, provable end state.
      expect(resumeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(resumeDb.collections.terminologyRelations.docs).toHaveLength(7);
      expect(resumeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
      expect(result.approved).toBe(true);

      // Checkpoint writes during resume only cover the remaining items
      // (offset continues from 5, doesn't restart at 0 or re-cover 0-5).
      const checkpointOffsets = resumeDb.collections.referenceImportRuns.calls
        .filter((call) => call.method === 'updateOne' && call.update.$set && call.update.$set.checkpoint)
        .map((call) => call.update.$set.checkpoint.offset);
      expect(checkpointOffsets).toEqual([10, 15]);
    });

    it('does not lose relations on resume — staging persists both concepts and relations (not just concepts)', async () => {
      const fakeDb = createFakeDb();
      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const stagedRelations = fakeDb.collections.referenceImportStaging.docs.filter((d) => d.entityType === 'TerminologyRelation');
      const stagedConcepts = fakeDb.collections.referenceImportStaging.docs.filter((d) => d.entityType === 'TerminologyConcept');
      expect(stagedConcepts).toHaveLength(8);
      expect(stagedRelations).toHaveLength(7);
      expect(stagedRelations.every((d) => d.candidate.sourceCode && d.candidate.targetCode)).toBe(true);
    });
  });

  describe('rollback (AC 7)', () => {
    it('reactivates the previous release against a real two-version promotion history from runImport', async () => {
      const fakeDb = createFakeDb();
      const v1Source = { ...hpoSource, datasetVersion: 'v1' };
      const v2Source = { ...hpoSource, datasetVersion: 'v2' };

      await runImport({ db: fakeDb, source: v1Source, normalizeRecord, initiatedBy: 'test-actor' });
      await runImport({ db: fakeDb, source: v2Source, normalizeRecord, initiatedBy: 'test-actor' });

      const releasesBefore = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releasesBefore).toHaveLength(2);
      const v2Release = releasesBefore.find((r) => r.datasetVersion === 'v2');
      const v1Release = releasesBefore.find((r) => r.datasetVersion === 'v1');
      expect(v2Release.releaseStatus).toBe('active');
      expect(v1Release.releaseStatus).toBe('superseded');
      expect(v2Release.previousReleaseId).toBe(v1Release.referenceDatasetReleaseId);

      const result = await rollbackRelease({ db: fakeDb, datasetCode: hpoSource.datasetCode, initiatedBy: 'test-actor' });

      expect(result.rolledBack).toBe(true);
      expect(result.activeReleaseId).toBe(v1Release.referenceDatasetReleaseId);

      // Both releases preserved — no physical deletion (§7.2 step 12/§7.3).
      expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(2);
      const releasesAfter = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releasesAfter.find((r) => r.referenceDatasetReleaseId === v1Release.referenceDatasetReleaseId).releaseStatus).toBe('active');
      expect(releasesAfter.find((r) => r.referenceDatasetReleaseId === v2Release.referenceDatasetReleaseId).releaseStatus).toBe('rolled_back');

      const rollbackRun = fakeDb.collections.referenceImportRuns.docs.find((r) => r.importMode === 'rollback');
      expect(rollbackRun).toBeDefined();
      expect(rollbackRun.runStatus).toBe('rolled_back');
      expect(rollbackRun.referenceDatasetReleaseId).toBe(v1Release.referenceDatasetReleaseId);
      expect(rollbackRun.datasetCode).toBe(hpoSource.datasetCode);
      expect(rollbackRun.initiatedBy).toBe('test-actor');
    });

    it('reports rolledBack:false with no active release for the dataset', async () => {
      const fakeDb = createFakeDb();

      const result = await rollbackRelease({ db: fakeDb, datasetCode: 'NOT_A_REAL_DATASET', initiatedBy: 'test-actor' });

      expect(result.rolledBack).toBe(false);
      expect(result.reason).toBe('no_active_release');
      expect(fakeDb.collections.referenceImportRuns.docs).toHaveLength(0);
    });

    it('reports rolledBack:false when the active release has no prior release to restore', async () => {
      const fakeDb = createFakeDb();
      await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const result = await rollbackRelease({ db: fakeDb, datasetCode: hpoSource.datasetCode, initiatedBy: 'test-actor' });

      expect(result.rolledBack).toBe(false);
      expect(result.reason).toBe('no_previous_release');
      // Left untouched — still active, no rollback run written.
      expect(fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('active');
      expect(fakeDb.collections.referenceImportRuns.docs.some((r) => r.importMode === 'rollback')).toBe(false);
    });
  });
});
