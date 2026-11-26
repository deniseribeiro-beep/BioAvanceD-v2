import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// IMPORTANT: daily-merkle.job.js calls scheduleNextRun() at module top-level on require(),
// which calls setTimeout(...). We must use fake timers BEFORE the first require of the
// module anywhere in this file, or a real timer callback gets scheduled in the test process.
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-07-02T10:00:00.000Z'));

// Load the real singleton modules that daily-merkle.job.js requires (CommonJS `require`,
// not ESM import) — vi.mock() does not reliably intercept require() in this repo's setup
// (confirmed: mock factories never run against CJS require() call sites).
//
// Note: vi.resetModules() + re-require per test was tried first (per the task brief's
// suggestion) but proved unreliable in this environment — after a second resetModules()+
// require() cycle, daily-merkle.job.js's internally destructured `connectDB` reference
// silently diverged from the freshly-required module object returned to the test (the
// mock's resolved value was demonstrably used by runOnce(), yet `mock.calls.length` read 0
// on the object the test held). So instead we follow the pattern already used in this repo
// at tests/unit/workers.unit.test.js: require the real singletons ONCE, spy on their
// methods BEFORE requiring daily-merkle.job.js (so its own destructuring captures the
// already-patched functions), and reset call state with mockClear()/mockReset() between
// tests rather than resetting the whole module registry.
const mongo = require('../../src/database/mongo');
const integrityService = require('../../src/services/integrityCheckService');
const auditRootService = require('../../src/services/auditRoot.service');
const auditV2Service = require('../../src/services/audit-v2.service');
const logger = require('../../src/utils/logger');
const env = require('../../src/config/env');

function makeFakeDb(previousTreeHeads = []) {
  return {
    __fakeDb: true,
    collection: vi.fn(() => ({
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          limit: vi.fn(() => ({
            toArray: vi.fn().mockResolvedValue(previousTreeHeads),
          })),
        })),
      })),
    })),
  };
}

vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
vi.spyOn(mongo, 'closeConnection').mockResolvedValue(undefined);
vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'deadbeef', leaves: ['leaf1', 'leaf2', 'leaf3'] });
vi.spyOn(auditRootService, 'saveDailyRoot').mockResolvedValue({ ok: true });
vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'existing' });
vi.spyOn(auditRootService, 'processTimestampBacklog').mockResolvedValue(undefined);
vi.spyOn(auditV2Service, 'createTreeHead').mockResolvedValue({ status: 'ok' });
vi.spyOn(auditV2Service, 'sealChain').mockResolvedValue({ treeSize: 2, anchorStatus: 'TIMESTAMPED' });
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
// #1468: connectDB's { __fakeDb: true } has no collection(), so a real
// recordJob would warn and break the logger.warn counts below. The job calls
// it on the module, so this spy intercepts it; its own behaviour is proven in
// tests/unit/infrastructure/metrics/jobMetrics.test.js.
const jobMetrics = require('../../src/infrastructure/metrics/jobMetrics');
const requestContext = require('../../src/utils/requestContext');
vi.spyOn(jobMetrics, 'recordJob').mockResolvedValue(undefined);
const { createFakeDb } = require('./foundation/helpers/fake-db');

// Single require: this is where the module's top-level auto scheduleNextRun() fires,
// captured harmlessly by fake timers (see the dedicated test below for that assertion).
const job = require('../../src/workers/jobs/daily-merkle.job');

function resetAllMocks() {
  mongo.connectDB.mockClear().mockResolvedValue({ __fakeDb: true });
  mongo.closeConnection.mockClear().mockResolvedValue(undefined);
  integrityService.buildMerkleForDate.mockClear().mockResolvedValue({ root: 'deadbeef', leaves: ['leaf1', 'leaf2', 'leaf3'] });
  auditRootService.saveDailyRoot.mockClear().mockResolvedValue({ ok: true });
  auditRootService.getRootByDate.mockClear().mockResolvedValue({ root: 'existing' });
  auditRootService.processTimestampBacklog.mockClear().mockResolvedValue(undefined);
  auditV2Service.createTreeHead.mockClear().mockResolvedValue({ status: 'ok' });
  auditV2Service.sealChain.mockClear().mockResolvedValue({ treeSize: 2, anchorStatus: 'TIMESTAMPED' });
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
  jobMetrics.recordJob.mockReset().mockResolvedValue(undefined);
}

