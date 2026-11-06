import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const logger = require('../../../src/utils/logger');
const notificationDispatchService = require('../../../src/services/notificationDispatch.service');
const platformAlert = require('../../../src/services/platformAlert.service');

// RNF015 C2 (#1323): the platform alert check opens one episode per firing
// key, notifies once, resolves on ok and leaves an unknown key untouched.

const SINCE = '2026-10-27T00:00:00.000Z';

function httpSnapshot(requests, errors) {
  const buckets = { 5: 0, 10: 0, 25: 0, 50: 0, 100: requests, 250: 0, 500: 0, 1000: 0, 2500: 0, 5000: 0, 10000: 0, '+Inf': 0 };
  return () => ({ since: SINCE, totals: { requests, errors, latency: { buckets } } });
}

const noQueues = () => Promise.resolve([]);

// A platformAlerts collection over an in-memory array, and the outbox count.
// `backup` ({ history, policy }) adds backupHistory and backup_policy; without
// it the backup reading fails and BACKUP_RPO stays unknown.
function makeDb({ deadLetter = 0, backup } = {}) {
  const rows = [];
  let nextId = 1;
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);
  const platformAlerts = {
    findOne: vi.fn(async (filter) => rows.find((row) => matches(row, filter)) || null),
    insertOne: vi.fn(async (doc) => {
      const _id = `pa-${nextId++}`;
      rows.push({ _id, ...doc });
      return { insertedId: _id };
    }),
    updateOne: vi.fn(async (filter, update) => {
      const row = rows.find((r) => matches(r, filter));
      if (row) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0 };
    }),
    find: vi.fn((filter) => {
      const cursor = {};
      cursor.sort = vi.fn(() => cursor);
      cursor.limit = vi.fn(() => cursor);
      cursor.toArray = vi.fn(async () => rows.filter((row) => matches(row, filter)));
      return cursor;
    }),
  };
  const outbox = {
    countDocuments: typeof deadLetter === 'function' ? vi.fn(deadLetter) : vi.fn().mockResolvedValue(deadLetter),
  };
  const collections = { platformAlerts, graph_projection_outbox: outbox };
  let backupHistory;
  if (backup) {
    backupHistory = {
      findOne: vi.fn(async (filter, options = {}) => {
        let found = backup.history.filter((row) => matches(row, filter));
        if (options.sort && options.sort.completedAt === -1) {
          found = [...found].sort((a, b) => b.completedAt - a.completedAt);
        }
        return found[0] || null;
      }),
    };
    collections.backupHistory = backupHistory;
    collections.backup_policy = { findOne: vi.fn(async () => backup.policy) };
  }
  return { collection: vi.fn((name) => collections[name]), rows, platformAlerts, outbox, backupHistory };
}

let dispatchSpy;

