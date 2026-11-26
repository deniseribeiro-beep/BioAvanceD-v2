import { describe, it, expect, beforeEach, vi } from 'vitest';
const sessionService = require('../../src/services/session.service');
const { createMatchingCollection } = require('../factories/filter.factory');

function makeCollection(overrides = {}) {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    find: vi.fn(),
    ...overrides
  };
}

function makeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) };
}

// An active, unexpired session document; overrides set its identity.
function liveSession(overrides = {}) {
  return {
    isActive: true,
    isRevoked: false,
    expiresAt: new Date(Date.now() + 10000),
    refreshExpiresAt: new Date(Date.now() + 10000),
    lastActivityAt: new Date(),
    inactivityTimeoutMs: 30 * 60 * 1000,
    ...overrides
  };
}

// #1330: an active session document under the canonical names that still
// carries all six legacy ones beside them, as one restored from data older
// than the migration would. #1386: only the canonical names are read; a write
// removes the legacy ones.
function sessionWithLegacyNames({ sessionId, userAccountId, accessTokenHash, ...overrides }) {
  const startedAt = new Date(Date.now() - 60 * 1000);
  const lastActivityAt = new Date();
  return liveSession({
    sessionId,
    userAccountId,
    accessTokenHash,
    lastActivityAt,
    sessionStartedAt: startedAt,
    inactivityTimeoutMs: 20 * 60 * 1000,
    sessionID: sessionId,
    userID: userAccountId,
    tokenHash: accessTokenHash,
    lastActivity: lastActivityAt,
    createdAt: startedAt,
    inactiveTimeout: 20 * 60 * 1000,
    ...overrides
  });
}

// #1386: an active session document carrying the legacy names only.
function legacyOnlySession(overrides = {}) {
  return {
    isActive: true,
    isRevoked: false,
    expiresAt: new Date(Date.now() + 10000),
    refreshExpiresAt: new Date(Date.now() + 10000),
    lastActivity: new Date(),
    createdAt: new Date(Date.now() - 60 * 1000),
    inactiveTimeout: 20 * 60 * 1000,
    ...overrides
  };
}

// The filters that find a session under its canonical names.
const byId = (sessionId) => ({ sessionId });
const byOwner = (userAccountId) => ({ userAccountId });
const byAccessHash = (hash) => ({ accessTokenHash: hash });

describe('SessionService.getTokenHash', () => {
  it('returns 64-char hex string', () => {
    const hash = sessionService.getTokenHash('test-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for same input', () => {
    expect(sessionService.getTokenHash('abc')).toBe(sessionService.getTokenHash('abc'));
  });

  it('differs for different tokens', () => {
    expect(sessionService.getTokenHash('token-a')).not.toBe(sessionService.getTokenHash('token-b'));
  });

  it('handles null gracefully', () => {
    expect(() => sessionService.getTokenHash(null)).not.toThrow();
    expect(sessionService.getTokenHash(null)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('SessionService.extractBrowser', () => {
  it('returns Desconhecido for null', () => {
    expect(sessionService.extractBrowser(null)).toBe('Desconhecido');
  });

  it('detects Chrome', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Chrome/110.0.0.0')).toBe('Chrome');
  });

  it('detects Edge (prioritized over Chrome)', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Chrome/110 Edg/110.0')).toBe('Edge');
  });

  it('detects Firefox', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Firefox/109.0')).toBe('Firefox');
  });

  it('detects Safari (no Chrome)', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Safari/605.1.15')).toBe('Safari');
  });

  it('returns Desconhecido for unknown UA', () => {
    expect(sessionService.extractBrowser('SomeOtherBrowser/1.0')).toBe('Desconhecido');
  });
});

describe('SessionService.extractOS', () => {
  it('returns Desconhecido for null', () => {
    expect(sessionService.extractOS(null)).toBe('Desconhecido');
  });

  it('detects Windows', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('detects macOS', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
  });

  it('detects iOS for iPhone', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)')).toBe('iOS');
  });

  it('detects iOS for iPad', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (iPad; CPU OS 14_0)')).toBe('iOS');
  });

  it('detects Linux', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });
});

describe('SessionService.extractDeviceName', () => {
  it('returns Dispositivo Desconhecido for null', () => {
    expect(sessionService.extractDeviceName(null)).toBe('Dispositivo Desconhecido');
  });

  it('returns Dispositivo Móvel for mobile UA', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 14)')).toBe('Dispositivo Móvel');
  });

  it('returns Dispositivo Móvel for Android', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (Linux; Android 11)')).toBe('Dispositivo Móvel');
  });

  it('returns Desktop for non-mobile UA', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Desktop');
  });
});

describe('SessionService.extractClientInfo', () => {
  it('returns N/A ip and Desconhecido defaults for null req', () => {
    const result = sessionService.extractClientInfo(null);
    expect(result.ipAddress).toBe('N/A');
    expect(result.userAgent).toBeNull();
    expect(result.deviceInfo.browser).toBe('Desconhecido');
    expect(result.deviceInfo.os).toBe('Desconhecido');
  });

  it('extracts ip from x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1', 'user-agent': 'Chrome/110' },
      ip: null,
    };
    const result = sessionService.extractClientInfo(req);
    expect(result.ipAddress).toBe('192.168.1.1');
  });

  it('extracts user-agent info', () => {
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/110.0.0.0' },
      ip: '127.0.0.1',
    };
    const result = sessionService.extractClientInfo(req);
    expect(result.userAgent).toContain('Chrome');
    expect(result.deviceInfo.browser).toBe('Chrome');
  });
});

