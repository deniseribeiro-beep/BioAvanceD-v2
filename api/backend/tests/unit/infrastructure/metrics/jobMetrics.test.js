import { describe, it, expect, vi, afterEach } from 'vitest';

const jobMetrics = require('../../../../src/infrastructure/metrics/jobMetrics');
const requestContext = require('../../../../src/utils/requestContext');
const logger = require('../../../../src/utils/logger');

// RNF015 C1/C3 (#1468): the job metrics are driven here by hand-built fake
// collections, so no case touches MongoDB.

const AT = new Date('2026-11-13T10:00:00.000Z');

function fakeDb(collection) {
  return { collection: vi.fn(() => collection) };
}

function writingDb() {
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  return { db: fakeDb({ updateOne }), updateOne };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#1468: recordJob', () => {
  it('records a completed run under the job correlation id', async () => {
    const { db, updateOne } = writingDb();

    await requestContext.runAsJob('req-metric-0001', () =>
      jobMetrics.recordJob(db, { worker: 'import-queue', job: 'import', outcome: 'completed', durationMs: 12.34567, at: AT })
    );

    expect(db.collection).toHaveBeenCalledWith('workerJobMetrics');
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'import-queue:import' },
      {
        $inc: { completed: 1, durationMsSum: 12.346 },
        $max: { durationMsMax: 12.346 },
        $set: {
          worker: 'import-queue',
          job: 'import',
          lastOutcome: 'completed',
          lastRunAt: AT,
          lastRequestId: 'req-metric-0001',
        },
      },
      { upsert: true }
    );
  });

  it('records a failed run under the failed counter', async () => {
    const { db, updateOne } = writingDb();

    await jobMetrics.recordJob(db, { worker: 'daily-merkle', job: 'run', outcome: 'failed', durationMs: 5, at: AT });

    const update = updateOne.mock.calls[0][1];
    expect(update.$inc).toEqual({ failed: 1, durationMsSum: 5 });
    expect(update.$set.lastOutcome).toBe('failed');
  });

  it('records an unknown outcome as failed and a bad duration as 0', async () => {
    const { db, updateOne } = writingDb();

    await jobMetrics.recordJob(db, { worker: 'w', job: 'j', outcome: 'weird', durationMs: -3, at: AT });

    const update = updateOne.mock.calls[0][1];
    expect(update.$inc).toEqual({ failed: 1, durationMsSum: 0 });
    expect(update.$max).toEqual({ durationMsMax: 0 });
  });

  it('keeps the series bounded: a label outside the pattern is recorded as other', async () => {
    const { db, updateOne } = writingDb();

    await jobMetrics.recordJob(db, { worker: 'bad worker\n', job: 'x'.repeat(65), outcome: 'completed', durationMs: 1, at: AT });

    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'other:other' });
    expect(update.$set.worker).toBe('other');
    expect(update.$set.job).toBe('other');
  });

  it('never rejects when the collection throws, and warns once', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const db = fakeDb({ updateOne: vi.fn().mockRejectedValue(new Error('mongo fora')) });

    await expect(jobMetrics.recordJob(db, { worker: 'w', job: 'j', outcome: 'completed', durationMs: 1 })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[JOB_METRICS\]/);
  });

  it('never rejects with no database, and warns once', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(jobMetrics.recordJob(null, { worker: 'w', job: 'j', outcome: 'completed', durationMs: 1 })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[JOB_METRICS\]/);
  });
});

describe('#1468: withJobMetrics', () => {
  it('records a completed run labelled by the job name and returns the result', async () => {
    const { db, updateOne } = writingDb();
    const wrapped = jobMetrics.withJobMetrics('import-queue', () => db, async (job, token) => `${job.name}:${token}`);

    const result = await requestContext.runAsJob('req-metric-0002', () => wrapped({ name: 'batch-import' }, 'tok'));

    expect(result).toBe('batch-import:tok');
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'import-queue:batch-import' });
    expect(update.$inc.completed).toBe(1);
    expect(update.$set.lastRequestId).toBe('req-metric-0002');
  });

  it('records a failed run and rethrows the same error', async () => {
    const { db, updateOne } = writingDb();
    const error = new Error('job quebrou');
    const wrapped = jobMetrics.withJobMetrics('notification-queue', () => db, async () => { throw error; });

    await expect(wrapped({ name: 'consent-notification' })).rejects.toBe(error);

    const update = updateOne.mock.calls[0][1];
    expect(update.$inc.failed).toBe(1);
    expect(update.$set.lastOutcome).toBe('failed');
  });
});

describe('#1468: readJobMetrics', () => {
  it('reads the bounded, sorted rows with missing counters as 0', async () => {
    const toArray = vi.fn().mockResolvedValue([
      { worker: 'import-queue', job: 'import', completed: 3, durationMsSum: 9, durationMsMax: 4, lastOutcome: 'completed', lastRunAt: AT },
    ]);
    const limit = vi.fn(() => ({ toArray }));
    const sort = vi.fn(() => ({ limit }));
    const find = vi.fn(() => ({ sort }));
    const db = fakeDb({ find });

    const rows = await jobMetrics.readJobMetrics(db);

    expect(find).toHaveBeenCalledWith({}, expect.objectContaining({ maxTimeMS: 2000 }));
    expect(find.mock.calls[0][1].projection._id).toBe(0);
    expect(sort).toHaveBeenCalledWith({ worker: 1, job: 1 });
    expect(limit).toHaveBeenCalledWith(200);
    expect(rows).toEqual([
      {
        worker: 'import-queue',
        job: 'import',
        completed: 3,
        failed: 0,
        durationMsSum: 9,
        durationMsMax: 4,
        lastOutcome: 'completed',
        lastRunAt: AT,
      },
    ]);
  });

  it('resolves null when the read fails', async () => {
    const db = fakeDb({ find: vi.fn(() => { throw new Error('mongo fora'); }) });

    await expect(jobMetrics.readJobMetrics(db)).resolves.toBeNull();
  });
});
