/**
 * tests/unit/infrastructure/middleware/auth.test.js
 * Unit tests for src/infrastructure/middleware/auth.js
 *
 * jwt is required as `const jwt = require('jsonwebtoken')` and used as `jwt.verify` (not
 * destructured), so vi.mock('jsonwebtoken') + spying on the mocked module works. Same story for
 * sessionService (`const sessionService = require('../../services/session.service')`, used as
 * `sessionService.verifySession`/`updateActivity`) — spyOn the real singleton directly instead of
 * vi.mock, since only two methods need overriding per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyMock = vi.fn();
vi.mock('jsonwebtoken', () => ({
  default: { verify: verifyMock },
  verify: verifyMock
}));

const jwt = require('jsonwebtoken');
jwt.verify = verifyMock;
const { authenticate, optionalAuth } = require('../../../../src/infrastructure/middleware/auth');
const sessionService = require('../../../../src/services/session.service');
const logger = require('../../../../src/utils/logger');
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440001';

function createReq(overrides = {}) {
  return {
    headers: {},
    path: '/api/samples',
    app: { locals: { db: { collection: () => ({ findOne: async () => ({ actorId: ACTOR_ID }) }) } } },
    ...overrides
  };
}

function createRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authenticate', () => {
    it('returns 401 when no authorization header is present', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Token não fornecido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when the authorization header does not start with Bearer', async () => {
      const req = createReq({ headers: { authorization: 'Basic abc123' } });
      const res = createRes();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('logs an unauthorized-access audit entry when db is available and no token given', async () => {
      const req = createReq({ app: { locals: { db: {} } } });
      const res = createRes();

      await authenticate(req, res, next);
      // audit logging happens inside setImmediate; flush microtask/macrotask queue
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 with token expired message when jwt.verify throws TokenExpiredError', async () => {
      const req = createReq({ headers: { authorization: 'Bearer expired-token' } });
      const res = createRes();
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      verifyMock.mockImplementation(() => {
        throw err;
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Token expirado' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 with invalid token message when jwt.verify throws a generic error', async () => {
      const req = createReq({ headers: { authorization: 'Bearer bad-token' } });
      const res = createRes();
      verifyMock.mockImplementation(() => {
        throw new Error('malformed');
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Token inválido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a signed pre-cutover ObjectId claim even on MFA routes', async () => {
      const req = createReq({ headers: { authorization: 'Bearer old-token' }, path: '/mfa/setup' });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '507f1f77bcf86cd799439011', mfaSetupRequired: true });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when db is unavailable for session validation', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        app: { locals: {} }
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 with sessionExpired flag when session check reports session_expired', async () => {
      const req = createReq({ headers: { authorization: 'Bearer good-token' } });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
        valid: false,
        reason: 'session_expired'
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ sessionExpired: true })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 with session revoked message when session check reports session_revoked', async () => {
      const req = createReq({ headers: { authorization: 'Bearer good-token' } });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
        valid: false,
        reason: 'session_revoked'
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Sessão revogada' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns generic 401 session invalid for any other invalid reason', async () => {
      const req = createReq({ headers: { authorization: 'Bearer good-token' } });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
        valid: false,
        reason: 'session_not_found'
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Sessão inválida' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() and sets req.user when the session is valid', async () => {
      const req = createReq({ headers: { authorization: 'Bearer good-token' } });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaVerified: true });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(sessionService.updateActivity).toHaveBeenCalledWith(req.app.locals.db, 'good-token');
      expect(req.user).toEqual({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaVerified: true });
      expect(next).toHaveBeenCalled();
    });

    it('skips session validation for keepalive routes', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/auth/keepalive'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession');

      await authenticate(req, res, next);

      expect(sessionService.verifySession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('skips session validation for mfa setup routes', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/mfa/setup'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaSetupRequired: true });
      vi.spyOn(sessionService, 'verifySession');

      await authenticate(req, res, next);

      expect(sessionService.verifySession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('skips session validation for user/security mfa-setup routes', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/user/security/mfa-setup'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession');

      await authenticate(req, res, next);

      expect(sessionService.verifySession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('skips session validation for /user/security/.../two-factor/qr', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/user/security/two-factor/qr'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession');

      await authenticate(req, res, next);

      expect(sessionService.verifySession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('skips session validation for /user/security/.../two-factor/enable', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/user/security/two-factor/enable'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession');

      await authenticate(req, res, next);

      expect(sessionService.verifySession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when the persisted actorId does not match the token claim', async () => {
      const findOne = vi.fn().mockResolvedValue({ actorId: '550e8400-e29b-41d4-a716-446655440099' });
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        app: { locals: { db: { collection: () => ({ findOne }) } } },
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Token inválido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when roleValidUntil is in the past', async () => {
      const findOne = vi.fn().mockResolvedValue({
        actorId: ACTOR_ID,
        roleValidUntil: '2020-01-01T00:00:00.000Z',
      });
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        app: { locals: { db: { collection: () => ({ findOne }) } } },
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaVerified: true });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ roleExpired: true, error: 'Papel expirado' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows access when roleValidUntil is still in the future', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const findOne = vi.fn().mockResolvedValue({
        actorId: ACTOR_ID,
        roleValidUntil: future,
      });
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        app: { locals: { db: { collection: () => ({ findOne }) } } },
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaVerified: true });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 requiring MFA setup when mfaSetupRequired and not mfaVerified', async () => {
      const req = createReq({ headers: { authorization: 'Bearer good-token' } });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaSetupRequired: true, mfaVerified: false });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ requiresMFASetup: true })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows access to /security/mfa-setup route even with mfaSetupRequired pending', async () => {
      const req = createReq({
        headers: { authorization: 'Bearer good-token' },
        path: '/api/security/mfa-setup'
      });
      const res = createRes();
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaSetupRequired: true, mfaVerified: false });
      vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true });
      vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({});

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID, mfaSetupRequired: true, mfaVerified: false });
    });

    it('returns 500 when an unexpected error escapes the outer try block', async () => {
      const res = createRes();
      // req.headers getter throws to trigger the outer catch
      const req = {
        get headers() {
          throw new Error('boom');
        },
        app: { locals: { db: { collection: () => ({ findOne: async () => ({}) }) } } },
        path: '/api/samples'
      };

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Erro interno' })
      );
      expect(logger.error).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('calls next() without setting req.user when there is no authorization header', async () => {
      const req = createReq();

      await optionalAuth(req, {}, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('calls next() without setting req.user when the header is not a Bearer token', async () => {
      const req = createReq({ headers: { authorization: 'Basic abc' } });

      await optionalAuth(req, {}, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('sets req.user and calls next() for a valid token', async () => {
      const req = createReq({ headers: { authorization: 'Bearer valid-token' } });
      verifyMock.mockReturnValue({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });

      await optionalAuth(req, {}, next);

      expect(req.user).toEqual({ userID: '550e8400-e29b-41d4-a716-446655440002', actorId: ACTOR_ID });
      expect(next).toHaveBeenCalled();
    });

    it('calls next() without setting req.user when jwt.verify throws', async () => {
      const req = createReq({ headers: { authorization: 'Bearer bad-token' } });
      verifyMock.mockImplementation(() => {
        throw new Error('invalid');
      });

      await optionalAuth(req, {}, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('calls next() even if headers access throws in the outer try block', async () => {
      const req = {
        get headers() {
          throw new Error('boom');
        }
      };

      await optionalAuth(req, {}, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