// #914 / RF014 AC#1: `session.timeoutMinutes` is one of the 43 SecurityConfiguration
// keys that nothing read. dict-02 P1X-0262 says Session.inactivityTimeoutMs "deve derivar
// de SecurityConfiguration" and calls it the EFECTIVE limit -- a materialised value,
// which is why it is snapshotted onto the session at creation rather than read live
// on every request. The snapshot choice is also what keeps #649's session
// revocation meaningful: under a live read a tightened timeout would apply
// instantly and the revocation would have nothing left to revoke on this path.
describe('#914: session.timeoutMinutes drives inactivityTimeoutMs', () => {
  beforeEach(() => { sessionService.sessions.clear(); });

  function dbWith(securityConfig, collection) {
    return {
      collection: vi.fn((name) => (name === 'security_config'
        ? { findOne: vi.fn().mockResolvedValue(securityConfig) }
        : collection)),
    };
  }

  it('snapshots the configured timeout onto the session, not the hardcoded 30 minutes', async () => {
    const collection = makeCollection();
    const db = dbWith({ _id: 'main', session: { timeoutMinutes: 45 } }, collection);

    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);

    expect(session.inactivityTimeoutMs).toBe(45 * 60 * 1000);
  });

  // #1247: dict-02 P1X-0313, "Timeout substitutivo no perfil reforçado".
  it('takes enhancedSecurity.sessionTimeoutMinutes while the mode is on', async () => {
    const collection = makeCollection();
    const db = dbWith({ _id: 'main', session: { timeoutMinutes: 45 }, enhancedSecurity: { enabled: true, sessionTimeoutMinutes: 15 } }, collection);
    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);
    expect(session.inactivityTimeoutMs).toBe(15 * 60 * 1000);
  });

  it('ignores enhancedSecurity.sessionTimeoutMinutes while the mode is off', async () => {
    const collection = makeCollection();
    const db = dbWith({ _id: 'main', session: { timeoutMinutes: 45 }, enhancedSecurity: { enabled: false, sessionTimeoutMinutes: 15 } }, collection);
    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);
    expect(session.inactivityTimeoutMs).toBe(45 * 60 * 1000);
  });

  it('falls back to 30 minutes when the policy is unreadable, rather than locking everyone out', async () => {
    const collection = makeCollection();
    const db = {
      collection: vi.fn((name) => (name === 'security_config'
        ? { findOne: vi.fn().mockRejectedValue(new Error('config unavailable')) }
        : collection)),
    };

    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);

    expect(session.inactivityTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('the maintenance sweep compares against each session\'s OWN inactivityTimeoutMs, not a global literal', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.cleanupExpiredSessions(db);

    const [filter] = collection.updateMany.mock.calls[0];
    const inactivityClause = filter.$or.find((c) => c.$expr);
    // Before #914 this clause was { lastActivity: { $lt: now - 30min } } -- a global
    // 30-minute literal that ignored the per-session field entirely, so the sweep
    // would evict a session whose configured timeout was 45 minutes.
    expect(inactivityClause).toBeDefined();
    // #1386: the canonical names only.
    expect(inactivityClause.$expr.$lt[0]).toEqual('$lastActivityAt');
    expect(inactivityClause.$expr.$lt[1].$subtract[1]).toEqual({
      $ifNull: ['$inactivityTimeoutMs', 30 * 60 * 1000]
    });
  });
});

