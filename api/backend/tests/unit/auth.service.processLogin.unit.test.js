import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authService = require('../../src/services/auth.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const logger = require('../../src/utils/logger');

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
});

describe('AuthService.setupMFAFirstLogin', () => {
  it('throws when username/password missing', async () => {
    const db = makeDb();
    await expect(authService.setupMFAFirstLogin(db, {})).rejects.toThrow('obrigatórios');
  });

  it('throws when user not found', async () => {
    const db = makeDb();
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'x', password: 'y' })
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('throws when password does not match', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue(BASE_USER) });
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'user1', password: 'wrong' })
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('throws when MFA already configured and not first login', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb({
      findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaEnabled: true, mfaSecret: 'SECRET' }),
    });
    await expect(
      authService.setupMFAFirstLogin(db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('já configurado');
  });

  it('generates a QR code and secret on success', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(QRCode, 'toDataURL').mockResolvedValue('data:image/png;base64,xyz');
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, lastLogin: null }) });
    const result = await authService.setupMFAFirstLogin(db, { username: 'user1', password: 'pw' });
    expect(result.secret).toBeTruthy();
    expect(result.qrCode).toBe('data:image/png;base64,xyz');
  });

  it('throws when QRCode generation fails', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(QRCode, 'toDataURL').mockRejectedValue(new Error('qr fail'));
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, lastLogin: null }) });
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
    const db = makeDb();
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'u', password: 'p' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('throws when password mismatch', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue(BASE_USER) });
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'wrong' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('throws when mfaSecret not configured', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: null }) });
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('MFA não configurado');
  });

  it('throws on invalid MFA code', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: 'SECRET' }) });
    await expect(
      authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '000000', {})
    ).rejects.toThrow('Código MFA inválido');
  });

  it('activates MFA and issues session tokens on success', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, mfaSecret: 'SECRET' }) });
    const result = await authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '123456', {});
    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
    expect(result.user.mfaEnabled).toBe(true);
  });

  // #434: response body's user.accessType must come from the live RBAC
  // assignment, not the stale unpopulated user.accessType field (#427).
  it('resolves the response body accessType from the live RBAC assignment, not stale user.accessType', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, accessType: 2, mfaSecret: 'SECRET' }) });
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
    const db = makeDb();
    const result = await authService.requestPasswordReset(db, 'nobody@test.com', {});
    expect(result.success).toBe(true);
    expect(result.resetLink).toBeUndefined();
  });

  it('returns generic success for inactive user without generating a token', async () => {
    const db = makeDb({ findOne: vi.fn().mockResolvedValue({ ...BASE_USER, status: 'inactive' }) });
    const result = await authService.requestPasswordReset(db, 'user@test.com', {});
    expect(result.success).toBe(true);
  });

  it('generates a reset token and persists it for an active user', async () => {
    const collectionApi = { findOne: vi.fn().mockResolvedValue(BASE_USER), updateOne: vi.fn().mockResolvedValue({}), find: vi.fn(), insertOne: vi.fn() };
    const db = makeDb(collectionApi);
    const result = await authService.requestPasswordReset(db, 'user@test.com', {});
    expect(result.success).toBe(true);
    expect(collectionApi.updateOne).toHaveBeenCalledWith(
      { _id: BASE_USER._id },
      expect.objectContaining({ $set: expect.objectContaining({ passwordResetToken: expect.any(String) }) })
    );
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
