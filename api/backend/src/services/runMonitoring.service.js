// RNF015 AC5/AC6 (#1323): a read-only list of the recent runs of each
// pipeline, with failures told apart by phase. The phases are the release's
// (requisitos.md section 8): Fase 1 Foundation is FoundationDataRun and
// ConfigurationValidationRun, Fase 2 Referências is ReferenceImportRun, and
// Fase 3 Operacional is the operational async import job. Fase 2 also lists
// ReferenceImportIssue records (the RF028 AC5 rejections); an issue fails on
// severity error or fatal, never on warning. A phase's failedTotal counts the
// whole collection (failedTotalByKind splits it per kind); failedListed counts
// only the rows returned. No index is added: every read is bounded by limit.
const { CANONICAL_COLLECTIONS } = require('../config/collections');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ISSUE_FAILED_SEVERITIES = ['error', 'fatal'];

// A run fails when its status field reads 'failed'. Each kind carries both the
// countDocuments filter and the row predicate, so they cannot disagree.
const failedOnStatus = (statusField) => ({
  failedFilter: { [statusField]: 'failed' },
  isFailed: (doc) => doc[statusField] === 'failed',
});

const KINDS = Object.freeze([
  { kind: 'foundationDataRun', phase: 1, collection: CANONICAL_COLLECTIONS.foundationDataRuns, sortField: 'startedAt', statusField: 'runStatus', ...failedOnStatus('runStatus') },
  { kind: 'configurationValidationRun', phase: 1, collection: CANONICAL_COLLECTIONS.configurationValidationRuns, sortField: 'executedAt', statusField: 'status', ...failedOnStatus('status') },
  { kind: 'referenceImportRun', phase: 2, collection: CANONICAL_COLLECTIONS.referenceImportRuns, sortField: 'startedAt', statusField: 'runStatus', ...failedOnStatus('runStatus') },
  { kind: 'referenceImportIssue', phase: 2, collection: CANONICAL_COLLECTIONS.referenceImportIssues, sortField: 'detectedAt', statusField: 'resolutionStatus', failedFilter: { severity: { $in: ISSUE_FAILED_SEVERITIES } }, isFailed: (doc) => ISSUE_FAILED_SEVERITIES.includes(doc.severity) },
  { kind: 'importJob', phase: 3, collection: 'importJobs', sortField: 'createdAt', statusField: 'status', ...failedOnStatus('status') },
]);

const PHASES = Object.freeze([
  { phase: 1, name: 'foundation' },
  { phase: 2, name: 'references' },
  { phase: 3, name: 'operational' },
]);

const FOUNDATION_STAGES = [
  ['dry_run', 'dryRunResult'],
  ['apply', 'applyResult'],
  ['verify', 'verifyResult'],
  ['rollback', 'rollbackResult'],
];

const CONFIGURATION_GATES = ['structural', 'semantic', 'dependency', 'security'];

// The only fields each row builder reads. The read projects to them, so a
// document's payload (an import job's fhirResources, errors, userID and
// fileName) never leaves the database.
const ROW_FIELDS = {
  foundationDataRun: ['foundationDataRunId', 'runStatus', 'startedAt', 'completedAt', ...FOUNDATION_STAGES.map(([, field]) => field), 'executionMode'],
  configurationValidationRun: ['configurationValidationRunId', 'status', 'executedAt', ...CONFIGURATION_GATES.map((name) => `${name}Result`), 'invariantResults.result', 'releaseId'],
  referenceImportRun: ['referenceImportRunId', 'runStatus', 'startedAt', 'completedAt', 'datasetCode', 'importMode'],
  referenceImportIssue: ['referenceImportIssueId', 'resolutionStatus', 'detectedAt', 'resolvedAt', 'referenceImportRunId', 'entityType', 'errorCode', 'severity'],
  importJob: ['jobID', 'status', 'startedAt', 'completedAt', 'dataType', 'errorCount'],
};

const projectionOf = (kind) => Object.fromEntries([['_id', 0], ...ROW_FIELDS[kind].map((field) => [field, 1])]);

const orNull = (value) => (value === undefined ? null : value);

