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

    const result = await authService.login(db, { email: 'exact@test.com', password: 'pw-of-at-least-15' }, {});

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

    const result = await authService.login(db, { email: identifier, password: 'pw-of-at-least-15' }, {});

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
      authService.login(db, { email: identifier, password: 'pw-of-at-least-15' }, {})
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

// ---------------------------------------------------------------------------
// #1052: login() leaked account identifiers into the application log.
//
// src/utils/logger.js is a 26-line console shim with no transports, so every
// line below lands wherever the container's stdout goes. Four sites, all on
// paths an UNAUTHENTICATED caller can drive:
//
//   1. the not-found branch ran `usersCollection.find({}, ...).limit(3)` and
//      logged three REAL users' emails and usernames at info level -- an
//      attacker-triggerable dump, reachable by anyone who types a wrong
//      username. `git log -S` puts it in c68aea04, "fix: forcing build
//      command 2", whose message never mentions it: a debug aid that rode in
//      on a build-poking commit rather than something deliberately shipped.
//   2. the SUCCESS branch logged the resolved user's username AND email on
//      every login. NOT named by #1052, and worse than (1) in frequency --
//      it fires on every successful lookup, not only on a typo.
//   3. the malformed-password-field branch logged the same pair again.
//      Also not named by #1052.
//   4. the attempt line and the not-found line echoed the raw caller-supplied
//      identifier verbatim -- the log-injection/forging shape, since the
//      shim does no escaping and a newline in the identifier forges a line.
//
// (1) was additionally an unbounded extra round trip an anonymous caller
// could trigger on the failure path, inside the very window a675abb7 (#1036)
// works to keep constant -- so removing it helps that equalizer rather than
// competing with it.
//
// These tests pin the ABSENCE of identifiers and raw input in log output.
// The CONTROL tests at the end assert behaviour the fix does not change and
// are green both before and after it; a red there would mean the harness is
// wrong, not that the bug reproduced (#695).
describe('AuthService.login -- #1052 no account identifiers in the application log', () => {
  const SECRET_EMAIL = 'victim@example.test';
  const SECRET_USERNAME = 'victimuser';

  // Captures every message the service emits through the logger shim, across
  // all four levels, flattened to one searchable string per call. Asserting
  // over the whole transcript rather than a single spy is what makes these
  // tests indifferent to WHICH line a future edit puts an identifier on.
  function captureLogs() {
    const logger = require('../../src/utils/logger');
    const lines = [];
    const record = (level) => (message, ...args) => {
      lines.push([level, message, ...args].map((v) => String(v)).join(' '));
    };
    vi.spyOn(logger, 'info').mockImplementation(record('info'));
    vi.spyOn(logger, 'warn').mockImplementation(record('warn'));
    vi.spyOn(logger, 'error').mockImplementation(record('error'));
    vi.spyOn(logger, 'debug').mockImplementation(record('debug'));
    return lines;
  }

  it('does not query for sample users, at all, when the identifier is not found', async () => {
    const db = makeLoginDb(vi.fn().mockResolvedValue(null));

    await expect(
      authService.login(db, { email: 'nobody@example.test', password: 'pw-of-at-least-15' }, {})
    ).rejects.toThrow('Credenciais inválidas');

    // The debug dump was the ONLY `find` the users collection saw on this
    // path, so its absence is provable directly rather than by inspecting
    // what was logged.
    expect(db.usersCollectionApi.find).not.toHaveBeenCalled();
  });

  it('does not log another account’s email or username when the identifier is not found', async () => {
    const lines = captureLogs();
    const db = makeLoginDb(vi.fn().mockResolvedValue(null));
    // Seed the sample-user query with real-looking identifiers, so that if
    // the dump is ever reintroduced this test fails on its actual payload
    // rather than merely on the shape of the call.
    db.usersCollectionApi.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { email: SECRET_EMAIL, username: SECRET_USERNAME },
        ]),
      }),
    });

    await expect(
      authService.login(db, { email: 'nobody@example.test', password: 'pw-of-at-least-15' }, {})
    ).rejects.toThrow('Credenciais inválidas');

    const transcript = lines.join('\n');
    expect(transcript).not.toContain(SECRET_EMAIL);
    expect(transcript).not.toContain(SECRET_USERNAME);
  });

  it('does not log the resolved user’s email or username on a SUCCESSFUL login', async () => {
    const lines = captureLogs();
    const user = makeUser({ email: SECRET_EMAIL, username: SECRET_USERNAME });
    const db = makeLoginDb(vi.fn().mockResolvedValue(user));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: SECRET_EMAIL, password: 'pw-of-at-least-15' }, {});
    expect(result.token).toBeTruthy();

    const transcript = lines.join('\n');
    expect(transcript).not.toContain(SECRET_EMAIL);
    expect(transcript).not.toContain(SECRET_USERNAME);
  });

  it('does not log the resolved user’s email or username when the stored password field is unusable', async () => {
    const lines = captureLogs();
    // A password field too short to be a bcrypt hash drives processLogin's
    // "campo de senha ausente ou inválido" branch, which logged the pair.
    const user = makeUser({ email: SECRET_EMAIL, username: SECRET_USERNAME, password: 'short' });
    const db = makeLoginDb(vi.fn().mockResolvedValue(user));

    await expect(
      authService.login(db, { email: SECRET_EMAIL, password: 'pw-of-at-least-15' }, {})
    ).rejects.toThrow();

    const transcript = lines.join('\n');
    expect(transcript).not.toContain(SECRET_EMAIL);
    expect(transcript).not.toContain(SECRET_USERNAME);
  });

  it('does not echo the raw caller-supplied identifier into the log', async () => {
    const lines = captureLogs();
    // Carries a newline, which is what makes a verbatim echo a log-FORGING
    // surface rather than merely a noisy one: the shim does no escaping, so
    // everything after the newline reads as its own log line.
    const forged = 'attacker\n[INFO] 2026-01-01T00:00:00.000Z - forged line';
    const db = makeLoginDb(vi.fn().mockResolvedValue(null));

    await expect(
      authService.login(db, { email: forged, password: 'pw-of-at-least-15' }, {})
    ).rejects.toThrow('Credenciais inválidas');

    const transcript = lines.join('\n');
    expect(transcript).not.toContain('forged line');
    expect(transcript).not.toContain('attacker');
  });

  // --- CONTROL: unchanged by the fix, green before and after (#695) --------

  it('CONTROL: still rejects an unknown identifier with the generic message', async () => {
    const db = makeLoginDb(vi.fn().mockResolvedValue(null));

    await expect(
      authService.login(db, { email: 'nobody@example.test', password: 'pw-of-at-least-15' }, {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('CONTROL: still issues a token for a valid identifier and password', async () => {
    const user = makeUser();
    const db = makeLoginDb(vi.fn().mockResolvedValue(user));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: user.email, password: 'pw-of-at-least-15' }, {});

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(user.email);
  });
});

// #914 / RF001, RF014 AC#3: authentication.requireMFA (dict-02 P1X-0278) decides
// whether a non-admin's first login must enrol MFA. It was never read, so the
// enrolment ran whatever the Administrador had configured.
describe('AuthService.login -- #914 authentication.requireMFA', () => {
  function withSecurityConfig(db, config) {
    const base = db.collection;
    db.collection = vi.fn((name) => (name === 'security_config'
      ? { findOne: vi.fn().mockResolvedValue(config) }
      : base(name)));
    return db;
  }

  function firstLoginUser() {
    return makeUser({ lastLogin: null, mfaEnabled: false });
  }

  it('requireMFA: false lets a non-admin first login through without the enrolment step', async () => {
    const db = withSecurityConfig(makeLoginDb(vi.fn().mockResolvedValue(firstLoginUser())), {
      _id: 'main', authentication: { requireMFA: false },
    });
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: 'user@test.com', password: 'pw-of-at-least-15' }, {});

    expect(result.requiresMFASetup).toBeUndefined();
    expect(result.token).toBeTruthy();
  });

  it('requireMFA: true keeps the mandatory first-login enrolment', async () => {
    const db = withSecurityConfig(makeLoginDb(vi.fn().mockResolvedValue(firstLoginUser())), {
      _id: 'main', authentication: { requireMFA: true },
    });
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: 'user@test.com', password: 'pw-of-at-least-15' }, {});

    expect(result.requiresMFASetup).toBe(true);
    expect(result.token).toBeUndefined();
  });

  it('no policy document keeps MFA mandatory -- the canonical default, and the behaviour before the read existed', async () => {
    const db = withSecurityConfig(makeLoginDb(vi.fn().mockResolvedValue(firstLoginUser())), null);
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: 'user@test.com', password: 'pw-of-at-least-15' }, {});

    expect(result.requiresMFASetup).toBe(true);
  });

  it('an unreadable policy fails CLOSED, keeping MFA mandatory', async () => {
    const db = makeLoginDb(vi.fn().mockResolvedValue(firstLoginUser()));
    const base = db.collection;
    db.collection = vi.fn((name) => (name === 'security_config'
      ? { findOne: vi.fn().mockRejectedValue(new Error('config unavailable')) }
      : base(name)));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    const result = await authService.login(db, { email: 'user@test.com', password: 'pw-of-at-least-15' }, {});

    expect(result.requiresMFASetup).toBe(true);
  });
});
