import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
const authService = require('../../src/services/auth.service');

// #860: AuthService.login() resolves the identifier in two stages --
//   1. an exact-match $or lookup (auth.service.js:232-237)
//   2. a case-insensitive $or/$regex fallback, only reached when stage 1
//      misses (auth.service.js:242-247), against an escaped copy of the
//      identifier so a caller-supplied regex metacharacter can't act as a
//      pattern.
// Nothing previously exercised a *successful* login, so nothing ever
// distinguished stage 1 from stage 2, and nothing asserted the $or/$regex
// shape stage 2 issues. This file covers that gap.
//
// filter.factory's `createMatchingCollection`/matchesFilter deliberately
// does NOT support `$regex` (documented in tests/factories/filter.factory.js),
// so stage 2's filter can't be proven via a matched *result* -- these tests
// assert directly on `findOne`'s own call history instead, which the factory
// doc also names as the valid alternative.
//
// `getUserAnonId` (called from auditLogger.logLogin, itself called from
// processLogin's success path) issues its OWN `usersCollection.findOne({ _id:
// 'USR-SYSTEM' }, ...)` lookup once a login succeeds, since the plain `{}`
// req these tests pass has no `req.user` for extractUserInfo to anonymize
// off of. That call lands on the very same `findOne` mock and would corrupt
// a plain "nth call" assertion -- `orLookupCalls()` below filters the call
// history down to the `$or`-shaped identifier-lookup calls specifically, so
// that unrelated call can't be mistaken for (or hide) a real stage-1/stage-2
// lookup.
function orLookupCalls(mockFn) {
  return mockFn.mock.calls.filter(
    ([filter]) => filter && Object.prototype.hasOwnProperty.call(filter, '$or')
  );
}

// Builds a `db` shaped the way AuthService.login()/processLogin()/
// issueSessionTokens() need to reach a real success or rejection return:
//   - `users`: the collection under test -- findOne behavior supplied by the
//     caller (`findOneImpl`), find/updateOne/insertOne stubbed to whatever a
//     login path touches on the way through (the not-found debug sample
//     query, the lastLogin update).
//   - `roles`/`userRoleAssignments`/`permissions`: stubbed empty so
//     isAdministrator/resolveUserHierarchyLevel/resolveRoleDisplayName
//     (rbac-assignment.service) resolve to "no roles" without throwing --
//     this file doesn't care what accessType/roleName the response carries,
//     only that reaching a token requires nothing more than an inactive RBAC
//     lookup.
//   - `sessions`: sessionService.createSession's insertOne target.
//   - default (`logs` etc.): auditLogger.logLogin's write goes through
//     logService.createLog, which auditLogger.log() wraps in its own
//     try/catch -- a failure there is swallowed (console.error), not
//     rethrown, so it's stubbed only well enough not to be `undefined`.
function makeLoginDb(findOneImpl) {
  const usersCollectionApi = {
    findOne: vi.fn(findOneImpl),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'anon-id' } }),
  };
  const rbacCollectionApi = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  };
  const sessionsCollectionApi = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-id' } }),
  };
  const defaultCollectionApi = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'doc-id' } }),
  };
  const RBAC_COLLECTIONS = new Set(['roles', 'permissions', 'userRoleAssignments']);

  const collection = vi.fn((name) => {
    if (name === 'users') return usersCollectionApi;
    if (RBAC_COLLECTIONS.has(name)) return rbacCollectionApi;
    if (name === 'sessions') return sessionsCollectionApi;
    return defaultCollectionApi;
  });

  return { collection, usersCollectionApi };
}

const HASHED = 'a'.repeat(60); // 20+ chars to pass processLogin's password-field sanity check

function makeUser(overrides = {}) {
  return {
    _id: { toString: () => 'user-1' },
    email: 'user@test.com',
    username: 'user1',
    name: 'User One',
    password: HASHED,
    status: 'active',
    lastLogin: new Date('2020-01-01'), // not first login -> skips mandatory MFA-setup branch
    mfaEnabled: false,
    ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AuthService.login', () => {
  it('resolves the user via the exact-match $or filter and never reaches the case-insensitive fallback', async () => {
    const user = makeUser({ email: 'exact@test.com', username: 'exactuser' });
    // Always resolves on the first call -- since login() only tries the
    // fallback when the exact-match findOne returns falsy, a findOine stub
    // that finds the user immediately proves stage 2 is skipped by the
    // control flow itself, not merely by an assertion after the fact.
    const db = makeLoginDb(vi.fn().mockResolvedValue(user));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: 'exact@test.com', password: 'pw' }, {});

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe('exact@test.com');

    const lookupCalls = orLookupCalls(db.usersCollectionApi.findOne);
    expect(lookupCalls).toHaveLength(1);
    expect(lookupCalls[0][0]).toEqual({
      $or: [
        { email: 'exact@test.com' },
        { username: 'exact@test.com' },
      ],
    });
  });

  it('falls back to the case-insensitive $or/$regex query when the exact match misses only on case, and resolves the user', async () => {
    const identifier = 'JohnSmith';
    const user = makeUser({ email: 'noone@nowhere.test', username: 'johnsmith' });
    let calls = 0;
    const findOneImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return null; // exact match misses -- stored value differs in case
      return user; // case-insensitive fallback resolves it
    });
    const db = makeLoginDb(findOneImpl);
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: identifier, password: 'pw' }, {});

    expect(result.token).toBeTruthy();
    expect(result.user.username).toBe('johnsmith');

    const lookupCalls = orLookupCalls(db.usersCollectionApi.findOne);
    expect(lookupCalls).toHaveLength(2);
    expect(lookupCalls[0][0]).toEqual({
      $or: [
        { email: identifier },
        { username: identifier },
      ],
    });
    expect(lookupCalls[1][0]).toEqual({
      $or: [
        { email: { $regex: `^${identifier}$`, $options: 'i' } },
        { username: { $regex: `^${identifier}$`, $options: 'i' } },
      ],
    });
  });

  it('escapes regex metacharacters in the identifier before issuing the case-insensitive fallback query', async () => {
    const identifier = 'a+b.c'; // '+' and '.' are regex metacharacters
    const db = makeLoginDb(vi.fn().mockResolvedValue(null)); // never found -> exercises both stages

    await expect(
      authService.login(db, { email: identifier, password: 'pw' }, {})
    ).rejects.toThrow('Credenciais inválidas');

    const lookupCalls = orLookupCalls(db.usersCollectionApi.findOne);
    expect(lookupCalls).toHaveLength(2);
    // Stage 1 (exact match) is a literal equality lookup -- no escaping
    // applies there, and none is needed since it's not a pattern.
    expect(lookupCalls[0][0]).toEqual({
      $or: [
        { email: identifier },
        { username: identifier },
      ],
    });
    // Stage 2 must carry the ESCAPED identifier inside $regex, not the raw
    // caller-supplied string -- an unescaped '.' or '+' reaching $regex
    // would let the identifier act as a pattern instead of a literal match.
    expect(lookupCalls[1][0]).toEqual({
      $or: [
        { email: { $regex: '^a\\+b\\.c$', $options: 'i' } },
        { username: { $regex: '^a\\+b\\.c$', $options: 'i' } },
      ],
    });
  });
});
