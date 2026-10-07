import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-de-teste-1255';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'key-teste';

const ipAttemptService = require('../../src/services/ipAttempt.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const auditLogger = require('../../src/utils/auditLogger');

// #1255/#1256: a fake of the five operations ipAttempt.service issues, with
// the semantics MongoDB gives them. The operator semantics themselves were
// checked against a real mongod (commit message), so this fake only has to
// be faithful to that, not to Mongo in general.
function makeStore(config) {
  const rows = new Map();
  const blockedNow = (row, now) => row.blockedUntil && row.blockedUntil > now;
  const attempts = {
    createIndex: vi.fn().mockResolvedValue('login_ip_attempts_ttl'),
    findOne: vi.fn(async ({ _id }) => (rows.has(_id) ? { ...rows.get(_id) } : null)),
    updateOne: vi.fn(async (filter, update) => {
      const row = rows.get(filter._id);
      if (!row) return { matchedCount: 0 };
      if (filter.windowStart && !(row.windowStart <= filter.windowStart.$lte)) return { matchedCount: 0 };
      if (filter.$or && blockedNow(row, filter.$or[1].blockedUntil.$lte)) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    }),
    findOneAndUpdate: vi.fn(async ({ _id }, update) => {
      let row = rows.get(_id);
      if (!row) {
        row = { _id, failures: 0, accounts: [], ...update.$setOnInsert };
        rows.set(_id, row);
      }
      row.failures += update.$inc.failures;
      Object.assign(row, update.$set);
      if (update.$addToSet && !row.accounts.includes(update.$addToSet.accounts)) {
        row.accounts.push(update.$addToSet.accounts);
      }
      return { ...row, accounts: [...row.accounts] };
    }),
  };
  const securityConfig = { findOne: vi.fn().mockResolvedValue(config) };
  const db = {
    collection: vi.fn((name) => (name === 'security_config' ? securityConfig : attempts)),
  };
  return { db, rows, attempts, securityConfig };
}

const req = (ip = '203.0.113.7') => ({ ip });

const config = (overrides = {}) => ({
  _id: 'main',
  authentication: { maxLoginAttempts: 5, lockoutDurationMinutes: 30 },
  loginAttempts: { trackIP: true, blockIPAfterAttempts: 10, ...(overrides.loginAttempts || {}) },
  enhancedSecurity: { enabled: false, blockUnusualActivity: true, ...(overrides.enhancedSecurity || {}) },
});

async function fail(db, times, { ip, identifier = 'id:same-account' } = {}) {
  for (let i = 0; i < times; i += 1) {
    await ipAttemptService.recordFailedSourceAttempt(db, req(ip), typeof identifier === 'function' ? identifier(i) : identifier);
  }
}

beforeEach(() => {
  ipAttemptService._resetTtlIndexFlag();
  vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('#1255 blockIPAfterAttempts', () => {
  it('blocks a source on its blockIPAfterAttempts-th failure, not before', async () => {
    const { db } = makeStore(config());
    await fail(db, 9);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
    await fail(db, 1);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(true);
  });

  it('blocks only the failing source', async () => {
    const { db } = makeStore(config());
    await fail(db, 10);
    expect(await ipAttemptService.isSourceBlocked(db, req('198.51.100.1'))).toBe(false);
  });

  it('stores a keyed hash of the address and the accounts, never the address', async () => {
    const { db, rows, attempts } = makeStore(config());
    await fail(db, 1, { identifier: 'name:alice@example.com' });
    const [row] = [...rows.values()];
    expect(row._id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    expect(JSON.stringify(row)).not.toContain('alice');
    expect(row.expiresAt.getTime() - row.windowStart.getTime()).toBe(30 * 60 * 1000);
    expect(attempts.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 }));
  });

  it('a window that has ended starts the count over', async () => {
    const { db, rows } = makeStore(config());
    await fail(db, 9);
    const [row] = [...rows.values()];
    row.windowStart = new Date(Date.now() - 31 * 60 * 1000);
    await fail(db, 1);
    expect(row.failures).toBe(1);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });

  it('an expired block lifts, and a running block is not reset by the window', async () => {
    const { db, rows } = makeStore(config());
    await fail(db, 10);
    const [row] = [...rows.values()];
    row.windowStart = new Date(Date.now() - 31 * 60 * 1000);
    await fail(db, 1);
    expect(row.failures).toBe(11);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(true);
    row.blockedUntil = new Date(Date.now() - 1000);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });

  it('trackIP false stores nothing and lifts an existing block', async () => {
    const off = config({ loginAttempts: { trackIP: false } });
    const { db, rows, securityConfig } = makeStore(config());
    await fail(db, 10);
    securityConfig.findOne.mockResolvedValue(off);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
    rows.clear();
    await fail(db, 3);
    expect(rows.size).toBe(0);
  });

  it('blockIPAfterAttempts 0 tracks without blocking', async () => {
    const { db, rows } = makeStore(config({ loginAttempts: { blockIPAfterAttempts: 0 } }));
    await fail(db, 25);
    expect([...rows.values()][0].failures).toBe(25);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });

  it('a missing security_config applies the canonical defaults (track, block after 10)', async () => {
    const { db } = makeStore(null);
    await fail(db, 10);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(true);
  });

  it('fails open: an unreadable store neither throws nor blocks', async () => {
    const { db, attempts } = makeStore(config());
    attempts.findOne.mockRejectedValue(new Error('down'));
    attempts.findOneAndUpdate.mockRejectedValue(new Error('down'));
    await expect(ipAttemptService.recordFailedSourceAttempt(db, req(), 'id:x')).resolves.toBeUndefined();
    await expect(ipAttemptService.isSourceBlocked(db, req())).resolves.toBe(false);
  });

  it('a request with no address is neither counted nor blocked', async () => {
    const { db, rows } = makeStore(config());
    await ipAttemptService.recordFailedSourceAttempt(db, {}, 'id:x');
    expect(rows.size).toBe(0);
    expect(await ipAttemptService.isSourceBlocked(db, {})).toBe(false);
  });
});

describe('#1256 blockUnusualActivity: one source failing against many accounts', () => {
  const spray = (i) => `name:user${i}@example.com`;

  it('blocks a source that fails against maxLoginAttempts distinct accounts, with an audit row and a notification', async () => {
    const { db } = makeStore(config({ enhancedSecurity: { enabled: true } }));
    await fail(db, 4, { identifier: spray });
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
    await fail(db, 1, { identifier: (i) => spray(i + 4) });
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(true);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN', severity: 'critical', payload: expect.objectContaining({ reason: 'unusual_activity', distinctAccounts: 5 }),
    }));
    expect(notificationDispatchService.dispatchNotification).toHaveBeenCalledWith(db, expect.objectContaining({
      eventType: 'unusual_activity_block',
    }));
  });

  it('repeated failures against one account are not unusual activity', async () => {
    const { db } = makeStore(config({ enhancedSecurity: { enabled: true } }));
    await fail(db, 9);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
    expect(notificationDispatchService.dispatchNotification).not.toHaveBeenCalled();
  });

  it('is read only while the enhanced mode is enabled', async () => {
    const { db } = makeStore(config({ enhancedSecurity: { enabled: false } }));
    await fail(db, 6, { identifier: spray });
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });

  it('is off when blockUnusualActivity is false inside the enabled mode', async () => {
    const { db } = makeStore(config({ enhancedSecurity: { enabled: true, blockUnusualActivity: false } }));
    await fail(db, 6, { identifier: spray });
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });

  it('needs trackIP: with tracking off there is no store to detect from', async () => {
    const { db, rows } = makeStore(config({ loginAttempts: { trackIP: false }, enhancedSecurity: { enabled: true } }));
    await fail(db, 6, { identifier: spray });
    expect(rows.size).toBe(0);
    expect(await ipAttemptService.isSourceBlocked(db, req())).toBe(false);
  });
});
