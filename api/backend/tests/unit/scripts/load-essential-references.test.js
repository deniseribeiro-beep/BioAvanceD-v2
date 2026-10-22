import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { runLoad, parseArgs, exitCodeFor } = require('../../../scripts/load-essential-references');
const { runSeed } = require('../../../scripts/seed-essential-reference-data');
const releaseService = require('../../../src/services/referenceRelease.service');
const auditLogger = require('../../../src/utils/auditLogger');
const ReferenceDatasetReleaseModel = require('../../../src/models/ReferenceDatasetRelease');
const { getManifestByKey } = require('../../../src/reference-data/essential/manifest');
const miabisSeed = require('../../../src/reference-data/miabis.min.json');
const sprecSeed = require('../../../src/reference-data/sprec.min.json');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * The Phase 2 job for the essential reference set (plano §5): Foundation
 * prepares the loaders and populates nothing (RF022 AC7), and this job loads
 * the set on a ready ReadinessReport, one ReferenceImportRun per entry
 * (RF028 AC5). A full run registers each entry's release before its load
 * (AC1), writes its coverage manifest and assessment (AC6/AC7) and promotes
 * it through promoteRelease (AC8). The fake db runs the job's own filters,
 * upserts and sorts.
 */
const environment = 'test';
const foundation = (db) => runSeed({ db, args: { mode: 'apply', list: false, only: null }, environment, deploymentId: 'test-host' });
const load = (db, argv = []) => runLoad({ db, args: parseArgs(argv), environment });
const runsOf = (db) => db.collection(CANONICAL_COLLECTIONS.referenceImportRuns).docs;
const releasesOf = (db) => db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases).docs;
const manifestsOf = (db) => db.collection(CANONICAL_COLLECTIONS.referenceCoverageManifests).docs;
const assessmentsOf = (db) => db.collection(CANONICAL_COLLECTIONS.dataQualityAssessments).docs;
const releaseOf = (db, datasetCode) => releasesOf(db).find((release) => release.datasetCode === datasetCode);
const miabisCount = ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions']
  .reduce((total, key) => total + miabisSeed[key].length, 0);

