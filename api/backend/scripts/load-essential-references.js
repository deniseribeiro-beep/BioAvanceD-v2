require('dotenv').config();

const crypto = require('crypto');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const ReferenceImportRunModel = require('../src/models/ReferenceImportRun');
const ReferenceDatasetReleaseModel = require('../src/models/ReferenceDatasetRelease');
const ReferenceCoverageManifestModel = require('../src/models/ReferenceCoverageManifest');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { selectEntries, planSteps, upsertDocs, missingDocsOf } = require('../src/foundation/essential-references');
const { buildCoverageManifest, assessRelease } = require('../src/reference-data/reference-imports/coverage');
const { insertDataQualityAssessment } = require('../src/ingestion/dataQualityAssessment');
const releaseService = require('../src/services/referenceRelease.service');

// Phase 2 (plano §5, RF028) for the essential reference set: the MIABIS and
// SPREC minimal sets and the RCS-GOV 1.0 package. Foundation (Phase 1,
// seed-essential-reference-data.js) prepares their loaders and populates
// none of them (RF022 AC7); this one-shot job loads them, after a ready
// ReadinessReport and before the API.
//
// Each entry's attempt is one ReferenceImportRun (RF028 AC5), linked to the
// Foundation run whose report allowed it and checkpointing the _ids it
// inserted. Upserts use $setOnInsert, so a re-run inserts nothing and says
// so. A full run registers its ReferenceDatasetRelease before the load
// (RF028 AC1), loads, writes the release's coverage manifest and quality
// assessment and sets it approved or rejected (AC6/AC7), writes its run,
// and promotes an approved release through promoteRelease (AC8). A dry run
// registers no release.
//
//   (default)   full: upsert every entry, then check every doc is present
//   --dry-run   dry_run: loads and checks each entry, writes only its run
//   --only=<k>  one manifest entry

const INITIATED_BY = 'system:essential-reference-load';

// INFERENCE, not a citation: the essential set accepts no rejected record,
// since a single keyless doc already fails its run.
const MAX_REJECTION_RATE = 0;

function parseArgs(argv) {
  const args = { dryRun: false, only: null };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token.startsWith('--only=')) args.only = token.slice('--only='.length);
  }
  return args;
}

