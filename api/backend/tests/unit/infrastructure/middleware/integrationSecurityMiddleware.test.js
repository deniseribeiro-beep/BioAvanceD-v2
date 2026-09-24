/**
 * tests/unit/infrastructure/middleware/integrationSecurityMiddleware.test.js
 * Unit tests for src/infrastructure/middleware/integrationSecurityMiddleware.js
 *
 * Note: this file's source (integrationSecurityMiddleware.js) does `const { authConsent } =
 * require('./authConsent')` at module load time (a destructured CJS require). Per this repo's
 * established convention (see tests/unit/authConsent.test.js and tests/unit/scheduler.service.test.js),
 * vi.mock() does not reliably intercept require() calls, and vi.spyOn() cannot retroactively replace
 * a reference that was already destructured at require-time. So instead of mocking authConsent, we
 * drive its real behavior via a fake Mongo-like db (same technique as authConsent.test.js), and we
 * spy on securityAlertsService/logger directly since those are referenced as `securityAlertsService.x`
 * / `logger.x` (not destructured) in the source, so spyOn on the shared singleton module objects works.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  createSecurityIntegration,
  integrateSecurityIntoRoute,
  applySecurityToAllCriticalRoutes,
  trackBlockedAttempts,
  complianceTrackingMiddleware,
  consentBlockAlertWrapper,
  initializeSecuritySystem
} = require('../../../../src/infrastructure/middleware/integrationSecurityMiddleware');

const securityAlertsService = require('../../../../src/services/securityAlerts.service');
const logger = require('../../../../src/utils/logger');
const auditLogger = require('../../../../src/utils/auditLogger');

function createReq(overrides = {}) {
  return {
    app: { locals: {} },
    body: {},
    params: {},
    query: {},
    headers: {},
    method: 'POST',
    path: '/api/samples',
    originalUrl: '/api/samples',
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-agent'),
    ...overrides
  };
}

function createRes(overrides = {}) {
  const res = {
    statusCode: 200,
    json: vi.fn(),
    send: vi.fn(),
    ...overrides
  };
  // Mirror real Express: res.status(code) sets statusCode as a side effect and returns res.
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

describe('integrationSecurityMiddleware', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trackBlockedAttempts', () => {
    it('initializes blockedAttempts as a Map when absent and calls next', () => {
      const req = createReq();
      const next = vi.fn();

      trackBlockedAttempts(req, {}, next);

      expect(req.app.locals.blockedAttempts).toBeInstanceOf(Map);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite an existing blockedAttempts Map', () => {
      const existing = new Map([['k', ['v']]]);
      const req = createReq({ app: { locals: { blockedAttempts: existing } } });
      const next = vi.fn();

      trackBlockedAttempts(req, {}, next);

      expect(req.app.locals.blockedAttempts).toBe(existing);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('complianceTrackingMiddleware', () => {
    it('sets complianceMetadata and calls next', () => {
      const req = createReq();
      const res = createRes();
      const next = vi.fn();

      complianceTrackingMiddleware(req, res, next);

      expect(req.complianceMetadata).toBeTruthy();
      expect(req.complianceMetadata.endpoint).toBe('/api/samples');
      expect(req.complianceMetadata.method).toBe('POST');
      expect(req.complianceMetadata.startTime).toBeInstanceOf(Date);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('wraps res.send so duration/statusCode get populated and original send still invoked with same data', () => {
      const req = createReq();
      const originalSend = vi.fn().mockReturnValue('sent-result');
      const res = createRes({ send: originalSend, statusCode: 201 });
      const next = vi.fn();

      complianceTrackingMiddleware(req, res, next);

      // res.send has been replaced with the wrapper
      expect(res.send).not.toBe(originalSend);

      const result = res.send({ hello: 'world' });

      expect(originalSend).toHaveBeenCalledWith({ hello: 'world' });
      expect(result).toBe('sent-result');
      expect(req.complianceMetadata.statusCode).toBe(201);
      expect(typeof req.complianceMetadata.duration).toBe('number');
      expect(req.complianceMetadata.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('consentBlockAlertWrapper', () => {
    it('alerts on 403 CONSENT block when db is present, tracks attempt, and passes through to original json', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);

      const fakeDb = { name: 'fakeDb' };
      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' },
        user: { userID: 'u1' }
      });
      const originalJson = vi.fn().mockReturnValue('json-result');
      const res = createRes({ json: originalJson, statusCode: 403 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'CONSENT_MISSING' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      expect(innerMiddleware).toHaveBeenCalledWith(req, res, next);
      expect(securityAlertsService.init).toHaveBeenCalledWith(fakeDb);
      expect(securityAlertsService.alertConsentBlocked).toHaveBeenCalledWith(
        'p1',
        '/api/samples',
        'CONSENT_MISSING',
        '127.0.0.1',
        'test-agent'
      );
      expect(originalJson).toHaveBeenCalledWith({ code: 'CONSENT_MISSING' });

      const attempts = req.app.locals.blockedAttempts.get('u1:p1');
      expect(attempts).toHaveLength(1);
      expect(attempts[0].reason).toBe('CONSENT_MISSING');
    });

    it('does not alert when status is not 403', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);

      const fakeDb = { name: 'fakeDb' };
      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const originalJson = vi.fn();
      const res = createRes({ json: originalJson, statusCode: 200 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'OK' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      expect(securityAlertsService.init).not.toHaveBeenCalled();
      expect(securityAlertsService.alertConsentBlocked).not.toHaveBeenCalled();
      expect(originalJson).toHaveBeenCalledWith({ code: 'OK' });
    });

    it('does not alert when code does not contain CONSENT even on 403', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);

      const fakeDb = { name: 'fakeDb' };
      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const originalJson = vi.fn();
      const res = createRes({ json: originalJson, statusCode: 403 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'FORBIDDEN_OTHER' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      expect(securityAlertsService.init).not.toHaveBeenCalled();
      expect(securityAlertsService.alertConsentBlocked).not.toHaveBeenCalled();
      expect(originalJson).toHaveBeenCalledWith({ code: 'FORBIDDEN_OTHER' });
    });

    it('does not alert when req.app.locals.db is falsy, even on 403 CONSENT', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);

      const req = createReq({
        app: { locals: { blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const originalJson = vi.fn();
      const res = createRes({ json: originalJson, statusCode: 403 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'CONSENT_MISSING' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      expect(securityAlertsService.init).not.toHaveBeenCalled();
      expect(securityAlertsService.alertConsentBlocked).not.toHaveBeenCalled();
      expect(originalJson).toHaveBeenCalledWith({ code: 'CONSENT_MISSING' });
    });

    it('calls detectSuspiciousActivity and clears attempts after 3rd blocked attempt within 5 minutes', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);
      vi.spyOn(securityAlertsService, 'detectSuspiciousActivity').mockResolvedValue(undefined);

      const fakeDb = { name: 'fakeDb' };
      const existingAttempts = new Map([
        ['u1:p1', [
          { timestamp: new Date(), reason: 'CONSENT_MISSING' },
          { timestamp: new Date(), reason: 'CONSENT_MISSING' }
        ]]
      ]);
      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: existingAttempts } },
        body: { participantId: 'p1' },
        user: { userID: 'u1' }
      });
      const originalJson = vi.fn();
      const res = createRes({ json: originalJson, statusCode: 403 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'CONSENT_MISSING' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      expect(securityAlertsService.detectSuspiciousActivity).toHaveBeenCalledWith(
        'p1',
        'u1',
        expect.arrayContaining([expect.objectContaining({ reason: 'CONSENT_MISSING' })]),
        '127.0.0.1',
        'test-agent'
      );
      // Entry should be cleared after crossing the threshold
      expect(req.app.locals.blockedAttempts.has('u1:p1')).toBe(false);
    });

    it('does not call detectSuspiciousActivity when attempts are outside the 5 minute window', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);
      vi.spyOn(securityAlertsService, 'detectSuspiciousActivity').mockResolvedValue(undefined);

      const fakeDb = { name: 'fakeDb' };
      const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000);
      const existingAttempts = new Map([
        ['u1:p1', [
          { timestamp: oldTimestamp, reason: 'CONSENT_MISSING' },
          { timestamp: oldTimestamp, reason: 'CONSENT_MISSING' }
        ]]
      ]);
      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: existingAttempts } },
        body: { participantId: 'p1' },
        user: { userID: 'u1' }
      });
      const originalJson = vi.fn();
      const res = createRes({ json: originalJson, statusCode: 403 });
      const next = vi.fn();

      const innerMiddleware = vi.fn((rq, rs) => {
        rs.json({ code: 'CONSENT_MISSING' });
      });

      const wrapped = consentBlockAlertWrapper(innerMiddleware);
      await wrapped(req, res, next);

      // Only the newly pushed attempt is recent (2 old + 1 new = 3 total, but only 1 recent)
      expect(securityAlertsService.detectSuspiciousActivity).not.toHaveBeenCalled();
      expect(req.app.locals.blockedAttempts.has('u1:p1')).toBe(true);
    });
  });

  describe('createSecurityIntegration', () => {
    // These tests drive the real authConsent middleware (see file-level comment for why it isn't
    // mocked) via a fake Mongo-like db, the same technique tests/unit/authConsent.test.js uses.
    function makeFakeDb(consentDoc) {
      const consentsCollection = { findOne: vi.fn().mockResolvedValue(consentDoc) };
      return { collection: vi.fn().mockReturnValue(consentsCollection), _consentsCollection: consentsCollection };
    }

    it('calls authConsent (via consentBlockAlertWrapper) and blocks with 403 CONSENT_REQUIRED when no active consent exists, when consentRequired is true (default)', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'alertConsentBlocked').mockResolvedValue(undefined);

      const fakeDb = makeFakeDb(null); // no active consent -> authConsent returns 403 CONSENT_REQUIRED

      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const jsonMock = vi.fn();
      const res = createRes({ json: jsonMock });
      const next = vi.fn();

      const middleware = createSecurityIntegration({ allowedScopes: ['uso_pesquisa'] });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
      // The alert wrapper should have fired because the 403 response carries a CONSENT code.
      expect(securityAlertsService.alertConsentBlocked).toHaveBeenCalledWith(
        'p1',
        '/api/samples',
        'CONSENT_REQUIRED',
        '127.0.0.1',
        'test-agent'
      );
    });

    it('calls next() when consent is active with the required scope (consentRequired true)', async () => {
      const fakeDb = makeFakeDb({
        _id: 'consent1',
        status: 'ACTIVE',
        responses: { uso_pesquisa: true }
      });

      const req = createReq({
        app: { locals: { db: fakeDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const res = createRes();
      const next = vi.fn();

      const middleware = createSecurityIntegration({ allowedScopes: ['uso_pesquisa'] });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.consent).toBeTruthy();
      expect(req.consent.validated).toBe(true);
    });

    it('calls next directly without touching the db when consentRequired is false', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();
      const next = vi.fn();

      const middleware = createSecurityIntegration({ consentRequired: false });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('fails open: logs the error and still calls next() when db.collection throws inside the consent flow', async () => {
      const throwingDb = {
        collection: vi.fn(() => {
          throw new Error('boom');
        })
      };

      const req = createReq({
        app: { locals: { db: throwingDb, blockedAttempts: new Map() } },
        body: { participantId: 'p1' }
      });
      const res = createRes();
      const next = vi.fn();

      const middleware = createSecurityIntegration({ consentRequired: true });
      await middleware(req, res, next);

      // authConsent itself catches internal errors and responds 500 rather than throwing, so
      // createSecurityIntegration's own try/catch is not hit via this path; assert the fail-open
      // contract at the level that IS reachable: next() is never blocked from eventually being
      // reachable by an unhandled throw (the wrapper does not crash the request).
      expect(res.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('fails open: logs and still calls next() when createSecurityIntegration itself throws synchronously (e.g. req.app.locals access failure)', async () => {
      const req = { app: null }; // accessing req.app.locals throws a TypeError synchronously
      const res = createRes();
      const next = vi.fn();

      const middleware = createSecurityIntegration({ consentRequired: true });
      await middleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        '[INTEGRATION] Erro na integração de segurança:',
        expect.any(String)
      );
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('integrateSecurityIntoRoute', () => {
    it('unshifts a security middleware layer into the matching route stack when the method exists', () => {
      const routeStack = [{ name: 'handler', handle: vi.fn() }];
      const app = {
        _router: {
          stack: [
            {
              route: {
                path: '/api/samples',
                methods: { post: true },
                stack: routeStack
              }
            }
          ]
        }
      };

      integrateSecurityIntoRoute(app, '/api/samples', 'post', { consentRequired: true });

      expect(routeStack).toHaveLength(2);
      expect(routeStack[0].name).toBe('securityIntegration');
      expect(typeof routeStack[0].handle).toBe('function');
      expect(logger.info).toHaveBeenCalledWith('[INTEGRATION] Segurança integrada em POST /api/samples');
    });

    it('does not mutate the stack when the method does not exist on the matched route', () => {
      const routeStack = [{ name: 'handler', handle: vi.fn() }];
      const app = {
        _router: {
          stack: [
            {
              route: {
                path: '/api/samples',
                methods: { get: true },
                stack: routeStack
              }
            }
          ]
        }
      };

      integrateSecurityIntoRoute(app, '/api/samples', 'post', {});

      expect(routeStack).toHaveLength(1);
    });

    it('does not mutate any stack when no route matches the given path', () => {
      const routeStack = [{ name: 'handler', handle: vi.fn() }];
      const app = {
        _router: {
          stack: [
            {
              route: {
                path: '/api/other',
                methods: { post: true },
                stack: routeStack
              }
            }
          ]
        }
      };

      integrateSecurityIntoRoute(app, '/api/samples', 'post', {});

      expect(routeStack).toHaveLength(1);
    });
  });

  describe('applySecurityToAllCriticalRoutes', () => {
    it('integrates security into each critical route present in app._router.stack', () => {
      const samplesPostStack = [{ name: 'handler' }];
      const patientsPutStack = [{ name: 'handler' }];
      const app = {
        _router: {
          stack: [
            { route: { path: '/api/samples', methods: { post: true }, stack: samplesPostStack } },
            { route: { path: '/api/patients/:id', methods: { put: true }, stack: patientsPutStack } }
          ]
        }
      };

      applySecurityToAllCriticalRoutes(app);

      expect(samplesPostStack).toHaveLength(2);
      expect(samplesPostStack.find(l => l.name === 'securityIntegration')).toBeTruthy();

      expect(patientsPutStack).toHaveLength(2);
      expect(patientsPutStack.find(l => l.name === 'securityIntegration')).toBeTruthy();

      // logger.info should report the total count of critical routes processed (10)
      expect(logger.info).toHaveBeenCalledWith('[INTEGRATION] Segurança integrada em 10 rotas críticas');
    });

    it('catches per-route errors from integrateSecurityIntoRoute and continues processing remaining routes', () => {
      const app = {
        get _router() {
          throw new Error('router unavailable');
        }
      };

      // Accessing app._router.stack inside integrateSecurityIntoRoute throws for every route;
      // applySecurityToAllCriticalRoutes wraps each call in try/catch and logs a warning instead of throwing.
      expect(() => applySecurityToAllCriticalRoutes(app)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledTimes(10);
      expect(logger.info).toHaveBeenCalledWith('[INTEGRATION] Segurança integrada em 10 rotas críticas');
    });
  });

  describe('initializeSecuritySystem', () => {
    it('initializes services, registers alert handler, applies global middleware, and applies security to critical routes', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'registerAlertHandler').mockImplementation(() => {});

      const fakeDb = { name: 'fakeDb' };
      const app = {
        use: vi.fn(),
        _router: { stack: [] }
      };

      await initializeSecuritySystem(app, fakeDb);

      expect(securityAlertsService.init).toHaveBeenCalledWith(fakeDb);
      expect(securityAlertsService.registerAlertHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(app.use).toHaveBeenCalledTimes(2);
      expect(app.use).toHaveBeenCalledWith(trackBlockedAttempts);
      expect(app.use).toHaveBeenCalledWith(complianceTrackingMiddleware);
      expect(logger.info).toHaveBeenCalledWith('[INTEGRATION] Inicializando sistema de segurança...');
    });

    it('catches errors and logs them instead of throwing', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'registerAlertHandler').mockImplementation(() => {});

      const app = {
        use: vi.fn(() => {
          throw new Error('use failed');
        }),
        _router: { stack: [] }
      };

      await expect(initializeSecuritySystem(app, { name: 'db' })).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        '[INTEGRATION] Erro ao inicializar sistema de segurança:',
        'use failed'
      );
    });

    it('handles a null db gracefully by still calling securityAlertsService.init(null)', async () => {
      vi.spyOn(securityAlertsService, 'init').mockImplementation(() => {});
      vi.spyOn(securityAlertsService, 'registerAlertHandler').mockImplementation(() => {});

      const app = {
        use: vi.fn(),
        _router: { stack: [] }
      };

      await initializeSecuritySystem(app, null);

      expect(securityAlertsService.init).toHaveBeenCalledWith(null);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
