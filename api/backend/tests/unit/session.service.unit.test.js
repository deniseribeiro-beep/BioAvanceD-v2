import { describe, it, expect, beforeEach, vi } from 'vitest';
const sessionService = require('../../src/services/session.service');

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

describe('SessionService.createSession', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('creates, caches, and persists a session', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    const session = await sessionService.createSession(db, 'user-1', 'access-tok', 'refresh-tok', null);

    expect(session.userID).toBe('user-1');
    expect(session.tokenHash).toBe(sessionService.getTokenHash('access-tok'));
    expect(session.refreshTokenHash).toBe(sessionService.getTokenHash('refresh-tok'));
    expect(sessionService.sessions.get(session.sessionID)).toBe(session);
    expect(collection.insertOne).toHaveBeenCalledWith(session);
  });

  it('propagates and logs errors from db.collection', async () => {
    const db = { collection: vi.fn(() => { throw new Error('db down'); }) };

    await expect(sessionService.createSession(db, 'user-1', 'a', 'r')).rejects.toThrow('db down');
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
    const tokenHash = sessionService.getTokenHash('cached-token');
    const session = {
      sessionID: 'sess-1',
      tokenHash,
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 10000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    sessionService.sessions.set('sess-1', session);
    const collection = makeCollection();
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'cached-token');

    expect(result.sessionID).toBe('sess-1');
    expect(result.isActive).toBe(true);
    expect(collection.updateOne).toHaveBeenCalled();
  });

  it('falls back to legacy plain-text token lookup when tokenHash misses', async () => {
    const session = {
      sessionID: 'sess-legacy',
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 10000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    const collection = makeCollection({
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(session)
    });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'legacy-token');

    expect(result.sessionID).toBe('sess-legacy');
    expect(sessionService.sessions.get('sess-legacy')).toBe(session);
  });

  it('invalidates and returns null when session found but expired', async () => {
    const session = {
      sessionID: 'sess-expired',
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    const collection = makeCollection({
      findOne: vi.fn().mockResolvedValueOnce(session)
    });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'expired-token');

    expect(result).toBeNull();
    expect(collection.updateOne).toHaveBeenCalledWith(
      { sessionID: 'sess-expired' },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false, isRevoked: true }) })
    );
  });

  it('swallows db update errors and still returns the session', async () => {
    const tokenHash = sessionService.getTokenHash('warn-token');
    const session = {
      sessionID: 'sess-warn',
      tokenHash,
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 10000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    sessionService.sessions.set('sess-warn', session);
    const collection = makeCollection({
      updateOne: vi.fn().mockRejectedValue(new Error('write failed'))
    });
    const db = makeDb(collection);

    const result = await sessionService.updateActivity(db, 'warn-token');
    expect(result.sessionID).toBe('sess-warn');
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
    const tokenHash = sessionService.getTokenHash('revoked-token');
    sessionService.sessions.set('sess-r', { sessionID: 'sess-r', tokenHash, isRevoked: true });

    const db = makeDb(makeCollection());
    const result = await sessionService.verifySession(db, 'revoked-token');
    expect(result).toEqual({ valid: false, reason: 'session_revoked' });
  });

  it('returns invalid session_expired and invalidates when inactive', async () => {
    const tokenHash = sessionService.getTokenHash('expired-token');
    const session = {
      sessionID: 'sess-exp',
      tokenHash,
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    sessionService.sessions.set('sess-exp', session);
    const collection = makeCollection();
    const db = makeDb(collection);

    const result = await sessionService.verifySession(db, 'expired-token');
    expect(result).toEqual({ valid: false, reason: 'session_expired' });
    expect(collection.updateOne).toHaveBeenCalled();
  });

  it('returns valid:true with the session when active', async () => {
    const tokenHash = sessionService.getTokenHash('active-token');
    const session = {
      sessionID: 'sess-active',
      tokenHash,
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 10000),
      refreshExpiresAt: new Date(Date.now() + 10000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    sessionService.sessions.set('sess-active', session);
    const db = makeDb(makeCollection());

    const result = await sessionService.verifySession(db, 'active-token');
    expect(result).toEqual({ valid: true, session });
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
    sessionService.sessions.set('sess-1', { sessionID: 'sess-1' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateSession(db, 'sess-1');

    expect(sessionService.sessions.has('sess-1')).toBe(false);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { sessionID: 'sess-1' },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false, isRevoked: true }) })
    );
  });

  it('swallows db errors during invalidation', async () => {
    sessionService.sessions.set('sess-1', { sessionID: 'sess-1' });
    const collection = makeCollection({ updateOne: vi.fn().mockRejectedValue(new Error('fail')) });
    const db = makeDb(collection);

    await expect(sessionService.invalidateSession(db, 'sess-1')).resolves.toBeUndefined();
  });
});

