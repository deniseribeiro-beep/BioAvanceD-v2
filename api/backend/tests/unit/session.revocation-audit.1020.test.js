import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// #1020: every session revocation writes one audit row from inside
// session.service, with the reason in `message` and the owner's pseudonym in
// `resourceId` (the fields the audit chain keeps), never in `payload`.
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { generateAnonId } = require('../../src/utils/userAnonymization');

const ORIGINAL_SALT = process.env.USER_ANON_SALT;
beforeAll(() => { process.env.USER_ANON_SALT = 'test-salt-1020'; });
afterAll(() => {
  if (ORIGINAL_SALT === undefined) delete process.env.USER_ANON_SALT;
  else process.env.USER_ANON_SALT = ORIGINAL_SALT;
});

function makeDb({ modifiedCount = 1, matchedCount = 1, sessionDoc = null, securityConfig = null } = {}) {
  const sessions = {
    updateOne: vi.fn(async () => ({ matchedCount, modifiedCount })),
    updateMany: vi.fn(async () => ({ matchedCount: modifiedCount, modifiedCount })),
    findOne: vi.fn(async () => sessionDoc),
  };
  const users = { findOne: vi.fn(async () => null) };
  const config = { findOne: vi.fn(async () => securityConfig) };
  const collection = (name) => (name === 'sessions' ? sessions : name === 'security_config' ? config : users);
  return { db: { collection }, sessions };
}

let logSpy;
beforeEach(() => {
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  sessionService.sessions.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionService.sessions.clear();
});

describe('session revocation audit rows (#1020)', () => {
  it('invalidateUserSessions: one row naming reason and count, owner pseudonym as resourceId, actor from revokedBy', async () => {
    const { db } = makeDb({ modifiedCount: 2 });
    const count = await sessionService.invalidateUserSessions(db, 'owner-1', 'admin_action', 'admin-9');
    expect(count).toBe(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const row = logSpy.mock.calls[0][0];
    expect(row).toMatchObject({
      action: 'UPDATE',
      resourceType: 'Session',
      resourceId: generateAnonId('owner-1'),
      severity: 'warning',
      message: 'Sessão revogada: motivo admin_action; sessões afetadas 2',
      req: { user: { userID: 'admin-9' } },
    });
    expect(row.payload).toBeUndefined();
    expect(row.message).not.toContain('USR-');
  });

  it('passes the caller\'s req through when it has one', async () => {
    const { db } = makeDb();
    const req = { user: { userID: 'admin-9' }, headers: {}, ip: '10.0.0.1' };
    await sessionService.invalidateUserSessions(db, 'owner-1', 'risk', 'admin-9', { req });
    expect(logSpy.mock.calls[0][0].req).toBe(req);
    expect(logSpy.mock.calls[0][0].message).toContain('motivo risk');
  });

  it('writes nothing when no session actually changed', async () => {
    const { db } = makeDb({ modifiedCount: 0 });
    await sessionService.invalidateUserSessions(db, 'owner-1', 'admin_action', 'admin-9');
    expect(logSpy).not.toHaveBeenCalled();
  });

  // #1249: dict-02 P1X-0296 session.logExpiration (default true) records
  // expiries in the audit trail; #1020 had left them out.
  it('audits an expiry while session.logExpiration is on, the default', async () => {
    const { db } = makeDb({ sessionDoc: { userAccountId: 'owner-1' } });
    await sessionService.invalidateSession(db, 'sess-1', 'expiration', 'system');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      resourceId: generateAnonId('owner-1'),
      severity: 'info',
      message: 'Sessão revogada: motivo expiration; sessões afetadas 1',
      req: null,
    });
  });

  it('does not audit an expiry while session.logExpiration is off', async () => {
    const { db } = makeDb({ securityConfig: { _id: 'main', session: { logExpiration: false } } });
    await sessionService.invalidateSession(db, 'sess-1', 'expiration', 'system');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logExpiration off leaves every other reason audited', async () => {
    const { db } = makeDb({ securityConfig: { _id: 'main', session: { logExpiration: false } } });
    await sessionService.invalidateSession(db, 'sess-1', 'user_request', 'owner-1');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('the maintenance sweep writes one row with the count it expired', async () => {
    const { db } = makeDb({ modifiedCount: 3 });
    await sessionService.cleanupExpiredSessions(db);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].message).toBe('Sessão revogada: motivo expiration; sessões afetadas 3');
  });

  it('invalidateSession (logout): owner read back from the stored session, reason user_request, severity info', async () => {
    const { db } = makeDb({ sessionDoc: { userAccountId: 'owner-2' } });
    await sessionService.invalidateSession(db, 'sess-2', 'user_request', 'owner-2');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      resourceId: generateAnonId('owner-2'),
      severity: 'info',
      message: 'Sessão revogada: motivo user_request; sessões afetadas 1',
    });
  });

  it('revokeSessionById: audited only when a session matched', async () => {
    const hit = makeDb({ matchedCount: 1 });
    expect(await sessionService.revokeSessionById(hit.db, 'owner-3', 'sess-3', 'user_request', 'owner-3')).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockClear();
    const miss = makeDb({ matchedCount: 0, modifiedCount: 0 });
    expect(await sessionService.revokeSessionById(miss.db, 'owner-3', 'sess-x', 'user_request', 'owner-3')).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('revokeAllOtherSessions (password change): reason and count', async () => {
    const { db } = makeDb({ modifiedCount: 3 });
    await sessionService.revokeAllOtherSessions(db, 'owner-4', 'current-token', 'password_change', 'owner-4');
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      resourceId: generateAnonId('owner-4'),
      severity: 'info',
      message: 'Sessão revogada: motivo password_change; sessões afetadas 3',
    });
  });

  it('revokeAllSessionsForPolicyChange: many owners, so no single resourceId', async () => {
    const { db } = makeDb({ modifiedCount: 7 });
    const count = await sessionService.revokeAllSessionsForPolicyChange(db, 'admin-token', 'admin-9');
    expect(count).toBe(7);
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      resourceId: null,
      message: 'Sessão revogada: motivo admin_action; sessões afetadas 7',
    });
  });

  it('a system actor is not dressed up as a person', async () => {
    const { db } = makeDb();
    await sessionService.invalidateUserSessions(db, 'owner-5', 'password_change', 'system');
    expect(logSpy.mock.calls[0][0].req).toBeNull();
  });

  it('an audit failure never fails the revocation', async () => {
    logSpy.mockRejectedValue(new Error('audit store down'));
    const { db } = makeDb({ modifiedCount: 1 });
    await expect(sessionService.invalidateUserSessions(db, 'owner-6', 'risk', 'admin-9')).resolves.toBe(1);
  });
});
