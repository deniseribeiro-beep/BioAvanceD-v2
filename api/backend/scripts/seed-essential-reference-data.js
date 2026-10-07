require('dotenv').config();

const crypto = require('crypto');
const os = require('os');
const { version: pipelineVersion } = require('../package.json');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { getManifest } = require('../src/reference-data/essential');
const miabisSeed = require('../src/reference-data/miabis.min.json');
const sprecSeed = require('../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../src/services/rcs-reference-data');
const FoundationDataRunModel = require('../src/models/FoundationDataRun');
const ReadinessReportModel = require('../src/models/ReadinessReport');
const canonicalDictionary = require('../src/reference-data/canonical-dictionary/v2');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { buildFoundationIndexes, verifyFoundationIndexes, INDEX_TARGETS } = require('../src/foundation/indexes');
const { CANONICAL_MODEL_RELEASE_ID, MIGRATION_PLAN_ID, DEFERRED_P0_GATES } = require('../src/foundation/readiness');

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
//               inserted, and blocks readiness until the next apply
//   --list      prints the manifest, touches no database
//
// Apply also seeds the configuration catalogs (RBAC, system report
// templates), which the API seeded at its own boot until RF022 AC4 moved
// them here; the API still does when no Foundation job runs first.
//
// The essential manifest is the 3-entry set (#366); the full canonical
// dictionary is loaded to pin dictionaryVersion/checksum/completeness
// (RF022 AC1: v2.0.0, 1644 elements with the 929 historical ones). Mongo
// schemas for the non-technical domain elements are out of scope here.

