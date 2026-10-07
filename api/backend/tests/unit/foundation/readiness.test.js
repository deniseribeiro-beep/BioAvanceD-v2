import { describe, it, expect } from 'vitest';
const { assertReadiness, FoundationNotReadyError, CANONICAL_MODEL_RELEASE_ID } = require('../../../src/foundation/readiness');
const ReadinessReportModel = require('../../../src/models/ReadinessReport');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('./helpers/fake-db');

/**
 * RF022 AC9, RNF014 C7: the API and workers start only on a `ready`
 * ReadinessReport for their environment and release.
 */
const passing = [{ gate: 'version', result: 'pass', p0: true }];
const failing = [{ gate: 'version', result: 'fail', p0: true }];

async function store(db, overrides = {}, gateResults = passing, generatedAt = new Date()) {
  const report = ReadinessReportModel.create({
    foundationDataRunId: 'run-1',
    canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
    environment: 'test',
    gateResults,
    generatedAt,
    ...overrides,
  });
  await db.collection(CANONICAL_COLLECTIONS.readinessReports).insertOne(report);
  return report;
}

describe('assertReadiness', () => {
  it('refuses when no report exists for the environment', async () => {
    const db = createFakeDb();
    await store(db, { environment: 'production' });
    await expect(assertReadiness(db, { environment: 'test' })).rejects.toThrow(FoundationNotReadyError);
  });

  it('refuses a blocked report and names its blockers', async () => {
    const db = createFakeDb();
    await store(db, {}, failing);
    await expect(assertReadiness(db, { environment: 'test' })).rejects.toThrow('gate:version');
  });

  it('refuses a ready report for another release', async () => {
    const db = createFakeDb();
    await store(db, { canonicalModelReleaseId: 'release-1.3.0' });
    await expect(assertReadiness(db, { environment: 'test' })).rejects.toThrow('release-1.3.0');
  });

  it('accepts a ready report, judging only the newest one', async () => {
    const db = createFakeDb();
    await store(db, {}, failing, new Date('2026-10-01T00:00:00Z'));
    const newest = await store(db, {}, passing, new Date('2026-10-02T00:00:00Z'));
    await expect(assertReadiness(db, { environment: 'test' })).resolves.toEqual(newest);

    // And a newer blocked report (a rollback) withdraws it.
    await store(db, { extraBlockers: ['rolled_back:run-1'] }, passing, new Date('2026-10-03T00:00:00Z'));
    await expect(assertReadiness(db, { environment: 'test' })).rejects.toThrow('rolled_back:run-1');
  });
});

describe('ReadinessReportModel', () => {
  it('derives status, blockers and p0Coverage from the gates', () => {
    const report = ReadinessReportModel.create({
      foundationDataRunId: 'run-1',
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
      gateResults: [
        { gate: 'version', result: 'pass', p0: true },
        { gate: 'consent', result: 'not_evaluated', p0: true },
        { gate: 'storage-lookup-indexes', result: 'warn', p0: false },
      ],
    });
    expect(report).toMatchObject({ status: 'ready', blockers: [], p0Coverage: 0.5 });
    expect(ReadinessReportModel.validate(report)).toEqual({ isValid: true, errors: [] });
  });

  it('pins its content hash in reportUri', () => {
    const report = ReadinessReportModel.create({ foundationDataRunId: 'run-1', canonicalModelReleaseId: 'r', gateResults: passing });
    const { reportUri, ...content } = report;
    expect(reportUri).toBe(`urn:bioavanced:readiness-report:${report.readinessReportId}#sha256=${ReadinessReportModel.reportChecksum(content)}`);
  });

  it('rejects a ready report with blockers, a blocked one without, and empty gates', () => {
    const base = ReadinessReportModel.create({ foundationDataRunId: 'run-1', canonicalModelReleaseId: 'r', gateResults: passing });
    expect(ReadinessReportModel.validate({ ...base, blockers: ['x'] }).errors).toContain('um relatório ready não pode ter blockers');
    expect(ReadinessReportModel.validate({ ...base, status: 'blocked' }).errors).toContain('um relatório blocked precisa nomear ao menos um blocker');
    expect(ReadinessReportModel.validate({ ...base, gateResults: [] }).errors).toContain('gateResults deve ser um array não vazio');
    expect(ReadinessReportModel.validate({ ...base, status: 'promoted' }).isValid).toBe(false);
  });
});
