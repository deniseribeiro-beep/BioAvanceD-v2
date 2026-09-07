import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authService = require('../../src/services/auth.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const logger = require('../../src/utils/logger');
// #797: findOne/updateOne mocks that actually honour the filter they are
// handed, instead of the identity stub (`findOne: vi.fn().mockResolvedValue(doc)`)
// that returns the same document regardless of the query. Used below only
// where a test's function under test actually issues a findOne against the
// `users` collection with a filter worth distinguishing (setupMFAFirstLogin,
// enableMFAFirstLogin, requestPasswordReset -- all $or: [{email},{username}]
// lookups). The `AuthService.processLogin` describe block deliberately does
// NOT use this: processLogin(db, user, ...) takes `user` as a parameter and
// never calls usersCollection.findOne itself -- that lookup lives in
// AuthService.login(), which this file does not test -- so tightening findOne
// there would assert on a call that never happens.
const { createMatchingCollection, createFilterCaptureStore } = require('../factories/filter.factory');

afterEach(() => { vi.restoreAllMocks(); });

function makeDb(overrides = {}) {
  const collectionApi = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-id' } }),
    ...overrides,
  };
  // #426: processLogin resolves admin status via rbac-assignment.service
  // (roles/userRoleAssignments), not accessType/roleName directly — those
  // collections need a real find().toArray() regardless of what the
  // `users` collection override looks like for a given test.
  const rbacCollectionApi = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  };
  const RBAC_COLLECTIONS = new Set(['roles', 'permissions', 'userRoleAssignments']);
  return {
    collection: vi.fn((name) => (RBAC_COLLECTIONS.has(name) ? rbacCollectionApi : collectionApi)),
    _collectionApi: collectionApi,
  };
}

const HASHED = 'a'.repeat(60); // 20+ chars to pass length check
const BASE_USER = {
  _id: { toString: () => 'user-1' },
  email: 'user@test.com',
  username: 'user1',
  name: 'User One',
  password: HASHED,
  accessType: 2,
  status: 'active',
  lastLogin: new Date('2020-01-01'),
  mfaEnabled: false,
  mfaSecret: null,
};

