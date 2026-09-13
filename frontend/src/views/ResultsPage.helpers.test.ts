// #905: the jobs-list metrics strip read a nested job.metrics object that
// no backend path ever returned, so it silently never rendered.
// deriveJobMetrics maps the flat fields the API actually sends.
import { describe, it, expect } from 'vitest';
import { deriveJobMetrics, formatImportErrorRow } from './ResultsPage';
import type { ImportJob } from '../types/models';

type ImportErrorItem = NonNullable<ImportJob['errors']>[number];

const baseJob = {
  jobID: 'j1',
  userID: 'u1',
  userName: 'user',
  dataType: 'results',
  fileName: 'f.csv',
  filePath: '/tmp/f.csv',
  fileSize: 10,
  fileFormat: 'CSV',
  status: 'completed',
} as unknown as ImportJob;

describe('deriveJobMetrics (#905)', () => {
  it('maps the flat worker-written counts into the display shape', () => {
    const metrics = deriveJobMetrics({
      ...baseJob,
      totalRecords: 10,
      successCount: 9,
      errorCount: 1,
    });
    expect(metrics).toEqual({ totalRecords: 10, successfulRecords: 9, failedRecords: 1 });
  });

  it('returns null when the job carries no counts (metrics strip hidden)', () => {
    expect(deriveJobMetrics(baseJob)).toBeNull();
  });

  it('defaults missing success/error counts to 0 rather than rendering undefined', () => {
    const metrics = deriveJobMetrics({ ...baseJob, totalRecords: 3 });
    expect(metrics).toEqual({ totalRecords: 3, successfulRecords: 0, failedRecords: 0 });
  });

  // The nested job.metrics object is deliberately NOT consulted: it never
  // exists on listed jobs (only on the report shape, mapped server-side).
  it('ignores a nested metrics object in favor of the flat fields', () => {
    const metrics = deriveJobMetrics({
      ...baseJob,
      totalRecords: 5,
      successCount: 5,
      errorCount: 0,
      metrics: { totalRecords: 999, successfulRecords: 999, failedRecords: 999, duplicatesFound: 0 } as any,
    });
    expect(metrics).toEqual({ totalRecords: 5, successfulRecords: 5, failedRecords: 0 });
  });
});

// #905: the report modal read `validationErrors`/`processingErrors`, fields
// no backend path has ever returned. The worker writes the human-readable
// text under the `error` key (see result-worker.js:90,111,147,316,329,343),
// not `message` -- formatImportErrorRow must read `error`, or every row
// renders blank.
describe('formatImportErrorRow (#905)', () => {
  it('reads the human-readable text from `error`, not `message`', () => {
    const item: ImportErrorItem = { error: 'Erro ao processar arquivo.xyz: boom' };
    const row = formatImportErrorRow(item);
    expect(row.message).toBe('Erro ao processar arquivo.xyz: boom');
  });

  it('ignores a same-shaped `message` field if one happens to be present', () => {
    const item = { error: 'the real message', message: 'a decoy' } as ImportErrorItem;
    const row = formatImportErrorRow(item);
    expect(row.message).toBe('the real message');
  });

  it('carries the row number through when present', () => {
    const item: ImportErrorItem = { row: 3, error: 'valor inválido' };
    const row = formatImportErrorRow(item);
    expect(row).toEqual({ row: 3, code: undefined, file: undefined, message: 'valor inválido' });
  });

  it('prefers fileName over filePath when both are present', () => {
    const item: ImportErrorItem = { error: 'x', fileName: 'a.csv', filePath: '/tmp/a.csv' };
    expect(formatImportErrorRow(item).file).toBe('a.csv');
  });

  it('falls back to filePath when fileName is absent', () => {
    const item: ImportErrorItem = { error: 'x', filePath: '/tmp/b.csv' };
    expect(formatImportErrorRow(item).file).toBe('/tmp/b.csv');
  });

  it('carries the code through when present (e.g. FORMAT_NOT_IMPLEMENTED)', () => {
    const item: ImportErrorItem = { error: 'x', code: 'FORMAT_NOT_IMPLEMENTED' };
    expect(formatImportErrorRow(item).code).toBe('FORMAT_NOT_IMPLEMENTED');
  });
});
