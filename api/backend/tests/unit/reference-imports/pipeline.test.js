import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runImport: runImportUnderTest } = require('../../../src/reference-data/reference-imports/pipeline');
const { promoteRelease, rollbackRelease } = require('../../../src/services/referenceRelease.service');
const auditLogger = require('../../../src/utils/auditLogger');
const ReferenceCoverageManifestModel = require('../../../src/models/ReferenceCoverageManifest');
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
  // promoteRelease's claim filter also uses $or, $exists and $lt; a null
  // condition matches a missing field, as in Mongo.
  const matchesValue = (value, cond) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((op) => op.startsWith('$'))) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$exists') return (value !== undefined) === arg;
        if (op === '$lt') return value !== undefined && value !== null && value < arg;
        if (op === '$in') return arg.includes(value);
        throw new Error(`unsupported operator: ${op}`);
      });
    }
    return cond === null ? value === null || value === undefined : value === cond;
  };
  const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) =>
    (key === '$or' ? cond.some((sub) => matches(doc, sub)) : matchesValue(doc[key], cond)));
  return {
    docs,
    calls,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id || 'fake-id' };
    },
    async insertMany(newDocs, options = {}) {
      calls.push({ method: 'insertMany', count: newDocs.length, session: options.session });
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
    // The outbox's per-aggregate version counter: an upserting $inc.
    async findOneAndUpdate(filter, update, options = {}) {
      calls.push({ method: 'findOneAndUpdate', filter, update, session: options.session });
      let doc = docs.find((d) => matches(d, filter));
      if (!doc) {
        if (!options.upsert) return null;
        doc = { ...filter };
        docs.push(doc);
      }
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by;
      if (update.$set) Object.assign(doc, update.$set);
      return doc;
    },
    // #1561: the batched promotion's upserting updateOne operations: the
    // outbox's version counters ($inc) and its events ($setOnInsert).
    async bulkWrite(operations, options = {}) {
      calls.push({ method: 'bulkWrite', count: operations.length, session: options.session });
      for (const { updateOne: { filter, update, upsert } } of operations) {
        let doc = docs.find((d) => matches(d, filter));
        if (!doc) {
          if (!upsert) continue;
          doc = { ...filter, ...(update.$setOnInsert || {}) };
          docs.push(doc);
        }
        for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by;
        if (update.$set) Object.assign(doc, update.$set);
      }
      return { ok: 1 };
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
    graph_projection_outbox_aggregate_versions: createFakeCollection(),
    referenceCoverageManifests: createFakeCollection(),
    dataQualityAssessments: createFakeCollection(),
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
  // Every case stores its assets under a tmp root, never under STORAGE_BASE.
  let storageRoot;
  const runImport = (opts) => runImportUnderTest({ assetStorageRoot: storageRoot, ...opts });
  // RF028 AC8: an import leaves its approved release for explicit promotion.
  const promote = (db, result) => promoteRelease({ db, releaseId: result.releaseId, approvedBy: 'test-approver' });
  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-assets-'));
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue();
  });
  afterEach(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('promotes the bundled HPO sample end to end on first run', async () => {
    const fakeDb = createFakeDb();

    const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
    await promote(fakeDb, result);

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

      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' }));

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

    // #1313 (RF023 AC3), #1561: on a replica set each batch of promoted
    // records and their events are written in one transaction, a
    // transaction per batch.
    const replicaSetDb = () => {
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
      return fakeDb;
    };
    const writesOf = (fakeDb, name, method) => fakeDb.collections[name].calls
      .filter((call) => call.method === method)
      .map((call) => ({ session: call.session?.id, count: call.count }));

    it('writes each batch of promoted records and their outbox events in one transaction on a replica set', async () => {
      const fakeDb = replicaSetDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      await promoteRelease({ db: fakeDb, releaseId: result.releaseId, approvedBy: 'test-approver', batchSize: 3 });

      const conceptWrites = writesOf(fakeDb, 'terminologyConcepts', 'insertMany');
      const relationWrites = writesOf(fakeDb, 'terminologyRelations', 'insertMany');
      expect(conceptWrites).toEqual([{ session: 1, count: 3 }, { session: 2, count: 3 }, { session: 3, count: 2 }]);
      expect(relationWrites).toEqual([{ session: 4, count: 3 }, { session: 5, count: 3 }, { session: 6, count: 1 }]);
      const recordWrites = [...conceptWrites, ...relationWrites];
      expect(writesOf(fakeDb, 'graph_projection_outbox', 'bulkWrite')).toEqual(recordWrites);
      // #1313: each event's aggregateVersion is taken in the same transaction.
      expect(writesOf(fakeDb, 'graph_projection_outbox_aggregate_versions', 'bulkWrite')).toEqual(recordWrites);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(15);
      expect(fakeDb.collections.graph_projection_outbox.docs.every((doc) => doc.aggregateVersion === 1)).toBe(true);
    });

    // #1561: a generated set, the measurement standing in for the full-lab
    // run: 400 concepts in an is_a chain promote in four batches each,
    // with no per-record lookup or transaction.
    it('promotes a generated 400-concept set in batches of 100, one transaction per batch', async () => {
      const fixturePath = path.join(storageRoot, 'generated-1561.jsonl');
      const lines = [];
      for (let index = 0; index < 400; index += 1) {
        const id = `HP:${9000000 + index}`;
        const parent = index === 0 ? [] : [`HP:${9000000 + index - 1}`];
        lines.push(JSON.stringify({ id, lbl: `Generated ${index}`, is_a: parent, synonyms: [], obsolete: false }));
      }
      fs.writeFileSync(fixturePath, `${lines.join('\n')}\n`);
      const source = {
        ...hpoSource,
        datasetVersion: 'generated-1561',
        fixturePath,
        retrievalUri: 'file://generated-1561.jsonl',
        expectedChecksum: crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),
      };
      const fakeDb = replicaSetDb();
      const conceptLookups = [];
      const concepts = fakeDb.collections.terminologyConcepts;
      const { findOne } = concepts;
      concepts.findOne = async (filter) => { conceptLookups.push(filter); return findOne.call(concepts, filter); };
      const result = await runImport({ db: fakeDb, source, normalizeRecord, initiatedBy: 'test-actor' });
      expect(result.approved).toBe(true);

      const promotion = await promoteRelease({ db: fakeDb, releaseId: result.releaseId, approvedBy: 'test-approver', batchSize: 100 });

      expect(promotion).toMatchObject({ promoted: true, recordsInserted: 799, recordsSkipped: 0 });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(400);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(399);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(799);
      expect(writesOf(fakeDb, 'terminologyConcepts', 'insertMany').map((write) => write.count)).toEqual([100, 100, 100, 100]);
      expect(writesOf(fakeDb, 'terminologyRelations', 'insertMany').map((write) => write.count)).toEqual([100, 100, 100, 99]);
      expect(new Set(writesOf(fakeDb, 'graph_projection_outbox', 'bulkWrite').map((write) => write.session)).size).toBe(8);
      expect(conceptLookups).toEqual([]);
    });

    // #1561: a promotion re-run on its own release (a crash after the record
    // writes, before the status flip) inserts nothing and appends nothing.
    it('re-running the promotion of one release inserts no record and appends no event', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      await promote(fakeDb, result);
      Object.assign(fakeDb.collections.referenceDatasetReleases.docs[0], { releaseStatus: 'approved', promotionClaimedAt: null });
      const insertCalls = () => [...fakeDb.collections.terminologyConcepts.calls, ...fakeDb.collections.terminologyRelations.calls]
        .filter((call) => call.method === 'insertMany').length;
      const insertsBefore = insertCalls();

      const rerun = await promote(fakeDb, result);

      expect(rerun).toMatchObject({ promoted: true, recordsInserted: 0, recordsSkipped: 15 });
      expect(insertCalls()).toBe(insertsBefore);
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(15);
    });

    // #1561: a relation staged twice in one run is inserted once, the second
    // copy counted as skipped, as the per-record lookup did before batching.
    it('inserts a relation staged twice in one batch once', async () => {
      const fixturePath = path.join(storageRoot, 'duplicate-parent-1561.jsonl');
      fs.writeFileSync(fixturePath, [
        JSON.stringify({ id: 'HP:9100000', lbl: 'Root', is_a: [], synonyms: [], obsolete: false }),
        JSON.stringify({ id: 'HP:9100001', lbl: 'Child', is_a: ['HP:9100000', 'HP:9100000'], synonyms: [], obsolete: false }),
      ].join('\n') + '\n');
      const source = {
        ...hpoSource,
        datasetVersion: 'duplicate-parent-1561',
        fixturePath,
        retrievalUri: 'file://duplicate-parent-1561.jsonl',
        expectedChecksum: crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),
      };
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source, normalizeRecord, initiatedBy: 'test-actor' });

      const promotion = await promote(fakeDb, result);

      expect(fakeDb.collections.referenceImportStaging.docs.filter((doc) => doc.entityType === 'TerminologyRelation')).toHaveLength(2);
      expect(promotion).toMatchObject({ promoted: true, recordsInserted: 3, recordsSkipped: 1 });
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(1);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(3);
    });

    // #1561: the natural-key indexes exist before the first record write,
    // whichever caller runs the promotion (a script runs no Foundation job).
    it('builds the concept and relation natural-key indexes before its claim and first record write', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      const order = [];
      for (const name of ['terminologyConcepts', 'terminologyRelations']) {
        fakeDb.collections[name].createIndex = async (keys, options) => { order.push(`${name}:${options.name}:${options.unique}`); };
      }
      const releases = fakeDb.collections.referenceDatasetReleases;
      const { updateOne } = releases;
      releases.updateOne = async (...args) => { order.push('claim-or-flip'); return updateOne.apply(releases, args); };

      await promote(fakeDb, result);

      expect(order.slice(0, 3)).toEqual([
        'terminologyConcepts:uniq_terminologyConcept_systemUri_code_version:true',
        'terminologyRelations:uniq_terminologyRelation_source_target_type_version:true',
        'claim-or-flip',
      ]);
    });

    it('does not append duplicate outbox events on a second, idempotent run', async () => {
      const fakeDb = createFakeDb();

      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord }));
      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord }));

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

      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' }));

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

    await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord }));
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

  describe('release registration (RF028 AC1)', () => {
    it('registers before load: the release exists, downloaded, and the run carries its id at the first staging write', async () => {
      const fakeDb = createFakeDb();
      const staging = fakeDb.collections.referenceImportStaging;
      const { insertMany } = staging;
      let atFirstStage = null;
      staging.insertMany = async (newDocs) => {
        if (!atFirstStage) {
          atFirstStage = {
            releases: fakeDb.collections.referenceDatasetReleases.docs.map((doc) => ({ ...doc })),
            runs: fakeDb.collections.referenceImportRuns.docs.map((doc) => ({ ...doc })),
          };
        }
        return insertMany.call(staging, newDocs);
      };

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      await promote(fakeDb, result);

      expect(atFirstStage.releases).toHaveLength(1);
      const registered = atFirstStage.releases[0];
      expect(registered.releaseStatus).toBe('downloaded');
      expect(registered).toMatchObject({
        sourceId: hpoSource.sourceId,
        datasetVersion: hpoSource.datasetVersion,
        license: hpoSource.license,
        retrievalUri: hpoSource.retrievalUri,
        sourceChecksum: hpoSource.expectedChecksum,
        parserVersion: hpoSource.parserVersion,
        mappingVersion: hpoSource.mappingVersion,
      });
      expect(registered.sourceFormat.length).toBeGreaterThan(0);
      expect(atFirstStage.runs).toHaveLength(1);
      expect(atFirstStage.runs[0].referenceDatasetReleaseId).toBe(registered.referenceDatasetReleaseId);

      const release = fakeDb.collections.referenceDatasetReleases.docs[0];
      expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(1);
      expect(release.referenceDatasetReleaseId).toBe(registered.referenceDatasetReleaseId);
      expect(release.releaseStatus).toBe('active');
      expect(result.releaseId).toBe(registered.referenceDatasetReleaseId);
      expect(fakeDb.collections.terminologyConcepts.docs.every(
        (concept) => concept.referenceDatasetReleaseId === registered.referenceDatasetReleaseId,
      )).toBe(true);
    });

    it('rejected run keeps its release: the registered release ends rejected and is linked from the run and its issues', async () => {
      const fakeDb = createFakeDb();
      const rejectAll = () => ({ ok: false, issue: { errorCode: 'TEST_REJECT', errorMessage: 'rejected', severity: 'error' } });

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord: rejectAll, initiatedBy: 'test-actor' });

      expect(result.approved).toBe(false);
      const releases = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releases).toHaveLength(1);
      expect(releases[0].releaseStatus).toBe('rejected');
      const releaseId = releases[0].referenceDatasetReleaseId;
      expect(result.releaseId).toBe(releaseId);

      const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
      expect(runDoc.runStatus).toBe('failed');
      expect(runDoc.referenceDatasetReleaseId).toBe(releaseId);
      const issues = fakeDb.collections.referenceImportIssues.docs;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.referenceDatasetReleaseId === releaseId)).toBe(true);
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
    });

    it.each([
      ['a full run', false],
      ['a dry run', true],
    ])('invalid registration on %s writes no release, stages nothing and fails with one fatal issue', async (_label, dryRun) => {
      const fakeDb = createFakeDb();
      const source = { ...hpoSource, retrievalUri: undefined };

      const result = await runImport({ db: fakeDb, source, normalizeRecord, dryRun, initiatedBy: 'test-actor' });

      expect(result.approved).toBe(false);
      expect(result.releaseId).toBeNull();
      expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(0);
      expect(fakeDb.collections.referenceImportStaging.docs).toHaveLength(0);
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
      const runs = fakeDb.collections.referenceImportRuns.docs;
      expect(runs).toHaveLength(1);
      expect(runs[0].runStatus).toBe('failed');
      const issues = fakeDb.collections.referenceImportIssues.docs;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        entityType: 'ReferenceDatasetRelease',
        errorCode: 'RELEASE_REGISTRATION_INVALID',
        severity: 'fatal',
        referenceDatasetReleaseId: 'unresolved',
      });
      expect(issues[0].errorMessage).toContain('retrievalUri');
    });
  });

  describe('asset preservation (RF028 AC2)', () => {
    const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const assetDir = () => path.join(storageRoot, 'reference-releases', hpoSource.datasetCode, 'sha256');
    const assetPath = () => path.join(assetDir(), hpoSource.expectedChecksum);

    const expectAssetFailure = (fakeDb, result) => {
      expect(result.approved).toBe(false);
      expect(result.assetUri).toBeNull();
      const releases = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releases).toHaveLength(1);
      // The content was never judged, so the release keeps its status.
      expect(releases[0].releaseStatus).toBe('downloaded');
      const releaseId = releases[0].referenceDatasetReleaseId;
      expect(result.releaseId).toBe(releaseId);
      const runs = fakeDb.collections.referenceImportRuns.docs;
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ runStatus: 'failed', referenceDatasetReleaseId: releaseId });
      const issues = fakeDb.collections.referenceImportIssues.docs;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        entityType: 'ReferenceDatasetRelease',
        errorCode: 'ASSET_PRESERVATION_FAILED',
        severity: 'fatal',
        referenceDatasetReleaseId: releaseId,
        rawValue: { assetUri: `objstore://reference-releases/HPO/sha256/${hpoSource.expectedChecksum}`, checksum: hpoSource.expectedChecksum },
      });
      expect(fakeDb.collections.referenceImportStaging.docs).toHaveLength(0);
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
    };

    it('a full run stores the asset before its first staging write, content-addressed by the release checksum', async () => {
      const fakeDb = createFakeDb();
      const staging = fakeDb.collections.referenceImportStaging;
      const { insertMany } = staging;
      let storedAtFirstStage = null;
      staging.insertMany = async (newDocs) => {
        if (storedAtFirstStage === null) storedAtFirstStage = fs.existsSync(assetPath());
        return insertMany.call(staging, newDocs);
      };

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      expect(storedAtFirstStage).toBe(true);
      const release = fakeDb.collections.referenceDatasetReleases.docs[0];
      expect(sha256(assetPath())).toBe(release.sourceChecksum);
      expect(result.assetUri).toBe('objstore://reference-releases/HPO/sha256/' + hpoSource.expectedChecksum);
      expect(fs.readdirSync(assetDir())).toEqual([hpoSource.expectedChecksum]);
      expect(result.approved).toBe(true);
    });

    it.each([
      ['a dry run', { dryRun: true }],
      ['a checksum mismatch', { source: { ...hpoSource, expectedChecksum: 'sha256-does-not-match' } }],
    ])('%s preserves nothing', async (_label, overrides) => {
      const fakeDb = createFakeDb();

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, ...overrides });

      expect(result.assetUri).toBeNull();
      expect(fs.existsSync(path.join(storageRoot, 'reference-releases'))).toBe(false);
    });

    it('a second full run of content-identical source reuses the stored object', async () => {
      const fakeDb = createFakeDb();

      const first = await runImport({ db: fakeDb, source: { ...hpoSource, datasetVersion: 'v1' }, normalizeRecord });
      const bytesAfterFirst = fs.readFileSync(assetPath());
      const second = await runImport({ db: fakeDb, source: { ...hpoSource, datasetVersion: 'v2' }, normalizeRecord });

      expect(second.idempotent).toBe(false);
      expect(second.approved).toBe(true);
      expect(second.assetUri).toBe(first.assetUri);
      expect(fs.readFileSync(assetPath()).equals(bytesAfterFirst)).toBe(true);
      expect(fs.readdirSync(assetDir())).toEqual([hpoSource.expectedChecksum]);
    });

    it('a stored object with other bytes fails the run and is left unchanged', async () => {
      const fakeDb = createFakeDb();
      fs.mkdirSync(assetDir(), { recursive: true });
      fs.writeFileSync(assetPath(), 'not the HPO release');

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      expectAssetFailure(fakeDb, result);
      expect(fs.readFileSync(assetPath(), 'utf8')).toBe('not the HPO release');
      expect(fs.readdirSync(assetDir())).toEqual([hpoSource.expectedChecksum]);
    });

    it('an unwritable storage root fails the run without throwing', async () => {
      const fakeDb = createFakeDb();
      const fileRoot = path.join(storageRoot, 'a-regular-file');
      fs.writeFileSync(fileRoot, 'x');

      const result = await runImportUnderTest({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', assetStorageRoot: fileRoot });

      expectAssetFailure(fakeDb, result);
      expect(fs.readFileSync(fileRoot, 'utf8')).toBe('x');
    });

    it('a run after an asset-preservation failure retries and completes', async () => {
      const fakeDb = createFakeDb();
      const assetRoot = path.join(storageRoot, 'asset-root');
      fs.writeFileSync(assetRoot, 'x');
      const failed = await runImportUnderTest({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', assetStorageRoot: assetRoot });
      expectAssetFailure(fakeDb, failed);
      fs.rmSync(assetRoot);
      fs.mkdirSync(assetRoot);

      const retried = await runImportUnderTest({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', assetStorageRoot: assetRoot });
      await promote(fakeDb, retried);

      expect(retried.idempotent).toBe(false);
      expect(retried.approved).toBe(true);
      expect(retried.run.referenceImportRunId).toBe(failed.run.referenceImportRunId);
      expect(retried.run.runStatus).toBe('completed');
      expect(retried.releaseId).toBe(failed.releaseId);
      const runs = fakeDb.collections.referenceImportRuns.docs.filter(
        (run) => run.idempotencyKey === failed.run.idempotencyKey && run.importMode === 'full',
      );
      expect(runs).toHaveLength(1);
      expect(runs[0].runStatus).toBe('completed');
      const releases = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releases).toHaveLength(1);
      expect(releases[0].releaseStatus).toBe('active');
      const stored = path.join(assetRoot, 'reference-releases', hpoSource.datasetCode, 'sha256', hpoSource.expectedChecksum);
      expect(sha256(stored)).toBe(hpoSource.expectedChecksum);
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
    });

    it('a failed run with a fatal issue other than ASSET_PRESERVATION_FAILED still short-circuits', async () => {
      const fakeDb = createFakeDb();
      const seeded = {
        referenceImportRunId: 'seeded-failed-run',
        referenceDatasetReleaseId: null,
        datasetCode: hpoSource.datasetCode,
        importMode: 'full',
        idempotencyKey: `${hpoSource.datasetCode}:${hpoSource.datasetVersion}:sha256:${hpoSource.expectedChecksum}`,
        runStatus: 'failed',
      };
      fakeDb.collections.referenceImportRuns.docs.push(seeded);
      fakeDb.collections.referenceImportIssues.docs.push(
        { referenceImportRunId: seeded.referenceImportRunId, errorCode: 'ASSET_PRESERVATION_FAILED', severity: 'fatal' },
        { referenceImportRunId: seeded.referenceImportRunId, errorCode: 'RELEASE_REGISTRATION_INVALID', severity: 'fatal' },
      );

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      expect(result.idempotent).toBe(true);
      expect(result.run).toBe(seeded);
      expect(fakeDb.collections.referenceDatasetReleases.docs).toHaveLength(0);
      expect(fs.existsSync(path.join(storageRoot, 'reference-releases'))).toBe(false);
    });
  });

  describe('checkpoint/resume (AC 7)', () => {
    it('writes the checkpoint in batches as staging progresses, not once at the end', async () => {
      const fakeDb = createFakeDb();

      // HPO's bundled fixture stages 8 concepts + 7 relations = 15 items;
      // batchSize 5 should produce 3 incremental checkpoint writes (5, 10,
      // 15), not a single one after everything is already staged.
      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor', batchSize: 5 }));

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
      await promote(resumeDb, result);

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
      // RF028 AC1: the seeded run's stale release id names no release here,
      // so the resumed run is linked to the release it registered.
      const resumedRelease = resumeDb.collections.referenceDatasetReleases.docs[0];
      expect(resumedRelease.releaseStatus).toBe('active');
      expect(result.run.referenceDatasetReleaseId).toBe(resumedRelease.referenceDatasetReleaseId);

      // Checkpoint writes during resume only cover the remaining items
      // (offset continues from 5, doesn't restart at 0 or re-cover 0-5).
      const checkpointOffsets = resumeDb.collections.referenceImportRuns.calls
        .filter((call) => call.method === 'updateOne' && call.update.$set && call.update.$set.checkpoint)
        .map((call) => call.update.$set.checkpoint.offset);
      expect(checkpointOffsets).toEqual([10, 15]);
    });

    // RF028 AC1 / AC 7: a release that is history is never reactivated by
    // the resume of a run that registered it before a newer release landed.
    it.each(['superseded', 'rolled_back', 'rejected'])(
      'a resumed run whose registered release was since %s registers a new release',
      async (storedStatus) => {
        const fakeDb = createFakeDb();
        const releases = fakeDb.collections.referenceDatasetReleases;
        const releaseA = {
          referenceDatasetReleaseId: 'release-a',
          datasetCode: hpoSource.datasetCode,
          systemUri: hpoSource.systemUri,
          datasetVersion: hpoSource.datasetVersion,
          sourceChecksum: hpoSource.expectedChecksum,
          releaseStatus: storedStatus,
          previousReleaseId: null,
        };
        const releaseB = {
          referenceDatasetReleaseId: 'release-b',
          datasetCode: hpoSource.datasetCode,
          systemUri: hpoSource.systemUri,
          datasetVersion: 'newer-version',
          sourceChecksum: 'newer-checksum',
          releaseStatus: 'active',
          previousReleaseId: 'release-a',
        };
        releases.docs.push(releaseA, releaseB);
        fakeDb.collections.referenceImportRuns.docs.push({
          referenceImportRunId: 'seeded-run-in-progress',
          referenceDatasetReleaseId: 'release-a',
          datasetCode: hpoSource.datasetCode,
          importMode: 'full',
          idempotencyKey: `${hpoSource.datasetCode}:${hpoSource.datasetVersion}:sha256:${hpoSource.expectedChecksum}`,
          runStatus: 'running',
          checkpoint: null,
        });

        const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
        await promote(fakeDb, result);

        expect(releases.docs).toHaveLength(3);
        expect(releaseA).toMatchObject({ releaseStatus: storedStatus, previousReleaseId: null });
        expect(releaseB.releaseStatus).toBe('superseded');
        const releaseC = releases.docs.find((r) => r.referenceDatasetReleaseId !== 'release-a' && r.referenceDatasetReleaseId !== 'release-b');
        expect(releaseC.releaseStatus).toBe('active');
        expect(releaseC.previousReleaseId).toBe('release-b');
        expect(releases.docs.filter((r) => r.datasetCode === hpoSource.datasetCode && r.releaseStatus === 'active')).toHaveLength(1);
        expect(result.run.referenceDatasetReleaseId).toBe(releaseC.referenceDatasetReleaseId);
        expect(fakeDb.collections.referenceImportRuns.docs[0].referenceDatasetReleaseId).toBe(releaseC.referenceDatasetReleaseId);
      },
    );

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

      await promote(fakeDb, await runImport({ db: fakeDb, source: v1Source, normalizeRecord, initiatedBy: 'test-actor' }));
      await promote(fakeDb, await runImport({ db: fakeDb, source: v2Source, normalizeRecord, initiatedBy: 'test-actor' }));

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
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('reports rolledBack:false when the active release has no prior release to restore', async () => {
      const fakeDb = createFakeDb();
      await promote(fakeDb, await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' }));
      auditLogger.log.mockClear();

      const result = await rollbackRelease({ db: fakeDb, datasetCode: hpoSource.datasetCode, initiatedBy: 'test-actor' });

      expect(result.rolledBack).toBe(false);
      expect(result.reason).toBe('no_previous_release');
      // Left untouched — still active, no rollback run written.
      expect(fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('active');
      expect(fakeDb.collections.referenceImportRuns.docs.some((r) => r.importMode === 'rollback')).toBe(false);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('rollback names the reactivated release as rollbackTargetId and writes one ROLLBACK AuditEvent', async () => {
      const fakeDb = createFakeDb();
      const v1 = await runImport({ db: fakeDb, source: { ...hpoSource, datasetVersion: 'v1' }, normalizeRecord, initiatedBy: 'test-actor' });
      await promote(fakeDb, v1);
      const v2 = await runImport({ db: fakeDb, source: { ...hpoSource, datasetVersion: 'v2' }, normalizeRecord, initiatedBy: 'test-actor' });
      await promote(fakeDb, v2);
      auditLogger.log.mockClear();

      const result = await rollbackRelease({ db: fakeDb, datasetCode: hpoSource.datasetCode, initiatedBy: 'test-actor' });

      expect(result.rolledBack).toBe(true);
      const releases = fakeDb.collections.referenceDatasetReleases.docs;
      const rolledBack = releases.find((r) => r.referenceDatasetReleaseId === v2.releaseId);
      expect(rolledBack).toMatchObject({ releaseStatus: 'rolled_back', rollbackTargetId: v1.releaseId });
      // The reactivated release keeps the approver of its original promotion.
      expect(releases.find((r) => r.referenceDatasetReleaseId === v1.releaseId)).toMatchObject({
        releaseStatus: 'active',
        promotionApprovedBy: 'test-approver',
      });
      expect(auditLogger.log).toHaveBeenCalledTimes(1);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ROLLBACK',
        resourceType: 'ReferenceDatasetRelease',
        resourceId: v2.releaseId,
        source: 'system',
        payload: {
          datasetCode: hpoSource.datasetCode,
          rolledBackReleaseId: v2.releaseId,
          activeReleaseId: v1.releaseId,
          initiatedBy: 'test-actor',
        },
      }));
    });
  });

  describe('explicit promotion (RF028 AC8, RNF032 C8/C9)', () => {
    it('an approved full run leaves its release approved and writes no concept, relation or outbox event', async () => {
      const fakeDb = createFakeDb();

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      expect(result.approved).toBe(true);
      const releases = fakeDb.collections.referenceDatasetReleases.docs;
      expect(releases).toHaveLength(1);
      expect(releases[0]).toMatchObject({ referenceDatasetReleaseId: result.releaseId, releaseStatus: 'approved', promotionApprovedBy: null });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(0);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(0);
      const runDoc = fakeDb.collections.referenceImportRuns.docs[0];
      expect(runDoc.runStatus).toBe('completed');
      expect(runDoc.validationSummary.approved).toBe(true);
      expect(runDoc.recordsInserted).toBe(0);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('promoteRelease activates an approved release, records its approver and writes one PROMOTE AuditEvent', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const promotion = await promote(fakeDb, result);

      expect(promotion).toMatchObject({ promoted: true, releaseId: result.releaseId, previousReleaseId: null, recordsInserted: 15 });
      const release = fakeDb.collections.referenceDatasetReleases.docs[0];
      expect(release).toMatchObject({ releaseStatus: 'active', promotionApprovedBy: 'test-approver', previousReleaseId: null });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
      expect(fakeDb.collections.referenceImportRuns.docs[0].recordsInserted).toBe(15);
      expect(auditLogger.log).toHaveBeenCalledTimes(1);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'PROMOTE',
        resourceType: 'ReferenceDatasetRelease',
        resourceId: result.releaseId,
        source: 'system',
        payload: {
          datasetCode: hpoSource.datasetCode,
          datasetVersion: hpoSource.datasetVersion,
          previousReleaseId: null,
          approvedBy: 'test-approver',
        },
      }));
    });

    it('a second promotion of the same release is refused and writes nothing new', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      await promote(fakeDb, result);

      const second = await promote(fakeDb, result);

      expect(second).toEqual({ promoted: false, reason: 'release_not_approved', releaseStatus: 'active' });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(15);
      expect(auditLogger.log).toHaveBeenCalledTimes(1);
    });

    it('promoteRelease refuses a rejected release, a dry run and an empty approver without an AuditEvent', async () => {
      const rejectedDb = createFakeDb();
      const rejectAll = () => ({ ok: false, issue: { errorCode: 'TEST_REJECT', errorMessage: 'rejected', severity: 'error' } });
      const rejected = await runImport({ db: rejectedDb, source: hpoSource, normalizeRecord: rejectAll, initiatedBy: 'test-actor' });
      expect(await promote(rejectedDb, rejected)).toEqual({ promoted: false, reason: 'release_not_approved', releaseStatus: 'rejected' });

      const dryDb = createFakeDb();
      const dry = await runImport({ db: dryDb, source: hpoSource, normalizeRecord, dryRun: true });
      expect(dry.releaseId).toBeNull();
      expect(await promote(dryDb, dry)).toEqual({ promoted: false, reason: 'release_not_found' });

      const approvedDb = createFakeDb();
      const approved = await runImport({ db: approvedDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      expect(await promoteRelease({ db: approvedDb, releaseId: approved.releaseId, approvedBy: '' }))
        .toEqual({ promoted: false, reason: 'approver_required' });
      expect(approvedDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('approved');

      for (const db of [rejectedDb, dryDb, approvedDb]) {
        expect(db.collections.terminologyConcepts.docs).toHaveLength(0);
      }
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('promoteRelease refuses an approved release with no completed approved run', async () => {
      const fakeDb = createFakeDb();
      const rejectAll = () => ({ ok: false, issue: { errorCode: 'TEST_REJECT', errorMessage: 'rejected', severity: 'error' } });
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord: rejectAll, initiatedBy: 'test-actor' });
      fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus = 'approved';

      const promotion = await promote(fakeDb, result);

      expect(promotion).toEqual({ promoted: false, reason: 'approved_run_not_found' });
      expect(fakeDb.collections.referenceDatasetReleases.docs[0].releaseStatus).toBe('approved');
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('promotion claim', () => {
    it('two promotions started together insert each record once and only one promotes', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      const outcomes = await Promise.all([promote(fakeDb, result), promote(fakeDb, result)]);

      expect(outcomes.filter((outcome) => outcome.promoted)).toHaveLength(1);
      expect(outcomes.find((outcome) => !outcome.promoted)).toEqual({ promoted: false, reason: 'promotion_in_progress' });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
      expect(fakeDb.collections.terminologyRelations.docs).toHaveLength(7);
      expect(fakeDb.collections.graph_projection_outbox.docs).toHaveLength(15);
      expect(fakeDb.collections.referenceDatasetReleases.docs[0]).toMatchObject({ releaseStatus: 'active', promotionClaimedAt: null });
      expect(auditLogger.log).toHaveBeenCalledTimes(1);
    });

    it('a promotion whose release turned active before its claim writes nothing', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      // Another caller finishes its promotion between this call's status
      // read and its claim.
      const staging = fakeDb.collections.referenceImportStaging;
      const { find } = staging;
      staging.find = (filter) => {
        Object.assign(fakeDb.collections.referenceDatasetReleases.docs[0], { releaseStatus: 'active', promotionClaimedAt: null });
        return find.call(staging, filter);
      };

      const promotion = await promote(fakeDb, result);

      expect(promotion).toEqual({ promoted: false, reason: 'release_not_approved', releaseStatus: 'active' });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('a fresh claim refuses a second promotion, which writes nothing', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      const claimedAt = new Date();
      fakeDb.collections.referenceDatasetReleases.docs[0].promotionClaimedAt = claimedAt;

      const promotion = await promote(fakeDb, result);

      expect(promotion).toEqual({ promoted: false, reason: 'promotion_in_progress' });
      expect(fakeDb.collections.referenceDatasetReleases.docs[0]).toMatchObject({ releaseStatus: 'approved', promotionClaimedAt: claimedAt });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
      expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('a stale claim, left by a crashed promotion, is retaken and the release promoted', async () => {
      const fakeDb = createFakeDb();
      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
      fakeDb.collections.referenceDatasetReleases.docs[0].promotionClaimedAt = new Date(Date.now() - 11 * 60 * 1000);

      const promotion = await promote(fakeDb, result);

      expect(promotion.promoted).toBe(true);
      expect(fakeDb.collections.referenceDatasetReleases.docs[0]).toMatchObject({ releaseStatus: 'active', promotionClaimedAt: null });
      expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(8);
    });
  });

  describe('coverage manifest and quality gate (RF028 AC6/AC7)', () => {
    const rejectAll = () => ({ ok: false, issue: { errorCode: 'TEST_REJECT', errorMessage: 'rejected', severity: 'error' } });

    it('an approved run writes its manifest and assessment before the approved flip, which names both', async () => {
      const fakeDb = createFakeDb();
      const releases = fakeDb.collections.referenceDatasetReleases;
      const { updateOne } = releases;
      let atApproval = null;
      releases.updateOne = async (filter, update, options) => {
        if (update.$set && update.$set.releaseStatus === 'approved') {
          atApproval = {
            manifests: fakeDb.collections.referenceCoverageManifests.docs.map((doc) => ({ ...doc })),
            assessments: fakeDb.collections.dataQualityAssessments.docs.map((doc) => ({ ...doc })),
          };
        }
        return updateOne.call(releases, filter, update, options);
      };

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });

      expect(result.approved).toBe(true);
      const manifests = fakeDb.collections.referenceCoverageManifests.docs;
      const assessments = fakeDb.collections.dataQualityAssessments.docs;
      expect(manifests).toHaveLength(1);
      expect(manifests[0]).toMatchObject({
        referenceDatasetReleaseId: result.releaseId,
        expectedCount: 10,
        obtainedCount: 8,
        coverageResult: 'justified',
        assets: [result.assetUri],
      });
      expect(manifests[0].exclusions.map((exclusion) => exclusion.reason)).toEqual(['MISSING_CODE', 'MISSING_DISPLAY']);
      expect(assessments).toHaveLength(1);
      expect(assessments[0]).toMatchObject({ scopeType: 'dataset_release', scopeId: result.releaseId, status: 'passed' });
      expect(releases.docs[0]).toMatchObject({
        releaseStatus: 'approved',
        coverageManifestId: manifests[0].referenceCoverageManifestId,
        dataQualityAssessmentId: assessments[0].dataQualityAssessmentId,
      });
      expect(atApproval.manifests.map((doc) => doc.referenceCoverageManifestId)).toEqual([manifests[0].referenceCoverageManifestId]);
      expect(atApproval.assessments.map((doc) => doc.dataQualityAssessmentId)).toEqual([assessments[0].dataQualityAssessmentId]);
    });

    it('a dry run and a checksum mismatch write no manifest and no assessment', async () => {
      const dryDb = createFakeDb();
      await runImport({ db: dryDb, source: hpoSource, normalizeRecord, dryRun: true });
      const mismatchDb = createFakeDb();
      await runImport({ db: mismatchDb, source: { ...hpoSource, expectedChecksum: 'sha256-does-not-match' }, normalizeRecord });

      for (const db of [dryDb, mismatchDb]) {
        expect(db.collections.referenceCoverageManifests.docs).toHaveLength(0);
        expect(db.collections.dataQualityAssessments.docs).toHaveLength(0);
      }
    });

    it('a rejected release carries its manifest and a failed assessment', async () => {
      const fakeDb = createFakeDb();

      const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord: rejectAll, initiatedBy: 'test-actor' });

      const manifest = fakeDb.collections.referenceCoverageManifests.docs[0];
      const assessment = fakeDb.collections.dataQualityAssessments.docs[0];
      expect(fakeDb.collections.referenceDatasetReleases.docs[0]).toMatchObject({
        referenceDatasetReleaseId: result.releaseId,
        releaseStatus: 'rejected',
        coverageManifestId: manifest.referenceCoverageManifestId,
        dataQualityAssessmentId: assessment.dataQualityAssessmentId,
      });
      expect(assessment).toMatchObject({ scopeId: result.releaseId, status: 'failed' });
    });

    describe('promoteRelease refuses a release without passing evidence, writing nothing', () => {
      const manifestOf = (db) => db.collections.referenceCoverageManifests.docs[0];
      const assessmentOf = (db) => db.collections.dataQualityAssessments.docs[0];
      const releaseOf = (db) => db.collections.referenceDatasetReleases.docs[0];

      it.each([
        ['coverage_manifest_missing', 'the release names no manifest or assessment', (db) => {
          Object.assign(releaseOf(db), { coverageManifestId: null, dataQualityAssessmentId: null });
        }],
        ['coverage_manifest_invalid', 'its manifest assets were changed after its checksum', (db) => {
          manifestOf(db).assets = ['file:///tampered'];
        }],
        ['coverage_manifest_invalid', 'its manifest covers another release', (db) => {
          const manifest = manifestOf(db);
          manifest.referenceDatasetReleaseId = 'another-release';
          manifest.checksum = ReferenceCoverageManifestModel.checksumOf(manifest);
        }],
        ['coverage_incomplete', 'its manifest leaves a gap no exclusion explains', (db) => {
          const manifest = manifestOf(db);
          const rebuilt = ReferenceCoverageManifestModel.create({ ...manifest, exclusions: manifest.exclusions.slice(1), coverageResult: null, checksum: null });
          expect(rebuilt.coverageResult).toBe('incomplete');
          db.collections.referenceCoverageManifests.docs[0] = rebuilt;
        }],
        ['quality_assessment_missing', 'the release names no assessment', (db) => {
          releaseOf(db).dataQualityAssessmentId = null;
        }],
        ['quality_assessment_failed', 'its assessment failed', (db) => {
          assessmentOf(db).status = 'failed';
        }],
      ])('%s when %s', async (reason, _when, alter) => {
        const fakeDb = createFakeDb();
        const result = await runImport({ db: fakeDb, source: hpoSource, normalizeRecord, initiatedBy: 'test-actor' });
        alter(fakeDb);

        const promotion = await promote(fakeDb, result);

        expect(promotion).toEqual({ promoted: false, reason });
        expect(releaseOf(fakeDb)).toMatchObject({ releaseStatus: 'approved', promotionClaimedAt: null });
        expect(fakeDb.collections.terminologyConcepts.docs).toHaveLength(0);
        expect(auditLogger.log).not.toHaveBeenCalled();
      });
    });
  });
});
