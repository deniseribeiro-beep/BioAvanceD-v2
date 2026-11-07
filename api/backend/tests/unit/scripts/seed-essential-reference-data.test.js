import { describe, it, expect } from 'vitest';
const { runSeed, parseArgs, exitCodeFor, indexGates, OPERATIONAL_COLLECTIONS } = require('../../../scripts/seed-essential-reference-data');
const { runLoad } = require('../../../scripts/load-essential-references');
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary/v2');
const FoundationDataRunModel = require('../../../src/models/FoundationDataRun');
const ReadinessReportModel = require('../../../src/models/ReadinessReport');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { CANONICAL_MODEL_RELEASE_ID, DEFERRED_P0_GATES } = require('../../../src/foundation/readiness');
const { createFakeDb } = require('../foundation/helpers/fake-db');
const rcsService = require('../../../src/services/rcs-certification.service');

/**
 * RF022 (Requisitos v4.0.0) through the Foundation job's own entry point:
 * AC1 the v2.0.0 dictionary (1644 elements, 929 historical), AC2 the index
 * builds, AC5 dry-run/apply/verify/rollback recorded as FoundationDataRuns,
 * AC7 reference loaders prepared and no reference data populated, AC8 no
 * operational data, AC9 the ReadinessReport that blocks promotion.
 *
 * The fake db (../foundation/helpers/fake-db.js) runs the pipeline's own
 * filters, sorts, upserts, counts and deletes, not canned answers, so a
 * wrong query reads as a wrong result here.
 */
const quiet = { environment: 'test', deploymentId: 'test-host' };
const apply = (db) => runSeed({ db, args: { mode: 'apply', list: false, only: null }, ...quiet });
const runsOf = (db) => db.collection(CANONICAL_COLLECTIONS.foundationDataRuns).docs;
const reportsOf = (db) => db.collection(CANONICAL_COLLECTIONS.readinessReports).docs;
const gateOf = (report, name) => report.gateResults.find((gate) => gate.gate === name);