function checksumFor(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Phase 2 runs only on a Foundation that promoted (plano §4 F1.11).
async function readyReport(db, environment) {
  return db.collection(CANONICAL_COLLECTIONS.readinessReports)
    .find({ environment }).sort({ generatedAt: -1 }).limit(1).next();
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The records of a payload-only entry: every array that is a top-level
// value of the payload or a value of a top-level plain object. Anything else
// counts 0, so an empty payload is incomplete (fail closed).
function payloadRecordCount(payload) {
  if (!isPlainObject(payload)) return 0;
  return Object.values(payload).reduce((total, value) => {
    if (Array.isArray(value)) return total + value.length;
    if (isPlainObject(value)) return total + Object.values(value).reduce((sum, inner) => sum + (Array.isArray(inner) ? inner.length : 0), 0);
    return total;
  }, 0);
}

function registrationFor(entry, inputChecksum) {
  return {
    sourceId: entry.sourceId,
    datasetCode: entry.key,
    datasetName: entry.datasetName,
    systemUri: entry.systemUri,
    datasetVersion: entry.version,
    retrievalUri: entry.retrievalUri,
    accessMethod: entry.accessMethod,
    sourceFormat: Array.isArray(entry.sourceFormat) ? [...entry.sourceFormat] : entry.sourceFormat,
    license: entry.license,
    licenseUri: entry.licenseUri,
    sourceChecksum: inputChecksum,
    parserVersion: entry.parserVersion,
    mappingVersion: entry.mappingVersion,
    releaseStatus: 'downloaded',
    previousReleaseId: null,
  };
}

// RF028 AC1: the release a full run loads into. A re-run of the content the
// dataset's active release holds reuses it; anything else registers a new
// release in `downloaded` status. A superseded, rolled-back, rejected or
// approved release is never reused.
async function resolveRelease(db, registration) {
  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const existingActive = await releases.findOne({ datasetCode: registration.datasetCode, releaseStatus: 'active' });
  const sameRelease = existingActive
    && existingActive.systemUri === registration.systemUri
    && existingActive.datasetVersion === registration.datasetVersion
    && existingActive.sourceChecksum === registration.sourceChecksum;
  if (sameRelease) return existingActive;

  const releaseDoc = ReferenceDatasetReleaseModel.create(registration);
  await releases.insertOne(releaseDoc);
  return releaseDoc;
}

// RF028 AC6/AC7: the release's coverage manifest and quality assessment,
// then its status flip naming both.
async function judgeRelease(db, { releaseDoc, run, entry, expectedCount, obtainedCount, failed, rejectionRate }) {
  const releaseId = releaseDoc.referenceDatasetReleaseId;
  const manifest = buildCoverageManifest({
    releaseId,
    runId: run.referenceImportRunId,
    datasetCode: entry.key,
    // No asset is preserved for the bundled set: its file ships in the repository.
    assetUri: entry.retrievalUri,
    recordsRead: expectedCount,
    obtainedCount,
    issues: [],
  });
  const manifestCheck = ReferenceCoverageManifestModel.validate(manifest);
  if (!manifestCheck.isValid) {
    throw new Error(`ReferenceCoverageManifest inválido: ${manifestCheck.errors.join('; ')}`);
  }
  await db.collection(CANONICAL_COLLECTIONS.referenceCoverageManifests).insertOne(manifest);
  const assessment = assessRelease({
    release: releaseDoc,
    manifest,
    fatalCount: failed ? 1 : 0,
    rejectionRate,
    maxRejectionRate: MAX_REJECTION_RATE,
    actorId: INITIATED_BY,
  });
  await insertDataQualityAssessment(db, assessment);
  await db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases).updateOne(
    { referenceDatasetReleaseId: releaseId },
    {
      $set: {
        releaseStatus: failed ? 'rejected' : 'approved',
        coverageManifestId: manifest.referenceCoverageManifestId,
        dataQualityAssessmentId: assessment.dataQualityAssessmentId,
        updatedAt: new Date(),
      },
    },
  );
}

async function loadEntry(db, step, { dryRun, foundationDataRunId }) {
  const { entry, docsByCollection, payload, keyless } = step;
  const inputChecksum = checksumFor({ docsByCollection, payload });
  const recordsRead = Object.values(docsByCollection).reduce((total, docs) => total + docs.length, 0);
  const startedAt = new Date();
  const runFields = {
    foundationDataRunId,
    datasetCode: entry.key,
    importMode: dryRun ? 'dry_run' : 'full',
    idempotencyKey: `${entry.key}:${entry.version}:sha256:${inputChecksum}`,
    startedAt,
    recordsRead,
    inputChecksum,
    initiatedBy: INITIATED_BY,
  };
  const runs = db.collection(CANONICAL_COLLECTIONS.referenceImportRuns);

  let releaseDoc = null;
  if (!dryRun) {
    const registration = registrationFor(entry, inputChecksum);
    const registrationCheck = ReferenceDatasetReleaseModel.validate(registration);
    if (!registrationCheck.isValid) {
      const failedRun = ReferenceImportRunModel.create({
        ...runFields,
        referenceDatasetReleaseId: null,
        completedAt: new Date(),
        runStatus: 'failed',
        checkpoint: null,
        recordsValidated: 0,
        recordsInserted: 0,
        recordsSkipped: 0,
        recordsRejected: 0,
        validationSummary: { fatal: 1, errors: 0, warnings: 0, rejectionRate: 0, approved: false, missing: [], registrationErrors: registrationCheck.errors },
      });
      await runs.insertOne(failedRun);
      return { run: failedRun, release: null };
    }
    releaseDoc = await resolveRelease(db, registration);
  }

  const insertedIds = {};
  let missing = [];
  if (!dryRun && keyless === 0) {
    for (const [collectionName, docs] of Object.entries(docsByCollection)) {
      insertedIds[collectionName] = await upsertDocs(db, collectionName, docs, entry.uniqueKeys || []);
    }
    missing = await missingDocsOf(db, step);
  }
  const recordsInserted = Object.values(insertedIds).reduce((total, ids) => total + ids.length, 0);
  const failed = keyless > 0 || missing.length > 0;
  const rejectionRate = recordsRead ? keyless / recordsRead : 0;
  const run = ReferenceImportRunModel.create({
    ...runFields,
    referenceDatasetReleaseId: releaseDoc ? releaseDoc.referenceDatasetReleaseId : null,
    completedAt: new Date(),
    runStatus: failed ? 'failed' : dryRun ? 'validated' : 'completed',
    checkpoint: dryRun ? null : { insertedIds },
    recordsValidated: recordsRead - keyless,
    recordsInserted,
    recordsSkipped: dryRun ? 0 : recordsRead - recordsInserted,
    recordsRejected: keyless,
    validationSummary: { fatal: failed ? 1 : 0, errors: 0, warnings: 0, rejectionRate, approved: !failed, missing: missing.slice(0, 20) },
  });

  // A release already active (a re-run of its content) keeps its own
  // manifest and assessment, and its status.
  if (releaseDoc && releaseDoc.releaseStatus !== 'active') {
    // INFERENCE, not a citation: a payload-only entry (RCS-GOV) writes no
    // document; its payload is the in-process module the RCS services read,
    // so nothing read can be lost by a write.
    const hasDocs = Object.keys(docsByCollection).length > 0;
    const expectedCount = hasDocs ? recordsRead : payloadRecordCount(payload);
    const obtainedCount = hasDocs ? (keyless > 0 ? 0 : recordsRead - missing.length) : expectedCount;
    await judgeRelease(db, { releaseDoc, run, entry, expectedCount, obtainedCount, failed, rejectionRate });
  }

  await runs.insertOne(run);
  return { run, release: releaseDoc };
}

// RF028 AC8: an approved release is promoted through promoteRelease, which
// holds the claim, the coverage gate, the supersede and the AuditEvent.
// INFERENCE, not a citation: the job promotes as its own system actor, as
// the import scripts do with system:reference-data-bootstrap.
async function promoteLoaded(db, { run, release }) {
  if (!release) {
    // An invalid registration registered nothing.
    return { datasetCode: run.datasetCode, referenceDatasetReleaseId: null, releaseStatus: null, promoted: null, promotionReason: null };
  }
  const releaseId = release.referenceDatasetReleaseId;
  let promoted = null;
  let promotionReason = null;
  if (run.runStatus === 'completed' && release.releaseStatus !== 'active') {
    const result = await releaseService.promoteRelease({ db, releaseId, approvedBy: INITIATED_BY });
    promoted = result.promoted;
    promotionReason = result.reason || null;
  }
  const current = await db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases).findOne({ referenceDatasetReleaseId: releaseId });
  return {
    datasetCode: run.datasetCode,
    referenceDatasetReleaseId: releaseId,
    releaseStatus: current ? current.releaseStatus : null,
    promoted,
    promotionReason,
  };
}

