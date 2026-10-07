import { describe, it, expect } from 'vitest';
const { runSeed, parseArgs, exitCodeFor, indexGates, OPERATIONAL_COLLECTIONS } = require('../../../scripts/seed-essential-reference-data');
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary/v2');
const FoundationDataRunModel = require('../../../src/models/FoundationDataRun');
const ReadinessReportModel = require('../../../src/models/ReadinessReport');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { CANONICAL_MODEL_RELEASE_ID, DEFERRED_P0_GATES } = require('../../../src/foundation/readiness');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RF022 (Requisitos v4.0.0) through the Foundation job's own entry point:
 * AC1 the v2.0.0 dictionary (1644 elements, 929 historical), AC2 the index
 * builds, AC5 dry-run/apply/verify/rollback recorded as FoundationDataRuns,
 * AC8 no operational data, AC9 the ReadinessReport that blocks promotion.
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

  it('checkpoints the ids each step inserted, and claims none on a re-run', async () => {
    const db = createFakeDb();
    await apply(db);
    await apply(db);

    const [first, second] = runsOf(db);
    const firstInserted = first.steps.find((step) => step.step === 'miabis-minimal').checkpoint.insertedIds;
    expect(firstInserted.sampleTypes).toHaveLength(db.collection('sampleTypes').docs.length);
    expect(second.steps.find((step) => step.step === 'miabis-minimal').checkpoint.insertedIds.sampleTypes).toEqual([]);
    expect(second.previousRunId).toBe(first.foundationDataRunId);
  });

  it('writes a ready ReadinessReport naming each gate it evaluated and each it does not yet (AC9)', async () => {
    const db = createFakeDb();
    const { run, report } = await apply(db);

    expect(reportsOf(db)).toEqual([report]);
    expect(report).toMatchObject({ status: 'ready', blockers: [], foundationDataRunId: run.foundationDataRunId, canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, environment: 'test' });
    for (const name of ['version', 'schemas', 'reference-mechanisms', 'storage-constraints', 'zero-operational-data']) {
      expect(gateOf(report, name)).toMatchObject({ result: 'pass', p0: true });
    }
    for (const { gate } of DEFERRED_P0_GATES) {
      expect(gateOf(report, gate)).toMatchObject({ result: 'not_evaluated', p0: true });
    }
    // Five evaluated P0 gates pass; the deferred ones keep coverage below 1.
    expect(report.p0Coverage).toBeCloseTo(5 / (5 + DEFERRED_P0_GATES.length));
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
    const db = createFakeDb({
      sampleTypes: (fakeDb) => ({
        afterUpsert: async () => {
          await fakeDb.collection(CANONICAL_COLLECTIONS.samples).insertOne({ _id: 'leaked-specimen' });
        },
      }),
    });
    const { report } = await apply(db);

    expect(OPERATIONAL_COLLECTIONS).toContain(CANONICAL_COLLECTIONS.samples);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('gate:zero-operational-data');
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
    expect(result.report.blockers).toEqual(expect.arrayContaining(['no_completed_apply', 'gate:reference-mechanisms']));
  });

  it('--verify after an apply writes a new ready report', async () => {
    const db = createFakeDb();
    await apply(db);
    const result = await runSeed({ db, args: parseArgs(['--verify']), ...quiet });

    expect(result.run).toMatchObject({ executionMode: 'validate', verifyResult: 'pass', applyResult: 'not_run' });
    expect(result.report.status).toBe('ready');
    expect(reportsOf(db)).toHaveLength(2);
  });

  it('--rollback removes only what the newest apply inserted, appends a run, and blocks readiness (AC10)', async () => {
    const db = createFakeDb();
    // A doc that existed before Foundation ran: no apply claims it.
    const firstSampleType = require('../../../src/reference-data/miabis.min.json').sampleTypes[0];
    await db.collection('sampleTypes').insertOne({ _id: 'pre-existing', ...firstSampleType });
    const { run: applyRun } = await apply(db);
    const result = await runSeed({ db, args: parseArgs(['--rollback']), ...quiet });

    expect(db.collection('sampleTypes').docs.map((doc) => doc._id)).toEqual(['pre-existing']);
    expect(db.collection('terminologies').docs).toHaveLength(0);
    expect(result.run).toMatchObject({ executionMode: 'rollback', rollbackResult: 'pass', runStatus: 'rolled_back' });
    expect(result.run.validationSummary.rollbackTargetRunId).toBe(applyRun.foundationDataRunId);
    expect(result.report).toMatchObject({ status: 'blocked', blockers: [`rolled_back:${applyRun.foundationDataRunId}`] });
    // The apply run itself is untouched: evidence is append-only.
    expect(runsOf(db).find((run) => run.foundationDataRunId === applyRun.foundationDataRunId)).toEqual(applyRun);
    expect(exitCodeFor(result)).toBe(0);
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