describe('AuthService.processLogin', () => {
  it('rejects when password field is missing/invalid', async () => {
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, password: 'short' }) });
    await expect(
      authService.processLogin(db, { ...BASE_USER, password: 'short' }, 'pw', null, db.collection(), {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('rejects on bcrypt mismatch', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb();
    await expect(
      authService.processLogin(db, BASE_USER, 'wrong', null, db.collection(), {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('rejects login when bcrypt.compare itself throws', async () => {
    vi.spyOn(bcrypt, 'compare').mockRejectedValue(new Error('bcrypt boom'));
    const db = makeDb();
    await expect(
      authService.processLogin(db, BASE_USER, 'pw', null, db.collection(), {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('rejects for inactive/suspended/blocked status', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    await expect(
      authService.processLogin(db, { ...BASE_USER, status: 'suspended' }, 'pw', null, db.collection(), {})
    ).rejects.toThrow('Usuário suspenso');
  });

  it('requires MFA setup on first login for non-admin', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    const user = { ...BASE_USER, lastLogin: null, mfaEnabled: false };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresMFASetup).toBe(true);
    expect(result.tempToken).toBeTruthy();
  });

  // #433: tempToken's accessType claim must come from the live RBAC
  // assignment (resolveUserHierarchyLevel), not the stale unpopulated
  // user.accessType field (#427) — same bug #431 fixed for issueAccessToken.
  it('resolves tempToken accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-x', roleCode: 'gestor', roleStatus: 'active', hierarchyLevel: 3 }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-x', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const user = { ...BASE_USER, accessType: 2, lastLogin: null, mfaEnabled: false };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresMFASetup).toBe(true);
    const decoded = jwt.decode(result.tempToken);
    expect(decoded.accessType).toBe(3);
  });

  // #434: processLogin's first-login MFA-setup response body's
  // user.accessType must come from the live RBAC assignment
  // (resolveUserHierarchyLevel), not the stale unpopulated
  // user.accessType field (#427) — same family as #433's tempToken fix,
  // but the response body field, not the JWT claim.
  it('resolves the MFA-setup response body accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-x', roleCode: 'gestor', roleStatus: 'active', hierarchyLevel: 3 }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-x', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const user = { ...BASE_USER, accessType: 2, lastLogin: null, mfaEnabled: false };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresMFASetup).toBe(true);
    expect(result.user.accessType).toBe(3);
  });

  it('skips mandatory MFA setup for admin on first login', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-admin', roleCode: 'administrator', roleStatus: 'active' }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-admin', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const user = { ...BASE_USER, lastLogin: null, accessType: 4, roleName: 'Administrador', mfaEnabled: false };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresMFASetup).toBeUndefined();
    expect(result.token).toBeTruthy();
  });

  it('asks for MFA code when mfaEnabled and none provided', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET' };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresMFA).toBe(true);
  });

  it('rejects invalid MFA code and increments failed attempts', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 0 };
    await expect(
      authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
    ).rejects.toThrow('Código MFA inválido');
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      { $set: { mfaFailedAttempts: 1 } }
    );
  });

  it('locks MFA after 5 failed attempts', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    // #650: the lockout branch now also fires dispatchNotification (fire-
    // and-forget) -- spied so it doesn't hit the real notificationRule
    // lookup against this test's bare collection mock.
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 4 };
    await expect(
      authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
    ).rejects.toThrow('MFA bloqueado');
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      { $set: { mfaLocked: true } }
    );
  });

  it('#650 (RF015 segurança) dispatches a mfa_brute_force_lockout notification when MFA locks', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 4 };
    await expect(
      authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
    ).rejects.toThrow('MFA bloqueado');
    expect(dispatchSpy).toHaveBeenCalledWith(db, {
      eventType: 'mfa_brute_force_lockout',
      sourceEventType: 'User',
      sourceEventId: user._id,
      payload: {
        userId: 'user-1',
        username: user.username,
        failedAttempts: 5
      }
    });
  });

  it('#650 (RF015 segurança) does not dispatch a notification on an ordinary MFA rejection (not yet locked)', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const dispatchSpy = vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(null);
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 0 };
    await expect(
      authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
    ).rejects.toThrow('Código MFA inválido');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('#685 does not crash the process when the notification engine itself fails on lockout (unhandled rejection guard)', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    vi.spyOn(notificationDispatchService, 'dispatchNotification').mockRejectedValue(new Error('notificationRules lookup failed'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 4 };
    await expect(
      authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
    ).rejects.toThrow('MFA bloqueado');

    // The dispatch call is fire-and-forget (`void`, no await in processLogin)
    // -- give its rejection a turn of the microtask queue to reach a .catch()
    // before asserting it was actually handled, not left unhandled. Matched
    // on the [NOTIFICATION_DISPATCH]-prefixed message specifically -- the
    // outer catch's generic 'Erro no login' logger.error call (unrelated to
    // this rejection) would otherwise make this assertion pass regardless
    // of whether the dispatch rejection was ever actually caught.
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NOTIFICATION_DISPATCH]'),
      expect.anything()
    ));
  });

  it('logs in successfully with a valid MFA code and resets failed attempts', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-1' } }) };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaFailedAttempts: 3 };
    const result = await authService.processLogin(db, user, 'pw', '123456', db.collection(), {});
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(user.email);
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      { $set: { mfaFailedAttempts: 0 } }
    );
  });

  // #683: mfaLocked was written by the 5-failed-attempts path above and read
  // by nothing in the login path -- auth.routes.js only displays it on a
  // status screen. So the 'lockout' never denied anything: the next attempt
  // was processed as if nothing had happened, mfaFailedAttempts kept climbing
  // past 5, and a correct code still logged the user straight in.
  //
  // dict-02 P1X-0200 makes mfaLocked a 1..1 Core boolean ('Indica bloqueio
  // específico do segundo fator'). Its companion mfaLockedUntil (P1X-0201) is
  // 0..1 Condicional -- 'quando a política usar duração' -- so a timed
  // auto-unlock is explicitly optional and no duration policy exists here.
  // The flag alone is therefore the whole contract: locked until an admin
  // clears it via the existing reset-mfa path.
  describe('mfaLocked enforcement (#683)', () => {
    it('refuses a locked account even when the MFA code is correct', async () => {
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
      const db = makeDb();
      const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaLocked: true, mfaFailedAttempts: 5 };

      await expect(
        authService.processLogin(db, user, 'pw', '123456', db.collection(), {})
      ).rejects.toThrow(/MFA bloqueado/);
    });

    it('refuses a locked account before any MFA processing, so failed attempts stop climbing', async () => {
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
      const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
      const db = makeDb(collectionApi);
      const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaLocked: true, mfaFailedAttempts: 7 };

      await expect(
        authService.processLogin(db, user, 'pw', '000000', db.collection(), {})
      ).rejects.toThrow(/MFA bloqueado/);

      expect(collectionApi.updateOne).not.toHaveBeenCalledWith(
        { _id: user._id },
        { $set: { mfaFailedAttempts: 8 } }
      );
    });

    it('refuses a locked account that also has no MFA code supplied, instead of asking for one', async () => {
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      const db = makeDb();
      const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaLocked: true };

      await expect(
        authService.processLogin(db, user, 'pw', null, db.collection(), {})
      ).rejects.toThrow(/MFA bloqueado/);
    });

    it('still refuses a wrong password with the generic credentials error, not the lock message', async () => {
      // The gate sits after password verification, matching where the status
      // guard already sits. A locked account must not be distinguishable from
      // any other account to someone who does not know the password.
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
      const db = makeDb();
      const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaLocked: true };

      await expect(
        authService.processLogin(db, user, 'wrong', null, db.collection(), {})
      ).rejects.toThrow(/Credenciais inválidas/);
    });

    it('lets an unlocked account through as before', async () => {
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
      vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
      const db = makeDb({ findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-1' } }) });
      const user = { ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET', mfaLocked: false, mfaFailedAttempts: 2 };

      const result = await authService.processLogin(db, user, 'pw', '123456', db.collection(), {});

      expect(result.token).toBeTruthy();
    });
  });

  it('logs in successfully without MFA when not enabled', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    const result = await authService.processLogin(db, BASE_USER, 'pw', null, db.collection(), {});
    expect(result.token).toBeTruthy();
    expect(result.sessionID).toBeTruthy();
  });

  // #434: successful-login response body's user.accessType must come from
  // the live RBAC assignment, not the stale unpopulated user.accessType
  // field (#427).
  it('resolves the successful-login response body accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-x', roleCode: 'gestor', roleStatus: 'active', hierarchyLevel: 3 }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-x', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const user = { ...BASE_USER, accessType: 2 };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.user.accessType).toBe(3);
  });

  // RF014 AC#4 (#648): admin-forced password reset -- forceReset blocks a
  // full session until a new password is set. Mirrors changePassword's own
  // validate/hash/history update, inlined into the login path since this
  // case has no prior authenticated session to call that endpoint with.
  it('returns requiresPasswordChange without issuing a token when forceReset is set and no newPassword given', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    const user = { ...BASE_USER, forceReset: true };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {});
    expect(result.requiresPasswordChange).toBe(true);
    expect(result.token).toBeUndefined();
  });

  it('rejects a newPassword that fails strength validation when forceReset is set', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb();
    const user = { ...BASE_USER, forceReset: true };
    await expect(
      authService.processLogin(db, user, 'pw', null, db.collection(), {}, 'weak')
    ).rejects.toThrow();
  });

  it('rejects a newPassword that matches a recently used password when forceReset is set', async () => {
    // The reused candidate must itself pass validateStrength (otherwise that
    // earlier check would throw first) -- so the old login password and the
    // rejected "new" password are the same strong-looking string, and
    // bcrypt.compare (validateReuse's own reuse check) matches only that one.
    const OLD_PASSWORD = 'OldStrongPass1!';
    vi.spyOn(bcrypt, 'compare').mockImplementation(async (candidate) => candidate === OLD_PASSWORD);
    const db = makeDb();
    const user = { ...BASE_USER, forceReset: true };
    await expect(
      authService.processLogin(db, user, OLD_PASSWORD, null, db.collection(), {}, OLD_PASSWORD)
    ).rejects.toThrow('já utilizada recentemente');
  });

  it('clears forceReset, updates the password, and issues a full session when a valid newPassword is given', async () => {
    vi.spyOn(bcrypt, 'compare').mockImplementation(async (candidate) => candidate === 'pw');
    const collectionApi = { findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-1' } }) };
    const db = makeDb(collectionApi);
    const user = { ...BASE_USER, forceReset: true };
    const result = await authService.processLogin(db, user, 'pw', null, db.collection(), {}, 'NewStrongPass1!');
    expect(result.token).toBeTruthy();
    expect(result.requiresPasswordChange).toBeUndefined();
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      expect.objectContaining({
        $set: expect.objectContaining({ forceReset: false, password: expect.any(String) })
      })
    );
  });
});

