import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// #1005: listSessionsForAudit (the audit read path over sessions), the IP
// masker it presents with, and the sessions index helper. The query, sort,
// paging and projection are asserted as handed to the driver; the real-Mongo
// proof is the e2e spec.
const sessionService = require('../../src/services/session.service');
const { maskIpAddress, generateAnonId } = require('../../src/utils/userAnonymization');
const { ensureSessionIndexes, SESSION_LOOKUP_INDEXES } = require('../../src/utils/sessionIndexes');

const ORIGINAL_SALT = process.env.USER_ANON_SALT;
beforeAll(() => { process.env.USER_ANON_SALT = 'test-salt-1005'; });
afterAll(() => {
  if (ORIGINAL_SALT === undefined) delete process.env.USER_ANON_SALT;
  else process.env.USER_ANON_SALT = ORIGINAL_SALT;
});

let collectionSeq = 0;

function makeDb(rows = [], total = rows.length) {
  const calls = {};
  const sessions = {
    collectionName: `sessions_test_${++collectionSeq}`,
    createIndex: vi.fn(async () => 'ok'),
    find: vi.fn((query, options) => {
      calls.query = query;
      calls.options = options;
      const cursor = {
        sort: (spec) => { calls.sort = spec; return cursor; },
        skip: (n) => { calls.skip = n; return cursor; },
        limit: (n) => { calls.limit = n; return cursor; },
        toArray: async () => rows,
      };
      return cursor;
    }),
    countDocuments: vi.fn(async (query) => { calls.countQuery = query; return total; }),
  };
  const users = { findOne: vi.fn(async () => null) };
  return {
    calls,
    sessions,
    db: { collection: (name) => (name === 'sessions' ? sessions : users) },
  };
}

