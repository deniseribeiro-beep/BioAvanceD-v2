import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require2 = createRequire(import.meta.url);

// Loaded through createRequire, the way tests/integration/user-security.routes.test.js
// loads them, so the spies below sit on the same module objects the controller reads.
const auditLogger = require2('../../src/utils/auditLogger');
const userSecurityService = require2('../../src/services/user-security.service');
const sessionService = require2('../../src/services/session.service');
const passwordService = require2('../../src/services/password.service');
const controller = require2('../../src/controllers/user-security.controller');

vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
vi.spyOn(auditLogger, 'extractRequestInfo').mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' });

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// withT: req.t present (returns the key), absent, or present but returning ''
// (so the `|| 'fallback'` arm runs even with a translator).
function createRequest({ db = {}, withT = true, body = {}, params = {}, query = {}, headers = {} } = {}) {
  const req = { app: { locals: { db } }, user: { userID: 'u-1' }, body, params, query, headers };
  if (withT === true) req.t = (key) => key;
  if (withT === 'empty') req.t = () => '';
  return req;
}

// method -> the service function its success path awaits.
const HANDLERS = [
  ['getStatus', 'getSecurityStatus'],
  ['getMFAStatus', 'getMFAStatus'],
  ['getPasswordStatus', 'getPasswordStatus'],
  ['getSessions', 'getSessions'],
  ['getActivities', 'getActivities'],
  ['updatePassword', 'updatePassword'],
  ['generateRecoveryCodes', 'generateRecoveryCodes'],
  ['revokeSession', 'revokeSession'],
  ['revokeAllSessions', 'revokeAllSessions'],
  ['requestPasswordReset', 'requestPasswordReset'],
];

// The bodies that get each handler past its own input checks to the service call.
const VALID_BODY = {
  updatePassword: { currentPassword: 'Old@12345678', newPassword: 'New@12345678' },
  requestPasswordReset: { expirationHours: 2 },
};

describe('user-security.controller branch arms', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'extractRequestInfo').mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' });
  });

  describe.each(HANDLERS)('%s', (method, serviceFn) => {
    it('answers 503 with the translated message when there is no db', async () => {
      const res = createResponse();
      await controller[method](createRequest({ db: null }), res);
      expect(res.statusCode).toBe(503);
      expect(res.payload).toEqual({ success: false, error: 'errors.databaseUnavailable' });
    });

    it('answers 503 with the Portuguese fallback when req.t is absent', async () => {
      const res = createResponse();
      await controller[method](createRequest({ db: null, withT: false }), res);
      expect(res.statusCode).toBe(503);
      expect(res.payload.error).toBe('Banco de dados não disponível');
    });

    it('answers 503 with the fallback when req.t returns an empty string', async () => {
      const res = createResponse();
      await controller[method](createRequest({ db: null, withT: 'empty' }), res);
      expect(res.payload.error).toBe('Banco de dados não disponível');
    });

    it.each([true, false])('maps a service failure to an error body (req.t present: %s)', async (withT) => {
      vi.spyOn(passwordService, 'isPasswordResetAllowed').mockResolvedValue(true);
      vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(0);
      vi.spyOn(userSecurityService, serviceFn).mockRejectedValue(new Error('boom'));
      const res = createResponse();
      await controller[method](createRequest({ withT, body: VALID_BODY[method] || {}, params: { id: 's-1' } }), res);
      expect([400, 500]).toContain(res.statusCode);
      expect(res.payload.success).toBe(false);
      expect(res.payload.message).toBe('boom');
      expect(typeof res.payload.error).toBe('string');
      if (!withT) expect(res.payload.error).not.toMatch(/^userSecurity\./);
    });
  });

  it('getActivities passes the parsed limit, and 20 when none is given', async () => {
    const spy = vi.spyOn(userSecurityService, 'getActivities').mockResolvedValue([{ a: 1 }]);
    const res = createResponse();
    await controller.getActivities(createRequest({ query: { limit: '5' } }), res);
    expect(spy).toHaveBeenLastCalledWith({}, 'u-1', 5);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ success: true, data: [{ a: 1 }] });
    await controller.getActivities(createRequest({ query: {} }), createResponse());
    expect(spy).toHaveBeenLastCalledWith({}, 'u-1', 20);
  });

  describe.each([
    ['updatePassword', 'updatePassword', 200, 'Senha alterada com sucesso'],
    ['generateRecoveryCodes', 'generateRecoveryCodes', 201, 'Códigos de recuperação gerados com sucesso'],
    ['revokeSession', 'revokeSession', 200, null],
    ['revokeAllSessions', 'revokeAllSessions', 200, null],
    ['requestPasswordReset', 'requestPasswordReset', 200, 'Link de reset de senha enviado com sucesso'],
  ])('%s success message', (method, serviceFn, status, fallback) => {
    it.each([true, false])('req.t present: %s', async (withT) => {
      vi.spyOn(passwordService, 'isPasswordResetAllowed').mockResolvedValue(true);
      vi.spyOn(sessionService, 'revokeAllOtherSessions').mockResolvedValue(0);
      vi.spyOn(userSecurityService, serviceFn).mockResolvedValue(
        serviceFn === 'generateRecoveryCodes' ? ['c1', 'c2'] : { expiresAt: 'x' }
      );
      const res = createResponse();
      await controller[method](createRequest({ withT, body: VALID_BODY[method] || {}, params: { id: 's-1' } }), res);
      expect(res.statusCode).toBe(status);
      expect(res.payload.success).toBe(true);
      if (withT) expect(res.payload.message).toMatch(/^userSecurity\./);
      else expect(res.payload.message).not.toMatch(/^userSecurity\./);
      if (!withT && fallback) expect(res.payload.message).toBe(fallback);
    });
  });

  it('updatePassword answers 400 when a password field is missing, without calling the service', async () => {
    const spy = vi.spyOn(userSecurityService, 'updatePassword');
    const res = createResponse();
    await controller.updatePassword(createRequest({ body: { currentPassword: 'x' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('Senha atual e nova senha são obrigatórias');
    expect(spy).not.toHaveBeenCalled();
  });

  it('requestPasswordReset answers 403 with the disabled body when resets are off', async () => {
    vi.spyOn(passwordService, 'isPasswordResetAllowed').mockResolvedValue(false);
    const spy = vi.spyOn(userSecurityService, 'requestPasswordReset');
    const res = createResponse();
    await controller.requestPasswordReset(createRequest({ body: { expirationHours: 2 } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual(passwordService.PASSWORD_RESET_DISABLED);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([0.1, 25])('requestPasswordReset refuses expirationHours %s with 400', async (hours) => {
    vi.spyOn(passwordService, 'isPasswordResetAllowed').mockResolvedValue(true);
    const spy = vi.spyOn(userSecurityService, 'requestPasswordReset');
    const res = createResponse();
    await controller.requestPasswordReset(createRequest({ body: { expirationHours: hours } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('Tempo de expiração deve estar entre 15 minutos e 24 horas');
    expect(spy).not.toHaveBeenCalled();
  });
});