describe('AuthService.setupMFAFirstLogin', () => {
  it('throws when username/password missing', async () => {
    const db = makeDb();
    await expect(authService.setupMFAFirstLogin(db, {})).rejects.toThrow('obrigatórios');
  });

  it('throws when user not found', async () => {
    // #797: proves the $or lookup queried email/username with the given
    // term even on the miss path -- an identity stub returning null can't
    // distinguish "queried the right fields and missed" from "queried the
    // wrong field entirely" (the #788-shaped bug this factory exists for).
    const filterStore = createFilterCaptureStore();
    const usersMock = createMatchingCollection([], { ...filterStore, key: 'users' });
    const db = makeDb(usersMock);
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'x', password: 'y' })
    ).rejects.toThrow('Credenciais inválidas');
    expect(filterStore.capturedFilters.users).toEqual({
      $or: [{ email: 'x' }, { username: 'x' }]
    });
  });

  it('throws when password does not match', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    // Matched via the username arm of the $or (email differs) -- a real
    // match, not a stub returning the doc regardless of the filter.
    const db = makeDb(createMatchingCollection([{ ...BASE_USER }]));
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'user1', password: 'wrong' })
    ).rejects.toThrow('Credenciais inválidas');
  });

  // #1032: still refuses, but with the GENERIC message -- the refusal must not
  // be distinguishable from a wrong password by an unauthenticated caller.
  it('refuses when MFA already configured and not first login, indistinguishably', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb(
      createMatchingCollection([{ ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET' }])
    );
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('generates a QR code and secret on success', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(QRCode, 'toDataURL').mockResolvedValue('data:image/png;base64,xyz');
    // #797: happy-path proof that the doc was found via the intended
    // email/username fields, not merely returned regardless of the filter.
    // Asserted via the findOne mock's own call history rather than the
    // shared capturedFilters slot: this test's success path also calls
    // updateOne (to persist mfaSecret) on the same collection, and
    // capturedFilters records only the most recent filter per collection --
    // that write would otherwise clobber the findOne filter we care about.
    const usersMock = createMatchingCollection([{ ...BASE_USER, lastLogin: null }]);
    const db = makeDb(usersMock);
    const result = await authService.setupMFAFirstLogin(db, { username: 'user1', password: 'pw' });
    expect(result.secret).toBeTruthy();
    expect(result.qrCode).toBe('data:image/png;base64,xyz');
    expect(usersMock.findOne).toHaveBeenCalledWith({
      $or: [{ email: 'user1' }, { username: 'user1' }]
    });
  });

  it('throws when QRCode generation fails', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(QRCode, 'toDataURL').mockRejectedValue(new Error('qr fail'));
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, lastLogin: null }]));
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Erro ao gerar QR Code');
  });
});