// #914 / RF014 AC#1, RNF021 AC#3: session.maxSessionDurationHours (dict-02
// P1X-0293, "Duração máxima absoluta") is carried by refreshExpiresAt, set once
// at creation from sessionStartedAt and never extended by rotation. Before this,
// rotateSessionTokens reset it to now + 7 days on every refresh, so no session
// ever had to end.
describe('#914: session.maxSessionDurationHours is an absolute cap', () => {
  const HOUR = 60 * 60 * 1000;
  beforeEach(() => { sessionService.sessions.clear(); });

  function dbWith(securityConfig, collection) {
    return {
      collection: vi.fn((name) => (name === 'security_config'
        ? { findOne: vi.fn().mockResolvedValue(securityConfig) }
        : collection)),
    };
  }

  it('sets refreshExpiresAt to sessionStartedAt + the configured cap, not + 7 days', async () => {
    const db = dbWith({ _id: 'main', session: { maxSessionDurationHours: 4 } }, makeCollection());

    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);

    expect(session.refreshExpiresAt.getTime() - session.sessionStartedAt.getTime()).toBe(4 * HOUR);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(session.refreshExpiresAt.getTime());
  });

  it("falls back to getDefaultConfig()'s 12 hours when the policy has no cap", async () => {
    const db = dbWith(null, makeCollection());

    const session = await sessionService.createSession(db, 'user-1', 'a', 'r', null);

    expect(session.refreshExpiresAt.getTime() - session.sessionStartedAt.getTime()).toBe(12 * HOUR);
  });

  it('never lets the access token outlive the cap', async () => {
    // The cap is reached 10 minutes from now: the next rotation must clamp the
    // 15-minute access token to the cap, not issue one past it.
    const collection = makeCollection();
    const ceiling = new Date(Date.now() + 10 * 60 * 1000);

    await sessionService.rotateSessionTokens(makeDb(collection), 's1', 'acc', 'ref', { sessionId: 's1', refreshExpiresAt: ceiling });

    const [, { $set }] = collection.updateOne.mock.calls[0];
    expect($set.refreshExpiresAt.getTime()).toBe(ceiling.getTime());
    expect($set.expiresAt.getTime()).toBe(ceiling.getTime());
  });

  it("rotation keeps the session's ceiling instead of sliding it forward", async () => {
    const collection = makeCollection();
    const ceiling = new Date(Date.now() + 3 * HOUR);

    await sessionService.rotateSessionTokens(makeDb(collection), 's1', 'acc', 'ref', { sessionId: 's1', refreshExpiresAt: ceiling });

    const [, { $set }] = collection.updateOne.mock.calls[0];
    expect($set.refreshExpiresAt.getTime()).toBe(ceiling.getTime());
    expect($set.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('reads the ceiling from the stored session when the caller does not pass it', async () => {
    const ceiling = new Date(Date.now() + 2 * HOUR);
    const collection = makeCollection({ findOne: vi.fn().mockResolvedValue({ sessionId: 's1', refreshExpiresAt: ceiling }) });

    await sessionService.rotateSessionTokens(makeDb(collection), 's1', 'acc', 'ref');

    expect(collection.findOne).toHaveBeenCalledWith(byId('s1'));
    const [, { $set }] = collection.updateOne.mock.calls[0];
    expect($set.refreshExpiresAt.getTime()).toBe(ceiling.getTime());
  });

  it('a session already past its cap is refused by verifySession', async () => {
    const now = Date.now();
    const session = {
      sessionId: 's-capped', userAccountId: 'u1', accessTokenHash: sessionService.getTokenHash('capped-tok'),
      isActive: true, isRevoked: false, lastActivityAt: new Date(now - 1000), inactivityTimeoutMs: 30 * 60 * 1000,
      sessionStartedAt: new Date(now - 5 * HOUR), expiresAt: new Date(now + 60 * 1000), refreshExpiresAt: new Date(now - 1000),
    };
    sessionService.sessions.set(session.sessionId, session);

    const result = await sessionService.verifySession(makeDb(makeCollection()), 'capped-tok');

    expect(result).toEqual({ valid: false, reason: 'session_expired' });
  });
});

describe('SessionService.createSession', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('creates, caches, and persists a session', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    const session = await sessionService.createSession(db, 'user-1', 'access-tok', 'refresh-tok', null);

    expect(session.userAccountId).toBe('user-1');
    expect(session.accessTokenHash).toBe(sessionService.getTokenHash('access-tok'));
    expect(session.refreshTokenHash).toBe(sessionService.getTokenHash('refresh-tok'));
    expect(sessionService.sessions.get(session.sessionId)).toBe(session);
    expect(collection.insertOne).toHaveBeenCalledWith(session);
  });

  it('#1330: stores the new session under the canonical names only', async () => {
    const collection = makeCollection();

    await sessionService.createSession(makeDb(collection), 'user-1', 'access-tok', 'refresh-tok', null);

    const [stored] = collection.insertOne.mock.calls[0];
    expect(stored).toMatchObject({
      sessionId: expect.stringMatching(/^session_user-1_/),
      userAccountId: 'user-1',
      accessTokenHash: sessionService.getTokenHash('access-tok'),
      lastActivityAt: expect.any(Date),
      sessionStartedAt: expect.any(Date),
      inactivityTimeoutMs: 30 * 60 * 1000
    });
    for (const legacy of ['sessionID', 'userID', 'tokenHash', 'lastActivity', 'createdAt', 'inactiveTimeout']) {
      expect(stored).not.toHaveProperty(legacy);
    }
  });

  it('propagates and logs errors from db.collection', async () => {
    const db = { collection: vi.fn(() => { throw new Error('db down'); }) };

    await expect(sessionService.createSession(db, 'user-1', 'a', 'r')).rejects.toThrow('db down');
  });

  // #1254: dict-02 P1X-0294 session.allowMultipleSessions. Off, a sign-in ends
  // the user's other active sessions, with reason admin_action (P1X-0267).
  describe('#1254: session.allowMultipleSessions', () => {
    function dbWithPolicy(session, otherActive) {
      const sessions = makeCollection({ countDocuments: vi.fn().mockResolvedValue(otherActive) });
      const config = makeCollection({ findOne: vi.fn().mockResolvedValue(session === undefined ? null : { _id: 'main', session }) });
      const db = { collection: vi.fn((name) => (name === 'security_config' ? config : sessions)) };
      return { db, sessions };
    }

    it('off: the new sign-in ends the user\'s other active sessions, after storing its own', async () => {
      const revoke = vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(undefined);
      const { db, sessions } = dbWithPolicy({ allowMultipleSessions: false }, 2);

      await sessionService.createSession(db, 'user-1', 'access-tok', 'refresh-tok', null);

      const accessHash = sessionService.getTokenHash('access-tok');
      expect(sessions.countDocuments).toHaveBeenCalledWith({
        ...byOwner('user-1'),
        isActive: true,
        $and: [{ accessTokenHash: { $ne: accessHash } }],
      });
      expect(revoke).toHaveBeenCalledWith(db, 'user-1', 'access-tok', 'admin_action', 'system', { req: null });
      expect(sessions.insertOne.mock.invocationCallOrder[0]).toBeLessThan(revoke.mock.invocationCallOrder[0]);
      revoke.mockRestore();
    });

    it('off with no other session: nothing to end, so no revocation and no audit row', async () => {
      const revoke = vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(undefined);
      const { db } = dbWithPolicy({ allowMultipleSessions: false }, 0);

      await sessionService.createSession(db, 'user-1', 'access-tok', 'refresh-tok', null);

      expect(revoke).not.toHaveBeenCalled();
      revoke.mockRestore();
    });

    it.each([
      ['on', { allowMultipleSessions: true }],
      ['absent from a stored document', {}],
      ['a new deployment (no document)', undefined],
    ])('%s: other sessions stay', async (_label, session) => {
      const revoke = vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(undefined);
      const { db, sessions } = dbWithPolicy(session, 3);

      await sessionService.createSession(db, 'user-1', 'access-tok', 'refresh-tok', null);

      expect(sessions.countDocuments).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
      revoke.mockRestore();
    });

    it('an unreadable policy ends nobody\'s sessions', async () => {
      const policy = await sessionService.resolveSessionPolicy({ collection: vi.fn(() => { throw new Error('down'); }) });
      expect(policy.allowMultipleSessions).toBe(true);
    });
  });
});