function firstFailed(doc, stages) {
  const hit = stages.find(([, field]) => doc[field] === 'fail');
  return hit ? hit[0] : null;
}

const ROW_BUILDERS = {
  foundationDataRun: (doc) => ({
    id: orNull(doc.foundationDataRunId),
    status: orNull(doc.runStatus),
    startedAt: orNull(doc.startedAt),
    completedAt: orNull(doc.completedAt),
    failedStage: firstFailed(doc, FOUNDATION_STAGES),
    detail: { executionMode: orNull(doc.executionMode) },
  }),
  configurationValidationRun: (doc) => {
    const gate = firstFailed(doc, CONFIGURATION_GATES.map((name) => [name, `${name}Result`]));
    const invariantFailed = Array.isArray(doc.invariantResults)
      && doc.invariantResults.some((entry) => entry && entry.result === 'fail');
    return {
      id: orNull(doc.configurationValidationRunId),
      status: orNull(doc.status),
      startedAt: orNull(doc.executedAt),
      completedAt: orNull(doc.executedAt),
      failedStage: gate || (invariantFailed ? 'invariants' : null),
      detail: { releaseId: orNull(doc.releaseId) },
    };
  },
  referenceImportRun: (doc) => ({
    id: orNull(doc.referenceImportRunId),
    status: orNull(doc.runStatus),
    startedAt: orNull(doc.startedAt),
    completedAt: orNull(doc.completedAt),
    failedStage: null,
    detail: { datasetCode: orNull(doc.datasetCode), importMode: orNull(doc.importMode) },
  }),
  referenceImportIssue: (doc) => ({
    id: orNull(doc.referenceImportIssueId),
    status: orNull(doc.resolutionStatus),
    startedAt: orNull(doc.detectedAt),
    completedAt: orNull(doc.resolvedAt),
    failedStage: null,
    detail: {
      referenceImportRunId: orNull(doc.referenceImportRunId),
      entityType: orNull(doc.entityType),
      errorCode: orNull(doc.errorCode),
      severity: orNull(doc.severity),
    },
  }),
  importJob: (doc) => ({
    id: orNull(doc.jobID),
    status: orNull(doc.status),
    startedAt: orNull(doc.startedAt),
    completedAt: orNull(doc.completedAt),
    failedStage: null,
    detail: { dataType: orNull(doc.dataType), errorCount: orNull(doc.errorCount) },
  }),
};

function toRow(k, doc) {
  const built = ROW_BUILDERS[k.kind](doc);
  return {
    kind: k.kind,
    phase: k.phase,
    id: built.id,
    status: built.status,
    startedAt: built.startedAt,
    completedAt: built.completedAt,
    failed: k.isFailed(doc),
    failedStage: built.failedStage,
    detail: built.detail,
  };
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

async function listRecentRuns(db, { limit }) {
  const results = await Promise.all(KINDS.map(async (k) => {
    const collection = db.collection(k.collection);
    const [docs, failedTotal] = await Promise.all([
      collection.find({}, { projection: projectionOf(k.kind) }).sort({ [k.sortField]: -1 }).limit(limit).toArray(),
      collection.countDocuments(k.failedFilter),
    ]);
    return { k, rows: docs.map((doc) => toRow(k, doc)), failedTotal };
  }));

  const runs = {};
  for (const { k, rows } of results) runs[k.kind] = rows;

  const phases = PHASES.map(({ phase, name }) => {
    const ofPhase = results.filter(({ k }) => k.phase === phase);
    const rows = ofPhase.flatMap(({ rows: r }) => r);
    return {
      phase,
      name,
      failedTotal: ofPhase.reduce((sum, { failedTotal }) => sum + failedTotal, 0),
      failedTotalByKind: Object.fromEntries(ofPhase.map(({ k, failedTotal }) => [k.kind, failedTotal])),
      listed: rows.length,
      failedListed: rows.filter((row) => row.failed).length,
    };
  });

  return { limit, phases, runs };
}

module.exports = { listRecentRuns, parseLimit, KINDS, DEFAULT_LIMIT, MAX_LIMIT };
