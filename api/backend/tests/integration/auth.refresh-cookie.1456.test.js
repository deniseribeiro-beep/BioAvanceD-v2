/**
 * #1456 (RNF021 AC1, AC5): the refresh route's token rotation and the
 * refresh cookie's flags, on the real router mounted with supertest.
 *
 * AC1: every rotation must issue a refresh token unlike the one it replaces.
 * The route signed { userID, sessionID, type } with no jti, so two
 * rotations of one session inside the same second produced the same JWT,
 * and the token just rotated away still matched the stored hash.
 *
 * AC5: the e2e stack runs NODE_ENV=test over plain HTTP, so it can show
 * HttpOnly and SameSite but never Secure; production's flags are pinned
 * here instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const authRoutesPath = require.resolve('../../src/interface/routes/auth.routes.js');
const authService = require('../../src/services/auth.service');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-jwt-secret';

function loadAuthRoutes() {
  delete require.cache[authRoutesPath];
  return require(authRoutesPath);
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/auth', loadAuthRoutes());
  return app;
}

function makeDbWithRbac(userDoc, rbacUsers = []) {
  const { buildRbacCollections } = require('../factories/rbac.factory');
  const rbac = buildRbacCollections(rbacUsers);
  const findOne = vi.fn(async () => userDoc);
  return { collection: vi.fn((name) => rbac[name] || { findOne }) };
}

function refreshFixture() {
  const userId = new ObjectId();
  vi.spyOn(sessionService, 'getSessionByRefreshToken').mockResolvedValue({ userAccountId: userId.toString(), sessionId: 's1456' });
  const rotateSpy = vi.spyOn(sessionService, 'rotateSessionTokens').mockResolvedValue(true);
  const db = makeDbWithRbac(
    { _id: userId, email: 'a@b.com', username: 'u', accessType: 2, name: 'A' },
    [{ userAccountId: userId.toString(), accessType: 2 }]
  );
  const cookie = `refresh_token=${jwt.sign({ userID: userId.toString(), sessionID: 's1456', type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' })}`;
  return { app: buildApp(db), rotateSpy, cookie };
}

function refreshCookieOf(res) {
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('refresh_token=') && !c.startsWith('refresh_token=;'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /api/auth/refresh rotation (RNF021 AC1)', () => {
  it('two rotations inside one second issue two different refresh tokens each with a jti', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T12:00:00.000Z'));
    const { app, rotateSpy, cookie } = refreshFixture();

    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const second = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const issued = rotateSpy.mock.calls.map((call) => call[3]);
    expect(issued).toHaveLength(2);
    expect(issued[0]).not.toBe(issued[1]);
    for (const token of issued) {
      const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
      expect(decoded.type).toBe('refresh');
      expect(decoded.sessionID).toBe('s1456');
      expect(typeof decoded.jti).toBe('string');
    }
  });
});

describe('refresh cookie flags under NODE_ENV=production (RNF021 AC5)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('the refresh route sets a Secure HttpOnly SameSite=Strict cookie', async () => {
    const { app, cookie } = refreshFixture();
    process.env.NODE_ENV = 'production';

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const setCookie = refreshCookieOf(res);
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/;\s*Secure(;|$)/);
    expect(setCookie).toMatch(/;\s*HttpOnly(;|$)/);
    expect(setCookie).toMatch(/;\s*SameSite=Strict(;|$)/);
    expect(setCookie).toMatch(/;\s*Path=\/api\/auth(;|$)/);
  });

  it('the login sets a Secure HttpOnly SameSite=Strict cookie', async () => {
    vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    vi.spyOn(authService, 'login').mockResolvedValue({
      token: 'jwt-abc',
      refreshToken: 'refresh-abc',
      sessionID: 'sess-abc',
      user: { userID: 'u1', username: 'alice' },
    });
    const app = buildApp({ collection: vi.fn(() => ({ findOne: vi.fn(async () => null) })) });
    process.env.NODE_ENV = 'production';

    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'x' });

    expect(res.status).toBe(200);
    const setCookie = refreshCookieOf(res);
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/;\s*Secure(;|$)/);
    expect(setCookie).toMatch(/;\s*HttpOnly(;|$)/);
    expect(setCookie).toMatch(/;\s*SameSite=Strict(;|$)/);
  });

  it('control: outside production the cookie is HttpOnly and SameSite=Lax without Secure', async () => {
    const { app, cookie } = refreshFixture();
    process.env.NODE_ENV = 'test';

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    const setCookie = refreshCookieOf(res);
    expect(setCookie).toMatch(/;\s*HttpOnly(;|$)/);
    expect(setCookie).toMatch(/;\s*SameSite=Lax(;|$)/);
    expect(setCookie).not.toMatch(/;\s*Secure(;|$)/);
  });
});