describe('AuthService.enableMFAFirstLogin', () => {
  it('throws when username/password missing', async () => {
    const db = makeDb();
    await expect(authService.enableMFAFirstLogin(db, {}, '123456', {})).rejects.toThrow('obrigatórios');
  });

  it('throws when mfaCode missing', async () => {
    const db = makeDb();
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'u', password: 'p' }, null, {})
    ).rejects.toThrow('Código MFA é obrigatório');
  });

  it('throws when user not found', async () => {
    // #797: proves the $or lookup queried email/username with the given
    // term even on the miss path.
    const filterStore = createFilterCaptureStore();
    const usersMock = createMatchingCollection([], { ...filterStore, key: 'users' });
    const db = makeDb(usersMock);
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'u', password: 'p' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
    expect(filterStore.capturedFilters.users).toEqual({
      $or: [{ email: 'u' }, { username: 'u' }]
    });
  });

  it('throws when password mismatch', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER }]));
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'wrong' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('throws when mfaSecret not configured', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, mfaSecret: null }]));
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('MFA não configurado');
  });

  it('throws on invalid MFA code', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, mfaSecret: 'SECRET' }]));
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '000000', {})
    ).rejects.toThrow('Código MFA inválido');
  });

  it('activates MFA and issues session tokens on success', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    // #797: happy-path proof that the doc was found via the intended
    // email/username fields. Asserted via the findOne mock's call history,
    // not the shared capturedFilters slot -- this success path also calls
    // updateOne (to persist mfaEnabled) on the same collection, which would
    // otherwise clobber the recorded findOne filter.
    const usersMock = createMatchingCollection([{ ...BASE_USER, mfaSecret: 'SECRET' }]);
    const db = makeDb(usersMock);
    const result = await authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {});
    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
    expect(usersMock.findOne).toHaveBeenCalledWith({
      $or: [{ email: 'user1' }, { username: 'user1' }]
    });
    expect(result.user.mfaEnabled).toBe(true);
  });

  // #434: response body's user.accessType must come from the live RBAC
  // assignment, not the stale unpopulated user.accessType field (#427).
  it('resolves the response body accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, accessType: 2, mfaSecret: 'SECRET' }]));
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-x', roleCode: 'gestor', roleStatus: 'active', hierarchyLevel: 3 }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-x', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const result = await authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {});
    expect(result.user.accessType).toBe(3);
  });
});

describe('AuthService.setupMFA', () => {
  it('throws when user not found', async () => {
    const db = makeDb();
    await expect(authService.setupMFA(db, '507f1f77bcf86cd799439011')).rejects.toThrow('não encontrado');
  });

  it('generates secret and QR code for an existing user', async () => {
    vi.spyOn(QRCode, 'toDataURL').mockResolvedValue('data:image/png;base64,abc');
    const db = makeDb({ findOne: vi.fn().mockResolvedValue(BASE_USER) });
    const result = await authService.setupMFA(db, '507f1f77bcf86cd799439011');
    expect(result.secret).toBeTruthy();
    expect(result.qrCode).toBe('data:image/png;base64,abc');
  });
});

describe('AuthService.enableMFA', () => {
  it('throws when user or mfaSecret missing', async () => {
    const db = makeDb();
    await expect(authService.enableMFA(db, '507f1f77bcf86cd799439011', '123456')).rejects.toThrow('MFA não configurado');
  });

  it('throws on invalid MFA code', async () => {
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: 'SECRET' }) });
    await expect(
      authService.enableMFA(db, '507f1f77bcf86cd799439011', '000000')
    ).rejects.toThrow('Código MFA inválido');
  });

  it('activates MFA without issuing tokens when not first login', async () => {
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: 'SECRET', lastLogin: new Date() }) });
    const result = await authService.enableMFA(db, '507f1f77bcf86cd799439011', '123456');
    expect(result).toEqual({ success: true });
  });

  it('issues session tokens when this was the first login', async () => {
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: 'SECRET', lastLogin: null }) });
    const result = await authService.enableMFA(db, '507f1f77bcf86cd799439011', '123456');
    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
  });

  // #434: first-login response body's user.accessType must come from the
  // live RBAC assignment, not the stale unpopulated user.accessType field
  // (#427).
  it('resolves the first-login response body accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, accessType: 2, mfaSecret: 'SECRET', lastLogin: null }) });
    db.collection.mockImplementation((name) => {
      if (name === 'roles') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ roleId: 'role-x', roleCode: 'gestor', roleStatus: 'active', hierarchyLevel: 3 }]) }) };
      if (name === 'userRoleAssignments') return { findOne: vi.fn(), find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ userAccountId: 'user-1', roleId: 'role-x', assignmentStatus: 'active', validUntil: null }]) }) };
      return db._collectionApi;
    });
    const result = await authService.enableMFA(db, '507f1f77bcf86cd799439011', '123456');
    expect(result.user.accessType).toBe(3);
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('returns generic success when user not found (no enumeration)', async () => {
    // #797: proves the $or lookup queried email/username with the given
    // email even on the miss path.
    const filterStore = createFilterCaptureStore();
    const usersMock = createMatchingCollection([], { ...filterStore, key: 'users' });
    const db = makeDb(usersMock);
    const result = await authService.requestPasswordReset(db, 'nobody@test.com', {});
    expect(result.success).toBe(true);
    expect(result.resetLink).toBeUndefined();
    expect(filterStore.capturedFilters.users).toEqual({
      $or: [{ email: 'nobody@test.com' }, { username: 'nobody@test.com' }]
    });
  });

  it('returns generic success for inactive user without generating a token', async () => {
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, status: 'inactive' }]));
    const result = await authService.requestPasswordReset(db, 'user@test.com', {});
    expect(result.success).toBe(true);
  });

  it('generates a reset token and persists it for an active user', async () => {
    // #797: happy-path proof that the doc was found via the intended
    // email/username fields, not merely returned regardless of the filter.
    // Asserted via the findOne mock's call history, not the shared
    // capturedFilters slot: this success path also writes the reset token
    // (updateOne) and then runs auditLogger.log, whose LGPD anonymization
    // step (getUserAnonId) issues its own findOne on this same collection --
    // either of which would clobber the recorded findOne filter.
    const usersMock = createMatchingCollection([{ ...BASE_USER }]);
    const db = makeDb(usersMock);
    const result = await authService.requestPasswordReset(db, 'user@test.com', {});
    expect(result.success).toBe(true);
    expect(usersMock.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({ $set: expect.objectContaining({ passwordResetToken: expect.any(String) }) })
    );
    expect(usersMock.findOne).toHaveBeenCalledWith({
      $or: [{ email: 'user@test.com' }, { username: 'user@test.com' }]
    });
  });
});