describe('daily-merkle.job', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-02T10:00:00.000Z'));
    resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('module load side effect: require.main !== module in a test context, so the top-level auto-start guard does not fire', () => {
    // daily-merkle.job.js gates its top-level scheduleNextRun() call behind
    // `if (require.main === module)` (Denise's 8b0bf61e, replacing an env-var flag)
    // specifically so it only auto-starts when run directly as the process entry point.
    // Under vitest, require.main is the test runner's own entry script, not this module,
    // so the guard is false and require()'ing the module registers no timer at all.
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('runOnce', () => {
    it('happy path: generates root, saves it with correct args, and leaves the shared connection open', async () => {
      await job.runOnce();

      expect(mongo.connectDB).toHaveBeenCalledTimes(1);
      // targetDate should be yesterday (UTC) relative to system time 2026-07-02T10:00:00Z -> 2026-07-01
      expect(integrityService.buildMerkleForDate).toHaveBeenCalledWith(
        '2026-07-01',
        { __fakeDb: true },
        { persistMissing: true }
      );
      expect(auditRootService.saveDailyRoot).toHaveBeenCalledWith({
        date: '2026-07-01',
        root: 'deadbeef',
        treeSize: 3,
        db: { __fakeDb: true },
      });
      // connectDB() returns the worker's shared client; closing it here left
      // every later queue job failing with "Client must be connected".
      expect(mongo.closeConnection).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns and skips persistence when buildMerkleForDate resolves without a root, and leaves the shared connection open', async () => {
      integrityService.buildMerkleForDate.mockResolvedValue({ root: null, leaves: [] });

      await job.runOnce();

      // isValidMerkleResult() requires a truthy root; runOnce() returns before
      // saveDailyRoot when the result is invalid, so nothing gets persisted.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(auditRootService.saveDailyRoot).not.toHaveBeenCalled();
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    it('when connectDB throws: error is caught and logged, promise resolves (never rejects), closeConnection is not called', async () => {
      mongo.connectDB.mockRejectedValue(new Error('mongo down'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(mongo.closeConnection).not.toHaveBeenCalled();
      expect(integrityService.buildMerkleForDate).not.toHaveBeenCalled();
      expect(auditRootService.saveDailyRoot).not.toHaveBeenCalled();
    });

    it('when buildMerkleForDate throws: error is caught and logged, and the shared connection stays open', async () => {
      integrityService.buildMerkleForDate.mockRejectedValue(new Error('merkle build failed'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(mongo.closeConnection).not.toHaveBeenCalled();
      expect(auditRootService.saveDailyRoot).not.toHaveBeenCalled();
    });

    it('when saveDailyRoot throws: error is caught and logged, and the shared connection stays open', async () => {
      auditRootService.saveDailyRoot.mockRejectedValue(new Error('save failed'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });
  });

  // #1468 (RNF015 C1/C3): each run is recorded once, under its own id.
  describe('#1468 run metrics', () => {
    function captureRecords() {
      const records = [];
      jobMetrics.recordJob.mockImplementation(async (db, entry) => {
        records.push({ db, ...entry, requestId: requestContext.currentRequestId() });
      });
      return records;
    }

    it('records a completed run once, under a fresh well-formed correlation id', async () => {
      const records = captureRecords();
      const db = makeFakeDb([]);
      mongo.connectDB.mockResolvedValue(db);

      await requestContext.runAsJob('req-outer-0004', () => job.runOnce());

      expect(records).toHaveLength(1);
      expect(records[0].db).toBe(db);
      expect(records[0]).toMatchObject({ worker: 'daily-merkle', job: 'run', outcome: 'completed' });
      expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(requestContext.WELL_FORMED.test(records[0].requestId)).toBe(true);
      expect(records[0].requestId).not.toBe('req-outer-0004');
    });

    it('records an invalid Merkle result, which ends the run early, as completed', async () => {
      const records = captureRecords();
      integrityService.buildMerkleForDate.mockResolvedValue({ root: null, leaves: [] });

      await job.runOnce();

      expect(records.map((r) => r.outcome)).toEqual(['completed']);
    });

    it('records a run whose body throws as failed, and still resolves', async () => {
      const records = captureRecords();
      auditRootService.saveDailyRoot.mockRejectedValue(new Error('save failed'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ worker: 'daily-merkle', job: 'run', outcome: 'failed' });
    });

    it('records nothing when connectDB fails, and still resolves', async () => {
      const records = captureRecords();
      mongo.connectDB.mockRejectedValue(new Error('mongo down'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(records).toEqual([]);
    });
  });

  describe('anchorV2ForDate (exercised via runOnce)', () => {
    it('creates a tree head with previousTreeHeadHash=null when no prior tree head exists for the log', async () => {
      mongo.connectDB.mockResolvedValue(makeFakeDb([]));

      await job.runOnce();

      expect(auditV2Service.createTreeHead).toHaveBeenCalledWith(
        expect.objectContaining({ logId: 'audit-2026-07-01', previousTreeHeadHash: null }),
        expect.anything()
      );
    });

    // #1307: the audit_events chain is sealed on the same nightly run.
    it('seals the audit_events chain after anchoring the day', async () => {
      const db = makeFakeDb([]);
      mongo.connectDB.mockResolvedValue(db);

      await job.runOnce();

      expect(auditV2Service.sealChain).toHaveBeenCalledWith(db);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('carries forward previousTreeHeadHash from the most recent existing tree head', async () => {
      mongo.connectDB.mockResolvedValue(makeFakeDb([{ rootHash: 'priorhash' }]));

      await job.runOnce();

      expect(auditV2Service.createTreeHead).toHaveBeenCalledWith(
        expect.objectContaining({ logId: 'audit-2026-07-01', previousTreeHeadHash: 'priorhash' }),
        expect.anything()
      );
    });

    // #841: makeFakeDb hands back its heads whatever sort it gets, so it
    // cannot tell the largest tree from the first one stored. This store
    // sorts, and holds the log's heads out of order beside another log's.
    it('carries forward the largest tree head among heads stored out of order', async () => {
      const db = createFakeDb();
      const heads = db.collection('audit_tree_heads');
      for (const [logId, treeSize] of [['audit-2026-07-01', 2], ['audit-2026-07-01', 5], ['audit-2026-07-01', 1], ['audit-2026-06-30', 9]]) {
        await heads.insertOne({ logId, treeSize, rootHash: `${logId}-root-${treeSize}` });
      }

      await job.anchorDate(db, '2026-07-01');

      expect(auditV2Service.createTreeHead).toHaveBeenCalledWith(
        expect.objectContaining({ logId: 'audit-2026-07-01', previousTreeHeadHash: 'audit-2026-07-01-root-5' }),
        db
      );
    });
  });

  describe('recoverMissingDates (exercised via runOnce)', () => {
    it('skips backfill dates that already have a saved root, without recomputing them', async () => {
      mongo.connectDB.mockResolvedValue(makeFakeDb([]));
      auditRootService.getRootByDate.mockResolvedValue({ root: 'already-there' });

      await job.runOnce();

      // Only the main targetDate's buildMerkleForDate call happens; no backfill date
      // ever reaches buildMerkleForDate since getRootByDate short-circuits every one.
      expect(integrityService.buildMerkleForDate).toHaveBeenCalledTimes(1);
    });

    it('warns and continues for a backfill date whose recomputed Merkle result is invalid, without persisting it', async () => {
      mongo.connectDB.mockResolvedValue(makeFakeDb([]));
      auditRootService.getRootByDate.mockResolvedValue(null);
      integrityService.buildMerkleForDate.mockImplementation((date) =>
        date === '2026-07-01'
          ? Promise.resolve({ root: 'deadbeef', leaves: ['leaf1'] })
          : Promise.resolve({ root: null, leaves: [] })
      );

      await job.runOnce();

      // 1 main date + 7 backfill dates, all invalid except the main one.
      expect(logger.warn).toHaveBeenCalledTimes(7);
      expect(auditRootService.saveDailyRoot).toHaveBeenCalledTimes(1);
    });

    it('recomputes, saves, and re-anchors a backfill date with no existing root and a valid Merkle result', async () => {
      mongo.connectDB.mockResolvedValue(makeFakeDb([]));
      auditRootService.getRootByDate.mockImplementation((date) => Promise.resolve(date === '2026-06-25' ? null : { root: 'already-there' }));

      await job.runOnce();

      expect(auditRootService.saveDailyRoot).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-06-25' })
      );
      expect(auditV2Service.createTreeHead).toHaveBeenCalledWith(
        expect.objectContaining({ logId: 'audit-2026-06-25' }),
        expect.anything()
      );
    });
  });

  describe('scheduleNextRun', () => {
    it('schedules a setTimeout with a positive delay (msUntilNextRun() + 1000ms buffer)', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      job.scheduleNextRun();

      expect(setTimeoutSpy).toHaveBeenCalled();
      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      const delay = lastCall[1];
      expect(delay).toBeGreaterThan(1000); // must include the +1000ms buffer at minimum
      expect(delay).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000); // never more than a day + buffer

      setTimeoutSpy.mockRestore();
    });

    it('computes a delay that lands at 02:30 UTC later today when current time is before 02:30 UTC', () => {
      vi.setSystemTime(new Date('2026-07-02T01:00:00.000Z')); // before 02:30 UTC
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      job.scheduleNextRun();

      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      const delay = lastCall[1];
      // From 01:00 UTC to 02:30 UTC today = 90 minutes = 5,400,000 ms, plus 1000ms buffer
      expect(delay).toBe(90 * 60 * 1000 + 1000);

      setTimeoutSpy.mockRestore();
    });

    it('computes a delay that rolls over to 02:30 UTC tomorrow when current time is after 02:30 UTC', () => {
      vi.setSystemTime(new Date('2026-07-02T10:00:00.000Z')); // after 02:30 UTC
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      job.scheduleNextRun();

      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      const delay = lastCall[1];
      // From 10:00 UTC today to 02:30 UTC tomorrow = 16h30m = 59,400,000 ms, plus 1000ms buffer
      expect(delay).toBe((16 * 60 + 30) * 60 * 1000 + 1000);

      setTimeoutSpy.mockRestore();
    });

    it('computes a delay of a full day + buffer when current time is precisely 02:30:00.000 UTC (next <= now rolls to tomorrow)', () => {
      vi.setSystemTime(new Date('2026-07-02T02:30:00.000Z')); // exactly 02:30 UTC
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      job.scheduleNextRun();

      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      const delay = lastCall[1];
      expect(delay).toBe(24 * 60 * 60 * 1000 + 1000);

      setTimeoutSpy.mockRestore();
    });

    it('the scheduled timer callback runs runOnce and then reschedules again', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      job.scheduleNextRun();
      const callCountBeforeFire = setTimeoutSpy.mock.calls.length;

      await vi.runOnlyPendingTimersAsync();

      // runOnce should have executed (connectDB called) and a new setTimeout should
      // have been scheduled again (reschedule-always behavior), even though runOnce's
      // own internal try/catch already swallows errors and never rejects.
      expect(mongo.connectDB).toHaveBeenCalled();
      expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(callCountBeforeFire);

      setTimeoutSpy.mockRestore();
    });
  });

  // #959: anchorDate is the reachable entry point. runOnce() cannot serve an HTTP
  // caller for two reasons these cases pin: it computes YESTERDAY rather than
  // taking a date, and its finally block calls closeConnection() -- which, called
  // from a request handler, would tear down the connection the whole app shares.
  describe('anchorDate (#959)', () => {
    beforeEach(() => { resetAllMocks(); });

    it('seals the SUPPLIED date, not yesterday', async () => {
      const db = makeFakeDb();

      await job.anchorDate(db, '2026-06-15');

      // System time is 2026-07-02, so runOnce would have sealed 2026-07-01.
      expect(integrityService.buildMerkleForDate).toHaveBeenCalledWith('2026-06-15', db, { persistMissing: true });
      expect(auditRootService.saveDailyRoot).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-06-15' })
      );
      expect(auditV2Service.createTreeHead).toHaveBeenCalledWith(
        expect.objectContaining({ logId: 'audit-2026-06-15' }),
        db
      );
    });

    it('uses the db it is handed and never opens or closes its own connection', async () => {
      const db = makeFakeDb();

      await job.anchorDate(db, '2026-06-15');

      expect(mongo.connectDB).not.toHaveBeenCalled();
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    it('returns null and persists nothing when the Merkle result is invalid', async () => {
      integrityService.buildMerkleForDate.mockResolvedValueOnce({ root: null, leaves: null });
      const db = makeFakeDb();

      const result = await job.anchorDate(db, '2026-06-15');

      expect(result).toBeNull();
      expect(auditRootService.saveDailyRoot).not.toHaveBeenCalled();
      expect(auditV2Service.createTreeHead).not.toHaveBeenCalled();
    });
  });

  // #989: the catch in runOnce() swallows every error into one generic line, so a
  // missing audit signing key -- a configuration error that never clears on its own
  // and silently stops every daily root and tree head from being sealed -- is
  // indistinguishable in the log from "Mongo blipped". These cases pin the two
  // shapes apart. The swallow itself is deliberate and unchanged: scheduleNextRun()
  // documents that runOnce() never rejects, and a rethrow would both become an
  // unhandled rejection in a detached setTimeout and skip the reschedule.
  describe('#989: signing-key configuration errors get their own log shape', () => {
    it('CONTROL: an ordinary failure still logs the generic job-error line', async () => {
      auditRootService.saveDailyRoot.mockRejectedValue(new Error('connection 3 to mongodb:27017 closed'));

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message] = logger.error.mock.calls[0];
      expect(message).toContain('Erro ao executar job');
      expect(message).not.toContain('AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE');
    });

    it("merkle-envelope's missing-key throw is reported as a configuration error naming the variables", async () => {
      auditRootService.saveDailyRoot.mockRejectedValue(
        new Error('Audit signing key must be provided via AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE')
      );

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message] = logger.error.mock.calls[0];
      expect(message).toContain('chave de assinatura');
      expect(message).toContain('AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE');
      expect(message).toContain('AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON');
    });

    it("audit-signing.provider's missing-key-id throw is reported as a configuration error", async () => {
      // anchorV2ForDate reads db.collection('audit_tree_heads') before calling
      // createTreeHead, so this case needs the full fake db, not connectDB's default.
      mongo.connectDB.mockResolvedValue(makeFakeDb([]));
      auditV2Service.createTreeHead.mockRejectedValue(
        new Error('AUDIT_MERKLE_SIGN_KEY_ID nao configurado')
      );

      await expect(job.runOnce()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message] = logger.error.mock.calls[0];
      expect(message).toContain('chave de assinatura');
    });

    it('an unreadable key file at the CONFIGURED path is reported as a configuration error', async () => {
      const originalKeyFile = env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE;
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '/run/secrets/merkle_signing_key.pem';
      const enoent = new Error("ENOENT: no such file or directory, open '/run/secrets/merkle_signing_key.pem'");
      enoent.code = 'ENOENT';
      enoent.path = '/run/secrets/merkle_signing_key.pem';
      auditRootService.saveDailyRoot.mockRejectedValue(enoent);

      try {
        await expect(job.runOnce()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledTimes(1);
        const [message] = logger.error.mock.calls[0];
        expect(message).toContain('chave de assinatura');
      } finally {
        env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = originalKeyFile;
      }
    });

    it('CONTROL: an ENOENT on some OTHER path is NOT reported as a signing-key problem', async () => {
      const originalKeyFile = env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE;
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '/run/secrets/merkle_signing_key.pem';
      const enoent = new Error("ENOENT: no such file or directory, open '/workspace/artifacts/whatever.json'");
      enoent.code = 'ENOENT';
      enoent.path = '/workspace/artifacts/whatever.json';
      auditRootService.saveDailyRoot.mockRejectedValue(enoent);

      try {
        await expect(job.runOnce()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledTimes(1);
        const [message] = logger.error.mock.calls[0];
        expect(message).toContain('Erro ao executar job');
      } finally {
        env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = originalKeyFile;
      }
    });
  });
});
