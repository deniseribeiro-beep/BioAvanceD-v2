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
  password: HASH,
  status: 'active',
  lastLogin: null,
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
      const db = makeDb(enrollingUser({ status }));
      await expect(enable(db)).rejects.toThrow(message);
      expect(issue).not.toHaveBeenCalled();
      expect(db.users.updateOne).not.toHaveBeenCalled();
    });
  }

  it('qr-first-login refuses a suspended account and stores no secret', async () => {
    const db = makeDb(enrollingUser({ status: 'suspended', mfaSecretCiphertext: null }));
    await expect(setup(db)).rejects.toThrow('Usuário suspenso');
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });

  it('the status is checked only after the password, so a wrong password still reads as generic', async () => {
    const db = makeDb(enrollingUser({ status: 'blocked' }));
    await expect(authService.enableMFAFirstLogin(db, { username: 'tecnico1258', password: 'wrong' }, '123456', {})).rejects.toThrow('Credenciais inválidas');
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
    const result = await enable(makeDb(enrollingUser({ forceReset: true })));
    expect(result.requiresPasswordChange).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
  });
});