describe('AuthService.resetPassword', () => {
  it('throws when token missing', async () => {
    const db = makeDb();
    await expect(authService.resetPassword(db, null, 'NewPass123!@#', {})).rejects.toThrow('não fornecido');
  });

  it('throws when newPassword missing', async () => {
    const db = makeDb();
    await expect(authService.resetPassword(db, 'tok', null, {})).rejects.toThrow('obrigatória');
  });

  it('throws when newPassword fails complexity validation', async () => {
    const db = makeDb();
    await expect(authService.resetPassword(db, 'tok', 'weak', {})).rejects.toThrow();
  });

  it('throws when token verification fails', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad token'); });
    const db = makeDb();
    await expect(
      authService.resetPassword(db, 'bad-token', 'NewPass123!@#', {})
    ).rejects.toThrow('Token de recuperação inválido');
  });

  it('throws a specific message when token expired', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => {
      const err = new Error('expired');
      err.name = 'TokenExpiredError';
      throw err;
    });
    const db = makeDb();
    await expect(
      authService.resetPassword(db, 'expired-token', 'NewPass123!@#', {})
    ).rejects.toThrow('expirado');
  });

  it('throws when decoded token type is not password-reset', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'access', userID: '507f1f77bcf86cd799439011' });
    const db = makeDb();
    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('Token inválido');
  });

  it('throws when user for token not found', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const db = makeDb();
    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('Usuário não encontrado');
  });

  it('throws when saved reset token does not match', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const db = makeDb({
      findOne: vi.fn().mockResolvedValue({ ...BASE_USER, passwordResetToken: 'different-token' }),
    });
    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('já utilizado');
  });

  // #1084: both guards were written as `if (user.passwordResetToken && ...)`,
  // and a successful reset $unsets that very field -- so the check that exists
  // to refuse an already-used token was disabled by the act of using it. The
  // stored token is not what authenticates the request either: the user is
  // looked up by an id taken from inside the JWT, so a replay walks straight
  // past both guards. The reset link is a URL query parameter, so a leaked
  // USED link was a full account takeover for the rest of the JWT's lifetime
  // -- 1h on the unauthenticated path, up to 24h on the authenticated one.
  it('#1084: refuses a REPLAYED token once passwordResetToken has been cleared, and does not touch the password', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const collectionApi = {
      // Exactly the post-reset state: $unset removed both fields.
      findOne: vi.fn().mockResolvedValue({ ...BASE_USER }),
      updateOne: vi.fn().mockResolvedValue({}),
      find: vi.fn(),
      insertOne: vi.fn(),
    };
    const db = makeDb(collectionApi);

    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('já utilizado');
    expect(collectionApi.updateOne).not.toHaveBeenCalled();
  });

  it('#1084: refuses when the stored token matches but the stored expiry is absent', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const collectionApi = {
      findOne: vi.fn().mockResolvedValue({ ...BASE_USER, passwordResetToken: 'tok' }),
      updateOne: vi.fn().mockResolvedValue({}),
      find: vi.fn(),
      insertOne: vi.fn(),
    };
    const db = makeDb(collectionApi);

    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('expirado');
    expect(collectionApi.updateOne).not.toHaveBeenCalled();
  });

  // CONTROL for #1084: same expected behaviour before and after the fix. A
  // first, unused token with a live expiry must still reset -- the guards
  // becoming unconditional must not close the happy path.
  it('#1084 control: a first, unused token with a live expiry still resets', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const collectionApi = {
      findOne: vi.fn().mockResolvedValue({
        ...BASE_USER,
        passwordResetToken: 'tok',
        passwordResetExpires: new Date(Date.now() + 100000),
      }),
      updateOne: vi.fn().mockResolvedValue({}),
      find: vi.fn(),
      insertOne: vi.fn(),
    };
    const db = makeDb(collectionApi);

    const result = await authService.resetPassword(db, 'tok', 'NewPass123!@#', {});
    expect(result.success).toBe(true);
    expect(collectionApi.updateOne).toHaveBeenCalled();
  });

  it('throws when the saved reset token has expired', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const db = makeDb({
      findOne: vi.fn().mockResolvedValue({
        ...BASE_USER,
        passwordResetToken: 'tok',
        passwordResetExpires: new Date(Date.now() - 1000),
      }),
    });
    await expect(
      authService.resetPassword(db, 'tok', 'NewPass123!@#', {})
    ).rejects.toThrow('expirado');
  });

  it('resets the password successfully and clears the reset token fields', async () => {
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const collectionApi = {
      findOne: vi.fn().mockResolvedValue({
        ...BASE_USER,
        passwordResetToken: 'tok',
        passwordResetExpires: new Date(Date.now() + 100000),
      }),
      updateOne: vi.fn().mockResolvedValue({}),
      find: vi.fn(),
      insertOne: vi.fn(),
    };
    const db = makeDb(collectionApi);
    const result = await authService.resetPassword(db, 'tok', 'NewPass123!@#', {});
    expect(result.success).toBe(true);
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({
        $set: expect.objectContaining({ password: expect.any(String) }),
        $unset: { passwordResetToken: '', passwordResetExpires: '' },
      })
    );
  });
});

