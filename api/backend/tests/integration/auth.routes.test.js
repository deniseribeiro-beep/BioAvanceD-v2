/**
 * Integration tests for src/interface/routes/auth.routes.js
 * Mounts the real router with supertest and exercises it end-to-end,
 * spying on its CJS dependencies (auth.controller, session.service,
 * auditLogger) rather than reimplementing route logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const logger = require('../../src/utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-jwt-secret';

function loadAuthRoutes() {
  // auth.routes.js `.bind()`s several authController methods at require time,
  // so any spy on authController must be installed BEFORE this re-require for
  // it to take effect on those bound routes (see testing-conventions skill).
  delete require.cache[authRoutesPath];
  return require(authRoutesPath);
}

function buildApp(authRoutes, db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db === undefined ? undefined : db;
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
  return {
    collection: vi.fn(() => ({ findOne })),
    __findOne: findOne
  };
}

/**
 * #428: GET /verify resolves accessType/roleName from the active RBAC
 * assignment (rbac-assignment.service.js), not the User document's own
 * (unpopulated since #427) fields — routes `roles`/`permissions`/
 * `userRoleAssignments` collection calls to buildRbacCollections' mocks,
 * `users` to a plain findOne returning userDoc, same as makeDb above.
 */
function makeDbWithRbac(userDoc, rbacUsers = []) {
  const { buildRbacCollections } = require('../factories/rbac.factory');
  const rbac = buildRbacCollections(rbacUsers);
  const findOne = vi.fn(async () => userDoc);
  return {
    collection: vi.fn((name) => rbac[name] || { findOne }),
    __findOne: findOne
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth.routes.js (integration, real router mounted)', () => {
  describe('POST /login', () => {
    it('translates username/twoFactorCode into email/mfaCode before delegating to authController.login', async () => {
      const spy = vi.spyOn(authController, 'login').mockImplementation(async (req, res) => {
        res.status(200).json({
          success: true,
          seenEmail: req.body.email,
          seenMfaCode: req.body.mfaCode
        });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'jdoe', password: 'x', twoFactorCode: '654321' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body.seenEmail).toBe('jdoe');
      expect(res.body.seenMfaCode).toBe('654321');
    });

    it('returns 500 with the error message when authController.login throws and headers were not sent', async () => {
      vi.spyOn(authController, 'login').mockImplementation(async () => {
        throw new Error('boom-login');
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'a@b.com', password: 'x' });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false, message: 'boom-login' });
    });
  });

  describe('POST /register', () => {
    it('delegates to authController.register (bound at router load time)', async () => {
      const spy = vi.spyOn(authController, 'register').mockImplementation(async (req, res) => {
        res.status(201).json({ success: true, created: req.body.email });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'new@example.com', password: 'x' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(201);
      expect(res.body.created).toBe('new@example.com');
    });
  });

  describe('POST /change-password', () => {
    it('returns 401 without an Authorization header (authenticate middleware blocks it)', async () => {
      const spy = vi.spyOn(authController, 'changePassword').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));

      const res = await request(app).post('/api/auth/change-password').send({});

      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    });

    it('delegates to authController.changePassword when authenticated', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const spy = vi.spyOn(authController, 'changePassword').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'a', newPassword: 'b' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /two-factor/qr', () => {
    it('delegates to authController.setupMFA (mfa-setup route, authenticate skips session check)', async () => {
      const spy = vi.spyOn(authController, 'setupMFA').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true, qr: 'data' });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const token = signAccessToken();

      const res = await request(app)
        .get('/api/auth/two-factor/qr')
        .set('Authorization', `Bearer ${token}`);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /two-factor/enable', () => {
    it('returns 401 without authentication', async () => {
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const res = await request(app).post('/api/auth/two-factor/enable').send({ code: '123456' });
      expect(res.status).toBe(401);
    });

    it('copies req.body.code into req.body.mfaCode before calling authController.enableMFA', async () => {
      const spy = vi.spyOn(authController, 'enableMFA').mockImplementation((req, res) => {
        res.status(200).json({ success: true, seenMfaCode: req.body.mfaCode });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/two-factor/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '999999' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.body.seenMfaCode).toBe('999999');
    });
  });

  describe('POST /two-factor/disable', () => {
    it('responds 501 not-implemented without needing a live session (issue #61)', async () => {
      // /two-factor/disable is an MFA-setup-exempt route like /two-factor/enable,
      // so authenticate() must skip the session-liveness check and reach the
      // inline 501 handler even with no db configured.
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/two-factor/disable')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(501);
    });

    it('responds 501 once authenticate can validate the session', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/two-factor/disable')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(501);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /two-factor/status', () => {
    it('returns 503 when there is no db on app.locals', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, undefined);
      const token = signAccessToken();

      const res = await request(app)
        .get('/api/auth/two-factor/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(503);
    });

    it('returns 404 when the authenticated user is not found in the db', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb(null));
      const token = signAccessToken();

      const res = await request(app)
        .get('/api/auth/two-factor/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('returns 200 with mfaEnabled/mfaLocked flags on success', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({ mfaEnabled: true, mfaLocked: false }));
      const token = signAccessToken();

      const res = await request(app)
        .get('/api/auth/two-factor/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ mfaEnabled: true, mfaLocked: false });
    });

    it('returns 500 when the db lookup throws', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      // First findOne is authenticate's own roleValidUntil lookup (must succeed so the
      // request reaches the route); the route's own lookup on the 2nd call is what throws.
      let calls = 0;
      const db = {
        collection: () => ({
          findOne: vi.fn(async () => {
            calls += 1;
            if (calls === 1) return {};
            throw new Error('db-down');
          })
        })
      };
      const app = buildApp(authRoutes, db);
      const token = signAccessToken();

      const res = await request(app)
        .get('/api/auth/two-factor/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('db-down');
    });
  });

  describe('POST /keepalive', () => {
    it('returns 503 when there is no db (authenticate skips session check for keepalive)', async () => {
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, undefined);
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/keepalive')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(503);
    });

    it('returns 401 sessionExpired when updateActivity resolves falsy', async () => {
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue(null);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/keepalive')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.sessionExpired).toBe(true);
    });

    it('returns 200 with lastActivity/expiresAt on success', async () => {
      const expiresAt = new Date().toISOString();
      const lastActivity = new Date().toISOString();
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ lastActivity, expiresAt });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/keepalive')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ lastActivity, expiresAt });
    });

    it('returns 500 when sessionService.updateActivity throws', async () => {
      vi.spyOn(sessionService, 'updateActivity').mockRejectedValue(new Error('keepalive-boom'));
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/keepalive')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('keepalive-boom');
    });
  });

  describe('POST /logout', () => {
    it('invalidates the session, clears the refresh cookie and returns 200', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1', userID: 'u1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const invalidateSpy = vi.spyOn(sessionService, 'invalidateSession').mockResolvedValue(true);
      const logLogoutSpy = vi.spyOn(auditLogger, 'logLogout').mockResolvedValue(undefined);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // #974: an explicit logout is 'user_request' by the session's own owner,
      // so it is distinguishable from the 'expiration'/'system' pair the clock
      // writes and from an admin's 'admin_action'.
      expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), 's1', 'user_request', 'u1');
      expect(logLogoutSpy).toHaveBeenCalledTimes(1);
      expect(res.headers['set-cookie']?.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
    });

    it('still returns 200 and still logs the logout when sessionService.verifySession throws', async () => {
      vi.spyOn(sessionService, 'verifySession')
        .mockResolvedValueOnce({ valid: true, session: { sessionID: 's1' } }) // for authenticate()
        .mockRejectedValueOnce(new Error('verify-boom')); // for the logout handler itself
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const logLogoutSpy = vi.spyOn(auditLogger, 'logLogout').mockResolvedValue(undefined);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logLogoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /verify', () => {
    it('returns 503 when there is no db', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, undefined);
      const token = signAccessToken();

      const res = await request(app).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(503);
    });

    it('returns 404 and logs TOKEN_VERIFY_FAILED when the user is not found', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb(null));
      const token = signAccessToken();

      const res = await request(app).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'TOKEN_VERIFY_FAILED' }));
    });

    it.each([
      [1, 'Usuário Externo'],
      [3, 'Coordenador']
    ])('resolves accessType %s to roleName "%s" via the active RBAC role assignment', async (accessType, expectedRole) => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      const userID = makeUserId();
      const app = buildApp(
        authRoutes,
        makeDbWithRbac({ email: 'a@b.com', username: 'u' }, [{ userAccountId: userID, accessType }])
      );
      const token = signAccessToken({ userID });

      const res = await request(app).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.roleName).toBe(expectedRole);
      expect(res.body.data.user.accessType).toBe(accessType);
      expect(res.body.data.valid).toBe(true);
    });

    it('returns 500 when the db lookup throws', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const authRoutes = loadAuthRoutes();
      // First findOne is authenticate's own roleValidUntil lookup (must succeed so the
      // request reaches the route); the route's own lookup on the 2nd call is what throws.
      let calls = 0;
      const db = {
        collection: () => ({
          findOne: vi.fn(async () => {
            calls += 1;
            if (calls === 1) return {};
            throw new Error('verify-db-boom');
          })
        })
      };
      const app = buildApp(authRoutes, db);
      const token = signAccessToken();

      const res = await request(app).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('verify-db-boom');
    });
  });

  describe('GET /sessions', () => {
    it('returns the sessions list from session.service.listUserSessions', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      vi.spyOn(sessionService, 'listUserSessions').mockResolvedValue([{ sessionID: 'x1' }]);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ sessionID: 'x1' }]);
    });

    it('returns 500 when session.service.listUserSessions throws', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      vi.spyOn(sessionService, 'listUserSessions').mockRejectedValue(new Error('list-boom'));
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /sessions/all-others', () => {
    it('revokes other sessions and returns 200', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      const revokeSpy = vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(true);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app).delete('/api/auth/sessions/all-others').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETE /sessions/:sessionId', () => {
    it('returns 404 when revokeSessionById resolves falsy', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 's1' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 's1' });
      vi.spyOn(sessionService, 'revokeSessionById').mockResolvedValue(false);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app).delete('/api/auth/sessions/session-xyz').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('revokes the specified session and returns 200', async () => {
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'other-session' } });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'other-session' });
      vi.spyOn(sessionService, 'revokeSessionById').mockResolvedValue(true);
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes, makeDb({}));
      const token = signAccessToken();

      const res = await request(app).delete('/api/auth/sessions/session-xyz').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /refresh (public, no authenticate middleware)', () => {
    function appWithDb(db) {
      const authRoutes = loadAuthRoutes();
      return buildApp(authRoutes, db);
    }

    it('returns 401 when there is no refresh_token cookie', async () => {
      const app = appWithDb(makeDb({}));
      const res = await request(app).post('/api/auth/refresh');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a garbage/invalid refresh token', async () => {
      const app = appWithDb(makeDb({}));
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=not-a-real-jwt');
      expect(res.status).toBe(401);
    });

    it('returns 401 when the token has the wrong "type" claim', async () => {
      const app = appWithDb(makeDb({}));
      const badToken = jwt.sign({ userID: makeUserId(), type: 'access' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${badToken}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 when session lookup for the refresh token returns null', async () => {
      vi.spyOn(sessionService, 'getSessionByRefreshToken').mockResolvedValue(null);
      const app = appWithDb(makeDb({}));
      const userID = makeUserId();
      const refreshToken = jwt.sign({ userID, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 when the session userID does not match the token userID', async () => {
      vi.spyOn(sessionService, 'getSessionByRefreshToken').mockResolvedValue({ userID: 'someone-else', sessionID: 's9' });
      const app = appWithDb(makeDb({}));
      const userID = makeUserId();
      const refreshToken = jwt.sign({ userID, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);
      expect(res.status).toBe(401);
    });

    it('returns 401 when the user behind a valid session is no longer in the db', async () => {
      const userID = makeUserId();
      vi.spyOn(sessionService, 'getSessionByRefreshToken').mockResolvedValue({ userID: String(userID), sessionID: 's9' });
      const app = appWithDb(makeDb(null));
      const refreshToken = jwt.sign({ userID, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);
      expect(res.status).toBe(401);
    });

    it('rotates tokens and returns a new access token on the happy path', async () => {
      const userId = new ObjectId();
      vi.spyOn(sessionService, 'getSessionByRefreshToken').mockResolvedValue({ userID: userId.toString(), sessionID: 's9' });
      const rotateSpy = vi.spyOn(sessionService, 'rotateSessionTokens').mockResolvedValue(true);
      // #431: the new access token's accessType is resolved from the RBAC
      // assignment, not the User document's (no-longer-populated) field.
      const db = makeDbWithRbac(
        { _id: userId, email: 'a@b.com', username: 'u', accessType: 2, name: 'A' },
        [{ userAccountId: userId.toString(), accessType: 3 }]
      );
      const app = appWithDb(db);
      const refreshToken = jwt.sign({ userID: userId.toString(), type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.data.token).toBe('string');
      const decodedAccess = jwt.verify(res.body.data.token, JWT_SECRET);
      expect(decodedAccess.userID).toBe(userId.toString());
      expect(decodedAccess.accessType).toBe(3);
      expect(rotateSpy).toHaveBeenCalledTimes(1);
      expect(res.headers['set-cookie']?.some((c) => c.startsWith('refresh_token='))).toBe(true);
    });
  });

  describe('POST /password-reset/request and /password-reset/reset', () => {
    it('delegates password-reset/request to authController.requestPasswordReset', async () => {
      const spy = vi.spyOn(authController, 'requestPasswordReset').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app).post('/api/auth/password-reset/request').send({ email: 'a@b.com' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });

    it('delegates password-reset/reset to authController.resetPassword', async () => {
      const spy = vi.spyOn(authController, 'resetPassword').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app).post('/api/auth/password-reset/reset').send({ token: 't', newPassword: 'x' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });

  describe('first-login MFA endpoints (public)', () => {
    it('delegates /two-factor/qr-first-login to authController.setupMFAFirstLogin', async () => {
      const spy = vi.spyOn(authController, 'setupMFAFirstLogin').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app).post('/api/auth/two-factor/qr-first-login').send({});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });

    it('delegates /two-factor/enable-first-login to authController.enableMFAFirstLogin', async () => {
      const spy = vi.spyOn(authController, 'enableMFAFirstLogin').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);

      const res = await request(app).post('/api/auth/two-factor/enable-first-login').send({});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });

  describe('legacy MFA endpoints (/mfa/setup, /mfa/enable)', () => {
    it('delegates /mfa/setup to authController.setupMFA when authenticated', async () => {
      const spy = vi.spyOn(authController, 'setupMFA').mockImplementation(async (req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const token = signAccessToken();

      const res = await request(app).post('/api/auth/mfa/setup').set('Authorization', `Bearer ${token}`).send({});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });

    it('delegates /mfa/enable to authController.enableMFA when authenticated', async () => {
      const spy = vi.spyOn(authController, 'enableMFA').mockImplementation((req, res) => {
        res.status(200).json({ success: true });
      });
      const authRoutes = loadAuthRoutes();
      const app = buildApp(authRoutes);
      const token = signAccessToken();

      const res = await request(app).post('/api/auth/mfa/enable').set('Authorization', `Bearer ${token}`).send({});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });
});