describe('SessionService.invalidateUserSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('removes only the matching user sessions from cache and updates db', async () => {
    sessionService.sessions.set('s1', { sessionID: 's1', userID: 'u1' });
    sessionService.sessions.set('s2', { sessionID: 's2', userID: 'u2' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.invalidateUserSessions(db, 'u1');

    expect(sessionService.sessions.has('s1')).toBe(false);
    expect(sessionService.sessions.has('s2')).toBe(true);
    expect(collection.updateMany).toHaveBeenCalledWith(
      { userID: 'u1', isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false }) })
    );
  });
});

describe('SessionService.cleanupExpiredSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('removes expired sessions from cache and returns count', async () => {
    const active = {
      sessionID: 'active',
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 100000),
      refreshExpiresAt: new Date(Date.now() + 100000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
    const expired = {
      sessionID: 'expired',
      isActive: true,
      isRevoked: false,
      expiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 100000),
      lastActivity: new Date(),
      inactiveTimeout: 30 * 60 * 1000
    };
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
});

describe('SessionService.listUserSessions', () => {
  it('maps sessions to summary shape and marks current session', async () => {
    const now = new Date();
    const sessions = [
      {
        sessionID: 's1',
        tokenHash: sessionService.getTokenHash('current-tok'),
        deviceInfo: { browser: 'Chrome', os: 'Windows', deviceName: 'Desktop' },
        ipAddress: '1.2.3.4',
        lastActivity: now,
        createdAt: now
      },
      {
        sessionID: 's2',
        userAgent: 'Mozilla/5.0 Firefox/109.0',
        ipAddress: '5.6.7.8',
        createdAt: now
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

    expect(collection.find).toHaveBeenCalledWith({ userID: 'u1', isActive: true, isRevoked: { $ne: true } });
    expect(result).toHaveLength(2);
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].browser).toBe('Chrome');
    expect(result[1].isCurrent).toBe(false);
    expect(result[1].browser).toBe('Firefox');
    expect(result[1].lastAccess).toBe(now);
  });

  it('marks nothing current when no currentAccessToken given', async () => {
    const collection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ sessionID: 's1', createdAt: new Date() }])
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
    sessionService.sessions.set('sess-1', { sessionID: 'sess-1' });
    const collection = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
    const db = makeDb(collection);

    const result = await sessionService.revokeSessionById(db, 'u1', 'sess-1');

    expect(result).toBe(true);
    expect(sessionService.sessions.has('sess-1')).toBe(false);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { userID: 'u1', sessionID: 'sess-1', isActive: true },
      expect.objectContaining({ $set: expect.objectContaining({ isActive: false, isRevoked: true }) })
    );
  });
});

describe('SessionService.revokeAllOtherSessions', () => {
  beforeEach(() => {
    sessionService.sessions.clear();
  });

  it('updates db and evicts only other-session cache entries for the user', async () => {
    const currentHash = sessionService.getTokenHash('current-tok');
    sessionService.sessions.set('s-current', { sessionID: 's-current', userID: 'u1', tokenHash: currentHash });
    sessionService.sessions.set('s-other', { sessionID: 's-other', userID: 'u1', tokenHash: 'different-hash' });
    sessionService.sessions.set('s-otheruser', { sessionID: 's-otheruser', userID: 'u2', tokenHash: 'different-hash' });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.revokeAllOtherSessions(db, 'u1', 'current-tok');

    expect(collection.updateMany).toHaveBeenCalled();
    expect(sessionService.sessions.has('s-current')).toBe(true);
    expect(sessionService.sessions.has('s-other')).toBe(false);
    expect(sessionService.sessions.has('s-otheruser')).toBe(true);
  });
});

describe('SessionService.getSessionByRefreshToken', () => {
  it('queries by refreshTokenHash and active/non-revoked/non-expired filters', async () => {
    const collection = makeCollection({ findOne: vi.fn().mockResolvedValue({ sessionID: 's1' }) });
    const db = makeDb(collection);

    const result = await sessionService.getSessionByRefreshToken(db, 'refresh-tok');

    expect(result).toEqual({ sessionID: 's1' });
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
    sessionService.sessions.set('sess-1', { sessionID: 'sess-1', userID: 'u1', stale: true });
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.rotateSessionTokens(db, 'sess-1', 'new-access', 'new-refresh');

    expect(collection.updateOne).toHaveBeenCalledWith(
      { sessionID: 'sess-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          tokenHash: sessionService.getTokenHash('new-access'),
          refreshTokenHash: sessionService.getTokenHash('new-refresh'),
          isActive: true,
          isRevoked: false
        })
      })
    );
    const cached = sessionService.sessions.get('sess-1');
    expect(cached.userID).toBe('u1');
    expect(cached.stale).toBe(true);
    expect(cached.tokenHash).toBe(sessionService.getTokenHash('new-access'));
  });

  it('creates cache entry when session was not previously cached', async () => {
    const collection = makeCollection();
    const db = makeDb(collection);

    await sessionService.rotateSessionTokens(db, 'sess-new', 'acc', 'ref');

    expect(sessionService.sessions.get('sess-new').sessionID).toBe('sess-new');
  });
});
