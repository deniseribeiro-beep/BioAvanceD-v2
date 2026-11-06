import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ALERT_CODES, windowOf, evaluateAlerts } = require('../../../../src/infrastructure/metrics/platformAlerts');

// RNF015 C2 (#1323): the platform alert rules, pure over their readings.

const THRESHOLDS = { httpErrorRate: 0.05, httpP95Ms: 2500, queueBacklog: 100 };
const BUCKET_KEYS = ['5', '10', '25', '50', '100', '250', '500', '1000', '2500', '5000', '10000', '+Inf'];

function buckets(fill = {}) {
  const out = {};
  for (const key of BUCKET_KEYS) out[key] = fill[key] || 0;
  return out;
}

function totals(requests, errors, fill) {
  return { requests, errors, latency: { buckets: buckets(fill) } };
}

function httpWindow(requests, errors, fill = { 100: requests }) {
  return { requests, errors, buckets: buckets(fill) };
}

function evaluate(overrides = {}) {
  return evaluateAlerts({
    httpWindow: httpWindow(0, 0, {}),
    queues: [],
    prevQueues: [],
    deadLetter: 0,
    thresholds: THRESHOLDS,
    ...overrides,
  });
}

function rowOf(rows, code, subject) {
  return rows.find((row) => row.code === code && row.subject === subject);
}

function upQueue(name, counts) {
  return { name, status: 'up', counts: { waiting: 0, delayed: 0, active: 0, failed: 0, paused: 0, ...counts } };
}

describe('platformAlerts - HTTP_ERROR_RATE', () => {
  it('fires above the threshold', () => {
    const row = rowOf(evaluate({ httpWindow: httpWindow(100, 6) }), ALERT_CODES.HTTP_ERROR_RATE, 'http');
    expect(row).toMatchObject({ key: 'HTTP_ERROR_RATE:http', severity: 'critical', state: 'firing', value: 0.06, threshold: 0.05 });
  });

  it('is ok at the threshold and below', () => {
    expect(rowOf(evaluate({ httpWindow: httpWindow(100, 5) }), ALERT_CODES.HTTP_ERROR_RATE, 'http').state).toBe('ok');
    expect(rowOf(evaluate({ httpWindow: httpWindow(100, 1) }), ALERT_CODES.HTTP_ERROR_RATE, 'http').state).toBe('ok');
  });

  it('is unknown with no value under 20 requests in the window', () => {
    const rows = evaluate({ httpWindow: httpWindow(19, 19, { '+Inf': 19 }) });
    expect(rowOf(rows, ALERT_CODES.HTTP_ERROR_RATE, 'http')).toMatchObject({ state: 'unknown', value: null });
    expect(rowOf(rows, ALERT_CODES.HTTP_LATENCY_P95, 'http')).toMatchObject({ state: 'unknown', value: null });
  });

  it('evaluates a window of exactly 20 requests', () => {
    const rows = evaluate({ httpWindow: httpWindow(20, 0) });
    expect(rowOf(rows, ALERT_CODES.HTTP_ERROR_RATE, 'http')).toMatchObject({ state: 'ok', value: 0 });
    expect(rowOf(rows, ALERT_CODES.HTTP_LATENCY_P95, 'http')).toMatchObject({ state: 'ok', value: 100 });
  });
});

describe('platformAlerts - HTTP_LATENCY_P95', () => {
  it('fires when the window p95 bucket bound is above the threshold', () => {
    const row = rowOf(evaluate({ httpWindow: httpWindow(100, 0, { 100: 90, 5000: 10 }) }), ALERT_CODES.HTTP_LATENCY_P95, 'http');
    expect(row).toMatchObject({ severity: 'warning', state: 'firing', value: 5000, threshold: 2500 });
  });

  it('fires when the p95 falls in the +Inf bucket', () => {
    const row = rowOf(evaluate({ httpWindow: httpWindow(100, 0, { 100: 90, '+Inf': 10 }) }), ALERT_CODES.HTTP_LATENCY_P95, 'http');
    expect(row).toMatchObject({ state: 'firing', value: '+Inf' });
  });

  it('is ok when the p95 bucket bound is at the threshold', () => {
    const row = rowOf(evaluate({ httpWindow: httpWindow(100, 0, { 100: 90, 2500: 10 }) }), ALERT_CODES.HTTP_LATENCY_P95, 'http');
    expect(row).toMatchObject({ state: 'ok', value: 2500 });
  });
});

