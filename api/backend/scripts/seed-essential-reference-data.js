require('dotenv').config();

const crypto = require('crypto');
const os = require('os');
const { version: pipelineVersion } = require('../package.json');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { getManifest } = require('../src/reference-data/essential');
const { selectEntries, planSteps, referenceCollections } = require('../src/foundation/essential-references');
const FoundationDataRunModel = require('../src/models/FoundationDataRun');
const ReadinessReportModel = require('../src/models/ReadinessReport');
const canonicalDictionary = require('../src/reference-data/canonical-dictionary/v2');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { buildFoundationIndexes, verifyFoundationIndexes, INDEX_TARGETS } = require('../src/foundation/indexes');
const { CANONICAL_MODEL_RELEASE_ID, MIGRATION_PLAN_ID, DEFERRED_P0_GATES } = require('../src/foundation/readiness');
const { rcsReadinessGate } = require('../src/foundation/rcs-readiness');

// The Foundation Data Pipeline's one-shot job (RF022, RNF031). It runs
// before the API and workers (RF022 AC4, RNF014 C6) and, in one apply run,
// does what the Foundation plan orders (plano §4): dry-run, apply, verify,
// then a ReadinessReport (RF022 AC9) whose status decides whether the API
// may start. The job exits non-zero on a blocked report, so a compose
// `service_completed_successfully` dependency holds the API back too.
//
// Modes (RF022 AC5, RNF031 C4), each recorded as a FoundationDataRun:
//   (default)   apply: dry-run, apply, verify, ReadinessReport
//   --dry-run   dry_run: plans and validates, mutates nothing
//   --verify    validate: re-verifies the newest apply, new ReadinessReport
//   --rollback  rollback: removes what the newest un-rolled-back apply
//               checkpointed, and blocks readiness until the next apply.
//               An apply since RF022 AC7 inserts no reference docs, so
//               only an older apply's checkpoints still name any
//   --list      prints the manifest, touches no database
//
// Apply also seeds the configuration catalogs (RBAC, system report
// templates), which the API seeded at its own boot until RF022 AC4 moved
// them here; the API still does when no Foundation job runs first.
//
// The essential manifest is the 3-entry set (#366). Foundation prepares its
// loaders and populates none of it (RF022 AC7, plano §4 F1.7): the dry-run
// loads every entry, and a P0 gate fails the run if any reference
// collection gained a doc during apply. The Phase 2 job,
// scripts/load-essential-references.js, loads it after this job's report
// is ready. The full canonical dictionary is loaded to pin
// dictionaryVersion/checksum/completeness (RF022 AC1: v2.0.0, 1644 elements
// with the 929 historical ones). Mongo schemas for the non-technical domain
// elements are out of scope here.

// The configuration catalogs Foundation prepares (RF022 AC2, plano F1.2).
// Lazily required: they pull the models and the collection resolver, which
// --list never needs.
const CONFIGURATION_SEEDS = [
  {
    // #1304, F1.2: the CanonicalModelRelease and its GovernanceInvariantCatalog.
    step: 'governance-registry',
    seed: (db) => require('../src/governance/registry').registerGovernance(db),
    count: ({ inserted, conflicts }) => ({ inserted: inserted.length, conflicts: conflicts.length }),
  },
  {
    step: 'rbac-catalog',
    seed: (db) => require('../src/services/rbac-catalog-seed.service').seedRolesAndPermissions(db),
    count: ({ roles, permissions }) => ({ roles: roles.length, permissions: permissions.length }),
  },
  {
    step: 'report-templates',
    seed: (db) => require('../src/services/report-template-seed.service').seedReportTemplates(db),
    count: ({ templates }) => ({ reportTemplates: templates.length }),
  },
];