describe('essential reference load (Phase 2)', () => {
  beforeEach(() => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to load before any ReadinessReport exists, and exits 1', async () => {
    const db = createFakeDb();
    const result = await load(db);

    expect(result).toEqual({ blocked: 'no_readiness_report', runs: [], releases: [] });
    expect(db.collection('sampleTypes').docs).toHaveLength(0);
    expect(runsOf(db)).toHaveLength(0);
    expect(releasesOf(db)).toHaveLength(0);
    expect(exitCodeFor(result)).toBe(1);
  });

  it('refuses to load on a blocked ReadinessReport', async () => {
    const db = createFakeDb();
    await db.collection(CANONICAL_COLLECTIONS.readinessReports).insertOne({ environment, status: 'blocked', generatedAt: new Date() });
    const result = await load(db);

    expect(result.blocked).toBe('foundation_blocked');
    expect(result.releases).toEqual([]);
    expect(db.collection('terminologies').docs).toHaveLength(0);
    expect(releasesOf(db)).toHaveLength(0);
  });

  it('loads every entry after a ready Foundation, links each run to it and promotes each release with a complete, passed coverage', async () => {
    const db = createFakeDb();
    const { run: foundationRun } = await foundation(db);
    const result = await load(db);

    expect(exitCodeFor(result)).toBe(0);
    expect(db.collection('sampleTypes').docs).toHaveLength(miabisSeed.sampleTypes.length);
    expect(db.collection('terminologies').docs).toHaveLength(sprecSeed.axes.length);
    expect(result.runs.map((run) => run.datasetCode)).toEqual(['miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0']);
    for (const run of result.runs) {
      expect(run).toMatchObject({ importMode: 'full', runStatus: 'completed', foundationDataRunId: foundationRun.foundationDataRunId });
      expect(typeof run.referenceDatasetReleaseId).toBe('string');
      expect(run.idempotencyKey).toMatch(new RegExp(`^${run.datasetCode.replace('.', '\\.')}:[^:]+:sha256:[0-9a-f]{64}$`));
    }
    const miabis = result.runs[0];
    expect(miabis.checkpoint.insertedIds.sampleTypes).toEqual(db.collection('sampleTypes').docs.map((doc) => doc._id));

    // The stored runs keep the load's counts after promotion.
    expect(miabisCount).toBe(10);
    const storedRun = (datasetCode) => runsOf(db).find((run) => run.datasetCode === datasetCode);
    expect(storedRun('miabis-minimal')).toMatchObject({ recordsRead: 10, recordsInserted: 10, recordsSkipped: 0 });
    expect(storedRun('sprec-minimal')).toMatchObject({ recordsRead: 4, recordsInserted: 4, recordsSkipped: 0 });
    expect(storedRun('rcs-gov-1.0')).toMatchObject({ recordsInserted: 0, recordsSkipped: 0 });

    expect(releasesOf(db)).toHaveLength(3);
    const expectedCounts = { 'miabis-minimal': 10, 'sprec-minimal': 4, 'rcs-gov-1.0': 339 };
    for (const [datasetCode, expectedCount] of Object.entries(expectedCounts)) {
      const release = releaseOf(db, datasetCode);
      const run = result.runs.find((candidate) => candidate.datasetCode === datasetCode);
      expect(release).toMatchObject({ releaseStatus: 'active', promotionApprovedBy: 'system:essential-reference-load', previousReleaseId: null, sourceChecksum: run.inputChecksum });
      expect(run.referenceDatasetReleaseId).toBe(release.referenceDatasetReleaseId);
      const manifest = manifestsOf(db).find((doc) => doc.referenceCoverageManifestId === release.coverageManifestId);
      expect(manifest).toMatchObject({ referenceDatasetReleaseId: release.referenceDatasetReleaseId, coverageResult: 'complete', expectedCount, obtainedCount: expectedCount, assets: [getManifestByKey(datasetCode).retrievalUri] });
      const assessment = assessmentsOf(db).find((doc) => doc.dataQualityAssessmentId === release.dataQualityAssessmentId);
      expect(assessment).toMatchObject({ scopeType: 'dataset_release', scopeId: release.referenceDatasetReleaseId, status: 'passed' });
    }
    expect(result.releases).toEqual(result.runs.map((run) => ({
      datasetCode: run.datasetCode,
      referenceDatasetReleaseId: run.referenceDatasetReleaseId,
      releaseStatus: 'active',
      promoted: true,
      promotionReason: null,
    })));
    expect(auditLogger.log).toHaveBeenCalledTimes(3);
    for (const [event] of auditLogger.log.mock.calls) expect(event.action).toBe('PROMOTE');
  });

  it('registers the release before the first upsert', async () => {
    const db = createFakeDb();
    await foundation(db);
    const sampleTypes = db.collection('sampleTypes');
    const upsert = sampleTypes.updateOne.bind(sampleTypes);
    let releasesAtFirstUpsert = null;
    sampleTypes.updateOne = async (...callArgs) => {
      if (!releasesAtFirstUpsert) releasesAtFirstUpsert = structuredClone(releasesOf(db));
      return upsert(...callArgs);
    };
    await load(db, ['--only=miabis-minimal']);

    expect(releasesAtFirstUpsert).toHaveLength(1);
    expect(releasesAtFirstUpsert[0]).toMatchObject({ datasetCode: 'miabis-minimal', releaseStatus: 'downloaded', coverageManifestId: null });
  });

  it('a re-run inserts nothing, claims nothing, reuses each active release and promotes nothing', async () => {
    const db = createFakeDb();
    await foundation(db);
    const first = await load(db);
    const promote = vi.spyOn(releaseService, 'promoteRelease');
    const second = await load(db);
    const [miabis] = second.runs;

    expect(miabis).toMatchObject({ runStatus: 'completed', recordsRead: miabisCount, recordsInserted: 0, recordsSkipped: miabisCount });
    expect(miabis.checkpoint.insertedIds.sampleTypes).toEqual([]);
    expect(db.collection('sampleTypes').docs).toHaveLength(miabisSeed.sampleTypes.length);
    expect(runsOf(db)).toHaveLength(6);
    expect(releasesOf(db)).toHaveLength(3);
    expect(second.runs.map((run) => run.referenceDatasetReleaseId)).toEqual(first.runs.map((run) => run.referenceDatasetReleaseId));
    expect(manifestsOf(db)).toHaveLength(3);
    expect(promote).not.toHaveBeenCalled();
    expect(second.releases.every((row) => row.releaseStatus === 'active' && row.promoted === null)).toBe(true);
    expect(exitCodeFor(second)).toBe(0);
  });

  it('changed content registers a new release, which supersedes the active one on promotion', async () => {
    const db = createFakeDb();
    await foundation(db);
    const entry = getManifestByKey('sprec-minimal');
    const old = ReferenceDatasetReleaseModel.create({
      sourceId: entry.sourceId,
      datasetCode: entry.key,
      datasetName: entry.datasetName,
      systemUri: entry.systemUri,
      datasetVersion: entry.version,
      retrievalUri: entry.retrievalUri,
      license: entry.license,
      sourceChecksum: '0'.repeat(64),
      parserVersion: entry.parserVersion,
      mappingVersion: entry.mappingVersion,
      releaseStatus: 'active',
      promotionApprovedBy: 'system:earlier-load',
    });
    await db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases).insertOne(old);
    const result = await load(db, ['--only=sprec-minimal']);

    expect(releasesOf(db)).toHaveLength(2);
    const fresh = releasesOf(db).find((release) => release.referenceDatasetReleaseId !== old.referenceDatasetReleaseId);
    expect(result.runs[0].referenceDatasetReleaseId).toBe(fresh.referenceDatasetReleaseId);
    expect(fresh).toMatchObject({ releaseStatus: 'active', previousReleaseId: old.referenceDatasetReleaseId });
    expect(releasesOf(db).find((release) => release.referenceDatasetReleaseId === old.referenceDatasetReleaseId).releaseStatus).toBe('superseded');
    expect(exitCodeFor(result)).toBe(0);
  });

  it('--dry-run validates each entry and writes only its runs', async () => {
    const db = createFakeDb();
    await foundation(db);
    const result = await load(db, ['--dry-run']);

    expect(result.runs.every((run) => run.importMode === 'dry_run' && run.runStatus === 'validated')).toBe(true);
    expect(result.runs.every((run) => run.referenceDatasetReleaseId === null)).toBe(true);
    expect(result.releases).toEqual([]);
    expect(releasesOf(db)).toHaveLength(0);
    expect(manifestsOf(db)).toHaveLength(0);
    expect(db.collection('sampleTypes').docs).toHaveLength(0);
    expect(exitCodeFor(result)).toBe(0);
  });

  it('--only loads one entry, and an unknown key is refused', async () => {
    const db = createFakeDb();
    await foundation(db);
    const result = await load(db, ['--only=sprec-minimal']);

    expect(result.runs.map((run) => run.datasetCode)).toEqual(['sprec-minimal']);
    expect(db.collection('sampleTypes').docs).toHaveLength(0);
    await expect(load(db, ['--only=nope'])).rejects.toThrow('Unknown seed key: nope');
  });

  it('fails the entry, rejects its release, and exits 1, when a loaded doc is not there on read-back', async () => {
    // A write that reports an upsert and does not stick.
    const db = createFakeDb({
      terminologies: (fakeDb) => ({
        afterUpsert: async (doc) => {
          const { docs } = fakeDb.collection('terminologies');
          docs.splice(docs.indexOf(doc), 1);
        },
      }),
    });
    await foundation(db);
    const result = await load(db, ['--only=sprec-minimal']);

    expect(result.runs[0]).toMatchObject({ runStatus: 'failed', validationSummary: { approved: false } });
    expect(result.runs[0].validationSummary.missing.length).toBeGreaterThan(0);
    const release = releaseOf(db, 'sprec-minimal');
    expect(release.releaseStatus).toBe('rejected');
    expect(manifestsOf(db).find((doc) => doc.referenceCoverageManifestId === release.coverageManifestId).coverageResult).toBe('incomplete');
    expect(assessmentsOf(db).find((doc) => doc.dataQualityAssessmentId === release.dataQualityAssessmentId).status).toBe('failed');
    expect(result.releases[0]).toMatchObject({ releaseStatus: 'rejected', promoted: null, promotionReason: null });
    expect(auditLogger.log).not.toHaveBeenCalled();
    expect(exitCodeFor(result)).toBe(1);
  });

  it('a refused promotion leaves the release approved and exits 1', async () => {
    const db = createFakeDb();
    await foundation(db);
    vi.spyOn(releaseService, 'promoteRelease').mockResolvedValue({ promoted: false, reason: 'promotion_in_progress' });
    const result = await load(db, ['--only=miabis-minimal']);

    expect(result.runs[0].runStatus).toBe('completed');
    expect(releaseOf(db, 'miabis-minimal').releaseStatus).toBe('approved');
    expect(result.releases[0]).toMatchObject({ releaseStatus: 'approved', promoted: false, promotionReason: 'promotion_in_progress' });
    expect(exitCodeFor(result)).toBe(1);
  });
});
