// #905: the jobs-list metrics strip read a nested job.metrics object that
// no backend path ever returned, so it silently never rendered.
// deriveJobMetrics maps the flat fields the API actually sends.
import { describe, it, expect } from 'vitest';
import { deriveJobMetrics } from './ResultsPage';
import type { ImportJob } from '../types/models';

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