// Operational collections the Foundation must leave untouched (RF022 AC8,
// RNF031 C7): it counts them before and after apply. AC8 names participants,
// identities, consents, specimens, telemetry, files, studies, assays and
// operational workflows. Telemetry readings themselves live in InfluxDB and
// file binaries in the object store: the job loads no client for either,
// which tests/architecture/foundation-job-stores.arch.test.js checks.
const OPERATIONAL_COLLECTIONS = [
  CANONICAL_COLLECTIONS.patients,
  CANONICAL_COLLECTIONS.participantIdentities,
  CANONICAL_COLLECTIONS.consents,
  CANONICAL_COLLECTIONS.samples,
  CANONICAL_COLLECTIONS.sampleMovements,
  CANONICAL_COLLECTIONS.encounters,
  CANONICAL_COLLECTIONS.rcsAssessments,
  CANONICAL_COLLECTIONS.accessRequests,
  // Telemetry: each reading's receipt and its validation issues (written by
  // src/services/telemetryReadingContract.js), the exposure summaries and
  // the datastreams a device's readings bind to.
  'telemetryIngestionEvents',
  'telemetryValidationIssues',
  CANONICAL_COLLECTIONS.telemetryExposureSummaries,
  CANONICAL_COLLECTIONS.telemetryDatastreams,
  // Files: each uploaded file's metadata and its versions.
  'sample_files',
  'assayFiles',
  'datasetFiles',
  'AnalysisFile',
  CANONICAL_COLLECTIONS.dataFileVersions,
  // Studies, assays and workflow runs.
  'studies',
  'assays',
  'workflowRuns',
];

function parseArgs(argv) {
  const args = { mode: 'apply', list: false, only: null };
  for (const token of argv) {
    if (token === '--dry-run') args.mode = 'dry_run';
    else if (token === '--verify') args.mode = 'validate';
    else if (token === '--rollback') args.mode = 'rollback';
    else if (token === '--list') args.list = true;
    else if (token.startsWith('--only=')) args.only = token.slice('--only='.length);
  }
  return args;
}

