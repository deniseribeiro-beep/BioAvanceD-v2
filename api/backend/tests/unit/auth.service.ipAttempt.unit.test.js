import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-de-teste-1255';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'key-teste';

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const authService = require('../../src/services/auth.service');
const authController = require('../../src/controllers/auth.controller');
const ipAttemptService = require('../../src/services/ipAttempt.service');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const { encryptValue } = require('../../src/utils/fieldEncryption');

// #1255: where auth.service consults and feeds the source-address store.
// The store's own behaviour is ipAttempt.service.unit.test.js; this file pins
// only that every unauthenticated password/MFA endpoint asks the gate first
// and reports each failure kind with a stable account identifier.

const PASSWORD = 'Correct@1255pass';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const req = { ip: '203.0.113.9' };

function makeDb(user) {
  const api = {
    findOne: vi.fn(async (filter) => (filter && filter.$or ? user : null)),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'doc-id' } }),
  };
  return { collection: vi.fn(() => api), _api: api };
}

const activeUser = (extra = {}) => ({
  _id: { toString: () => 'user-1255' },
  username: 'tecnico1255',
  email: 'tecnico1255@example.com',
  password: HASH,
  status: 'active',
  lastLogin: new Date(),
  ...extra,
});

let blocked;
let record;

beforeEach(() => {
  blocked = vi.spyOn(ipAttemptService, 'isSourceBlocked').mockResolvedValue(false);
  record = vi.spyOn(ipAttemptService, 'recordFailedSourceAttempt').mockResolvedValue(undefined);
  vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(undefined);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('#1255 the source gate', () => {
  it('login refuses a blocked source with the generic message, before any lookup or compare', async () => {
    blocked.mockResolvedValue(true);
    const db = makeDb(activeUser());
    const compare = vi.spyOn(bcrypt, 'compare');
    await expect(authService.login(db, { email: 'tecnico1255', password: PASSWORD }, req)).rejects.toThrow('Credenciais inválidas');
    expect(blocked).toHaveBeenCalledWith(db, req);
    expect(db._api.findOne).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it('setupMFAFirstLogin refuses a blocked source before the lookup', async () => {
    blocked.mockResolvedValue(true);
    const db = makeDb(activeUser({ lastLogin: null }));
    await expect(authService.setupMFAFirstLogin(db, { username: 'tecnico1255', password: PASSWORD }, req)).rejects.toThrow('Credenciais inválidas');
    expect(db._api.findOne).not.toHaveBeenCalled();
  });

  it('enableMFAFirstLogin refuses a blocked source before the lookup', async () => {
    blocked.mockResolvedValue(true);
    const db = makeDb(activeUser({ lastLogin: null }));
    await expect(authService.enableMFAFirstLogin(db, { username: 'tecnico1255', password: PASSWORD }, '123456', req)).rejects.toThrow('Credenciais inválidas');
    expect(db._api.findOne).not.toHaveBeenCalled();
  });

  it('the first-login QR controller hands the request to the service, so the gate sees an address', async () => {
    const spy = vi.spyOn(authService, 'setupMFAFirstLogin').mockResolvedValue({ qrCode: 'q', secret: 's' });
    const request = { ...req, app: { locals: { db: {} } }, body: { username: 'u', password: 'p' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await authController.setupMFAFirstLogin(request, res);
    expect(spy).toHaveBeenCalledWith(request.app.locals.db, { username: 'u', password: 'p' }, request);
  });
});

describe('#1255 every failure kind counts against the source', () => {
  it('an unknown identifier, under its typed name', async () => {
    const db = makeDb(null);
    await expect(authService.login(db, { email: ' ghost@example.com ', password: 'x' }, req)).rejects.toThrow('Credenciais inválidas');
    expect(record).toHaveBeenCalledWith(db, req, 'name:ghost@example.com');
  });

  it('a wrong password, under the account id', async () => {
    const db = makeDb(activeUser());
    await expect(authService.processLogin(db, activeUser(), 'wrong-password', null, db._api, req)).rejects.toThrow('Credenciais inválidas');
    expect(record).toHaveBeenCalledWith(db, req, 'id:user-1255');
  });

  it('a wrong MFA code at login', async () => {
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    const user = activeUser({ mfaEnabled: true, mfaSecretCiphertext: encryptValue('JBSWY3DPEHPK3PXP') });
    const db = makeDb(user);
    await expect(authService.processLogin(db, user, PASSWORD, '000000', db._api, req)).rejects.toThrow('Código MFA inválido');
    expect(record).toHaveBeenCalledWith(db, req, 'id:user-1255');
  });

  it('a wrong password and an unknown name at setupMFAFirstLogin', async () => {
    const user = activeUser({ lastLogin: null });
    await expect(authService.setupMFAFirstLogin(makeDb(user), { username: 'tecnico1255', password: 'wrong' }, req)).rejects.toThrow('Credenciais inválidas');
    expect(record).toHaveBeenLastCalledWith(expect.anything(), req, 'id:user-1255');
    await expect(authService.setupMFAFirstLogin(makeDb(null), { username: 'nobody', password: 'wrong' }, req)).rejects.toThrow('Credenciais inválidas');
    expect(record).toHaveBeenLastCalledWith(expect.anything(), req, 'name:nobody');
  });

  it('a wrong password and a wrong enrolment code at enableMFAFirstLogin', async () => {
    const user = activeUser({ lastLogin: null, mfaSecretCiphertext: encryptValue('JBSWY3DPEHPK3PXP') });
    await expect(authService.enableMFAFirstLogin(makeDb(user), { username: 'tecnico1255', password: 'wrong' }, '000000', req)).rejects.toThrow('Credenciais inválidas');
    expect(record).toHaveBeenCalledTimes(1);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    await expect(authService.enableMFAFirstLogin(makeDb(user), { username: 'tecnico1255', password: PASSWORD }, '000000', req)).rejects.toThrow('Código MFA inválido');
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith(expect.anything(), req, 'id:user-1255');
  });

  it('a successful login records nothing against the source', async () => {
    const db = makeDb(activeUser());
    await authService.processLogin(db, activeUser(), PASSWORD, null, db._api, req).catch(() => {});
    expect(record).not.toHaveBeenCalled();
  });
});