describe('SessionService.updateActivity', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('returns null when session not found anywhere', async () => {
    const collection = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'missing-token');
    expect(result).toBeNull();
  });

  it('finds session in cache and updates activity', async () => {
    const accessTokenHash = sessionService.getTokenHash('cached-token');
    const session = liveSession({ sessionId: 'sess-1', accessTokenHash });
    sessionService.sessions.set('sess-1', session);
    const collection = makeCollection();
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'cached-token');

    expect(result.sessionId).toBe('sess-1');
    expect(result.isActive).toBe(true);
    expect(collection.updateOne).toHaveBeenCalled();
  });

  // #1330: the activity write removes the legacy names a document still
  // carries beside the canonical ones. tokenHash goes at the next rotation,
  // which computes the new hash.
  it('#1330: rewrites a session under the canonical names and $unsets the legacy ones it still carries', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', userAccountId: 'u0', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const stored = sessionWithLegacyNames({ sessionId: 'sess-legacy-names', userAccountId: 'u1', accessTokenHash: sessionService.getTokenHash('legacy-names-token') });
    const startedAt = stored.sessionStartedAt;
    const collection = createMatchingCollection([decoy, stored]);

    const result = await sessionService.updateActivity(makeDb(collection), 'legacy-names-token');

    expect(result?.sessionId).toBe('sess-legacy-names');
    expect(collection.findOne.mock.calls[0][0]).toEqual(byAccessHash(sessionService.getTokenHash('legacy-names-token')));
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual(byId('sess-legacy-names'));
    expect(update.$set).toMatchObject({
      sessionId: 'sess-legacy-names',
      userAccountId: 'u1',
      sessionStartedAt: startedAt,
      inactivityTimeoutMs: 20 * 60 * 1000,
      lastActivityAt: expect.any(Date),
      isActive: true
    });
    expect(update.$set).not.toHaveProperty('accessTokenHash');
    expect(Object.keys(update.$unset).sort()).toEqual(['createdAt', 'inactiveTimeout', 'lastActivity', 'sessionID', 'userID']);
    // The cached copy carries the canonical names too, so the next request
    // reads the same values.
    expect(sessionService.sessions.get('sess-legacy-names')).toMatchObject({ sessionId: 'sess-legacy-names', userAccountId: 'u1' });
    expect(sessionService.sessions.get('sess-legacy-names')).not.toHaveProperty('userID');
  });

  it('#1386: does not find a session stored only under the legacy names', async () => {
    const stored = legacyOnlySession({ sessionID: 'sess-legacy-only', userID: 'u1', tokenHash: sessionService.getTokenHash('legacy-only-token') });
    const collection = createMatchingCollection([stored]);

    expect(await sessionService.updateActivity(makeDb(collection), 'legacy-only-token')).toBeNull();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('#1330: a document without inactivityTimeoutMs does not gain a null timeout', async () => {
    const { inactivityTimeoutMs, ...stored } = liveSession({ sessionId: 'sess-no-timeout', userAccountId: 'u1', accessTokenHash: sessionService.getTokenHash('no-timeout-token') });
    const collection = createMatchingCollection([stored]);

    await sessionService.updateActivity(makeDb(collection), 'no-timeout-token');

    const [, update] = collection.updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty('inactivityTimeoutMs');
  });

  // #1336: the two lookups below were once an identity stub answering null,
  // then the session, by call order, so a lookup on the wrong key passed.
  // Seeded collections answer by filter, and the decoy comes first because a
  // filter on a key no session carries degenerates to `{ key: null }` and
  // matches the first document.
  it('falls back to legacy plain-text token lookup when tokenHash misses', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const session = liveSession({ sessionId: 'sess-legacy', token: 'legacy-token' });
    const collection = createMatchingCollection([decoy, session]);
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'legacy-token');

    expect(result.sessionId).toBe('sess-legacy');
    expect(sessionService.sessions.get('sess-legacy')).toBe(session);
    expect(collection.findOne.mock.calls.map(([filter]) => filter)).toEqual([
      byAccessHash(sessionService.getTokenHash('legacy-token')),
      { token: 'legacy-token' }
    ]);
  });

  it('resolves a stored session by the hash of its token, never by the token itself', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const session = liveSession({ sessionId: 'sess-db', accessTokenHash: sessionService.getTokenHash('db-token') });
    const collection = createMatchingCollection([decoy, session]);

    const result = await sessionService.updateActivity(makeDb(collection), 'db-token');

    expect(result.sessionId).toBe('sess-db');
    expect(collection.findOne).toHaveBeenCalledTimes(1);
    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-db'),
      expect.objectContaining({ $set: expect.objectContaining({ isActive: true }) })
    );
  });

  it('invalidates and returns null when session found but expired', async () => {
    const session = liveSession({
      sessionId: 'sess-expired',
      expiresAt: new Date(Date.now() - 1000)
    });
    const collection = makeCollection({
      findOne: vi.fn().mockResolvedValueOnce(session)
    });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'expired-token');

    expect(result).toBeNull();
    // #974: the clock killing a session must not be byte-identical to an
    // administrator killing one, so this eviction carries the same
    // 'expiration'/'system' pair cleanupExpiredSessions writes.
    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-expired'),
      expect.objectContaining({
        $set: expect.objectContaining({
          isActive: false,
          isRevoked: true,
          revocationReason: 'expiration',
          revokedBy: 'system'
        })
      })
    );
  });

  it('swallows db update errors and still returns the session', async () => {
    const accessTokenHash = sessionService.getTokenHash('warn-token');
    const session = liveSession({ sessionId: 'sess-warn', accessTokenHash });
    sessionService.sessions.set('sess-warn', session);
    const collection = makeCollection({
      updateOne: vi.fn().mockRejectedValue(new Error('write failed'))
    });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'warn-token');
    expect(result.sessionId).toBe('sess-warn');
  });
});