function checksumFor(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function countOperational(db) {
  const counts = {};
  for (const name of OPERATIONAL_COLLECTIONS) {
    counts[name] = await db.collection(name).countDocuments({});
  }
  return counts;
}

// The essential set's reference collections, counted before and after
// apply: Foundation prepares their loaders and must not populate them
// (RF022 AC7).
async function countReferences(db, plan) {
  const counts = {};
  for (const name of referenceCollections(plan)) {
    counts[name] = await db.collection(name).countDocuments({});
  }
  return counts;
}

function gate(name, passed, p0, evidence) {
  return { gate: name, result: passed ? 'pass' : 'fail', p0, evidence };
}

// F1.7: every reference loader loads and every doc it plans carries its
// unique keys, so the Phase 2 job can upsert it.
function mechanismsGate(plan) {
  return gate('reference-mechanisms', plan.every((step) => step.keyless === 0), true, {
    loaders: plan.map(({ entry, plannedCounts, keyless }) => ({ key: entry.key, plannedCounts, keyless })),
  });
}

// RF022 AC5: a step the apply completed records its checkpoint, the order
// and time it completed, so the run reads back where it got to. It names no
// insertedIds: Foundation inserts no reference docs (AC7), so --rollback
// still removes only what an older apply checkpointed.
function completeStep(steps, step) {
  const sequence = steps.filter((entry) => entry.checkpoint).length + 1;
  steps.push({ ...step, status: 'completed', checkpoint: { sequence, completedAt: new Date() } });
}

// RF022 AC2 preparations this job does not build yet: each is recorded as a
// step with the phase that brings it, as DEFERRED_P0_GATES does for the
// readiness gates, so the run names every preparation.
const DEFERRED_PREPARATIONS = [
  { step: 'quarantine', builtIn: 'later phase' },
  { step: 'outbox', builtIn: 'W7 · outbox v2' },
  { step: 'audit', builtIn: 'later phase' },
];

function contractChecksums(selected) {
  return {
    dictionary: canonicalDictionary.dictionaryChecksum(),
    essentialManifest: checksumFor(selected.map(({ key, version, uniqueKeys }) => ({ key, version, uniqueKeys }))),
    indexTargets: checksumFor(INDEX_TARGETS.map((target) => target.collection)),
  };
}

function runBase({ selected, args, environment, deploymentId, previousRun, executionMode }) {
  return {
    pipelineVersion,
    schemaVersion: canonicalDictionary.DICTIONARY_VERSION,
    dictionaryVersion: canonicalDictionary.DICTIONARY_VERSION,
    environment,
    deploymentId,
    executionMode,
    configurationChecksum: checksumFor({ selectedKeys: selected.map((entry) => entry.key), only: args.only, environment, deploymentId }),
    dictionaryChecksum: canonicalDictionary.dictionaryChecksum(),
    canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    migrationPlanId: MIGRATION_PLAN_ID,
    contractChecksums: contractChecksums(selected),
    initiatedBy: 'system:foundation-data-pipeline',
    previousRunId: previousRun ? previousRun.foundationDataRunId : null,
  };
}

// The run's reportUri names the run document itself, by id and content
// hash, until object storage exists (W10).
function finishRun(data) {
  const runId = crypto.randomUUID();
  const { reportUri, ...content } = data;
  return FoundationDataRunModel.create({
    ...content,
    foundationDataRunId: runId,
    reportUri: `urn:bioavanced:foundation-data-run:${runId}#sha256=${checksumFor(content)}`,
  });
}

async function writeReport(db, run, gateResults, extraBlockers = []) {
  const report = ReadinessReportModel.create({
    foundationDataRunId: run.foundationDataRunId,
    canonicalModelReleaseId: run.canonicalModelReleaseId,
    environment: run.environment,
    gateResults: [
      ...gateResults,
      ...DEFERRED_P0_GATES.map(({ gate: name, phase }) => ({ gate: name, result: 'not_evaluated', p0: true, evidence: { builtIn: phase } })),
    ],
    extraBlockers,
  });
  await db.collection(CANONICAL_COLLECTIONS.readinessReports).insertOne(report);
  return report;
}

// Release/checksum parity (plano §9 "Versão"): the same release id must not
// arrive with a different dictionary checksum than an earlier completed run.
function versionGate(previousCompleted) {
  const dictionaryCompleteness = canonicalDictionary.checkCompleteness();
  const checksum = canonicalDictionary.dictionaryChecksum();
  const drifted = previousCompleted
    && previousCompleted.canonicalModelReleaseId === CANONICAL_MODEL_RELEASE_ID
    && previousCompleted.dictionaryChecksum !== checksum;
  return {
    dictionaryCompleteness,
    gates: [
      gate('version', !drifted, true, { canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, dictionaryChecksum: checksum, previousChecksum: previousCompleted ? previousCompleted.dictionaryChecksum : null }),
      gate('schemas', dictionaryCompleteness.verified, true, { loadedTotal: dictionaryCompleteness.loadedTotal, historicalTotal: dictionaryCompleteness.historicalTotal }),
    ],
  };
}

// #1304, F1.2/F1.10: the release this run names is registered, with the
// invariant catalog bound to it, and both checksums match this build's.
async function governanceGate(db) {
  const { passed, evidence } = await require('../src/governance/registry').verifyGovernance(db);
  return gate('governance-registry', passed, true, evidence);
}

// plano §9 "Configuração": every active ConfigurationRelease went through a
// ConfigurationValidationRun that passed (RF014 AC3, CFG-005).
async function configurationGate(db) {
  const { latestRunOf } = require('../src/services/configurationValidation.service');
  const active = await db.collection(CANONICAL_COLLECTIONS.configurationReleases).find({ status: 'active' }).toArray();
  const unvalidated = [];
  for (const release of active) {
    const run = await latestRunOf(db, release.configurationReleaseId);
    if (!run || run.status !== 'passed') unvalidated.push({ configurationReleaseId: release.configurationReleaseId, run: run ? run.status : null });
  }
  return gate('configuration', unvalidated.length === 0, true, { activeReleases: active.length, unvalidated });
}

function indexGates(builds, missing) {
  const failedUnique = builds.filter((build) => build.unique && (build.ok === false || missing.includes(build)));
  const failedLookup = builds.filter((build) => !build.unique && (build.ok === false || missing.includes(build)));
  const summary = (list) => list.map(({ collection, name, error }) => ({ collection, name, error }));
  return [
    // A unique index is a constraint, so a missing one is a structural failure.
    gate('storage-constraints', failedUnique.length === 0, true, { built: builds.filter((build) => build.unique).length, failed: summary(failedUnique) }),
    // A lookup index only serves performance: reported, never blocking.
    { gate: 'storage-lookup-indexes', result: failedLookup.length === 0 ? 'pass' : 'warn', p0: false, evidence: { built: builds.filter((build) => !build.unique).length, failed: summary(failedLookup) } },
  ];
}

async function newestRun(runs, filter) {
  return runs.find(filter).sort({ startedAt: -1 }).limit(1).next();
}

async function runApply({ db, args, environment, deploymentId, selected, configurationSeeds }) {
  const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
  const previousRun = await newestRun(runs, { environment });
  const previousCompleted = await newestRun(runs, { environment, runStatus: 'completed' });
  const base = runBase({ selected, args, environment, deploymentId, previousRun, executionMode: 'apply' });
  const startedAt = new Date();

  // F1.0/F1.1: preflight and dry-run.
  const { dictionaryCompleteness, gates: versionGates } = versionGate(previousCompleted);
  const plan = planSteps(selected);
  const dryRunPassed = versionGates.every((g) => g.result === 'pass') && plan.every((step) => step.keyless === 0);
  if (!dryRunPassed) {
    const run = finishRun({
      ...base, startedAt, completedAt: new Date(), runStatus: 'failed', dryRunResult: 'fail', applyResult: 'not_run', verifyResult: 'not_run', rollbackResult: 'not_required',
      steps: plan.map(({ entry, plannedCounts, keyless }) => ({ step: entry.key, status: 'planned', plannedCounts, keyless })),
      validationSummary: { passed: 0, failed: 1, dictionaryCompleteness },
      errorSummary: { fatal: 1, message: 'dry-run failed: see the ReadinessReport gates' },
    });
    await runs.insertOne(run);
    const report = await writeReport(db, run, versionGates, ['dry_run_failed']);
    return { run, report };
  }

  // F1.3/F1.4/F1.7: apply. F1.7 prepares the reference loaders and writes
  // nothing through them (RF022 AC7): each entry's step records what the
  // Phase 2 job will load.
  const operationalBefore = await countOperational(db);
  const referencesBefore = await countReferences(db, plan);
  const steps = [];
  // F1.3: the dictionary's entities, validated by the dry-run above.
  completeStep(steps, { step: 'entities', plannedCounts: { elements: dictionaryCompleteness.loadedTotal, entities: dictionaryCompleteness.entityTotal, historical: dictionaryCompleteness.historicalTotal } });
  steps.push(...plan.map(({ entry, plannedCounts, keyless }) => ({ step: entry.key, system: entry.system, version: entry.version, status: 'prepared', plannedCounts, keyless })));
  let builds = [];
  let currentStep = null;
  try {
    // F1.2 configuration catalogs, which the API seeded at its own boot
    // before RF022 AC4 separated the two. Both upserts are idempotent and
    // reconcile catalog-owned fields, so a re-run is safe; a failure here is
    // fatal for the run, where it was only logged at boot.
    for (const { step, seed, count } of configurationSeeds) {
      currentStep = step;
      const result = await seed(db);
      completeStep(steps, { step, plannedCounts: count(result) });
    }
    currentStep = 'indexes';
    builds = await buildFoundationIndexes(db);
    completeStep(steps, { step: 'indexes', plannedCounts: { indexes: builds.length } });
  } catch (error) {
    const run = finishRun({
      ...base, startedAt, completedAt: new Date(), runStatus: 'failed', dryRunResult: 'pass', applyResult: 'fail', verifyResult: 'not_run', rollbackResult: 'not_required',
      steps: [...steps, { step: currentStep || 'unknown', status: 'failed' }],
      validationSummary: { passed: steps.length, failed: 1, dictionaryCompleteness },
      // P1X-0409: errorSummary must stay sanitized (no secrets/tokens/raw
      // payloads) — truncate defensively since a Mongo write-error message
      // can echo back offending field values.
      errorSummary: { fatal: 1, message: String(error.message || error).slice(0, 300) },
    });
    await runs.insertOne(run);
    await writeReport(db, run, versionGates, ['apply_failed']);
    throw error;
  }

  // F1.10: verify.
  const missingIndexes = await verifyFoundationIndexes(db, builds);
  const operationalAfter = await countOperational(db);
  const createdOperational = Object.keys(operationalAfter).filter((name) => operationalAfter[name] > operationalBefore[name]);
  const referencesAfter = await countReferences(db, plan);
  const populatedReferences = Object.keys(referencesAfter).filter((name) => referencesAfter[name] > referencesBefore[name]);
  const verifyGates = [
    mechanismsGate(plan),
    await governanceGate(db),
    await configurationGate(db),
    rcsReadinessGate(),
    ...indexGates(builds, missingIndexes),
    gate('zero-operational-data', createdOperational.length === 0, true, { before: operationalBefore, after: operationalAfter }),
    gate('zero-reference-data', populatedReferences.length === 0, true, { before: referencesBefore, after: referencesAfter }),
  ];
  const gateResults = [...versionGates, ...verifyGates];
  const verifyPassed = verifyGates.every((g) => g.result !== 'fail');

  steps.push(...DEFERRED_PREPARATIONS.map(({ step, builtIn }) => ({ step, status: 'deferred', builtIn })));
  // F1.10: the verify gates are the run's tests.
  const testCounts = { gates: verifyGates.length, failed: verifyGates.filter((g) => g.result === 'fail').length };
  if (verifyPassed) completeStep(steps, { step: 'tests', plannedCounts: testCounts });
  else steps.push({ step: 'tests', status: 'failed', plannedCounts: testCounts });
  // F1.11: what a --rollback of this run would remove, read from the
  // checkpoints above.
  const removable = steps.reduce((sum, step) => sum + Object.values(step.checkpoint?.insertedIds || {}).reduce((n, ids) => n + ids.length, 0), 0);
  steps.push({ step: 'rollback', status: 'prepared', plannedCounts: { removable } });

  const run = finishRun({
    ...base, startedAt, completedAt: new Date(),
    runStatus: verifyPassed ? 'completed' : 'failed',
    dryRunResult: 'pass', applyResult: 'pass', verifyResult: verifyPassed ? 'pass' : 'fail', rollbackResult: 'not_required',
    steps,
    validationSummary: {
      passed: gateResults.filter((g) => g.result === 'pass').length,
      failed: gateResults.filter((g) => g.result === 'fail').length,
      dictionaryCompleteness,
      gateResults,
    },
  });
  await runs.insertOne(run);
  const report = await writeReport(db, run, gateResults);
  return { run, report };
}

async function runDryRun({ db, args, environment, deploymentId, selected }) {
  const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
  const previousRun = await newestRun(runs, { environment });
  const previousCompleted = await newestRun(runs, { environment, runStatus: 'completed' });
  const { dictionaryCompleteness, gates } = versionGate(previousCompleted);
  const plan = planSteps(selected);
  for (const { entry, plannedCounts } of plan) {
    console.log(JSON.stringify({ key: entry.key, mode: 'dry_run', plannedCounts }, null, 2));
  }
  const passed = gates.every((g) => g.result === 'pass') && plan.every((step) => step.keyless === 0);
  const run = finishRun({
    ...runBase({ selected, args, environment, deploymentId, previousRun, executionMode: 'dry_run' }),
    completedAt: new Date(),
    runStatus: passed ? 'completed' : 'failed',
    dryRunResult: passed ? 'pass' : 'fail',
    applyResult: 'not_run', verifyResult: 'not_run', rollbackResult: 'not_required',
    steps: plan.map(({ entry, plannedCounts, keyless }) => ({ step: entry.key, status: 'planned', plannedCounts, keyless })),
    validationSummary: { passed: gates.filter((g) => g.result === 'pass').length, failed: gates.filter((g) => g.result === 'fail').length, dictionaryCompleteness, gateResults: gates },
  });
  await runs.insertOne(run);
  return { run, report: null };
}

async function runVerify({ db, args, environment, deploymentId, selected }) {
  const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
  const previousRun = await newestRun(runs, { environment });
  const lastApply = await newestRun(runs, { environment, executionMode: 'apply', runStatus: 'completed' });
  const { dictionaryCompleteness, gates: versionGates } = versionGate(lastApply);
  const plan = planSteps(selected);
  const builds = await buildFoundationIndexes(db);
  const missingIndexes = await verifyFoundationIndexes(db, builds);
  const gateResults = [
    ...versionGates,
    mechanismsGate(plan),
    await governanceGate(db),
    await configurationGate(db),
    rcsReadinessGate(),
    ...indexGates(builds, missingIndexes),
  ];
  const passed = gateResults.every((g) => g.result !== 'fail');
  const run = finishRun({
    ...runBase({ selected, args, environment, deploymentId, previousRun, executionMode: 'validate' }),
    completedAt: new Date(),
    runStatus: passed ? 'completed' : 'failed',
    dryRunResult: 'not_run', applyResult: 'not_run', verifyResult: passed ? 'pass' : 'fail', rollbackResult: 'not_required',
    steps: [{ step: 'verify', status: passed ? 'completed' : 'failed' }],
    validationSummary: { passed: gateResults.filter((g) => g.result === 'pass').length, failed: gateResults.filter((g) => g.result === 'fail').length, dictionaryCompleteness, gateResults },
  });
  await runs.insertOne(run);
  // No apply on record is itself a blocker: nothing has been promoted.
  const report = await writeReport(db, run, gateResults, lastApply ? [] : ['no_completed_apply']);
  return { run, report };
}

async function runRollback({ db, args, environment, deploymentId, selected }) {
  const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
  const previousRun = await newestRun(runs, { environment });
  // The newest apply that no rollback run has named yet. Runs are
  // append-only (RF022 AC10): the apply run is never edited.
  const rolledBack = new Set((await runs.find({ environment, executionMode: 'rollback' }).toArray()).map((run) => run.validationSummary?.rollbackTargetRunId));
  const applies = await runs.find({ environment, executionMode: 'apply', applyResult: 'pass' }).sort({ startedAt: -1 }).toArray();
  const target = applies.find((run) => !rolledBack.has(run.foundationDataRunId)) || null;

  const removed = {};
  let rollbackResult = 'not_required';
  let errorSummary = null;
  if (target) {
    try {
      for (const step of target.steps || []) {
        for (const [collectionName, ids] of Object.entries(step.checkpoint?.insertedIds || {})) {
          if (!ids.length) continue;
          const result = await db.collection(collectionName).deleteMany({ _id: { $in: ids } });
          removed[collectionName] = (removed[collectionName] || 0) + (result?.deletedCount || 0);
        }
      }
      rollbackResult = 'pass';
    } catch (error) {
      rollbackResult = 'fail';
      errorSummary = { fatal: 1, message: String(error.message || error).slice(0, 300) };
    }
  }

  const run = finishRun({
    ...runBase({ selected, args, environment, deploymentId, previousRun, executionMode: 'rollback' }),
    completedAt: new Date(),
    runStatus: rollbackResult === 'fail' ? 'failed' : 'rolled_back',
    dryRunResult: 'not_run', applyResult: 'not_run', verifyResult: 'not_run', rollbackResult,
    // Indexes stay: they are structure every later apply rebuilds anyway,
    // and the request paths build them lazily too (#941).
    steps: [{ step: 'rollback', status: rollbackResult, removed }],
    // rollbackTargetRunId: which apply this undid, read back above so the
    // next rollback skips it.
    validationSummary: { passed: rollbackResult === 'fail' ? 0 : 1, failed: rollbackResult === 'fail' ? 1 : 0, rollbackTargetRunId: target ? target.foundationDataRunId : null },
    errorSummary,
  });
  await runs.insertOne(run);
  // After a rollback nothing is promoted until the next apply.
  const report = await writeReport(db, run, [gate('rollback', rollbackResult !== 'fail', true, { removed })], [`rolled_back:${target ? target.foundationDataRunId : 'none'}`]);
  return { run, report };
}

/**
 * Core pipeline logic, factored out from `main()` so it can run against an
 * injected `db` (a real Mongo handle from the CLI entrypoint, or a fake
 * collection in tests) instead of always opening a live connection.
 * Returns { run, report }, or null for --list. `configurationSeeds` defaults
 * to the RBAC catalog and the system report templates.
 */
async function runSeed({ db, args, environment, deploymentId, configurationSeeds = CONFIGURATION_SEEDS }) {
  if (args.list) {
    for (const entry of getManifest()) {
      console.log(`${entry.key}\t${entry.system}\t${entry.version}\t${entry.description}`);
    }
    return null;
  }
  const selected = selectEntries(args.only);
  const context = { db, args, environment, deploymentId, selected, configurationSeeds };
  const mode = args.mode || 'apply';
  if (mode === 'dry_run') return runDryRun(context);
  if (mode === 'validate') return runVerify(context);
  if (mode === 'rollback') return runRollback(context);
  return runApply(context);
}

// Exit 0 only when the run did what it was asked and, for apply and verify,
// the ReadinessReport is ready: that exit code is what holds the API back.
function exitCodeFor(result) {
  if (!result) return 0;
  const { run, report } = result;
  if (run.executionMode === 'rollback') return run.rollbackResult === 'fail' ? 1 : 0;
  if (run.executionMode === 'dry_run') return run.dryRunResult === 'pass' ? 0 : 1;
  return report && report.status === 'ready' ? 0 : 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environment = require('../src/config/env').NODE_ENV;
  const deploymentId = process.env.HOSTNAME || os.hostname();

  const db = args.list ? null : await connectNewDB();
  let code = 0;
  try {
    const result = await runSeed({ db, args, environment, deploymentId });
    if (result && result.report) {
      console.log(JSON.stringify({ readinessReportId: result.report.readinessReportId, status: result.report.status, blockers: result.report.blockers, p0Coverage: result.report.p0Coverage }));
    }
    code = exitCodeFor(result);
  } finally {
    if (db) {
      await closeConnection().catch(() => {});
    }
  }
  process.exitCode = code;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { runSeed, parseArgs, checksumFor, exitCodeFor, indexGates, OPERATIONAL_COLLECTIONS, CONFIGURATION_SEEDS };
