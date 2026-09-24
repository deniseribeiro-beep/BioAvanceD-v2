import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const controller = require('../../src/controllers/user-security.controller');
const userSecurityService = require('../../src/services/user-security.service');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440001';

function makeRes() {
  const res = {};
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeReq(overrides = {}) {
  return {
    app: { locals: { db: { marker: 'db' } } },
    user: { userID: 'user-1', actorId: ACTOR_ID },
    headers: {},
    query: {},
    params: {},
    body: {},
    ...overrides,
  };
}

async function invoke(method, req) {
  const res = makeRes();
  await controller[method](req, res);
  return res;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'extractRequestInfo').mockReturnValue({ ipAddress: '127.0.0.1' });
});

describe('user-security.controller item 8 coverage', () => {
  const readMethods = [
    ['getStatus', 'getSecurityStatus'],
    ['getMFAStatus', 'getMFAStatus'],
    ['getPasswordStatus', 'getPasswordStatus'],
  ];

  it.each(readMethods)('%s returns 503 with the default database-unavailable message', async (method) => {
    const res = await invoke(method, makeReq({ app: { locals: { db: null } } }));
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Banco de dados não disponível');
  });

  it.each(readMethods)('%s uses the translated database-unavailable message when available', async (method) => {
    const res = await invoke(method, makeReq({
      app: { locals: { db: null } },
      t: vi.fn(() => 'db-unavailable-translated'),
    }));
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('db-unavailable-translated');
  });

  it.each(readMethods)('%s returns service data on success', async (method, serviceMethod) => {
    vi.spyOn(userSecurityService, serviceMethod).mockResolvedValue({ ok: serviceMethod });
    const req = makeReq();
    const res = await invoke(method, req);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: serviceMethod } });
    expect(userSecurityService[serviceMethod]).toHaveBeenCalledWith(req.app.locals.db, 'user-1');
  });

  it.each([
    ['getStatus', 'getSecurityStatus', 'Erro ao obter status de segurança'],
    ['getMFAStatus', 'getMFAStatus', 'Erro ao obter status MFA'],
    ['getPasswordStatus', 'getPasswordStatus', 'Erro ao obter status da senha'],
  ])('%s maps service failures to 500 using the fallback message', async (method, serviceMethod, fallback) => {
    vi.spyOn(userSecurityService, serviceMethod).mockRejectedValue(new Error('service failed'));
    const res = await invoke(method, makeReq());
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe(fallback);
    expect(res.body.message).toBe('service failed');
  });

  it.each([
    ['getStatus', 'getSecurityStatus'],
    ['getMFAStatus', 'getMFAStatus'],
    ['getPasswordStatus', 'getPasswordStatus'],
  ])('%s uses translated catch messages', async (method, serviceMethod) => {
    vi.spyOn(userSecurityService, serviceMethod).mockRejectedValue(new Error('service failed'));
    const res = await invoke(method, makeReq({ t: vi.fn(() => 'translated-error') }));
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('translated-error');
  });

  describe('getSessions', () => {
    it('returns 503 with and without translation support', async () => {
      let res = await invoke('getSessions', makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('Banco de dados não disponível');

      res = await invoke('getSessions', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');
    });

    it('passes the bearer token and extracted request info to the service', async () => {
      vi.spyOn(userSecurityService, 'getSessions').mockResolvedValue([{ id: 's1' }]);
      const req = makeReq({ headers: { authorization: 'Bearer token-1' } });
      const res = await invoke('getSessions', req);
      expect(res.statusCode).toBe(200);
      expect(userSecurityService.getSessions).toHaveBeenCalledWith(
        req.app.locals.db,
        'user-1',
        'token-1',
        { ipAddress: '127.0.0.1' }
      );
    });

    it('passes undefined token when authorization is absent', async () => {
      vi.spyOn(userSecurityService, 'getSessions').mockResolvedValue([]);
      const req = makeReq();
      await invoke('getSessions', req);
      expect(userSecurityService.getSessions.mock.calls[0][2]).toBeUndefined();
    });

    it('maps failures with fallback and translated messages', async () => {
      vi.spyOn(userSecurityService, 'getSessions').mockRejectedValue(new Error('sessions failed'));
      let res = await invoke('getSessions', makeReq());
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Erro ao obter sessões');

      res = await invoke('getSessions', makeReq({ t: vi.fn(() => 'sessions translated') }));
      expect(res.body.error).toBe('sessions translated');
    });
  });

  describe('getActivities', () => {
    it('returns 503 with both message branches', async () => {
      let res = await invoke('getActivities', makeReq({ app: { locals: { db: null } } }));
      expect(res.body.error).toBe('Banco de dados não disponível');

      res = await invoke('getActivities', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');
    });

    it('uses a parsed limit and falls back to 20 for invalid input', async () => {
      vi.spyOn(userSecurityService, 'getActivities').mockResolvedValue([]);
      const reqExplicit = makeReq({ query: { limit: '7' } });
      await invoke('getActivities', reqExplicit);
      expect(userSecurityService.getActivities).toHaveBeenLastCalledWith(reqExplicit.app.locals.db, 'user-1', 7);

      const reqDefault = makeReq({ query: { limit: 'invalid' } });
      await invoke('getActivities', reqDefault);
      expect(userSecurityService.getActivities).toHaveBeenLastCalledWith(reqDefault.app.locals.db, 'user-1', 20);
    });

    it('maps failures with fallback and translated messages', async () => {
      vi.spyOn(userSecurityService, 'getActivities').mockRejectedValue(new Error('activities failed'));
      let res = await invoke('getActivities', makeReq());
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Erro ao obter atividades');

      res = await invoke('getActivities', makeReq({ t: vi.fn(() => 'activities translated') }));
      expect(res.body.error).toBe('activities translated');
    });
  });

  describe('updatePassword', () => {
    it('returns 503 for missing db and 400 for missing password fields', async () => {
      let res = await invoke('updatePassword', makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);

      res = await invoke('updatePassword', makeReq({ body: { currentPassword: 'old' } }));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('obrigatórias');

      res = await invoke('updatePassword', makeReq({ body: { newPassword: 'new' } }));
      expect(res.statusCode).toBe(400);
    });

    it('updates, revokes other sessions and audits with an explicit bearer token', async () => {
      vi.spyOn(userSecurityService, 'updatePassword').mockResolvedValue(undefined);
      vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(undefined);
      const req = makeReq({
        headers: { authorization: 'Bearer current-token' },
        body: { currentPassword: 'old', newPassword: 'new' },
      });

      const res = await invoke('updatePassword', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Senha alterada com sucesso');
      expect(sessionService.revokeAllOtherSessions).toHaveBeenCalledWith(
        req.app.locals.db, 'user-1', 'current-token', 'password_change', ACTOR_ID
      );
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE',
        resourceType: 'Password',
        severity: 'critical',
      }));
    });

    it('covers empty authorization and translated success message', async () => {
      vi.spyOn(userSecurityService, 'updatePassword').mockResolvedValue(undefined);
      vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(undefined);
      const req = makeReq({
        headers: undefined,
        body: { currentPassword: 'old', newPassword: 'new' },
        t: vi.fn(() => 'password translated'),
      });
      const res = await invoke('updatePassword', req);
      expect(res.body.message).toBe('password translated');
      expect(sessionService.revokeAllOtherSessions.mock.calls[0][2]).toBe('');
    });

    it('maps update failures with fallback and translated messages', async () => {
      vi.spyOn(userSecurityService, 'updatePassword').mockRejectedValue(new Error('bad password'));
      let res = await invoke('updatePassword', makeReq({ body: { currentPassword: 'old', newPassword: 'new' } }));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Erro ao alterar senha');

      res = await invoke('updatePassword', makeReq({
        body: { currentPassword: 'old', newPassword: 'new' },
        t: vi.fn(() => 'password error translated'),
      }));
      expect(res.body.error).toBe('password error translated');
    });
  });

  describe('generateRecoveryCodes', () => {
    it('returns 503 with fallback and translated messages', async () => {
      let res = await invoke('generateRecoveryCodes', makeReq({ app: { locals: { db: null } } }));
      expect(res.body.error).toBe('Banco de dados não disponível');
      res = await invoke('generateRecoveryCodes', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');
    });

    it('returns generated codes, audits and covers both success-message branches', async () => {
      vi.spyOn(userSecurityService, 'generateRecoveryCodes').mockResolvedValue(['a', 'b']);
      let res = await invoke('generateRecoveryCodes', makeReq());
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toEqual({ codes: ['a', 'b'], remaining: 2 });
      expect(res.body.message).toBe('Códigos de recuperação gerados com sucesso');
      expect(auditLogger.log).toHaveBeenCalled();

      res = await invoke('generateRecoveryCodes', makeReq({ t: vi.fn(() => 'codes translated') }));
      expect(res.body.message).toBe('codes translated');
    });

    it('maps failures through fallback and translation', async () => {
      vi.spyOn(userSecurityService, 'generateRecoveryCodes').mockRejectedValue(new Error('codes failed'));
      let res = await invoke('generateRecoveryCodes', makeReq());
      expect(res.body.error).toBe('Erro ao gerar códigos de recuperação');
      res = await invoke('generateRecoveryCodes', makeReq({ t: vi.fn(() => 'codes error translated') }));
      expect(res.body.error).toBe('codes error translated');
    });
  });

  describe('revokeSession', () => {
    it('covers db-unavailable, success and error branches', async () => {
      let res = await invoke('revokeSession', makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);

      vi.spyOn(userSecurityService, 'revokeSession').mockResolvedValue(undefined);
      const req = makeReq({ params: { id: 'session-1' } });
      res = await invoke('revokeSession', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Sessão revogada com sucesso');
      expect(userSecurityService.revokeSession).toHaveBeenCalledWith(req.app.locals.db, 'user-1', 'session-1', ACTOR_ID);

      userSecurityService.revokeSession.mockRejectedValueOnce(new Error('revoke failed'));
      res = await invoke('revokeSession', makeReq({
        params: { id: 'session-2' },
        t: vi.fn(() => 'revoke translated'),
      }));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('revoke translated');
    });

    it('covers translated database and success messages plus fallback error', async () => {
      let res = await invoke('revokeSession', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');

      vi.spyOn(userSecurityService, 'revokeSession').mockResolvedValue(undefined);
      res = await invoke('revokeSession', makeReq({
        params: { id: 'session-1' },
        t: vi.fn(() => 'revoke success translated'),
      }));
      expect(res.body.message).toBe('revoke success translated');

      userSecurityService.revokeSession.mockRejectedValueOnce(new Error('revoke failed'));
      res = await invoke('revokeSession', makeReq({ params: { id: 'session-2' } }));
      expect(res.body.error).toBe('Erro ao revogar sessão');
    });
  });

  describe('revokeAllSessions', () => {
    it('covers missing db and explicit/absent bearer tokens', async () => {
      let res = await invoke('revokeAllSessions', makeReq({ app: { locals: { db: null } } }));
      expect(res.statusCode).toBe(503);

      vi.spyOn(userSecurityService, 'revokeAllSessions').mockResolvedValue(undefined);
      let req = makeReq({ headers: { authorization: 'Bearer keep-me' } });
      res = await invoke('revokeAllSessions', req);
      expect(res.statusCode).toBe(200);
      expect(userSecurityService.revokeAllSessions).toHaveBeenLastCalledWith(req.app.locals.db, 'user-1', 'keep-me', ACTOR_ID);

      req = makeReq({ headers: {} });
      await invoke('revokeAllSessions', req);
      expect(userSecurityService.revokeAllSessions.mock.calls.at(-1)[2]).toBeUndefined();
    });

    it('covers translated db/success/error and fallback error messages', async () => {
      let res = await invoke('revokeAllSessions', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');

      vi.spyOn(userSecurityService, 'revokeAllSessions').mockResolvedValue(undefined);
      res = await invoke('revokeAllSessions', makeReq({ t: vi.fn(() => 'all revoked translated') }));
      expect(res.body.message).toBe('all revoked translated');

      userSecurityService.revokeAllSessions.mockRejectedValueOnce(new Error('revoke all failed'));
      res = await invoke('revokeAllSessions', makeReq());
      expect(res.body.error).toBe('Erro ao revogar todas as sessões');

      userSecurityService.revokeAllSessions.mockRejectedValueOnce(new Error('revoke all failed'));
      res = await invoke('revokeAllSessions', makeReq({ t: vi.fn(() => 'revoke all error translated') }));
      expect(res.body.error).toBe('revoke all error translated');
    });
  });

  describe('requestPasswordReset', () => {
    it('returns 503 with fallback and translated messages', async () => {
      let res = await invoke('requestPasswordReset', makeReq({ app: { locals: { db: null } } }));
      expect(res.body.error).toBe('Banco de dados não disponível');
      res = await invoke('requestPasswordReset', makeReq({
        app: { locals: { db: null } },
        t: vi.fn(() => 'db translated'),
      }));
      expect(res.body.error).toBe('db translated');
    });

    it('rejects expiration below 15 minutes and above 24 hours', async () => {
      let res = await invoke('requestPasswordReset', makeReq({ body: { expirationHours: 0.1 } }));
      expect(res.statusCode).toBe(400);
      res = await invoke('requestPasswordReset', makeReq({ body: { expirationHours: 25 } }));
      expect(res.statusCode).toBe(400);
    });

    it('uses the default expiration, audits, and covers fallback/translated success messages', async () => {
      const expiresAt = new Date('2026-09-18T21:00:00.000Z');
      vi.spyOn(userSecurityService, 'requestPasswordReset').mockResolvedValue({ expiresAt });

      let req = makeReq({ body: {} });
      let res = await invoke('requestPasswordReset', req);
      expect(res.statusCode).toBe(200);
      expect(userSecurityService.requestPasswordReset).toHaveBeenLastCalledWith(req.app.locals.db, 'user-1', 1);
      expect(res.body.message).toBe('Link de reset de senha enviado com sucesso');
      expect(res.body.data.expirationHours).toBe(1);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE',
        resourceType: 'PasswordReset',
        payload: expect.objectContaining({ expirationHours: 1, expiresAt }),
      }));

      req = makeReq({ body: { expirationHours: 24 }, t: vi.fn(() => 'reset translated') });
      res = await invoke('requestPasswordReset', req);
      expect(res.body.message).toBe('reset translated');
      expect(res.body.data.expirationHours).toBe(24);
    });

    it('maps failures with fallback and translated messages', async () => {
      vi.spyOn(userSecurityService, 'requestPasswordReset').mockRejectedValue(new Error('reset failed'));
      let res = await invoke('requestPasswordReset', makeReq({ body: { expirationHours: 1 } }));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Erro ao solicitar reset de senha');

      res = await invoke('requestPasswordReset', makeReq({
        body: { expirationHours: 1 },
        t: vi.fn(() => 'reset error translated'),
      }));
      expect(res.body.error).toBe('reset error translated');
    });
  });
});