// #958 / RNF021 AC#2. Unlike the two self-service paths, neither of these has a
// current session to preserve: the token reset is unauthenticated, and the forced
// reset runs BEFORE issueSessionTokens. So both revoke everything -- and for the
// forced reset the ORDERING is load-bearing: revoking after the new token was
// issued would kill the session the user is about to be handed.
describe('#958: password changes revoke sessions', () => {
  function dbWithSessions(collectionApi) {
    const base = makeDb(collectionApi);
    const sessionsCollection = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 3 }) };
    return {
      sessionsCollection,
      db: {
        ...base,
        collection: vi.fn((name) => (name === 'sessions' ? sessionsCollection : base.collection(name))),
      },
    };
  }

  it('resetPassword revokes every session for the account', async () => {
    // resetPassword verifies the token as a JWT before any lookup; the sibling
    // happy-path test stubs it the same way.
    vi.spyOn(jwt, 'verify').mockReturnValue({ type: 'password-reset', userID: '507f1f77bcf86cd799439011' });
    const { db, sessionsCollection } = dbWithSessions({
      findOne: vi.fn().mockResolvedValue({
        ...BASE_USER,
        passwordResetToken: 'tok',
        passwordResetExpires: new Date(Date.now() + 100000),
      }),
      updateOne: vi.fn().mockResolvedValue({}),
    });

    await authService.resetPassword(db, 'tok', 'NewPass123!@#', {});

    expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userID: 'user-1', isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          isRevoked: true, revocationReason: 'password_change', revokedBy: 'system',
        }),
      })
    );
  });
});

// #952 / RF001 AC#2, Fase 1: "Bloquear TEMPORARIAMENTE a conta apos o LIMITE
// CONFIGURADO de tentativas malsucedidas." Three words decide the shape:
// Bloquear (behaviour, not a settings screen), temporariamente (a duration --
// so NOT the admin-clear-only shape mfaLocked has, which #933 documents as a
// deadlock), and o limite configurado (from SecurityConfiguration, which
// dict-02 P1X-0206 restates as "deve seguir SecurityConfiguration").
describe('#952: password lockout (RF001 AC#2)', () => {
  function dbWith(userOverrides, policy) {
    const users = {
      findOne: vi.fn().mockResolvedValue({ ...BASE_USER, ...userOverrides }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => "s" } }),
    };
    const base = makeDb(users);
    return {
      users,
      db: {
        ...base,
        collection: vi.fn((name) => (name === 'security_config'
          ? { findOne: vi.fn().mockResolvedValue(policy || { _id: 'main' }) }
          : base.collection(name))),
      },
    };
  }

  it('counts a wrong password instead of discarding it', async () => {
    const { db, users } = dbWith({});
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authService.processLogin(db, { ...BASE_USER }, 'wrong', null, users, {}))
      .rejects.toThrow('Credenciais inválidas');

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
    );
  });

  it('locks the account for the configured duration once the configured limit is reached', async () => {
    const { db, users } = dbWith(
      { failedLoginAttempts: 2 },
      { _id: 'main', authentication: { maxLoginAttempts: 3, lockoutDurationMinutes: 15 } }
    );
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authService.processLogin(db, { ...BASE_USER, failedLoginAttempts: 2 }, 'wrong', null, users, {}))
      .rejects.toThrow('Credenciais inválidas');

    const lockCall = users.updateOne.mock.calls.find(
      (c) => c[1] && c[1].$set && c[1].$set.accountLockedUntil
    );
    expect(lockCall).toBeDefined();
    expect(lockCall[1].$set.accountLockedUntil).toBeInstanceOf(Date);
  });

  it('refuses a locked account BEFORE bcrypt.compare, with the generic message', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    const { db, users } = dbWith({ accountLockedUntil: lockedUntil });
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    await expect(
      authService.processLogin(db, { ...BASE_USER, accountLockedUntil: lockedUntil }, 'correct', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');

    // Placement is the point. After bcrypt it would deny only the eventual
    // correct guess while every wrong one still burns a bcrypt round; before it,
    // guessing actually stops. And the message stays generic so a locked account
    // is not distinguishable from a wrong password -- the same account-enumeration
    // concern auth.service already states for the mfaLocked gate.
    expect(compare).not.toHaveBeenCalled();
  });

  it('lets the login through once the lock has EXPIRED -- temporariamente, not permanent', async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    const { db, users } = dbWith({ accountLockedUntil: expired });
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authService.processLogin(db, { ...BASE_USER, accountLockedUntil: expired }, 'wrong', null, users, {}))
      .rejects.toThrow('Credenciais inválidas');

    expect(compare).toHaveBeenCalled();
  });
});

