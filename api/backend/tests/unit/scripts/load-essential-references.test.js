import { describe, it, expect } from 'vitest';
const { runLoad, parseArgs, exitCodeFor } = require('../../../scripts/load-essential-references');
const { runSeed } = require('../../../scripts/seed-essential-reference-data');
const miabisSeed = require('../../../src/reference-data/miabis.min.json');
const sprecSeed = require('../../../src/reference-data/sprec.min.json');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * The Phase 2 job for the essential reference set (plano §5): Foundation
 * prepares the loaders and populates nothing (RF022 AC7), and this job loads
 * the set on a ready ReadinessReport, one ReferenceImportRun per entry
 * (RF028 AC5). The fake db runs the job's own filters, upserts and sorts.
 */
const environment = 'test';
const foundation = (db) => runSeed({ db, args: { mode: 'apply', list: false, only: null }, environment, deploymentId: 'test-host' });
const load = (db, argv = []) => runLoad({ db, args: parseArgs(argv), environment });
const runsOf = (db) => db.collection(CANONICAL_COLLECTIONS.referenceImportRuns).docs;
const miabisCount = ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions']
  .reduce((total, key) => total + miabisSeed[key].length, 0);

describe('essential reference load (Phase 2)', () => {
  it('refuses to load before any ReadinessReport exists, and exits 1', async () => {
    const db = createFakeDb();
    const result = await load(db);

    expect(result).toEqual({ blocked: 'no_readiness_report', runs: [] });
    expect(db.collection('sampleTypes').docs).toHaveLength(0);
    expect(runsOf(db)).toHaveLength(0);
    expect(exitCodeFor(result)).toBe(1);
  });

  it('refuses to load on a blocked ReadinessReport', async () => {
    const db = createFakeDb();
    await db.collection(CANONICAL_COLLECTIONS.readinessReports).insertOne({ environment, status: 'blocked', generatedAt: new Date() });
    const result = await load(db);

    expect(result.blocked).toBe('foundation_blocked');
    expect(db.collection('terminologies').docs).toHaveLength(0);
  });

  it('loads every entry after a ready Foundation and links each run to it', async () => {
    const db = createFakeDb();
    const { run: foundationRun } = await foundation(db);
    const result = await load(db);

    expect(exitCodeFor(result)).toBe(0);
    expect(db.collection('sampleTypes').docs).toHaveLength(miabisSeed.sampleTypes.length);
    expect(db.collection('terminologies').docs).toHaveLength(sprecSeed.axes.length);
    expect(result.runs.map((run) => run.datasetCode)).toEqual(['miabis-minimal', 'sprec-minimal', 'rcs-gov-1.0']);
    for (const run of result.runs) {
      expect(run).toMatchObject({ importMode: 'full', runStatus: 'completed', foundationDataRunId: foundationRun.foundationDataRunId, referenceDatasetReleaseId: null });
      expect(run.idempotencyKey).toMatch(new RegExp(`^${run.datasetCode.replace('.', '\\.')}:[^:]+:sha256:[0-9a-f]{64}$`));
    }
    const miabis = result.runs[0];
    expect(miabis).toMatchObject({ recordsRead: miabisCount, recordsInserted: miabisCount, recordsSkipped: 0 });
    expect(miabis.checkpoint.insertedIds.sampleTypes).toEqual(db.collection('sampleTypes').docs.map((doc) => doc._id));
    expect(runsOf(db)).toEqual(result.runs);
  });

  it('a re-run inserts nothing, claims nothing, and records the attempt', async () => {
    const db = createFakeDb();
    await foundation(db);
    await load(db);
    const { runs: [miabis] } = await load(db);

    expect(miabis).toMatchObject({ runStatus: 'completed', recordsRead: miabisCount, recordsInserted: 0, recordsSkipped: miabisCount });
    expect(miabis.checkpoint.insertedIds.sampleTypes).toEqual([]);
    expect(db.collection('sampleTypes').docs).toHaveLength(miabisSeed.sampleTypes.length);
    expect(runsOf(db)).toHaveLength(6);
  });

  it('--dry-run validates each entry and writes only its runs', async () => {
    const db = createFakeDb();
    await foundation(db);
    const result = await load(db, ['--dry-run']);

    expect(result.runs.every((run) => run.importMode === 'dry_run' && run.runStatus === 'validated')).toBe(true);
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

  it('fails the entry, and exits 1, when a loaded doc is not there on read-back', async () => {
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
    expect(exitCodeFor(result)).toBe(1);
  });
});