describe('Foundation job: apply', () => {
  it('records a FoundationDataRun whose dictionaryChecksum matches the v2.0.0 catalog', async () => {
    const db = createFakeDb();
    await apply(db);

    const [run] = runsOf(db);
    expect(run.runStatus).toBe('completed');
    expect(run.dictionaryVersion).toBe('2.0.0');
    expect(run.schemaVersion).toBe('2.0.0');
    expect(run.dictionaryChecksum).toBe(canonicalDictionary.dictionaryChecksum());
  });

  it('carries a verified dictionary completeness gate in validationSummary', async () => {
    const db = createFakeDb();
    await apply(db);

    expect(runsOf(db)[0].validationSummary.dictionaryCompleteness).toMatchObject({
      dictionaryVersion: '2.0.0',
      expectedTotal: 1644,
      loadedTotal: 1644,
      historicalTotal: 929,
      missingHistoricalIds: [],
      verified: true,
    });
  });

  it('runs dry-run, apply and verify in one run and records every v2.0.0 run field (AC5)', async () => {
    const db = createFakeDb();
    await apply(db);

    const [run] = runsOf(db);
    expect(run).toMatchObject({
      executionMode: 'apply',
      dryRunResult: 'pass',
      applyResult: 'pass',
      verifyResult: 'pass',
      rollbackResult: 'not_required',
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      migrationPlanId: 'migration-1.3.0-to-2.0.0',
    });
    expect(run.contractChecksums.dictionary).toBe(canonicalDictionary.dictionaryChecksum());
    expect(run.reportUri).toMatch(new RegExp(`^urn:bioavanced:foundation-data-run:${run.foundationDataRunId}#sha256=[0-9a-f]{64}$`));
    expect(FoundationDataRunModel.validate(run)).toEqual({ isValid: true, errors: [] });
  });

  it('prepares each reference loader and populates no reference collection (AC7)', async () => {
    const db = createFakeDb();
    await apply(db);
    await apply(db);

    const [first, second] = runsOf(db);
    const miabis = first.steps.find((step) => step.step === 'miabis-minimal');
    expect(miabis).toMatchObject({ status: 'prepared', keyless: 0 });
    expect(miabis.plannedCounts.sampleTypes).toBe(require('../../../src/reference-data/miabis.min.json').sampleTypes.length);
    expect(miabis.checkpoint).toBeUndefined();
    for (const name of ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions', 'terminologies']) {
      expect(db.collection(name).docs).toHaveLength(0);
    }
    expect(second.previousRunId).toBe(first.foundationDataRunId);
  });

  it('records a step for each RF022 AC2 preparation, with a checkpoint on each it completed (AC2, AC5)', async () => {
    const db = createFakeDb();
    const { run } = await apply(db);

    expect(run.steps.map((step) => step.step)).toEqual([
      'entities', 'miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0',
      'governance-registry', 'rbac-catalog', 'report-templates', 'indexes',
      'quarantine', 'outbox', 'audit', 'tests', 'rollback',
    ]);
    const stepOf = (name) => run.steps.find((step) => step.step === name);
    expect(stepOf('entities')).toMatchObject({ status: 'completed', plannedCounts: { elements: 1644, entities: 146, historical: 929 } });
    expect(stepOf('tests')).toMatchObject({ status: 'completed', plannedCounts: { failed: 0 } });
    expect(stepOf('rollback')).toEqual({ step: 'rollback', status: 'prepared', plannedCounts: { removable: 0 } });
    for (const name of ['quarantine', 'outbox', 'audit']) {
      expect(stepOf(name)).toMatchObject({ status: 'deferred', builtIn: expect.any(String) });
    }
    const completed = run.steps.filter((step) => step.status === 'completed');
    expect(completed.map((step) => step.step)).toEqual(['entities', 'governance-registry', 'rbac-catalog', 'report-templates', 'indexes', 'tests']);
    expect(completed.map((step) => step.checkpoint.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const step of completed) {
      expect(step.checkpoint.completedAt).toBeInstanceOf(Date);
      expect(step.checkpoint.insertedIds).toBeUndefined();
    }
  });

  it('blocks readiness when apply populates a reference collection (AC7)', async () => {
    const db = createFakeDb();
    const configurationSeeds = [{ step: 'leaky-seed', seed: async (fakeDb) => fakeDb.collection('sampleTypes').insertOne({ _id: 'leaked-reference' }), count: () => ({}) }];
    const { report } = await runSeed({ db, args: parseArgs([]), ...quiet, configurationSeeds });

    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('gate:zero-reference-data');
    expect(gateOf(report, 'zero-reference-data').evidence).toMatchObject({ before: { sampleTypes: 0 }, after: { sampleTypes: 1 } });
  });

  it('writes a ready ReadinessReport naming each gate it evaluated and each it does not yet (AC9)', async () => {
    const db = createFakeDb();
    const { run, report } = await apply(db);

    expect(reportsOf(db)).toEqual([report]);
    expect(report).toMatchObject({ status: 'ready', blockers: [], foundationDataRunId: run.foundationDataRunId, canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, environment: 'test' });
    const evaluated = ['version', 'schemas', 'reference-mechanisms', 'governance-registry', 'configuration', 'rcs', 'storage-constraints', 'zero-operational-data', 'zero-reference-data'];
    for (const name of evaluated) {
      expect(gateOf(report, name)).toMatchObject({ result: 'pass', p0: true });
    }
    expect(gateOf(report, 'rcs').evidence.rulePackage.checksum).toBe(rcsService.rulePackage().checksum);
    for (const { gate } of DEFERRED_P0_GATES) {
      expect(gateOf(report, gate)).toMatchObject({ result: 'not_evaluated', p0: true });
    }
    // The evaluated P0 gates pass; the deferred ones keep coverage below 1.
    expect(report.p0Coverage).toBeCloseTo(evaluated.length / (evaluated.length + DEFERRED_P0_GATES.length));
    expect(ReadinessReportModel.validate(report)).toEqual({ isValid: true, errors: [] });
    expect(exitCodeFor({ run, report })).toBe(0);
  });

  it('blocks readiness when a unique index cannot be built, and exits non-zero', async () => {
    const db = createFakeDb({
      [CANONICAL_COLLECTIONS.samples]: () => ({
        createIndex: async (key, options) => {
          if (options.unique) throw new Error('E11000 duplicate key');
        },
      }),
    });
    const result = await apply(db);

    expect(result.report.status).toBe('blocked');
    expect(result.report.blockers).toContain('gate:storage-constraints');
    expect(gateOf(result.report, 'storage-constraints').evidence.failed[0]).toMatchObject({ collection: CANONICAL_COLLECTIONS.samples, error: 'E11000 duplicate key' });
    expect(result.run).toMatchObject({ runStatus: 'failed', verifyResult: 'fail' });
    expect(exitCodeFor(result)).toBe(2);
  });

  it('maps a failed lookup index to a warning and a failed unique index to a P0 failure', () => {
    const lookup = { collection: 'sessions', name: 'sessions_tokenHash_v1', unique: false, ok: false, error: 'interrupted' };
    const unique = { collection: 'samples', name: 'samples_barcode_unique_v2', unique: true, ok: true, error: null };
    const [constraints, lookups] = indexGates([lookup, unique], []);
    expect(constraints).toMatchObject({ gate: 'storage-constraints', result: 'pass', p0: true });
    expect(lookups).toMatchObject({ gate: 'storage-lookup-indexes', result: 'warn', p0: false });
    // A build that reported success but is not there on read-back fails too.
    expect(indexGates([unique], [unique])[0].result).toBe('fail');
  });

  it('seeds the RBAC catalog and the report templates as its configuration step (AC4)', async () => {
    const db = createFakeDb();
    const { run } = await apply(db);

    const rbac = run.steps.find((step) => step.step === 'rbac-catalog');
    const templates = run.steps.find((step) => step.step === 'report-templates');
    expect(rbac.plannedCounts.roles).toBeGreaterThan(0);
    expect(rbac.plannedCounts.permissions).toBeGreaterThan(0);
    expect(db.collection(CANONICAL_COLLECTIONS.roles).docs).toHaveLength(rbac.plannedCounts.roles);
    expect(db.collection(CANONICAL_COLLECTIONS.permissions).docs).toHaveLength(rbac.plannedCounts.permissions);
    expect(templates.plannedCounts.reportTemplates).toBeGreaterThan(0);
  });

  it('fails the apply, records it and blocks readiness when a configuration seed throws', async () => {
    const db = createFakeDb();
    const configurationSeeds = [{ step: 'rbac-catalog', seed: async () => { throw new Error('roles write refused'); }, count: () => ({}) }];

    await expect(runSeed({ db, args: parseArgs([]), ...quiet, configurationSeeds })).rejects.toThrow('roles write refused');

    const [run] = runsOf(db);
    expect(run).toMatchObject({ runStatus: 'failed', dryRunResult: 'pass', applyResult: 'fail', verifyResult: 'not_run' });
    expect(run.steps.at(-1)).toEqual({ step: 'rbac-catalog', status: 'failed' });
    expect(reportsOf(db)[0]).toMatchObject({ status: 'blocked', blockers: ['apply_failed'] });
  });

  it('blocks readiness when apply creates an operational record (AC8)', async () => {
    const db = createFakeDb();
    const configurationSeeds = [{ step: 'leaky-seed', seed: async (fakeDb) => fakeDb.collection(CANONICAL_COLLECTIONS.samples).insertOne({ _id: 'leaked-specimen' }), count: () => ({}) }];
    const { report } = await runSeed({ db, args: parseArgs([]), ...quiet, configurationSeeds });

    expect(OPERATIONAL_COLLECTIONS).toContain(CANONICAL_COLLECTIONS.samples);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('gate:zero-operational-data');
  });

  it('registers the CanonicalModelRelease and its invariant catalog once, and a re-run writes neither again (#1304, F1.2)', async () => {
    const db = createFakeDb();
    const first = await apply(db);
    const second = await apply(db);

    const releases = db.collection(CANONICAL_COLLECTIONS.canonicalModelReleases).docs;
    const catalogs = db.collection(CANONICAL_COLLECTIONS.governanceInvariantCatalogs).docs;
    expect(releases).toHaveLength(1);
    expect(catalogs).toHaveLength(1);
    expect(releases[0]).toMatchObject({ canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, semanticVersion: '2.0.0', releaseStatus: 'active' });
    expect(catalogs[0].canonicalModelReleaseId).toBe(CANONICAL_MODEL_RELEASE_ID);
    expect(first.run.steps.find((step) => step.step === 'governance-registry').plannedCounts).toEqual({ inserted: 2, conflicts: 0 });
    expect(second.run.steps.find((step) => step.step === 'governance-registry').plannedCounts).toEqual({ inserted: 0, conflicts: 0 });
    expect(second.report.status).toBe('ready');
  });

  it('blocks readiness when the registered release carries a different checksum, and leaves it untouched (#1304)', async () => {
    const db = createFakeDb();
    await apply(db);
    const releases = db.collection(CANONICAL_COLLECTIONS.canonicalModelReleases);
    releases.docs[0].checksum = 'sha256:registered-elsewhere';

    const { run, report } = await apply(db);
    expect(run.steps.find((step) => step.step === 'governance-registry').plannedCounts).toEqual({ inserted: 0, conflicts: 1 });
    expect(report.status).toBe('blocked');
    expect(report.blockers).toEqual(['gate:governance-registry']);
    expect(gateOf(report, 'governance-registry').evidence.failures).toEqual(['checksum da canonicalModelRelease diverge']);
    expect(releases.docs[0].checksum).toBe('sha256:registered-elsewhere');
  });

  it('blocks readiness when an active ConfigurationRelease has no passed validation run (plano §9, CFG-005)', async () => {
    const db = createFakeDb();
    await db.collection(CANONICAL_COLLECTIONS.configurationReleases).insertOne({ configurationReleaseId: 'never-validated', profileId: 'p', status: 'active' });
    const { report } = await apply(db);
    expect(report.blockers).toEqual(['gate:configuration']);
    expect(gateOf(report, 'configuration').evidence.unvalidated).toEqual([{ configurationReleaseId: 'never-validated', run: null }]);

    await db.collection(CANONICAL_COLLECTIONS.configurationValidationRuns).insertOne({ releaseId: 'never-validated', status: 'passed', executedAt: new Date() });
    expect((await apply(db)).report.status).toBe('ready');
  });

  it('blocks readiness when the governance registry step did not run', async () => {
    const db = createFakeDb();
    const { report } = await runSeed({ db, args: parseArgs([]), ...quiet, configurationSeeds: [] });
    expect(report.blockers).toEqual(['gate:governance-registry']);
    expect(gateOf(report, 'governance-registry').evidence.failures).toEqual(['canonicalModelRelease ausente', 'governanceInvariantCatalog ausente']);
  });

  it('blocks before applying when the same release arrives with a different dictionary checksum', async () => {
    const db = createFakeDb();
    await db.collection(CANONICAL_COLLECTIONS.foundationDataRuns).insertOne({
      environment: 'test', runStatus: 'completed', startedAt: new Date(0),
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, dictionaryChecksum: 'a-different-catalog',
    });
    const result = await apply(db);

    expect(result.run).toMatchObject({ dryRunResult: 'fail', applyResult: 'not_run', runStatus: 'failed' });
    expect(result.report.blockers).toEqual(expect.arrayContaining(['gate:version', 'dry_run_failed']));
    expect(db.collection('sampleTypes').docs).toHaveLength(0);
    expect(exitCodeFor(result)).toBe(2);
  });
});

describe('Foundation job: the other modes', () => {
  it('--dry-run records a dry_run run and writes nothing else', async () => {
    const db = createFakeDb();
    const result = await runSeed({ db, args: parseArgs(['--dry-run']), ...quiet });

    expect(result.run).toMatchObject({ executionMode: 'dry_run', dryRunResult: 'pass', applyResult: 'not_run', verifyResult: 'not_run' });
    expect(result.report).toBeNull();
    expect(Object.keys(db.collections).sort()).toEqual([CANONICAL_COLLECTIONS.foundationDataRuns]);
    expect(FoundationDataRunModel.validate(result.run).isValid).toBe(true);
    expect(exitCodeFor(result)).toBe(0);
  });

  it('--verify with no completed apply blocks readiness', async () => {
    const db = createFakeDb();
    const result = await runSeed({ db, args: parseArgs(['--verify']), ...quiet });

    expect(result.run.executionMode).toBe('validate');
    expect(result.report.status).toBe('blocked');
    // Nothing was ever applied, so the governance registry is empty too.
    expect(result.report.blockers).toEqual(['gate:governance-registry', 'no_completed_apply']);
  });

  it('--verify after an apply writes a new ready report', async () => {
    const db = createFakeDb();
    await apply(db);
    const result = await runSeed({ db, args: parseArgs(['--verify']), ...quiet });

    expect(result.run).toMatchObject({ executionMode: 'validate', verifyResult: 'pass', applyResult: 'not_run' });
    expect(result.report.status).toBe('ready');
    expect(gateOf(result.report, 'rcs')).toMatchObject({ result: 'pass', p0: true });
    expect(reportsOf(db)).toHaveLength(2);
  });

  it('--rollback of an apply leaves the references Phase 2 loaded, appends a run, and blocks readiness (AC7, AC10)', async () => {
    const db = createFakeDb();
    const { run: applyRun } = await apply(db);
    await runLoad({ db, args: { dryRun: false, only: null }, environment: 'test' });
    const loaded = db.collection('sampleTypes').docs.length;
    const result = await runSeed({ db, args: parseArgs(['--rollback']), ...quiet });

    expect(loaded).toBeGreaterThan(0);
    expect(db.collection('sampleTypes').docs).toHaveLength(loaded);
    expect(result.run).toMatchObject({ executionMode: 'rollback', rollbackResult: 'pass', runStatus: 'rolled_back' });
    expect(result.run.validationSummary.rollbackTargetRunId).toBe(applyRun.foundationDataRunId);
    expect(result.report).toMatchObject({ status: 'blocked', blockers: [`rolled_back:${applyRun.foundationDataRunId}`] });
    // The apply run itself is untouched: evidence is append-only.
    expect(runsOf(db).find((run) => run.foundationDataRunId === applyRun.foundationDataRunId)).toEqual(applyRun);
    expect(exitCodeFor(result)).toBe(0);
  });

  it('--rollback still removes exactly the ids an older apply checkpointed', async () => {
    const db = createFakeDb();
    // An apply from before RF022 AC7, when Foundation upserted references.
    await db.collection(CANONICAL_COLLECTIONS.foundationDataRuns).insertOne({
      foundationDataRunId: 'older-apply', environment: 'test', executionMode: 'apply', applyResult: 'pass', startedAt: new Date(0),
      steps: [{ step: 'miabis-minimal', checkpoint: { insertedIds: { sampleTypes: ['claimed-1', 'claimed-2'] } } }],
    });
    for (const _id of ['pre-existing', 'claimed-1', 'claimed-2']) await db.collection('sampleTypes').insertOne({ _id });
    const result = await runSeed({ db, args: parseArgs(['--rollback']), ...quiet });

    expect(db.collection('sampleTypes').docs.map((doc) => doc._id)).toEqual(['pre-existing']);
    expect(result.run.validationSummary.rollbackTargetRunId).toBe('older-apply');
    expect(result.run.steps[0].removed).toEqual({ sampleTypes: 2 });
  });

  it('a second --rollback finds nothing left to undo', async () => {
    const db = createFakeDb();
    await apply(db);
    await runSeed({ db, args: parseArgs(['--rollback']), ...quiet });
    const result = await runSeed({ db, args: parseArgs(['--rollback']), ...quiet });

    expect(result.run.rollbackResult).toBe('not_required');
    expect(result.run.validationSummary.rollbackTargetRunId).toBeNull();
  });

  it('parseArgs maps each flag to its execution mode', () => {
    expect(parseArgs([]).mode).toBe('apply');
    expect(parseArgs(['--dry-run']).mode).toBe('dry_run');
    expect(parseArgs(['--verify']).mode).toBe('validate');
    expect(parseArgs(['--rollback']).mode).toBe('rollback');
    expect(parseArgs(['--list', '--only=sprec-minimal'])).toMatchObject({ list: true, only: 'sprec-minimal' });
  });

  it('rejects an unknown --only key', async () => {
    await expect(runSeed({ db: createFakeDb(), args: parseArgs(['--only=nope']), ...quiet })).rejects.toThrow('Unknown seed key: nope');
  });
});