// #986 item 1 (RF001 AC#2): 3029dc83 instrumented processLogin, which is
// POST /api/auth/login. Two OTHER routes -- registered unauthenticated --
// accept a username and password and verify it with their own bcrypt.compare:
// setupMFAFirstLogin and enableMFAFirstLogin. Neither counted an attempt and
// neither consulted accountLockedUntil, so the per-account lockout had two
// bypasses. Both are additionally reachable against arbitrary, fully-enrolled
// accounts, which is what makes them more than an uncounted-guessing gap:
// setupMFAFirstLogin was a password ORACLE (two distinguishable messages), and
// enableMFAFirstLogin had no enrollment guard at all, so a correct password
// plus a valid TOTP issued real session tokens through an unauthenticated
// endpoint -- a complete alternate login path the lockout could not reach.
describe('#986: the two unauthenticated first-login endpoints respect the account lockout', () => {
  const ENROLLED = { ...BASE_USER, lastLogin: new Date('2020-01-01'), mfaEnabled: true, mfaSecret: 'SECRET' };

  it('setupMFAFirstLogin refuses an enrolled account BEFORE bcrypt.compare -- closes the oracle', async () => {
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([{ ...ENROLLED }]));

    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'wrong' }))
      .rejects.toThrow('Credenciais inválidas');

    // The whole point: a wrong password and a correct one must now be
    // indistinguishable on an enrolled account.
    //
    // #1036 un-weakened this rather than deleting it. It used to assert the
    // compare never ran at all, which proved the property only incidentally:
    // what actually matters is that the STORED HASH is never consulted. A
    // dummy round now runs on this branch to equalize latency (the enrolled
    // and unknown branches were ~61ms faster than the not-yet-enrolled one),
    // so "never called" is no longer true -- but "never called against the
    // real hash" is, and it is the stronger statement.
    expect(compare).not.toHaveBeenCalledWith(expect.anything(), ENROLLED.password);
    // ...and the equalizer did run, which is what closes #1036.
    expect(compare).toHaveBeenCalled();
  });

  it('enableMFAFirstLogin refuses an enrolled account BEFORE bcrypt.compare -- closes the second login path', async () => {
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const verify = vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb(createMatchingCollection([{ ...ENROLLED }]));

    await expect(authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {}))
      .rejects.toThrow('Credenciais inválidas');

    // #1036: same un-weakening as the setupMFAFirstLogin case above -- the
    // stored hash is never consulted, while a dummy round equalizes latency.
    expect(compare).not.toHaveBeenCalledWith(expect.anything(), ENROLLED.password);
    expect(compare).toHaveBeenCalled();
    // The TOTP check must still never run: this branch is refused outright.
    expect(verify).not.toHaveBeenCalled();
  });

  it('setupMFAFirstLogin counts a wrong password against a not-yet-enrolled account', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER }]));

    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'wrong' }))
      .rejects.toThrow('Credenciais inválidas');

    expect(db._collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
    );
  });

  it('enableMFAFirstLogin counts a wrong password against a not-yet-enrolled account', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, mfaSecret: 'SECRET' }]));

    await expect(authService.enableMFAFirstLogin(db, { username: 'user1', password: 'wrong' }, '123456', {}))
      .rejects.toThrow('Credenciais inválidas');

    expect(db._collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
    );
  });

  it('both endpoints refuse a locked account BEFORE bcrypt.compare, with the generic message', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    const locked = { ...BASE_USER, accountLockedUntil: lockedUntil, mfaSecret: 'SECRET' };

    const compareA = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    await expect(
      authService.setupMFAFirstLogin(makeDb(createMatchingCollection([{ ...locked }])), { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Credenciais inválidas');
    expect(compareA).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const compareB = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    await expect(
      authService.enableMFAFirstLogin(makeDb(createMatchingCollection([{ ...locked }])), { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
    expect(compareB).not.toHaveBeenCalled();
  });

  // The mirror of the counting half. enableMFAFirstLogin issues real session
  // tokens, so it is a completed login and must clear the counter and the lock
  // exactly as processLogin's own success path does -- otherwise it counts up
  // and never down, and a user who enrolls through it stays locked.
  it('enableMFAFirstLogin clears failedLoginAttempts AND accountLockedUntil on success', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb(createMatchingCollection([{ ...BASE_USER, mfaSecret: 'SECRET' }]));

    const result = await authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {});

    expect(result.success).toBe(true);
    const activation = db._collectionApi.updateOne.mock.calls.find(
      (call) => call[1]?.$set && 'mfaEnabled' in call[1].$set
    );
    expect(activation).toBeTruthy();
    expect(activation[1].$set).toEqual(expect.objectContaining({
      mfaEnabled: true,
      failedLoginAttempts: 0,
      accountLockedUntil: null,
    }));
  });
});

// #1032: 490077f4 (#986 item 1) moved the enrolment guard ABOVE bcrypt.compare.
// That closed a password oracle and opened a cheaper enumeration one: the
// distinct 'MFA já configurado…' message was reachable by an UNAUTHENTICATED
// caller supplying ANY arbitrary password, so a single request per username
// disclosed both account existence and MFA-enrolment state. processLogin's own
// comment in this same service already states the governing principle --
// "enumeration is the worse leak" -- so the message collapses into the generic
// one; the guard ORDER is deliberately unchanged, and the #986 block above
// still pins it via expect(compare).not.toHaveBeenCalled().
//
// What that costs was measured before it was removed, not assumed: the string
// was never rendered. auth.controller.js:472-476 returns a 400 carrying BOTH
// an `error` field -- always truthy, via a `|| 'Erro ao configurar MFA'`
// fallback -- and `message`, and frontend/src/views/MFASetupPage.tsx:68-71
// reads `data.error || data.message || ...`, so `message` was unreachable in
// the UI on this path. Nothing in frontend/src matched the literal.
describe('#1032: the first-login MFA endpoints disclose no enrolment state to an unauthenticated caller', () => {
  const ENROLLED = { ...BASE_USER, lastLogin: new Date('2020-01-01'), mfaEnabled: true, mfaSecret: 'SECRET' };

  const messageOf = async (promise) => {
    try {
      await promise;
      return null;
    } catch (error) {
      return error.message;
    }
  };

  it('setupMFAFirstLogin answers an enrolled account exactly as it answers an unknown username', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    // Control: unchanged by this fix, so it must be green BEFORE it too --
    // a red here would mean the fixture is wrong, not that the leak exists.
    const unknown = await messageOf(
      authService.setupMFAFirstLogin(makeDb(createMatchingCollection([])), { username: 'nobody', password: 'anything' })
    );
    expect(unknown).toBe('Credenciais inválidas');

    const enrolled = await messageOf(
      authService.setupMFAFirstLogin(makeDb(createMatchingCollection([{ ...ENROLLED }])), { username: 'user1', password: 'anything' })
    );

    expect(enrolled).toBe(unknown);
  });

  it('enableMFAFirstLogin answers an enrolled account exactly as it answers an unknown username', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);

    const unknown = await messageOf(
      authService.enableMFAFirstLogin(makeDb(createMatchingCollection([])), { username: 'nobody', password: 'anything' }, '123456', {})
    );
    expect(unknown).toBe('Credenciais inválidas');

    const enrolled = await messageOf(
      authService.enableMFAFirstLogin(makeDb(createMatchingCollection([{ ...ENROLLED }])), { username: 'user1', password: 'anything' }, '123456', {})
    );

    expect(enrolled).toBe(unknown);
  });

  it('neither endpoint emits a message naming the enrolment state', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);

    const setup = await messageOf(
      authService.setupMFAFirstLogin(makeDb(createMatchingCollection([{ ...ENROLLED }])), { username: 'user1', password: 'anything' })
    );
    const enable = await messageOf(
      authService.enableMFAFirstLogin(makeDb(createMatchingCollection([{ ...ENROLLED }])), { username: 'user1', password: 'anything' }, '123456', {})
    );

    expect(setup).not.toMatch(/configurado/i);
    expect(enable).not.toMatch(/configurado/i);
  });
});