describe('SessionService.verifySession', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('returns invalid session_not_found when nothing matches', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    const result = await sessionService.verifySession(db, 'nope');
    expect(result).toEqual({ valid: false, reason: 'session_not_found' });
  });

  it('returns invalid session_revoked for a revoked session', async () => {
    const accessTokenHash = sessionService.getTokenHash('revoked-token');
    sessionService.sessions.set('sess-r', { sessionId: 'sess-r', accessTokenHash, isRevoked: true });

    const db = makeDb(makeCollection());
    const result = await sessionService.verifySession(db, 'revoked-token');
    expect(result).toEqual({ valid: false, reason: 'session_revoked' });
  });

  it('returns invalid session_expired and invalidates when inactive', async () => {
    const accessTokenHash = sessionService.getTokenHash('expired-token');
    const session = liveSession({
      sessionId: 'sess-exp',
      accessTokenHash,
      expiresAt: new Date(Date.now() - 1000)
    });
    sessionService.sessions.set('sess-exp', session);
    const collection = makeCollection();
    const db = makeDb(collection);

    const result = await sessionService.verifySession(db, 'expired-token');
    expect(result).toEqual({ valid: false, reason: 'session_expired' });
    // #974: as in updateActivity's expiry test above -- a bare
    // toHaveBeenCalled() here passed equally well before the reason was
    // recorded at all, which is why it is spelled out.
    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-exp'),
      expect.objectContaining({
        $set: expect.objectContaining({
          isActive: false,
          isRevoked: true,
          revocationReason: 'expiration',
          revokedBy: 'system'
        })
      })
    );
  });

  it('returns valid:true with the session when active', async () => {
    const accessTokenHash = sessionService.getTokenHash('active-token');
    const session = liveSession({ sessionId: 'sess-active', accessTokenHash });
    sessionService.sessions.set('sess-active', session);
    const db = makeDb(makeCollection());

    const result = await sessionService.verifySession(db, 'active-token');
    expect(result).toEqual({ valid: true, session });
  });

  // #1336: verifySession's database path, the per-request lookup on a cache
  // miss, had no test at all; every case above seeds the in-process cache.
  it('resolves an uncached session from the database by its token hash', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const session = liveSession({ sessionId: 'sess-db', accessTokenHash: sessionService.getTokenHash('db-token') });
    const collection = createMatchingCollection([decoy, session]);

    const result = await sessionService.verifySession(makeDb(collection), 'db-token');

    expect(result).toEqual({ valid: true, session });
    expect(collection.findOne).toHaveBeenCalledTimes(1);
    expect(sessionService.sessions.get('sess-db')).toBe(session);
  });

  // #1386: the per-request lookup reads the canonical accessTokenHash only.
  it('#1386: does not resolve a session stored only under the legacy names', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const session = legacyOnlySession({ sessionID: 'sess-legacy-only', userID: 'u1', tokenHash: sessionService.getTokenHash('legacy-only-token') });
    const collection = createMatchingCollection([decoy, session]);

    const result = await sessionService.verifySession(makeDb(collection), 'legacy-only-token');

    expect(result.valid).toBe(false);
    expect(sessionService.sessions.has('sess-legacy-only')).toBe(false);
  });

  it('falls back to a legacy plain-text token for an uncached session', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const session = liveSession({ sessionId: 'sess-legacy', token: 'legacy-token' });
    const collection = createMatchingCollection([decoy, session]);

    const result = await sessionService.verifySession(makeDb(collection), 'legacy-token');

    expect(result).toEqual({ valid: true, session });
    expect(collection.findOne.mock.calls.map(([filter]) => filter)).toEqual([
      byAccessHash(sessionService.getTokenHash('legacy-token')),
      { token: 'legacy-token' }
    ]);
  });

  it('does not resolve a token that matches no stored session', async () => {
    const decoy = liveSession({ sessionId: 'sess-decoy', accessTokenHash: sessionService.getTokenHash('decoy-token') });
    const collection = createMatchingCollection([decoy]);

    const result = await sessionService.verifySession(makeDb(collection), 'unknown-token');

    expect(result).toEqual({ valid: false, reason: 'session_not_found' });
    expect(sessionService.sessions.size).toBe(0);
  });

  it('returns invalid reason:error when lookup throws', async () => {
    const db = { collection: vi.fn(() => { throw new Error('boom'); }) };
    const result = await sessionService.verifySession(db, 'whatever');
    expect(result).toEqual({ valid: false, reason: 'error' });
  });
});

