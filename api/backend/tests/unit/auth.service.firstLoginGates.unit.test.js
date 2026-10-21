import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-de-teste-1258';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'key-teste';

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const authService = require('../../src/services/auth.service');
const ipAttemptService = require('../../src/services/ipAttempt.service');
const { encryptValue } = require('../../src/utils/fieldEncryption');

// #1258 item 5: the unauthenticated first-login endpoints issue a full
// session (enable) or store a second factor (setup), and applied neither the
// account-status gate nor #1251's password expiry that processLogin applies.
// requireMFAForAll (#1247) sends every returning unenrolled account through
// them, so both now apply.

const PASSWORD = 'Correct@1258pass';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const DAY = 24 * 60 * 60 * 1000;

function makeDb(user, securityConfig = null) {
  const users = {
    findOne: vi.fn(async (filter) => (filter && filter.$or ? user : null)),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const other = {
    findOne: vi.fn(async (filter) => (filter && filter._id === 'main' ? securityConfig : null)),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'doc-id' } }),
  };
  return { collection: vi.fn((name) => (name === 'users' ? users : other)), users };
}

const enrollingUser = (extra = {}) => ({
  _id: { toString: () => 'user-1258' },
  username: 'tecnico1258',
  email: 'tecnico1258@example.com',
  passwordHash: HASH,
  accountStatus: 'active',
  lastLoginAt: null,
  mfaEnabled: false,
  mfaSecretCiphertext: encryptValue('JBSWY3DPEHPK3PXP'),
  passwordChangedAt: new Date(),
  ...extra,
});

const enable = (db) => authService.enableMFAFirstLogin(db, { username: 'tecnico1258', password: PASSWORD }, '123456', { ip: '203.0.113.5' });
const setup = (db) => authService.setupMFAFirstLogin(db, { username: 'tecnico1258', password: PASSWORD }, { ip: '203.0.113.5' });

let issue;

beforeEach(() => {
  vi.spyOn(ipAttemptService, 'isSourceBlocked').mockResolvedValue(false);
  vi.spyOn(ipAttemptService, 'recordFailedSourceAttempt').mockResolvedValue(undefined);
  vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
  issue = vi.spyOn(authService, 'issueSessionTokens').mockResolvedValue({ token: 't', refreshToken: 'r', sessionID: 's' });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('#1258 item 5: account status at the first-login endpoints', () => {
  it('control: an active account with a current password gets its session', async () => {
    const result = await enable(makeDb(enrollingUser()));
    expect(result.token).toBe('t');
    expect(issue).toHaveBeenCalledTimes(1);
  });

  for (const [status, message] of [['inactive', 'Usuário inativo'], ['suspended', 'Usuário suspenso'], ['blocked', 'Usuário bloqueado'], ['Suspenso', 'Usuário suspenso']]) {
    it(`enable-first-login refuses a ${status} account and issues no session`, async () => {
      const db = makeDb(enrollingUser({ accountStatus: status }));
      await expect(enable(db)).rejects.toThrow(message);
      expect(issue).not.toHaveBeenCalled();
      expect(db.users.updateOne).not.toHaveBeenCalled();
    });
  }

  it('qr-first-login refuses a suspended account and stores no secret', async () => {
    const db = makeDb(enrollingUser({ accountStatus: 'suspended', mfaSecretCiphertext: null }));
    await expect(setup(db)).rejects.toThrow('Usuário suspenso');
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });

  it('the status is checked only after the password, so a wrong password still reads as generic', async () => {
    const db = makeDb(enrollingUser({ accountStatus: 'blocked' }));
    await expect(authService.enableMFAFirstLogin(db, { username: 'tecnico1258', password: 'wrong' }, '123456', {})).rejects.toThrow('Credenciais inválidas');
  });

  // #1270 item 1: the same at qr-first-login, for every non-active status.
  for (const status of ['inactive', 'suspended', 'blocked']) {
    it(`qr-first-login answers a wrong password on a ${status} account with the generic message`, async () => {
      const db = makeDb(enrollingUser({ accountStatus: status, mfaSecretCiphertext: null }));
      await expect(authService.setupMFAFirstLogin(db, { username: 'tecnico1258', password: 'wrong' }, {})).rejects.toThrow(/^Credenciais inválidas$/);
      expect(db.users.updateOne).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ mfaSecretCiphertext: expect.anything() }) }));
    });
  }
});