describe('platformAlerts - windowOf', () => {
  it('subtracts the previous totals', () => {
    const prev = totals(100, 10, { 100: 90, 5000: 10 });
    const cur = totals(150, 12, { 100: 130, 5000: 20 });
    expect(windowOf(prev, 'since-1', cur, 'since-1')).toEqual({
      requests: 50, errors: 2, buckets: buckets({ 100: 40, 5000: 10 }),
    });
  });

  it('gives the current totals when since changed', () => {
    const prev = totals(100, 10, { 100: 100 });
    const cur = totals(150, 12, { 100: 150 });
    expect(windowOf(prev, 'since-1', cur, 'since-2')).toEqual({ requests: 150, errors: 12, buckets: buckets({ 100: 150 }) });
  });

  it('gives the current totals with no previous reading or a counter that went down', () => {
    const cur = totals(30, 1, { 100: 30 });
    expect(windowOf(null, null, cur, 'since-1')).toEqual({ requests: 30, errors: 1, buckets: buckets({ 100: 30 }) });
    expect(windowOf(totals(40, 1, { 100: 40 }), 'since-1', cur, 'since-1').requests).toBe(30);
  });
});

describe('platformAlerts - queues', () => {
  it('gives unknown for all three codes on a queue not initialized', () => {
    const rows = evaluate({ queues: [{ name: 'import-queue', status: 'not_initialized' }] });
    for (const code of [ALERT_CODES.QUEUE_UNAVAILABLE, ALERT_CODES.QUEUE_BACKLOG, ALERT_CODES.QUEUE_FAILED]) {
      expect(rowOf(rows, code, 'import-queue').state).toBe('unknown');
    }
  });

  it('fires QUEUE_UNAVAILABLE on an unavailable queue and leaves backlog and failed unknown', () => {
    const rows = evaluate({
      queues: [{ name: 'import-queue', status: 'unavailable', reason: 'timeout' }],
      prevQueues: [upQueue('import-queue', { failed: 1 })],
    });
    expect(rowOf(rows, ALERT_CODES.QUEUE_UNAVAILABLE, 'import-queue')).toMatchObject({ severity: 'critical', state: 'firing' });
    expect(rowOf(rows, ALERT_CODES.QUEUE_BACKLOG, 'import-queue').state).toBe('unknown');
    expect(rowOf(rows, ALERT_CODES.QUEUE_FAILED, 'import-queue').state).toBe('unknown');
  });

  it('is ok on QUEUE_UNAVAILABLE for a queue that is up', () => {
    const rows = evaluate({ queues: [upQueue('import-queue')] });
    expect(rowOf(rows, ALERT_CODES.QUEUE_UNAVAILABLE, 'import-queue').state).toBe('ok');
  });

  it('fires QUEUE_BACKLOG when waiting plus delayed is over the threshold', () => {
    const over = evaluate({ queues: [upQueue('notification-queue', { waiting: 60, delayed: 41 })] });
    expect(rowOf(over, ALERT_CODES.QUEUE_BACKLOG, 'notification-queue')).toMatchObject({ state: 'firing', value: 101, threshold: 100 });
    const at = evaluate({ queues: [upQueue('notification-queue', { waiting: 60, delayed: 40 })] });
    expect(rowOf(at, ALERT_CODES.QUEUE_BACKLOG, 'notification-queue')).toMatchObject({ state: 'ok', value: 100 });
  });

  it('fires QUEUE_FAILED on a rise in failed since the previous reading', () => {
    const rows = evaluate({ queues: [upQueue('import-queue', { failed: 7 })], prevQueues: [upQueue('import-queue', { failed: 5 })] });
    expect(rowOf(rows, ALERT_CODES.QUEUE_FAILED, 'import-queue')).toMatchObject({ state: 'firing', value: 2 });
  });

  it('is ok on QUEUE_FAILED on a fall in failed', () => {
    const rows = evaluate({ queues: [upQueue('import-queue', { failed: 3 })], prevQueues: [upQueue('import-queue', { failed: 5 })] });
    expect(rowOf(rows, ALERT_CODES.QUEUE_FAILED, 'import-queue')).toMatchObject({ state: 'ok', value: 0 });
  });

  it('gives unknown on QUEUE_FAILED with no previous reading of the queue', () => {
    const rows = evaluate({ queues: [upQueue('import-queue', { failed: 3 })], prevQueues: [upQueue('notification-queue', { failed: 0 })] });
    expect(rowOf(rows, ALERT_CODES.QUEUE_FAILED, 'import-queue').state).toBe('unknown');
  });
});