describe('maskIpAddress (#1005, dict-02 P1X-0256)', () => {
  it('drops the last IPv4 octet', () => {
    expect(maskIpAddress('10.0.3.17')).toBe('10.0.3.x');
  });
  it('treats an IPv4-mapped IPv6 address as IPv4', () => {
    expect(maskIpAddress('::ffff:192.168.1.40')).toBe('192.168.1.x');
  });
  it('keeps only the /48 prefix of an IPv6 address', () => {
    expect(maskIpAddress('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3::x');
    expect(maskIpAddress('2001:db8::1')).toBe('2001:db8::x');
  });
  it('masks loopback IPv6 down to nothing identifying', () => {
    expect(maskIpAddress('::1')).toBe('::x');
  });
  it('returns null for an absent address and x for an unparseable one', () => {
    expect(maskIpAddress(null)).toBeNull();
    expect(maskIpAddress('')).toBeNull();
    expect(maskIpAddress('not-an-ip')).toBe('x');
  });
});

describe('sessionService.listSessionsForAudit (#1005)', () => {
  it('defaults: no filter, newest first by session start, page 1 of 50, token hashes projected out', async () => {
    const { db, calls } = makeDb();
    const result = await sessionService.listSessionsForAudit(db, {});
    expect(calls.query).toEqual({});
    expect(calls.countQuery).toEqual({});
    // #1386: the canonical start only.
    expect(calls.sort).toEqual({ sessionStartedAt: -1 });
    expect(calls.skip).toBe(0);
    expect(calls.limit).toBe(50);
    expect(calls.options.projection).toMatchObject({
      accessTokenHash: 0, tokenHash: 0, refreshTokenHash: 0, sessionId: 0, sessionID: 0,
    });
    expect(result).toMatchObject({ total: 0, page: 1, limit: 50, totalPages: 0, sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('builds every filter into the same query for find and countDocuments', async () => {
    const { db, calls } = makeDb();
    await sessionService.listSessionsForAudit(db, {
      userId: 'user-9',
      revocationReason: 'admin_action',
      isRevoked: 'true',
      isActive: 'false',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-30T00:00:00Z',
    });
    const range = { $gte: new Date('2026-09-01T00:00:00Z'), $lte: new Date('2026-09-30T00:00:00Z') };
    // #1386: owner and range each match the canonical name only.
    const expected = {
      revocationReason: 'admin_action',
      isRevoked: true,
      isActive: false,
      $and: [
        { userAccountId: 'user-9' },
        { sessionStartedAt: range },
      ],
    };
    expect(calls.query).toEqual(expected);
    expect(calls.countQuery).toEqual(expected);
  });

  it('sortBy=lastActivity orders on lastActivityAt', async () => {
    const { db, calls } = makeDb();
    const result = await sessionService.listSessionsForAudit(db, { sortBy: 'lastActivity', sortOrder: 'asc' });
    expect(calls.sort).toEqual({ lastActivityAt: 1 });
    expect(result.sortBy).toBe('lastActivity');
  });

  it('isRevoked=false also matches rows written before the field existed', async () => {
    const { db, calls } = makeDb();
    await sessionService.listSessionsForAudit(db, { isRevoked: 'false' });
    expect(calls.query).toEqual({ isRevoked: { $ne: true } });
  });

  it('accepts every member of the P1X-0267 vocabulary, risk included', async () => {
    for (const reason of ['user_request', 'admin_action', 'password_change', 'risk', 'expiration']) {
      const { db, calls } = makeDb();
      await sessionService.listSessionsForAudit(db, { revocationReason: reason });
      expect(calls.query.revocationReason).toBe(reason);
    }
  });

  it.each([
    [{ revocationReason: 'hacked' }, /revocationReason/],
    [{ sortBy: 'tokenHash' }, /sortBy/],
    [{ from: 'yesterday-ish' }, /from/],
    [{ isRevoked: 'yes' }, /isRevoked/],
  ])('refuses %o with a 422-shaped error before querying', async (filters, message) => {
    const { db, sessions } = makeDb();
    await expect(sessionService.listSessionsForAudit(db, filters)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringMatching(message),
    });
    expect(sessions.find).not.toHaveBeenCalled();
  });

  it('caps limit at 200 and pages by skip', async () => {
    const { db, calls } = makeDb([], 1000);
    const result = await sessionService.listSessionsForAudit(db, { limit: '5000', page: '3' });
    expect(calls.limit).toBe(200);
    expect(calls.skip).toBe(400);
    expect(result.totalPages).toBe(5);
  });

  it('honours an allow-listed sortBy and ascending order', async () => {
    const { db, calls } = makeDb();
    await sessionService.listSessionsForAudit(db, { sortBy: 'revokedAt', sortOrder: 'asc' });
    expect(calls.sort).toEqual({ revokedAt: 1 });
  });

  it('pseudonymises owner and revoking admin, keeps system literal, masks the IP, and emits no token field', async () => {
    const revokedAt = new Date('2026-09-29T10:00:00Z');
    // Two rows under the canonical names; the response keeps its API keys
    // (createdAt, lastActivity).
    const rows = [
      {
        _id: 'oid-1', sessionId: 'session_user-1_1', userAccountId: 'user-1', ipAddress: '10.1.2.3', userAgent: 'Mozilla/5.0 Chrome/120',
        deviceInfo: { browser: 'Chrome', os: 'Windows', type: 'desktop' },
        sessionStartedAt: new Date('2026-09-29T09:00:00Z'), lastActivityAt: new Date('2026-09-29T09:30:00Z'),
        isActive: false, isRevoked: true,
        revokedAt, revokedBy: 'admin-7', revocationReason: 'admin_action',
      },
      {
        _id: 'oid-2', sessionId: 'session_user-1_2', userAccountId: 'user-1', ipAddress: '10.1.2.4',
        sessionStartedAt: new Date('2026-09-28T09:00:00Z'), lastActivityAt: new Date('2026-09-28T09:30:00Z'),
        isActive: false, isRevoked: true,
        revokedAt, revokedBy: 'system', revocationReason: 'expiration',
      },
    ];
    const { db } = makeDb(rows);
    const { sessions } = await sessionService.listSessionsForAudit(db, {});

    expect(sessions[0]).toMatchObject({
      id: 'oid-1',
      user: generateAnonId('user-1'),
      ipAddress: '10.1.2.x',
      browser: 'Chrome',
      os: 'Windows',
      deviceType: 'desktop',
      isActive: false,
      isRevoked: true,
      revokedAt,
      revokedBy: generateAnonId('admin-7'),
      revocationReason: 'admin_action',
    });
    expect(sessions[0].user).toMatch(/^USR-[0-9A-F]{8}$/);
    expect(sessions[0].createdAt).toEqual(new Date('2026-09-29T09:00:00Z'));
    expect(sessions[0].lastActivity).toEqual(new Date('2026-09-29T09:30:00Z'));
    expect(sessions[1].revokedBy).toBe('system');
    expect(sessions[1].user).toBe(sessions[0].user);
    expect(sessions[1].createdAt).toEqual(new Date('2026-09-28T09:00:00Z'));
    expect(sessions[1].lastActivity).toEqual(new Date('2026-09-28T09:30:00Z'));
    // sessionID embeds the owner's raw id (`session_<userID>_<ms>`), so the
    // raw id must not appear anywhere in the output.
    expect(JSON.stringify(sessions)).not.toContain('user-1');
    expect(JSON.stringify(sessions)).not.toContain('admin-7');
    for (const s of sessions) {
      expect(s).not.toHaveProperty('sessionId');
      expect(s).not.toHaveProperty('sessionID');
      expect(s).not.toHaveProperty('userAccountId');
      expect(s).not.toHaveProperty('userID');
      expect(s).not.toHaveProperty('accessTokenHash');
      expect(s).not.toHaveProperty('tokenHash');
      expect(s).not.toHaveProperty('refreshTokenHash');
      expect(s).not.toHaveProperty('userAgent');
    }
  });

  it('ensures the sessions indexes', async () => {
    const { db, sessions } = makeDb();
    await sessionService.listSessionsForAudit(db, {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(sessions.createIndex.mock.calls.map((c) => c[1].name)).toEqual(SESSION_LOOKUP_INDEXES.map(([, name]) => name));
  });
});

describe('ensureSessionIndexes (#1005)', () => {
  it('builds each index once per collection name, and a failed build does not stop the rest', async () => {
    const collection = {
      collectionName: `sessions_latch_${++collectionSeq}`,
      createIndex: vi.fn(async (_keys, { name }) => {
        if (name === 'sessions_accessTokenHash_v1') throw new Error('index build failed');
        return name;
      }),
    };
    await ensureSessionIndexes(collection);
    await ensureSessionIndexes(collection);
    expect(collection.createIndex).toHaveBeenCalledTimes(SESSION_LOOKUP_INDEXES.length);
  });

  it('builds the hot-path accessTokenHash index', () => {
    expect(SESSION_LOOKUP_INDEXES).toContainEqual([{ accessTokenHash: 1 }, 'sessions_accessTokenHash_v1']);
  });

  // #1386: readers use the canonical names only, so every index is keyed by
  // them and none by a legacy name.
  it('builds each index on the canonical names, none on a legacy one', () => {
    const keys = SESSION_LOOKUP_INDEXES.map(([spec]) => spec);
    for (const canonical of [
      { accessTokenHash: 1 },
      { sessionId: 1 },
      { userAccountId: 1, isActive: 1 },
      { userAccountId: 1, sessionStartedAt: -1 },
      { sessionStartedAt: -1 },
      { revocationReason: 1, sessionStartedAt: -1 },
    ]) {
      expect(keys).toContainEqual(canonical);
    }
    const legacy = ['sessionID', 'userID', 'tokenHash', 'lastActivity', 'createdAt', 'inactiveTimeout'];
    for (const spec of keys) {
      for (const field of Object.keys(spec)) expect(legacy).not.toContain(field);
    }
  });

  it('builds no unique or TTL session index', async () => {
    const collection = { collectionName: `sessions_options_${++collectionSeq}`, createIndex: vi.fn(async () => 'ok') };
    await ensureSessionIndexes(collection);
    for (const [, options] of collection.createIndex.mock.calls) {
      expect(options.unique).not.toBe(true);
      expect(options).not.toHaveProperty('expireAfterSeconds');
    }
  });
});