describe('SessionService.invalidateSession', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('removes from cache and marks inactive in db', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateSession(db, 'sess-1');

    expect(sessionService.sessions.has('sess-1')).toBe(false);
    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-1'),
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false, isRevoked: true }) })
    );
  });

  it('swallows db errors during invalidation', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1' });
    const collection = makeCollection({ updateOne: vi.fn().mockRejectedValue(new Error('fail')) });
    const db = makeDb(collection);

    await expect(sessionService.invalidateSession(db, 'sess-1')).resolves.toBeUndefined();
  });

  it('#974: writes the passed revocationReason and coerces a non-string revokedBy to String', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1' });
    const collection = makeCollection();
    const db = makeDb(collection);
    const objectIdLike = { toString: () => 'admin-1' };

    await sessionService.invalidateSession(db, 'sess-1', 'admin_action', objectIdLike);

    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-1'),
      expect.objectContaining({
        $set: expect.objectContaining({ revocationReason: 'admin_action', revokedBy: 'admin-1' })
      })
    );
  });

  it('#974: default-argument call still writes revocationReason and revokedBy as null', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateSession(db, 'sess-1');

    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-1'),
      expect.objectContaining({
        $set: expect.objectContaining({ revocationReason: null, revokedBy: null })
      })
    );
  });
});

describe('SessionService.invalidateUserSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('removes only the matching user sessions from cache and updates db', async () => {
    sessionService.sessions.set('s1', { sessionId: 's1', userAccountId: 'u1' });
    sessionService.sessions.set('s2', { sessionId: 's2', userAccountId: 'u2' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateUserSessions(db, 'u1');

    expect(sessionService.sessions.has('s1')).toBe(false);
    expect(sessionService.sessions.has('s2')).toBe(true);
    expect(collection.updateMany).toHaveBeenCalledWith(
      { ...byOwner('u1'), isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false }) })
    );
  });

  // #963: this was the ONLY one of the five session-write helpers that did
  // not coerce its argument -- listUserSessions:340, revokeSessionById:366
  // and revokeAllOtherSessions:391 all filter on String(userID). The stored
  // field is always a string (Session.js does String(data.userAccountId), fed
  // from auth.service.js's user._id.toString()), so being handed an ObjectId
  // matched nothing, threw nothing, and let the caller return 200 -- a
  // silent no-op, and exactly the shape a caller passing targetUser._id
  // rather than targetUser._id.toString() would produce.
  it('#963: coerces a non-string userID, so an ObjectId-like id is not a silent no-op', async () => {
    const objectIdLike = { toString: () => 'u1' };
    sessionService.sessions.set('s1', { sessionId: 's1', userAccountId: 'u1' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateUserSessions(db, objectIdLike);

    expect(collection.updateMany).toHaveBeenCalledWith(
      { ...byOwner('u1'), isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false }) })
    );
    // The in-memory cache used a strict === against the raw argument, so it
    // missed for the same reason the filter did.
    expect(sessionService.sessions.has('s1')).toBe(false);
  });

  it('#974: writes the passed revocationReason and coerces a non-string revokedBy to String', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);
    const objectIdLike = { toString: () => 'admin-1' };

    await sessionService.invalidateUserSessions(db, 'u1', 'admin_action', objectIdLike);

    expect(collection.updateMany).toHaveBeenCalledWith(
      { ...byOwner('u1'), isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({ revocationReason: 'admin_action', revokedBy: 'admin-1' })
      })
    );
  });
});