describe('platformAlerts - OUTBOX_DEAD_LETTER', () => {
  it('fires on one dead letter', () => {
    expect(rowOf(evaluate({ deadLetter: 1 }), ALERT_CODES.OUTBOX_DEAD_LETTER, 'graph_projection_outbox'))
      .toMatchObject({ key: 'OUTBOX_DEAD_LETTER:graph_projection_outbox', severity: 'critical', state: 'firing', value: 1 });
  });

  it('is ok on none', () => {
    expect(rowOf(evaluate({ deadLetter: 0 }), ALERT_CODES.OUTBOX_DEAD_LETTER, 'graph_projection_outbox').state).toBe('ok');
  });

  it('gives unknown when the count could not be read', () => {
    expect(rowOf(evaluate({ deadLetter: null }), ALERT_CODES.OUTBOX_DEAD_LETTER, 'graph_projection_outbox').state).toBe('unknown');
  });
});

// RNF010 C2 (#1484): the age of the newest successful backup against rpoHours.
describe('platformAlerts - BACKUP_RPO', () => {
  it('fires when the newest successful backup is older than rpoHours', () => {
    expect(rowOf(evaluate({ backup: { ageHours: 25, anyRun: true, rpoHours: 24 } }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ key: 'BACKUP_RPO:backup', severity: 'critical', state: 'firing', value: 25, threshold: 24 });
  });

  it('is ok at rpoHours and below', () => {
    expect(rowOf(evaluate({ backup: { ageHours: 24, anyRun: true, rpoHours: 24 } }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ state: 'ok', value: 24, threshold: 24 });
    expect(rowOf(evaluate({ backup: { ageHours: 1, anyRun: true, rpoHours: 24 } }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ state: 'ok', value: 1, threshold: 24 });
  });

  it('fires when runs are recorded but none succeeded', () => {
    expect(rowOf(evaluate({ backup: { ageHours: null, anyRun: true, rpoHours: 24 } }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ state: 'firing', value: null, threshold: 24 });
  });

  it('is unknown before any backup run', () => {
    expect(rowOf(evaluate({ backup: { ageHours: null, anyRun: false, rpoHours: 24 } }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ state: 'unknown', value: null, threshold: 24 });
  });

  it('is unknown when the reading is unavailable', () => {
    expect(rowOf(evaluate({ backup: null }), ALERT_CODES.BACKUP_RPO, 'backup'))
      .toMatchObject({ state: 'unknown', value: null, threshold: null });
  });
});

describe('platformAlerts - row shape', () => {
  it('carries only the fixed vocabulary', () => {
    const rows = evaluate({ queues: [upQueue('import-queue')] });
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['code', 'key', 'severity', 'state', 'subject', 'threshold', 'value']);
    }
  });
});
