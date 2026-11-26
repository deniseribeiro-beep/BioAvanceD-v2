// RNF015 C1/C3 (#1468): per-job metrics for the workers and the scheduled
// jobs. One document per `worker:job` in workerJobMetrics, so the counts of
// every worker process meet in one place. No npm package: plain counters.
//
// A record never rejects: a metrics write that fails must not turn a job that
// succeeded into a failed one. recordJob reads the correlation id itself, so
// it is called inside the job's request context (requestContext.runAsJob).

const logger = require('../../utils/logger');
const { currentRequestId } = require('../../utils/requestContext');

const COLLECTION = 'workerJobMetrics';
const OTHER = 'other';
// Bounded labels keep the number of documents bounded.
const LABEL = /^[A-Za-z0-9._:-]{1,64}$/;
const READ_LIMIT = 200;
const READ_TIMEOUT_MS = 2000;

function label(value) {
  return typeof value === 'string' && LABEL.test(value) ? value : OTHER;
}

function durationOf(durationMs) {
  const ms = Number(durationMs);
  return Number.isFinite(ms) && ms >= 0 ? Number(ms.toFixed(3)) : 0;
}

async function recordJob(db, { worker, job, outcome, durationMs, at = new Date() } = {}) {
  const w = label(worker);
  const j = label(job);
  const o = outcome === 'completed' ? 'completed' : 'failed';
  const ms = durationOf(durationMs);
  try {
    if (!db || typeof db.collection !== 'function') {
      throw new Error('no database');
    }
    await db.collection(COLLECTION).updateOne(
      { _id: `${w}:${j}` },
      {
        $inc: { [o]: 1, durationMsSum: ms },
        $max: { durationMsMax: ms },
        $set: { worker: w, job: j, lastOutcome: o, lastRunAt: at, lastRequestId: currentRequestId() },
      },
      { upsert: true }
    );
  } catch (error) {
    logger.warn(`[JOB_METRICS] Falha ao registrar métrica do job ${w}:${j}: ${error?.message || error}`);
  }
}

// Times a BullMQ processor and records its outcome. The processor's error is
// rethrown unchanged, so BullMQ still sees the job fail.
function withJobMetrics(worker, getDb, processor) {
  return async (job, ...rest) => {
    const t0 = process.hrtime.bigint();
    const name = job && job.name;
    const elapsed = () => Number(process.hrtime.bigint() - t0) / 1e6;
    let result;
    try {
      result = await processor(job, ...rest);
    } catch (error) {
      await recordJob(getDb(), { worker, job: name, outcome: 'failed', durationMs: elapsed() });
      throw error;
    }
    await recordJob(getDb(), { worker, job: name, outcome: 'completed', durationMs: elapsed() });
    return result;
  };
}

// Resolves null on any error, so a reader can tell "no data" from "no read".
async function readJobMetrics(db) {
  try {
    const rows = await db
      .collection(COLLECTION)
      .find({}, {
        projection: {
          _id: 0, worker: 1, job: 1, completed: 1, failed: 1, durationMsSum: 1, durationMsMax: 1, lastOutcome: 1, lastRunAt: 1,
        },
        maxTimeMS: READ_TIMEOUT_MS,
      })
      .sort({ worker: 1, job: 1 })
      .limit(READ_LIMIT)
      .toArray();
    return rows.map((row) => ({
      worker: row.worker,
      job: row.job,
      completed: Number(row.completed) || 0,
      failed: Number(row.failed) || 0,
      durationMsSum: Number(row.durationMsSum) || 0,
      durationMsMax: Number(row.durationMsMax) || 0,
      lastOutcome: row.lastOutcome ?? null,
      lastRunAt: row.lastRunAt ?? null,
    }));
  } catch (error) {
    return null;
  }
}

module.exports = { recordJob, withJobMetrics, readJobMetrics, COLLECTION };