// The configuration catalogs Foundation prepares (RF022 AC2, plano F1.2).
// Lazily required: they pull the models and the collection resolver, which
// --list never needs.
const CONFIGURATION_SEEDS = [
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
// RNF031 C7): it counts them before and after apply.
const OPERATIONAL_COLLECTIONS = [
  CANONICAL_COLLECTIONS.patients,
  CANONICAL_COLLECTIONS.participantIdentities,
  CANONICAL_COLLECTIONS.consents,
  CANONICAL_COLLECTIONS.samples,
  CANONICAL_COLLECTIONS.sampleMovements,
  CANONICAL_COLLECTIONS.encounters,
  CANONICAL_COLLECTIONS.rcsAssessments,
  CANONICAL_COLLECTIONS.accessRequests,
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadByKey(key) {
  if (key === 'miabis-minimal') {
    return {
      docsByCollection: {
        sampleTypes: ensureArray(miabisSeed.sampleTypes),
        sampleOrigins: ensureArray(miabisSeed.sampleOrigins),
        extractionProtocols: ensureArray(miabisSeed.extractionProtocols),
        qualityDescriptions: ensureArray(miabisSeed.qualityDescriptions),
      },
    };
  }

  if (key === 'sprec-minimal') {
    return {
      docsByCollection: {
        terminologies: ensureArray(sprecSeed.axes).map((axis) => ({
          sistema: sprecSeed.sistema,
          fonte: sprecSeed.fonte,
          axis: axis.axis,
          code: axis.code,
          label: axis.label,
          descricao: axis.descricao,
        })),
      },
    };
  }

  if (key === 'rcs-gov-1.0') {
    return {
      docsByCollection: {},
      payload: {
        catalogs: rcsReferenceData.catalogs,
        severityMappings: rcsReferenceData.severityMappings,
        weights: rcsReferenceData.weights,
        thresholds: rcsReferenceData.thresholds,
        governanceRules: rcsReferenceData.governanceRules,
      },
    };
  }

  throw new Error(`Loader not implemented for seed key: ${key}`);
}

function filterFor(doc, uniqueKeys) {
  return uniqueKeys.length
    ? Object.fromEntries(uniqueKeys.map((key) => [key, doc[key]]))
    : { _id: doc._id };
}

// Returns the _ids this call inserted, the step's checkpoint for rollback
// (RF022 AC10): a doc that already existed is never claimed by this run.
async function upsertDocs(db, collectionName, docs, uniqueKeys = []) {
  const collection = db.collection(collectionName);
  const insertedIds = [];
  for (const doc of docs) {
    const result = await collection.updateOne(filterFor(doc, uniqueKeys), { $setOnInsert: { ...doc } }, { upsert: true });
    if (result && result.upsertedId !== undefined && result.upsertedId !== null) insertedIds.push(result.upsertedId);
  }
  return insertedIds;
}

function selectEntries(args) {
  const manifest = getManifest();
  const selected = args.only ? manifest.filter((entry) => entry.key === args.only) : manifest;
  if (args.only && selected.length === 0) {
    throw new Error(`Unknown seed key: ${args.only}`);
  }
  return selected;
}

// F1.1 dry-run: every loader loads and every planned doc carries its unique
// keys. Nothing is written.
function planSteps(selected) {
  return selected.map((entry) => {
    const docsByCollection = loadByKey(entry.key).docsByCollection || {};
    const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
    const keyless = Object.values(docsByCollection).flat()
      .filter((doc) => (entry.uniqueKeys || []).some((key) => doc[key] === undefined || doc[key] === null)).length;
    return { entry, docsByCollection, plannedCounts, keyless };
  });
}

async function countOperational(db) {
  const counts = {};
  for (const name of OPERATIONAL_COLLECTIONS) {
    counts[name] = await db.collection(name).countDocuments({});
  }
  return counts;
}

// F1.10 verify: every planned reference doc is present, every index the
// job built is readable, and no operational record appeared.
async function verifyPlan(db, plan) {
  const missingDocs = [];
  for (const { entry, docsByCollection } of plan) {
    for (const [collectionName, docs] of Object.entries(docsByCollection)) {
      for (const doc of docs) {
        const found = await db.collection(collectionName).countDocuments(filterFor(doc, entry.uniqueKeys || []));
        if (found === 0) missingDocs.push({ step: entry.key, collection: collectionName, filter: filterFor(doc, entry.uniqueKeys || []) });
      }
    }
  }
  return missingDocs;
}

function gate(name, passed, p0, evidence) {
  return { gate: name, result: passed ? 'pass' : 'fail', p0, evidence };
}

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

  // F1.3/F1.4/F1.7: apply.
  const operationalBefore = await countOperational(db);
  const steps = [];
  let builds = [];
  let currentStep = null;
  try {
    for (const { entry, docsByCollection, plannedCounts } of plan) {
      currentStep = entry.key;
      console.log(JSON.stringify({ key: entry.key, mode: 'apply', plannedCounts }, null, 2));
      const insertedIds = {};
      for (const [collectionName, docs] of Object.entries(docsByCollection)) {
        insertedIds[collectionName] = await upsertDocs(db, collectionName, docs, entry.uniqueKeys || []);
      }
      steps.push({ step: entry.key, system: entry.system, version: entry.version, status: 'completed', plannedCounts, checkpoint: { insertedIds } });
    }
    // F1.2 configuration catalogs, which the API seeded at its own boot
    // before RF022 AC4 separated the two. Both upserts are idempotent and
    // reconcile catalog-owned fields, so a re-run is safe; a failure here is
    // fatal for the run, where it was only logged at boot.
    for (const { step, seed, count } of configurationSeeds) {
      currentStep = step;
      const result = await seed(db);
      steps.push({ step, status: 'completed', plannedCounts: count(result) });
    }
    currentStep = 'indexes';
    builds = await buildFoundationIndexes(db);
    steps.push({ step: 'indexes', status: 'completed', plannedCounts: { indexes: builds.length } });
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
  const missingDocs = await verifyPlan(db, plan);
  const missingIndexes = await verifyFoundationIndexes(db, builds);
  const operationalAfter = await countOperational(db);
  const createdOperational = Object.keys(operationalAfter).filter((name) => operationalAfter[name] > operationalBefore[name]);
  const verifyGates = [
    gate('reference-mechanisms', missingDocs.length === 0, true, { missing: missingDocs.slice(0, 20) }),
    ...indexGates(builds, missingIndexes),
    gate('zero-operational-data', createdOperational.length === 0, true, { before: operationalBefore, after: operationalAfter }),
  ];
  const gateResults = [...versionGates, ...verifyGates];
  const verifyPassed = verifyGates.every((g) => g.result !== 'fail');

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
  const missingDocs = await verifyPlan(db, plan);
  const builds = await buildFoundationIndexes(db);
  const missingIndexes = await verifyFoundationIndexes(db, builds);
  const gateResults = [
    ...versionGates,
    gate('reference-mechanisms', missingDocs.length === 0, true, { missing: missingDocs.slice(0, 20) }),
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
  const selected = selectEntries(args);
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
