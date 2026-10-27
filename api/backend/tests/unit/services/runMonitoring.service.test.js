import { describe, it, expect, vi } from 'vitest';

const runMonitoring = require('../../../src/services/runMonitoring.service');

// RNF015 AC5/AC6 (#1323): the recent runs of each pipeline, under the phase
// requisitos.md section 8 gives it, with the failed stage named where the
// record has one.

function fakeCollection(docs = [], failed = 0) {
  const cursor = {};
  cursor.sort = vi.fn(() => cursor);
  cursor.limit = vi.fn(() => cursor);
  cursor.toArray = vi.fn().mockResolvedValue(docs);
  return {
    cursor,
    find: vi.fn(() => cursor),
    countDocuments: vi.fn().mockResolvedValue(failed),
  };
}

function fakeDb(seed = {}) {
  const fakes = {};
  for (const k of runMonitoring.KINDS) {
    const { docs, failed } = seed[k.kind] || {};
    fakes[k.collection] = fakeCollection(docs, failed);
  }
  return { fakes, db: { collection: (name) => fakes[name] } };
}

describe('runMonitoring.listRecentRuns', () => {
  it('lists each kind newest first under its phase', async () => {
    const { db } = fakeDb({
      foundationDataRun: { docs: [{ foundationDataRunId: 'f-2', runStatus: 'completed' }, { foundationDataRunId: 'f-1', runStatus: 'failed' }] },
      configurationValidationRun: { docs: [{ configurationValidationRunId: 'c-1', status: 'passed' }] },
      referenceImportRun: { docs: [{ referenceImportRunId: 'r-2', runStatus: 'failed' }, { referenceImportRunId: 'r-1', runStatus: 'completed' }] },
      importJob: { docs: [{ jobID: 'j-1', status: 'completed' }] },
    });

    const result = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(result.runs.foundationDataRun.map((r) => r.id)).toEqual(['f-2', 'f-1']);
    expect(result.runs.referenceImportRun.map((r) => r.id)).toEqual(['r-2', 'r-1']);
    const phaseOf = { foundationDataRun: 1, configurationValidationRun: 1, referenceImportRun: 2, importJob: 3 };
    for (const [kind, phase] of Object.entries(phaseOf)) {
      expect(result.runs[kind].length).toBeGreaterThan(0);
      for (const row of result.runs[kind]) {
        expect(row).toMatchObject({ kind, phase });
      }
    }
    expect(result.phases.map((p) => [p.phase, p.name, p.listed, p.failedListed])).toEqual([
      [1, 'foundation', 3, 1],
      [2, 'references', 2, 1],
      [3, 'operational', 1, 0],
    ]);
  });

  it('names the Foundation stage that failed', async () => {
    const { db } = fakeDb({
      foundationDataRun: {
        docs: [
          { foundationDataRunId: 'f-fail', runStatus: 'failed', dryRunResult: 'pass', applyResult: 'fail', verifyResult: 'not_run' },
          { foundationDataRunId: 'f-ok', runStatus: 'completed', dryRunResult: 'pass', applyResult: 'pass', verifyResult: 'pass', rollbackResult: 'not_required' },
        ],
      },
    });

    const { runs } = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(runs.foundationDataRun[0]).toMatchObject({ id: 'f-fail', failed: true, failedStage: 'apply' });
    expect(runs.foundationDataRun[1]).toMatchObject({ id: 'f-ok', failed: false, failedStage: null });
  });

  it('names the configuration gate that failed, or invariants', async () => {
    const pass = { structuralResult: 'pass', semanticResult: 'pass', dependencyResult: 'pass', securityResult: 'pass' };
    const { db } = fakeDb({
      configurationValidationRun: {
        docs: [
          { configurationValidationRunId: 'c-sem', status: 'failed', ...pass, semanticResult: 'fail', invariantResults: [] },
          { configurationValidationRunId: 'c-inv', status: 'failed', ...pass, invariantResults: [{ invariantId: 'I-1', result: 'pass' }, { invariantId: 'I-2', result: 'fail' }] },
        ],
      },
    });

    const { runs } = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(runs.configurationValidationRun.map((r) => r.failedStage)).toEqual(['semantic', 'invariants']);
  });

  it('counts failures per phase, so a phase 2 failure never reads as phase 1', async () => {
    const { db, fakes } = fakeDb({ referenceImportRun: { failed: 3 } });

    const { phases } = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(phases.map((p) => [p.phase, p.failedTotal])).toEqual([[1, 0], [2, 3], [3, 0]]);
    const failedFilterOf = {
      foundationDataRun: { runStatus: 'failed' },
      configurationValidationRun: { status: 'failed' },
      referenceImportRun: { runStatus: 'failed' },
      referenceImportIssue: { severity: { $in: ['error', 'fatal'] } },
      importJob: { status: 'failed' },
    };
    for (const k of runMonitoring.KINDS) {
      expect(fakes[k.collection].countDocuments).toHaveBeenCalledWith(failedFilterOf[k.kind]);
    }
  });

  it('copies no field outside the listed ones', async () => {
    const { db } = fakeDb({
      importJob: {
        docs: [{
          jobID: 'j-1', dataType: 'samples', status: 'failed', errorCount: 1,
          userID: 'u-secret', fileName: 'secret.csv', errors: [{ error: 'secret' }],
        }],
      },
    });

    const result = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.runs.importJob[0]).toEqual({
      kind: 'importJob', phase: 3, id: 'j-1', status: 'failed', startedAt: null, completedAt: null,
      failed: true, failedStage: null, detail: { dataType: 'samples', errorCount: 1 },
    });
  });

  it('lists ReferenceImportIssue records under phase 2, newest first', async () => {
    const { db } = fakeDb({
      referenceImportIssue: {
        docs: [
          {
            referenceImportIssueId: 'i-2', referenceImportRunId: 'r-1', entityType: 'cid10', errorCode: 'DUPLICATE_CODE', severity: 'error',
            resolutionStatus: 'resolved', detectedAt: '2026-05-02T10:00:00Z', resolvedAt: '2026-05-03T10:00:00Z',
          },
          { referenceImportIssueId: 'i-1', severity: 'error', resolutionStatus: 'open' },
        ],
      },
    });

    const { runs } = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(runs.referenceImportIssue.map((r) => r.id)).toEqual(['i-2', 'i-1']);
    for (const row of runs.referenceImportIssue) expect(row).toMatchObject({ kind: 'referenceImportIssue', phase: 2 });
    expect(runs.referenceImportIssue[0]).toEqual({
      kind: 'referenceImportIssue', phase: 2, id: 'i-2', status: 'resolved',
      startedAt: '2026-05-02T10:00:00Z', completedAt: '2026-05-03T10:00:00Z', failed: true, failedStage: null,
      detail: { referenceImportRunId: 'r-1', entityType: 'cid10', errorCode: 'DUPLICATE_CODE', severity: 'error' },
    });
  });

  it('counts an error or fatal ReferenceImportIssue as a phase 2 failure, never a warning', async () => {
    const { db } = fakeDb({
      referenceImportRun: { failed: 1 },
      referenceImportIssue: {
        docs: [
          { referenceImportIssueId: 'i-e', severity: 'error' },
          { referenceImportIssueId: 'i-w', severity: 'warning' },
          { referenceImportIssueId: 'i-f', severity: 'fatal' },
        ],
        failed: 2,
      },
    });

    const { runs, phases } = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(runs.referenceImportIssue.map((r) => r.failed)).toEqual([true, false, true]);
    expect(phases[1]).toMatchObject({ phase: 2, failedTotal: 3, failedListed: 2, failedTotalByKind: { referenceImportRun: 1, referenceImportIssue: 2 } });
    expect(phases[0].failedTotalByKind).toEqual({ foundationDataRun: 0, configurationValidationRun: 0 });
  });

  it('copies no ReferenceImportIssue field outside the row', async () => {
    const { db } = fakeDb({
      referenceImportIssue: {
        docs: [{
          referenceImportIssueId: 'i-1', severity: 'error',
          rawValue: 'secret', errorMessage: 'secret', resolutionNotes: 'secret', resolvedBy: 'secret',
          quarantinePayloadUri: 'secret', sourceRecordId: 'secret',
        }],
      },
    });

    const result = await runMonitoring.listRecentRuns(db, { limit: 20 });

    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('asks each collection for at most limit rows, newest first', async () => {
    const { db, fakes } = fakeDb();

    const result = await runMonitoring.listRecentRuns(db, { limit: 7 });

    expect(result.limit).toBe(7);
    const sortFieldOf = { foundationDataRun: 'startedAt', configurationValidationRun: 'executedAt', referenceImportRun: 'startedAt', referenceImportIssue: 'detectedAt', importJob: 'createdAt' };
    for (const k of runMonitoring.KINDS) {
      const fake = fakes[k.collection];
      expect(fake.find.mock.calls[0][0]).toEqual({});
      expect(fake.cursor.sort).toHaveBeenCalledWith({ [sortFieldOf[k.kind]]: -1 });
      expect(fake.cursor.limit).toHaveBeenCalledWith(7);
    }
  });
  // The fields each row builder reads; the read must load these and nothing
  // else, so an import job's fhirResources, errors, userID and fileName and a
  // validation run's findings never reach the API process.
  const rowFieldsOf = {
    foundationDataRun: ['foundationDataRunId', 'runStatus', 'startedAt', 'completedAt', 'dryRunResult', 'applyResult', 'verifyResult', 'rollbackResult', 'executionMode'],
    configurationValidationRun: ['configurationValidationRunId', 'status', 'executedAt', 'structuralResult', 'semanticResult', 'dependencyResult', 'securityResult', 'invariantResults.result', 'releaseId'],
    referenceImportRun: ['referenceImportRunId', 'runStatus', 'startedAt', 'completedAt', 'datasetCode', 'importMode'],
    referenceImportIssue: ['referenceImportIssueId', 'resolutionStatus', 'detectedAt', 'resolvedAt', 'referenceImportRunId', 'entityType', 'errorCode', 'severity'],
    importJob: ['jobID', 'status', 'startedAt', 'completedAt', 'dataType', 'errorCount'],
  };

  it.each(Object.keys(rowFieldsOf))('projects the %s read to the row fields, never its payload', async (kind) => {
    const { db, fakes } = fakeDb();

    await runMonitoring.listRecentRuns(db, { limit: 20 });

    const k = runMonitoring.KINDS.find((entry) => entry.kind === kind);
    const options = fakes[k.collection].find.mock.calls[0][1];
    expect(options && options.projection).toEqual({ _id: 0, ...Object.fromEntries(rowFieldsOf[kind].map((field) => [field, 1])) });
    for (const payload of ['fhirResources', 'errors', 'userID', 'fileName', 'findings', 'invariantResults', 'reportUri', 'rawValue', 'errorMessage', 'resolutionNotes', 'resolvedBy', 'quarantinePayloadUri']) {
      expect(options.projection).not.toHaveProperty([payload]);
    }
  });
});

describe('runMonitoring.parseLimit', () => {
  it('parseLimit accepts 1 to 100 and refuses everything else', () => {
    expect(runMonitoring.parseLimit(undefined)).toBe(20);
    expect(runMonitoring.parseLimit('1')).toBe(1);
    expect(runMonitoring.parseLimit('100')).toBe(100);
    for (const bad of ['0', '101', 'abc', '-1', '2.5', ['1', '2']]) {
      expect(runMonitoring.parseLimit(bad)).toBeNull();
    }
  });
});
