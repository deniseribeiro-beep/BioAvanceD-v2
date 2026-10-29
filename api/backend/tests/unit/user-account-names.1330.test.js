// #1330: users documents are stored under the dict-02 UserAccount names
// (P1X-0182..0208). #1386: readers no longer fall back to the legacy names
// (name, password, status, mfaActivationDate, lastLogin, passwordHistory,
// forceReset, passwordResetExpires), so a legacy value is not read; a write
// to a document still carrying one moves the rest to the canonical names and
// $unsets the legacy ones.
import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authService = require('../../src/services/auth.service');
const userSecurityService = require('../../src/services/user-security.service');
const UserModel = require('../../src/models/User');
const { hashToken } = require('../../src/utils/tokenHash');

afterEach(() => { vi.restoreAllMocks(); });

const USER_ID = '507f1f77bcf86cd799439011';
const PASSWORD = 'Legacy@Password-2026';
const OLD_PASSWORD = 'Older@Password-2025';
const CURRENT_HASH = bcrypt.hashSync(PASSWORD, 4);
const OLD_HASH = bcrypt.hashSync(OLD_PASSWORD, 4);

// An in-memory users collection with the update semantics these writes use:
// $set, $unset and $inc, filters on equality, $exists and top-level $or. Its
// own minimal copy, since the shared fake db does not apply $unset.
function usersStore(docs) {
  const matches = (doc, filter) => Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((clause) => matches(doc, clause));
    if (expected && typeof expected === 'object' && '$exists' in expected) {
      return (doc[key] !== undefined) === Boolean(expected.$exists);
    }
    return String(doc[key]) === String(expected);
  });
  return {
    docs,
    findOne: vi.fn(async (filter) => {
      const doc = docs.find((candidate) => matches(candidate, filter));
      return doc ? structuredClone(doc) : null;
    }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((candidate) => matches(candidate, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by;
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

// Every other collection answers like an empty one: no policy document (the
// defaults apply), no role assignment, and accepted writes.
function makeDb(users) {
  const other = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'id-1' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    countDocuments: vi.fn().mockResolvedValue(0),
  };
  return { collection: vi.fn((name) => (name === 'users' ? users : other)) };
}

// Canonical password, status and last login, so it signs in as a returning
// user; the other renamed fields still under their legacy names.
function legacyUser(overrides = {}) {
  return {
    _id: USER_ID,
    name: 'Conta Legada',
    email: 'legada@bioavanced.test',
    username: 'legada',
    passwordHash: CURRENT_HASH,
    accountStatus: 'active',
    mfaEnabled: false,
    mfaSecretCiphertext: null,
    mfaActivationDate: null,
    lastLoginAt: new Date('2026-01-01T00:00:00Z'),
    passwordHistory: [OLD_HASH],
    passwordChangedAt: new Date(),
    forceReset: false,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

function expectOnlyCanonicalNames(doc) {
  for (const legacy of UserModel.LEGACY_FIELDS) {
    expect(doc).not.toHaveProperty(legacy);
  }
}

describe('#1330/#1386: a user still carrying legacy names', () => {
  it('signs in, and the sign-in moves the document to the canonical names with the legacy ones $unset', async () => {
    const users = usersStore([legacyUser()]);
    const db = makeDb(users);

    const result = await authService.processLogin(db, await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {});

    expect(result.token).toBeTruthy();
    for (const key of ['password', 'passwordHash', 'passwordHistory', 'passwordHistoryHashes']) {
      expect(result.user).not.toHaveProperty(key);
    }

    const [stored] = users.docs;
    expectOnlyCanonicalNames(stored);
    expect(stored).toMatchObject({
      displayName: 'Conta Legada',
      passwordHash: CURRENT_HASH,
      accountStatus: 'active',
      mfaSetupAt: null,
      passwordHistoryHashes: [OLD_HASH],
      forcePasswordReset: false,
    });
    expect(stored.lastLoginAt).toBeInstanceOf(Date);

    const move = users.updateOne.mock.calls.find(([, update]) => update.$unset && update.$unset.name === '');
    expect(move[0]).toMatchObject({ _id: USER_ID, displayName: { $exists: false }, name: { $exists: true } });
  });

  it('signs in again after the move, now through the canonical names', async () => {
    const users = usersStore([legacyUser()]);
    const db = makeDb(users);
    await authService.processLogin(db, await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {});

    const writesBefore = users.updateOne.mock.calls.length;
    const again = await authService.processLogin(db, await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {});

    expect(again.token).toBeTruthy();
    // The lastLoginAt write only: a canonical document needs no move.
    expect(users.updateOne.mock.calls.length - writesBefore).toBe(1);
  });

  it('a move from a stale copy does not undo a value written since: a name set meanwhile stays', async () => {
    const users = usersStore([legacyUser()]);
    const db = makeDb(users);
    const staleCopy = await users.findOne({ _id: USER_ID });
    // An administrator renames the account after the sign-in read it.
    await users.updateOne({ _id: USER_ID }, UserModel.storedUpdateOf({ displayName: 'Renomeada' }));

    await authService.processLogin(db, staleCopy, PASSWORD, null, users, {});

    const [stored] = users.docs;
    expect(stored.displayName).toBe('Renomeada');
    expect(stored).not.toHaveProperty('name');
    // The whole move was skipped; the next write moves the rest.
    expect(stored.passwordHistory).toEqual([OLD_HASH]);
  });

  it('is not signed in through a legacy password hash alone', async () => {
    const users = usersStore([legacyUser({ passwordHash: undefined, password: CURRENT_HASH })]);
    await expect(
      authService.processLogin(makeDb(users), await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {})
    ).rejects.toThrow();
    expect(users.docs[0].lastLoginAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('changes its password: the legacy history is not read, and the write removes it', async () => {
    const users = usersStore([legacyUser()]);
    const db = makeDb(users);

    const NEW_PASSWORD = 'Brand@New-Password-2026';
    await userSecurityService.updatePassword(db, USER_ID, PASSWORD, NEW_PASSWORD);

    const [stored] = users.docs;
    expectOnlyCanonicalNames(stored);
    expect(await bcrypt.compare(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(stored.passwordHistoryHashes).toEqual([CURRENT_HASH]);
    expect(stored).toMatchObject({ displayName: 'Conta Legada', accountStatus: 'active', forcePasswordReset: false });
  });

  it('refuses a reset whose window is stored only under the legacy passwordResetExpires', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: USER_ID });
    const users = usersStore([legacyUser({
      passwordResetTokenHash: hashToken('reset-token'),
      passwordResetExpires: new Date(Date.now() + 60_000),
    })]);
    const db = makeDb(users);

    await expect(authService.resetPassword(db, 'reset-token', 'Reset@Password-2026x', {})).rejects.toThrow('expirado');
    expect(users.docs[0].passwordHash).toBe(CURRENT_HASH);
  });
});

describe('#1330: a canonical-named user', () => {
  function canonicalUser(overrides = {}) {
    return {
      _id: USER_ID,
      displayName: 'Conta Canônica',
      email: 'canonica@bioavanced.test',
      username: 'canonica',
      passwordHash: CURRENT_HASH,
      accountStatus: 'active',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      mfaSetupAt: null,
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
      passwordHistoryHashes: [OLD_HASH],
      passwordChangedAt: new Date(),
      forcePasswordReset: false,
      failedLoginAttempts: 0,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      ...overrides,
    };
  }

  it('is refused at sign-in when accountStatus is blocked, though it has no legacy status', async () => {
    const users = usersStore([canonicalUser({ accountStatus: 'blocked' })]);
    await expect(
      authService.processLogin(makeDb(users), await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {})
    ).rejects.toThrow('Usuário bloqueado');
  });

  it('is sent to the password change when forcePasswordReset is set', async () => {
    const users = usersStore([canonicalUser({ forcePasswordReset: true })]);
    const result = await authService.processLogin(makeDb(users), await users.findOne({ _id: USER_ID }), PASSWORD, null, users, {});
    expect(result.requiresPasswordChange).toBe(true);
    expect(result.token).toBeUndefined();
  });

  it('requests a reset under passwordResetExpiresAt, and an expired one is refused', async () => {
    const users = usersStore([canonicalUser()]);
    const db = makeDb(users);
    vi.spyOn(require('../../src/services/NotificationService'), 'sendPasswordReset').mockResolvedValue(undefined);

    await authService.requestPasswordReset(db, 'canonica@bioavanced.test', {});
    const [stored] = users.docs;
    expect(stored.passwordResetExpiresAt).toBeInstanceOf(Date);
    expect(stored).not.toHaveProperty('passwordResetExpires');

    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: USER_ID });
    stored.passwordResetTokenHash = hashToken('reset-token');
    stored.passwordResetExpiresAt = new Date(Date.now() - 1000);
    await expect(authService.resetPassword(db, 'reset-token', 'Reset@Password-2026x', {})).rejects.toThrow('expirado');
  });
});
