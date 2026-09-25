import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const authRoutesPath = require.resolve('../../../src/interface/routes/auth.routes.js');
const sessionService = require('../../../src/services/session.service');
const auditLogger = require('../../../src/utils/auditLogger');
const {
  TEST_USER_ACCOUNT_IDS,
  TEST_ACTOR_IDS,
} = require('../../factories/auth.factory');

const JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
process.env.JWT_SECRET = JWT_SECRET;
const ACTOR_ID = TEST_ACTOR_IDS[2];
const USER_ID = TEST_USER_ACCOUNT_IDS[2];

function loadAuthRoutes() {
  delete require.cache[authRoutesPath];
  return require(authRoutesPath);
}

function buildApp(authRoutes, db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/auth', authRoutes);
  return app;
}

function signAccessToken() {
  return jwt.sign(
    {
      userID: USER_ID,
      actorId: ACTOR_ID,
      email: 'user@example.com',
      accessType: 2,
      mfaVerified: true,
    },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function makeDb(userDoc) {
  let authServed = false;
  const findOne = vi.fn(async () => {
    if (userDoc === null) {
      if (!authServed) {
        authServed = true;
        return { actorId: ACTOR_ID, userAccountId: USER_ID, userStatus: 'active' };
      }
      return null;
    }
    return { actorId: ACTOR_ID, userAccountId: USER_ID, userStatus: 'active', ...userDoc };
  });
  return { collection: vi.fn(() => ({ findOne })) };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NODE_ENV;
});

describe('auth.routes item 8 residual fallbacks', () => {
  it('GET /verify uses Portuguese defaults when req.t is absent', async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const token = signAccessToken();

    const res = await request(buildApp(loadAuthRoutes(), makeDb(null)))
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Usuário não encontrado');
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Token verificado mas usuário não encontrado',
      module: 'Segurança',
    }));
  });

  it('refresh cookie options flip to secure/strict in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    vi.spyOn(sessionService, 'invalidateSession').mockResolvedValue(true);
    vi.spyOn(auditLogger, 'logLogout').mockResolvedValue(undefined);

    const res = await request(buildApp(loadAuthRoutes(), makeDb({})))
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${signAccessToken()}`);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] || [];
    const refresh = setCookie.find((value) => String(value).startsWith('refresh_token='));
    expect(refresh).toBeTruthy();
    expect(String(refresh)).toMatch(/SameSite=Strict/i);
    expect(String(refresh)).toMatch(/Secure/i);
  });
});
