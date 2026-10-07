import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-de-teste-1268';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'key-teste';

const bcrypt = require('bcryptjs');
const authController = require('../../src/controllers/auth.controller');
const ipAttemptService = require('../../src/services/ipAttempt.service');
const auditLogger = require('../../src/utils/auditLogger');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');

// #1268: a blocked source address must answer exactly as a locked account
// does, at the HTTP layer, on every unauthenticated endpoint that verifies a
// password or a TOTP code: the same status, the same body. Neither runs the
// bcrypt compare, so neither pays the ~61 ms a wrong password pays. That is
// the account lockout's deliberate trade (#952, #1036): a fast refusal stops
// the guessing instead of burning a round per attempt.

const PASSWORD = 'Correct@1268pass';
const HASH = bcrypt.hashSync(PASSWORD, 4);

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

const user = (extra = {}) => ({
  _id: { toString: () => 'user-1268' },
  username: 'tecnico1268',
  email: 'tecnico1268@example.com',
  password: HASH,
  status: 'active',
  lastLogin: null,
  ...extra,
});

const lockedUser = () => user({ accountLockedUntil: new Date(Date.now() + 30 * 60 * 1000) });

async function call(method, db, body) {
  const req = { ip: '203.0.113.68', app: { locals: { db } }, body };
  let status;
  let payload;
  const res = {
    status: vi.fn((s) => { status = s; return res; }),
    json: vi.fn((p) => { payload = p; return res; }),
    cookie: vi.fn(),
  };
  await authController[method](req, res);
  return { status, payload };
}

const ENDPOINTS = [
  ['login (POST /login)', 'login', { email: 'tecnico1268', password: 'Wrong@1268pass' }],
  ['setupMFAFirstLogin (POST /two-factor/qr-first-login)', 'setupMFAFirstLogin', { username: 'tecnico1268', password: 'Wrong@1268pass' }],
  ['enableMFAFirstLogin (POST /two-factor/enable-first-login)', 'enableMFAFirstLogin', { username: 'tecnico1268', password: 'Wrong@1268pass', code: '123456' }],
];

let blocked;
let compare;

beforeEach(() => {
  blocked = vi.spyOn(ipAttemptService, 'isSourceBlocked').mockResolvedValue(false);
  vi.spyOn(ipAttemptService, 'recordFailedSourceAttempt').mockResolvedValue(undefined);
  vi.spyOn(notificationDispatchService, 'dispatchNotification').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'logLogin').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  compare = vi.spyOn(bcrypt, 'compare');
});

afterEach(() => { vi.restoreAllMocks(); });

describe('#1268 a blocked source answers like a locked account', () => {
  it.each(ENDPOINTS)('%s: same status and body, and no compare on either', async (_name, method, body) => {
    blocked.mockResolvedValue(true);
    const viaBlock = await call(method, makeDb(user()), body);
    const blockCompares = compare.mock.calls.length;

    blocked.mockResolvedValue(false);
    const viaLockout = await call(method, makeDb(lockedUser()), body);

    expect(viaBlock.status).toBe(viaLockout.status);
    expect(viaBlock.payload).toEqual(viaLockout.payload);
    expect(viaBlock.payload.message).toBe('Credenciais inválidas');
    expect(blockCompares).toBe(0);
    expect(compare).not.toHaveBeenCalled();
  });

  it.each(ENDPOINTS)('control, %s: an unblocked, unlocked wrong password does pay the compare', async (_name, method, body) => {
    const { payload } = await call(method, makeDb(user()), body);
    expect(payload.message).toBe('Credenciais inválidas');
    expect(compare).toHaveBeenCalled();
  });
});