// #1036: #986 moved the enrolment guard above bcrypt.compare and #1032
// collapsed its message. Both were right; together they left the same
// disclosure in a different channel, because only ONE of the three outcomes
// still did the expensive work.
//
// [ran it] bcryptjs at cost factor 10 on this machine: median 60.9ms
// (p10 58.9, p90 65.6) against ~0.0001ms for a guard-only return -- no overlap
// whatsoever, so "this username exists and is not yet enrolled" was separable
// from a single request, not from a statistical attack.
describe('#1036: the guard branches that skip the real compare are latency-equalized', () => {
  const ENROLLED = { ...BASE_USER, lastLogin: new Date('2020-01-01'), mfaEnabled: true, mfaSecret: 'SECRET' };

  it('setupMFAFirstLogin burns a comparison for an UNKNOWN username', async () => {
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([]));

    await expect(authService.setupMFAFirstLogin(db, { username: 'nao-existe', password: 'x' }))
      .rejects.toThrow('Credenciais inválidas');

    expect(compare).toHaveBeenCalled();
  });

  it('enableMFAFirstLogin burns a comparison for an UNKNOWN username', async () => {
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb(createMatchingCollection([]));

    await expect(authService.enableMFAFirstLogin(db, { username: 'nao-existe', password: 'x' }, '123456', {}))
      .rejects.toThrow('Credenciais inválidas');

    expect(compare).toHaveBeenCalled();
  });

  it('the equalizer never consults the stored hash, on either branch', async () => {
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb(createMatchingCollection([{ ...ENROLLED }]));

    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'qualquer' }))
      .rejects.toThrow('Credenciais inválidas');

    // Returning true from the mocked compare must not turn a refusal into a
    // success -- the equalizer's result is discarded by construction.
    expect(compare).not.toHaveBeenCalledWith(expect.anything(), ENROLLED.password);
  });

  // CONTROL, and the reason this fix is not applied uniformly: #952's comment
  // on the lockout gate says it sits before bcrypt.compare precisely so that
  // guessing STOPS rather than burning a round per attempt. Equalizing there
  // would hand back the DoS amplification that gate closed, so the lockout
  // path stays fast -- and therefore stays distinguishable, deliberately.
  //
  // Must be GREEN before AND after #1036. If it reds, the equalizer has been
  // applied too widely.
  it('CONTROL: the account-LOCKOUT branch still burns nothing (#952)', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    // `dbWith` is scoped to another describe in this file; makeDb /
    // createMatchingCollection are the module-level pair.
    const lockedUser = { ...BASE_USER, accountLockedUntil: lockedUntil };
    const users = createMatchingCollection([lockedUser]);
    const db = makeDb(users);
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    await expect(
      authService.processLogin(db, lockedUser, 'correct', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');

    expect(compare).not.toHaveBeenCalled();
  });
});