/**
 * Returns { blocked, runs, releases }. `blocked` names why nothing loaded:
 * no ready ReadinessReport for this environment. `releases` holds one row
 * per full-mode entry: its release, read back after any promotion.
 */
async function runLoad({ db, args, environment }) {
  const selected = selectEntries(args.only);
  const report = await readyReport(db, environment);
  if (!report || report.status !== 'ready') {
    return { blocked: report ? `foundation_${report.status}` : 'no_readiness_report', runs: [], releases: [] };
  }
  const runs = [];
  const releases = [];
  for (const step of planSteps(selected)) {
    const loaded = await loadEntry(db, step, { dryRun: args.dryRun, foundationDataRunId: report.foundationDataRunId });
    runs.push(loaded.run);
    if (!args.dryRun) releases.push(await promoteLoaded(db, loaded));
  }
  return { blocked: null, runs, releases };
}

// The job gates the API on the essential set: a completed entry whose
// release is not active fails it, unlike the import scripts' refused
// promotion.
function exitCodeFor({ blocked, runs, releases = [] }) {
  if (blocked) return 1;
  if (runs.some((run) => run.runStatus === 'failed')) return 1;
  const completed = new Set(runs.filter((run) => run.runStatus === 'completed').map((run) => run.referenceDatasetReleaseId));
  return releases.every((row) => !completed.has(row.referenceDatasetReleaseId) || row.releaseStatus === 'active') ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environment = require('../src/config/env').NODE_ENV;
  const db = await connectNewDB();
  let code = 0;
  try {
    const result = await runLoad({ db, args, environment });
    console.log(JSON.stringify({
      blocked: result.blocked,
      runs: result.runs.map(({ datasetCode, importMode, runStatus, recordsRead, recordsInserted, recordsSkipped }) => ({ datasetCode, importMode, runStatus, recordsRead, recordsInserted, recordsSkipped })),
      releases: result.releases,
    }, null, 2));
    code = exitCodeFor(result);
  } finally {
    await closeConnection().catch(() => {});
  }
  process.exitCode = code;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { runLoad, parseArgs, exitCodeFor };
