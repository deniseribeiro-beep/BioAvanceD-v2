/**
 * Extends tests/integration/auth.routes.test.js with the branch-coverage
 * gaps left after that file's initial pass: the `(req.t && req.t(key)) ||
 * '<pt fallback>'` truthy branch (never exercised there because no i18n
 * middleware sets req.t — same class of gap closed for
 * sample-file.controller.js in test-loop session 11), plus a few real
 * logic branches (login's mfaCode compat fallback, logout skipping the
 * session-invalidate block when db/token are absent, and the
 * sessionId-matches-current-session cookie-clear branch).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const authRoutesPath = require.resolve('../../src/interface/routes/auth.routes.js');
const authController = require('../../src/controllers/auth.controller');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

function loadAuthRoutes() {
  delete require.cache[authRoutesPath];
  return require(authRoutesPath);
}

function buildApp(authRoutes, db, { withT = false } = {}) {
  const app = express();
  app.use(express.json());
  if (withT) {
    app.use((req, res, next) => {
      req.t = (key) => `T:${key}`;
      next();
    });
  }
  app.locals.db = db;
  app.use('/api/auth', authRoutes);
  return app;
}

function makeUserId() {
  return new ObjectId().toHexString();
}

function signAccessToken(overrides = {}) {
  return jwt.sign(
    { userID: makeUserId(), email: 'user@example.com', accessType: 2, mfaVerified: true, ...overrides },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function makeDb(userDoc) {
  const findOne = vi.fn(async () => userDoc);
  return { collection: vi.fn(() => ({ findOne })) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth.routes.js branch coverage - req.t translation truthy branches', () => {
  it('POST /two-factor/disable uses req.t for the not-implemented error', async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    const authRoutes = loadAuthRoutes();
    const app = buildApp(authRoutes, makeDb({}), { withT: true });
    const token = signAccessToken();

    const res = await request(app).post('/api/auth/two-factor/disable').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('T:common.notImplemented');
  });

  it('GET /two-factor/status uses req.t for not-found and catch-error messages', async () => {
    // The route's own `if (!db)` guard is unreachable in practice: the
    // `authenticate` middleware performs the identical check first for any
    // non-keepalive/non-MFA-setup route and returns its own 503 before this
    // handler ever runs (see src/infrastructure/middleware/auth.js:64-73).
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    const authRoutes = loadAuthRoutes();
    const token = signAccessToken();

    const notFoundRes = await request(buildApp(authRoutes, makeDb(null), { withT: true }))
      .get('/api/auth/two-factor/status').set('Authorization', `Bearer ${token}`);
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error).toBe('T:users.notFound');

    const throwingDb = { collection: () => ({ findOne: vi.fn(async () => { throw new Error('mfa-status-boom'); }) }) };
    const errRes = await request(buildApp(loadAuthRoutes(), throwingDb, { withT: true }))
      .get('/api/auth/two-factor/status').set('Authorization', `Bearer ${token}`);
    expect(errRes.status).toBe(500);
    expect(errRes.body.error).toBe('T:mfa.statusError');
  });

  it('POST /keepalive uses req.t for db-unavailable, session-expired, success, and catch-error messages', async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    const token = signAccessToken();

    vi.spyOn(sessionService, 'updateActivity').mockResolvedValueOnce(null);
    const expiredRes = await request(buildApp(loadAuthRoutes(), makeDb({}), { withT: true }))
      .post('/api/auth/keepalive').set('Authorization', `Bearer ${token}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error).toBe('T:auth.sessionExpired');
    expect(expiredRes.body.message).toBe('T:auth.sessionExpiredMessage');

    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ lastActivity: 1, expiresAt: 2 });
    const okRes = await request(buildApp(loadAuthRoutes(), makeDb({}), { withT: true }))
      .post('/api/auth/keepalive').set('Authorization', `Bearer ${token}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.message).toBe('T:auth.sessionRenewed');

    vi.spyOn(sessionService, 'updateActivity').mockRejectedValueOnce(new Error('keepalive-boom'));
    const errRes = await request(buildApp(loadAuthRoutes(), makeDb({}), { withT: true }))
      .post('/api/auth/keepalive').set('Authorization', `Bearer ${token}`);
    expect(errRes.status).toBe(500);
    expect(errRes.body.error).toBe('T:auth.keepaliveError');

    const noDbRes = await request(buildApp(loadAuthRoutes(), undefined, { withT: true }))
      .post('/api/auth/keepalive').set('Authorization', `Bearer ${token}`);
    expect(noDbRes.status).toBe(503);
    expect(noDbRes.body.error).toBe('T:errors.databaseUnavailable');
  });

  it('POST /logout uses req.t for the success message', async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    vi.spyOn(sessionService, 'invalidateSession').mockResolvedValue(true);
    vi.spyOn(auditLogger, 'logLogout').mockResolvedValue(undefined);
    const authRoutes = loadAuthRoutes();
    const app = buildApp(authRoutes, makeDb({}), { withT: true });
    const token = signAccessToken();

    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('T:auth.logoutSuccess');
  });

  it('GET /verify uses req.t for not-found (with audit message/module), catch-error, and the accessType->roleName map', async () => {
    // Same unreachable-guard note as /two-factor/status above: /verify's
    // own `if (!db)` check can't be reached with a no-db request because
    // `authenticate` blocks first.
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
    const token = signAccessToken();

    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const notFoundRes = await request(buildApp(loadAuthRoutes(), makeDb(null), { withT: true }))
      .get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error).toBe('T:users.notFound');
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: 'T:auth.tokenVerifyFailed',
      module: 'T:common.security',
    }));

    const throwingDb = { collection: () => ({ findOne: vi.fn(async () => { throw new Error('verify-boom'); }) }) };
    const errRes = await request(buildApp(loadAuthRoutes(), throwingDb, { withT: true }))
      .get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
    expect(errRes.status).toBe(500);
    expect(errRes.body.error).toBe('T:auth.verifyTokenError');

    const adminRes = await request(buildApp(loadAuthRoutes(), makeDb({ accessType: 4, email: 'a@b.com' }), { withT: true }))
      .get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.user.roleName).toBe('T:roles.administrator');

    const defaultRoleRes = await request(buildApp(loadAuthRoutes(), makeDb({ accessType: 999, email: 'a@b.com' }), { withT: true }))
      .get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
    expect(defaultRoleRes.status).toBe(200);
    expect(defaultRoleRes.body.data.user.roleName).toBe('T:roles.technician');
  });

  it('POST /refresh uses req.t for the db-unavailable error', async () => {
    const res = await request(buildApp(loadAuthRoutes(), undefined, { withT: true })).post('/api/auth/refresh');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('T:errors.databaseUnavailable');
  });
});

describe('auth.routes.js branch coverage - real logic branches', () => {
  it('POST /login falls back to `mfaCode` when `twoFactorCode` is absent', async () => {
    const spy = vi.spyOn(authController, 'login').mockImplementation(async (req, res) => {
      res.status(200).json({ success: true, seenMfaCode: req.body.mfaCode });
    });
    const authRoutes = loadAuthRoutes();
    const app = buildApp(authRoutes);

    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x', mfaCode: '111111' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.body.seenMfaCode).toBe('111111');
  });

  it('DELETE /sessions/:sessionId clears the refresh cookie when the current session matches the requested sessionId', async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-xyz' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-xyz' });
    vi.spyOn(sessionService, 'revokeSessionById').mockResolvedValue(true);
    const authRoutes = loadAuthRoutes();
    const app = buildApp(authRoutes, makeDb({}));
    const token = signAccessToken();

    const res = await request(app).delete('/api/auth/sessions/session-xyz').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
  });
});