describe('SessionService.cleanupExpiredSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('removes expired sessions from cache and returns count', async () => {
    const active = liveSession({ sessionId: 'active', expiresAt: new Date(Date.now() + 100000), refreshExpiresAt: new Date(Date.now() + 100000) });
    const expired = liveSession({ sessionId: 'expired', expiresAt: new Date(Date.now() - 1000), refreshExpiresAt: new Date(Date.now() + 100000) });
    sessionService.sessions.set('active', active);
    sessionService.sessions.set('expired', expired);
    const collection = makeCollection();
    const db = makeDb(collection);

    const count = await sessionService.cleanupExpiredSessions(db);

    expect(count).toBe(1);
    expect(sessionService.sessions.has('expired')).toBe(false);
    expect(sessionService.sessions.has('active')).toBe(true);
    expect(collection.updateMany).toHaveBeenCalled();
  });

  it('#974: writes revocationReason "expiration" and revokedBy "system"', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.cleanupExpiredSessions(db);

    expect(collection.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ revocationReason: 'expiration', revokedBy: 'system' })
      })
    );
  });
});

describe('SessionService.listUserSessions', () => {
  it('maps sessions to summary shape and marks current session', async () => {
    const now = new Date();
    const sessions = [
      {
        sessionId: 's1',
        accessTokenHash: sessionService.getTokenHash('current-tok'),
        deviceInfo: { browser: 'Chrome', os: 'Windows', deviceName: 'Desktop' },
        ipAddress: '1.2.3.4',
        lastActivityAt: now,
        sessionStartedAt: now
      },
      {
        sessionId: 's2',
        userAgent: 'Mozilla/5.0 Firefox/109.0',
        ipAddress: '5.6.7.8',
        sessionStartedAt: now
      }
    ];
    const collection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(sessions)
        })
      })
    };
    const db = makeDb(collection);

    const result = await sessionService.listUserSessions(db, 'u1', 'current-tok');

    expect(collection.find).toHaveBeenCalledWith({ ...byOwner('u1'), isActive: true, isRevoked: { $ne: true } });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].browser).toBe('Chrome');
    expect(result[1].isCurrent).toBe(false);
    expect(result[1].browser).toBe('Firefox');
    expect(result[1].lastAccess).toBe(now);
    expect(result[1].createdAt).toBe(now);
  });

  // #1386: the owner filter reads the canonical userAccountId only.
  it('#1386: does not list a session stored only under the legacy names', async () => {
    const started = new Date('2026-10-01T10:00:00Z');
    const active = new Date('2026-10-01T11:00:00Z');
    const collection = createMatchingCollection([
      { sessionID: 'legacy-1', userID: 'u1', tokenHash: sessionService.getTokenHash('current-tok'), isActive: true, lastActivity: active, createdAt: started },
      { sessionId: 'other-user', userAccountId: 'u2', isActive: true, sessionStartedAt: started }
    ]);

    const result = await sessionService.listUserSessions(makeDb(collection), 'u1', 'current-tok');

    expect(result).toEqual([]);
  });

  it('marks nothing current when no currentAccessToken given', async () => {
    const collection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ sessionId: 's1', sessionStartedAt: new Date() }])
        })
      })
    };
    const db = makeDb(collection);

    const result = await sessionService.listUserSessions(db, 'u1', null);
    expect(result[0].isCurrent).toBe(false);
  });
});

describe('SessionService.revokeSessionById', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('returns false and does not touch cache when no match', async () => {
    const collection = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) });
    const db = makeDb(collection);

    const result = await sessionService.revokeSessionById(db, 'u1', 'sess-missing');
    expect(result).toBe(false);
  });

  it('returns true and removes from cache on match', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1' });
    const collection = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
    const db = makeDb(collection);

    const result = await sessionService.revokeSessionById(db, 'u1', 'sess-1');

    expect(result).toBe(true);
    expect(sessionService.sessions.has('sess-1')).toBe(false);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { $and: [byOwner('u1'), byId('sess-1')], isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false, isRevoked: true }) })
    );
  });

  it('#1386: does not revoke a session stored only under the legacy names', async () => {
    const collection = createMatchingCollection([
      { sessionID: 'sess-legacy', userID: 'u1', isActive: true }
    ]);

    expect(await sessionService.revokeSessionById(makeDb(collection), 'u1', 'sess-legacy', 'user_request', 'u1')).toBe(false);
    expect(collection.docs[0].isRevoked).toBeUndefined();
  });

  it('#974: default-argument call still writes revocationReason and revokedBy as null', async () => {
    const collection = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
    const db = makeDb(collection);

    await sessionService.revokeSessionById(db, 'u1', 'sess-1');

    expect(collection.updateOne).toHaveBeenCalledWith(
      { $and: [byOwner('u1'), byId('sess-1')], isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ revocationReason: null, revokedBy: null }) })
    );
  });
});