beforeEach(() => {
  platformAlert._resetForTests();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('platformAlert.service - runPlatformAlertCheck', () => {
  it('inserts one active row and dispatches once on a first firing run', async () => {
    const db = makeDb({ deadLetter: 2 });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      alertKey: 'OUTBOX_DEAD_LETTER:graph_projection_outbox', code: 'OUTBOX_DEAD_LETTER', status: 'active', value: 2,
    });
    expect(db.outbox.countDocuments).toHaveBeenCalledWith({ status: 'DEAD_LETTER' }, { maxTimeMS: 2000 });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'platform_alert',
      sourceEventType: 'PlatformAlert',
      sourceEventId: 'pa-1',
      payload: { code: 'OUTBOX_DEAD_LETTER', subject: 'graph_projection_outbox', severity: 'critical', value: 2, threshold: 0 },
    });
  });

  it('inserts nothing and does not dispatch again on a second firing run', async () => {
    const db = makeDb({ deadLetter: 2 });
    const deps = { snapshot: httpSnapshot(0, 0), readQueues: noQueues };
    await platformAlert.runPlatformAlertCheck(db, deps);
    db.outbox.countDocuments.mockResolvedValue(3);

    await platformAlert.runPlatformAlertCheck(db, deps);

    expect(db.platformAlerts.insertOne).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(db.rows[0]).toMatchObject({ status: 'active', value: 3 });
  });

  it('resolves the active row on an ok run', async () => {
    const db = makeDb({ deadLetter: 1 });
    const deps = { snapshot: httpSnapshot(0, 0), readQueues: noQueues };
    await platformAlert.runPlatformAlertCheck(db, deps);
    db.outbox.countDocuments.mockResolvedValue(0);

    await platformAlert.runPlatformAlertCheck(db, deps);

    expect(db.rows[0].status).toBe('resolved');
    expect(db.rows[0].resolvedAt).toBeInstanceOf(Date);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('writes nothing on an unknown run', async () => {
    const db = makeDb({ deadLetter: 1 });
    const deps = { snapshot: httpSnapshot(0, 0), readQueues: noQueues };
    await platformAlert.runPlatformAlertCheck(db, deps);
    db.platformAlerts.insertOne.mockClear();
    db.platformAlerts.updateOne.mockClear();
    db.outbox.countDocuments.mockRejectedValue(new Error('timeout'));

    await platformAlert.runPlatformAlertCheck(db, {
      snapshot: httpSnapshot(0, 0),
      readQueues: () => Promise.resolve([{ name: 'import-queue', status: 'not_initialized' }]),
    });

    expect(db.platformAlerts.insertOne).not.toHaveBeenCalled();
    expect(db.platformAlerts.updateOne).not.toHaveBeenCalled();
    expect(db.rows[0].status).toBe('active');
  });

  it('gives OUTBOX_DEAD_LETTER unknown on a count rejection and still evaluates the other keys', async () => {
    const db = makeDb({ deadLetter: () => Promise.reject(new Error('secret connection detail')) });

    const results = await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(100, 50), readQueues: noQueues });

    expect(results.find((r) => r.code === 'OUTBOX_DEAD_LETTER').state).toBe('unknown');
    expect(results.find((r) => r.code === 'HTTP_ERROR_RATE')).toMatchObject({ state: 'firing', value: 0.5 });
    expect(db.rows.map((row) => row.alertKey)).toEqual(['HTTP_ERROR_RATE:http']);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret connection detail');
  });

  it('keeps an active HTTP alert active through a sparse window', async () => {
    const db = makeDb();
    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(30, 15), readQueues: noQueues });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(40, 15), readQueues: noQueues });

    expect(db.rows.map((row) => [row.alertKey, row.status])).toEqual([['HTTP_ERROR_RATE:http', 'active']]);
    expect(db.platformAlerts.updateOne).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('inserts nothing and dispatches nothing on a second run started while one is pending', async () => {
    const db = makeDb({ deadLetter: 1 });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slowQueues = () => gate.then(() => []);

    const first = platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: slowQueues });
    const second = await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });
    release();
    await first;

    expect(second).toBeNull();
    expect(db.platformAlerts.insertOne).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('reads the active row with a maxTimeMS', async () => {
    const db = makeDb({ deadLetter: 1 });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    expect(db.platformAlerts.findOne).toHaveBeenCalledWith(
      { alertKey: 'OUTBOX_DEAD_LETTER:graph_projection_outbox', status: 'active' },
      { maxTimeMS: 2000 }
    );
  });

  it('keeps evaluating the other keys when one key write fails', async () => {
    const db = makeDb({ deadLetter: 1 });
    // The first key read is HTTP_ERROR_RATE's, firing at 50%.
    db.platformAlerts.findOne.mockRejectedValueOnce(new Error('write failed'));

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(100, 50), readQueues: noQueues });

    expect(db.platformAlerts.findOne.mock.calls[0][0]).toEqual({ alertKey: 'HTTP_ERROR_RATE:http', status: 'active' });
    expect(db.rows.map((row) => row.alertKey)).toEqual(['OUTBOX_DEAD_LETTER:graph_projection_outbox']);
  });

  // RNF010 C2 (#1484): the age of the newest successful backup against rpoHours.
  it('opens a BACKUP_RPO episode when the newest successful backup is past rpoHours', async () => {
    const db = makeDb({
      backup: {
        history: [{ status: 'success', completedAt: new Date(Date.now() - 25 * 3600000) }],
        policy: { _id: 'main', rpoHours: 24 },
      },
    });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ alertKey: 'BACKUP_RPO:backup', status: 'active', threshold: 24 });
    expect(db.rows[0].value).toBeGreaterThan(24);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('writes no BACKUP_RPO episode when the newest successful backup is within rpoHours', async () => {
    const db = makeDb({
      backup: {
        history: [{ status: 'success', completedAt: new Date(Date.now() - 3600000) }],
        policy: { _id: 'main', rpoHours: 24 },
      },
    });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    expect(db.rows).toEqual([]);
  });

  it('reads backupHistory with a maxTimeMS', async () => {
    const db = makeDb({
      backup: {
        history: [{ status: 'success', completedAt: new Date(Date.now() - 3600000) }],
        policy: { _id: 'main', rpoHours: 24 },
      },
    });

    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    expect(db.backupHistory.findOne).toHaveBeenCalledWith(
      { status: 'success' },
      expect.objectContaining({ maxTimeMS: 2000 })
    );
  });
});