// #1270 item 2: processLogin hands a first-login account its setup tempToken
// BEFORE it reaches the forceReset/expiry branch, and the middleware admits
// that token at POST /two-factor/enable and /mfa/enable. enableMFA issued a
// full session there for lastLogin null, applying neither the expiry, nor
// forceReset, nor the account status, so that route completed a first login
// enable-first-login (#1250, #1258) refuses.
describe('#1270 item 2: the authenticated enrolment (enableMFA) completes a first login under the same gates', () => {
  const policy = { _id: 'main', passwordRules: { expirationDays: 90 } };
  const USER_ID = '507f1f77bcf86cd799439011';
  const byId = (user, securityConfig = null) => {
    const db = makeDb(user, securityConfig);
    db.users.findOne = vi.fn(async (filter) => (filter && filter._id ? user : null));
    return db;
  };

  it('control: an active account with a current password gets its session', async () => {
    const result = await authService.enableMFA(byId(enrollingUser(), policy), USER_ID, '123456');
    expect(result.token).toBe('t');
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('an expired password enrols, but withholds the session and asks for the change', async () => {
    const db = byId(enrollingUser({ passwordChangedAt: new Date(Date.now() - 200 * DAY) }), policy);
    const result = await authService.enableMFA(db, USER_ID, '123456');
    expect(result).toEqual(expect.objectContaining({ requiresPasswordChange: true, reason: 'expired' }));
    expect(result.token).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
    expect(db.users.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ mfaEnabled: true }) }));
  });

  it('forceReset withholds the session with its own message and no reason', async () => {
    const result = await authService.enableMFA(byId(enrollingUser({ forcePasswordReset: true })), USER_ID, '123456');
    expect(result.requiresPasswordChange).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
  });

  it('a suspended account is refused and nothing is written', async () => {
    const db = byId(enrollingUser({ accountStatus: 'suspended' }));
    await expect(authService.enableMFA(db, USER_ID, '123456')).rejects.toThrow('Usuário suspenso');
    expect(issue).not.toHaveBeenCalled();
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });

  it('control: an enrolled account enabling again (not a first login) is untouched by the gates', async () => {
    const db = byId(enrollingUser({ lastLoginAt: new Date(), passwordChangedAt: new Date(Date.now() - 200 * DAY), forcePasswordReset: true }), policy);
    expect(await authService.enableMFA(db, USER_ID, '123456')).toEqual({ success: true });
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('#1258 item 5: an expired password at enable-first-login (#1251)', () => {
  const policy = { _id: 'main', passwordRules: { expirationDays: 90 } };

  it('enrols, but withholds the session and asks for the change, as forceReset does', async () => {
    const db = makeDb(enrollingUser({ passwordChangedAt: new Date(Date.now() - 200 * DAY) }), policy);
    const result = await enable(db);
    expect(result).toEqual(expect.objectContaining({ requiresPasswordChange: true, reason: 'expired' }));
    expect(result.token).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
    expect(db.users.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ mfaEnabled: true }) }));
  });

  it('control: a password inside the window gets its session', async () => {
    const db = makeDb(enrollingUser({ passwordChangedAt: new Date(Date.now() - 10 * DAY) }), policy);
    expect((await enable(db)).token).toBe('t');
  });

  it('forceReset keeps its own message and no reason', async () => {
    const result = await enable(makeDb(enrollingUser({ forcePasswordReset: true })));
    expect(result.requiresPasswordChange).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
  });
});