describe('SessionService.revokeAllOtherSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('updates db and evicts only other-session cache entries for the user', async () => {
    const currentHash = sessionService.getTokenHash('current-tok');
    sessionService.sessions.set('s-current', { sessionId: 's-current', userAccountId: 'u1', accessTokenHash: currentHash });
    sessionService.sessions.set('s-other', { sessionId: 's-other', userAccountId: 'u1', accessTokenHash: 'different-hash' });
    sessionService.sessions.set('s-otheruser', { sessionId: 's-otheruser', userAccountId: 'u2', accessTokenHash: 'different-hash' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.revokeAllOtherSessions(db, 'u1', 'current-tok');

    expect(collection.updateMany).toHaveBeenCalled();
    expect(sessionService.sessions.has('s-current')).toBe(true);
    expect(sessionService.sessions.has('s-other')).toBe(false);
    expect(sessionService.sessions.has('s-otheruser')).toBe(true);
  });

  // #1386: the caller's own session is spared by its accessTokenHash, and a
  // session stored only under the legacy names is not matched.
  it('#1386: spares the current session and revokes the other canonical ones only', async () => {
    const currentHash = sessionService.getTokenHash('current-tok');
    const collection = createMatchingCollection([
      { sessionId: 'canonical-current', userAccountId: 'u1', accessTokenHash: currentHash, isActive: true },
      { sessionID: 'legacy-other', userID: 'u1', tokenHash: 'other-hash', isActive: true },
      { sessionId: 'canonical-other', userAccountId: 'u1', accessTokenHash: 'other-hash-2', isActive: true },
      { sessionId: 'someone-else', userAccountId: 'u2', accessTokenHash: 'other-hash-3', isActive: true }
    ]);

    await sessionService.revokeAllOtherSessions(makeDb(collection), 'u1', 'current-tok');

    expect(collection.docs.filter((doc) => doc.isRevoked === true).map((doc) => doc.sessionId || doc.sessionID))
      .toEqual(['canonical-other']);
  });

  it('#974: writes revocationReason "user_request" and revokedBy as the acting user', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.revokeAllOtherSessions(db, 'u1', 'current-tok');

    expect(collection.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ revocationReason: 'user_request', revokedBy: 'u1' })
      })
    );
  });
});

describe('SessionService.getSessionByRefreshToken', () => {
  it('queries by refreshTokenHash and active/non-revoked/non-expired filters', async () => {
    const collection = makeCollection({ findOne: vi.fn().mockResolvedValue({ sessionId: 's1' }) });
    const db = makeDb(collection);

    const result = await sessionService.getSessionByRefreshToken(db, 'refresh-tok');

    expect(result).toEqual({ sessionId: 's1' });
    expect(collection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshTokenHash: sessionService.getTokenHash('refresh-tok'),
        isActive: true,
        isRevoked: { $ne: true }
      })
    );
  });
});

describe('SessionService.rotateSessionTokens', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('updates db and merges rotated fields into the cached session', async () => {
    sessionService.sessions.set('sess-1', { sessionId: 'sess-1', userAccountId: 'u1', stale: true });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.rotateSessionTokens(db, 'sess-1', 'new-access', 'new-refresh');

    expect(collection.updateOne).toHaveBeenCalledWith(
      byId('sess-1'),
      expect.objectContaining({
        $set: expect.objectContaining({
          accessTokenHash: sessionService.getTokenHash('new-access'),
          refreshTokenHash: sessionService.getTokenHash('new-refresh'),
          isActive: true,
          isRevoked: false
        })
      })
    );
    const cached = sessionService.sessions.get('sess-1');
    expect(cached.userAccountId).toBe('u1');
    expect(cached.stale).toBe(true);
    expect(cached.accessTokenHash).toBe(sessionService.getTokenHash('new-access'));
  });

  // #1330: a refresh of a session still carrying legacy names rewrites it
  // under the canonical ones alone and removes every legacy name.
  it('#1330: rotating a session $unsets every legacy name it still carries', async () => {
    const startedAt = new Date(Date.now() - 60 * 1000);
    const stored = sessionWithLegacyNames({ sessionId: 'sess-legacy', userAccountId: 'u1', accessTokenHash: 'old-hash', sessionStartedAt: startedAt, createdAt: startedAt });
    const collection = makeCollection();

    await sessionService.rotateSessionTokens(makeDb(collection), 'sess-legacy', 'new-access', 'new-refresh', stored);

    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual(byId('sess-legacy'));
    expect(update.$set).toMatchObject({
      sessionId: 'sess-legacy',
      userAccountId: 'u1',
      sessionStartedAt: startedAt,
      inactivityTimeoutMs: 20 * 60 * 1000,
      accessTokenHash: sessionService.getTokenHash('new-access'),
      lastActivityAt: expect.any(Date)
    });
    expect(Object.keys(update.$unset).sort()).toEqual(['createdAt', 'inactiveTimeout', 'lastActivity', 'sessionID', 'tokenHash', 'userID']);
    const cached = sessionService.sessions.get('sess-legacy');
    for (const legacy of ['sessionID', 'userID', 'tokenHash', 'lastActivity', 'createdAt', 'inactiveTimeout']) {
      expect(cached).not.toHaveProperty(legacy);
    }
  });

  it('#974: clears the whole revocation record, not just isRevoked/revokedAt', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.rotateSessionTokens(db, 'sess-1', 'acc', 'ref');

    const [, update] = collection.updateOne.mock.calls[0];
    // The reset was partial: isActive/isRevoked/revokedAt were reset and the
    // two fields 4d6807c8 added were not, so a rotated session could carry a
    // stale reason alongside isRevoked: false. Unreachable today --
    // getSessionByRefreshToken filters isRevoked: { $ne: true } -- but the
    // guard is the only thing holding it, and nothing pinned that.
    expect(update.$set.revokedAt).toBeNull();
    expect(update.$set.revocationReason).toBeNull();
    expect(update.$set.revokedBy).toBeNull();
  });

  it('creates cache entry when session was not previously cached', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.rotateSessionTokens(db, 'sess-new', 'acc', 'ref');

    expect(sessionService.sessions.get('sess-new').sessionId).toBe('sess-new');
  });
});