describe('platformAlert.service - getAlertState', () => {
  it('gives evaluatedAt null before any run', async () => {
    const db = makeDb();

    const state = await platformAlert.getAlertState(db);

    expect(state).toEqual({ evaluatedAt: null, results: null, active: [] });
  });

  it('gives the last evaluation and the active rows after a run', async () => {
    const db = makeDb({ deadLetter: 1 });
    await platformAlert.runPlatformAlertCheck(db, { snapshot: httpSnapshot(0, 0), readQueues: noQueues });

    const state = await platformAlert.getAlertState(db);

    expect(typeof state.evaluatedAt).toBe('string');
    expect(state.results.map((r) => r.key)).toContain('OUTBOX_DEAD_LETTER:graph_projection_outbox');
    expect(state.active).toHaveLength(1);
    expect(db.platformAlerts.find).toHaveBeenCalledWith({ status: 'active' }, expect.objectContaining({ projection: expect.objectContaining({ _id: 0 }) }));
  });
});

describe('platformAlert.service - thresholdsFrom', () => {
  it('reads the env keys and falls back on a non-finite or negative value', () => {
    expect(platformAlert.thresholdsFrom({})).toEqual({ httpErrorRate: 0.05, httpP95Ms: 2500, queueBacklog: 100 });
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: '0.1', ALERT_HTTP_P95_MS: '1000', ALERT_QUEUE_BACKLOG: '5' }))
      .toEqual({ httpErrorRate: 0.1, httpP95Ms: 1000, queueBacklog: 5 });
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: 'abc', ALERT_HTTP_P95_MS: '-1', ALERT_QUEUE_BACKLOG: 'Infinity' }))
      .toEqual({ httpErrorRate: 0.05, httpP95Ms: 2500, queueBacklog: 100 });
  });

  it('treats a whitespace-only value as unset', () => {
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: ' ', ALERT_HTTP_P95_MS: '  ', ALERT_QUEUE_BACKLOG: '\t' }))
      .toEqual({ httpErrorRate: 0.05, httpP95Ms: 2500, queueBacklog: 100 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back with a warning on an error rate above 1 or a zero rate or p95', () => {
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: '2' }).httpErrorRate).toBe(0.05);
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: '0', ALERT_HTTP_P95_MS: '0' }))
      .toMatchObject({ httpErrorRate: 0.05, httpP95Ms: 2500 });
    expect(platformAlert.thresholdsFrom({ ALERT_HTTP_ERROR_RATE: '1', ALERT_QUEUE_BACKLOG: '0' }))
      .toMatchObject({ httpErrorRate: 1, queueBacklog: 0 });
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});
