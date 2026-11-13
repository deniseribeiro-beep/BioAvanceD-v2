import { describe, it, expect, vi, beforeEach } from 'vitest';
const securityAlertsService = require('../../../src/services/securityAlerts.service');

// Note: securityAlertsService is a singleton (module.exports = new SecurityAlertsService()).
// It uses this.db set via init(db) and calls this.db.collection(...) directly, so a plain
// fake db object works without any vi.mock. sanitizeSensitiveData (from ../utils/security)
// is pure/safe and is allowed to run for real per this repo's testing conventions.

function makeFakeCollection({ insertedId = 'alert-id-1', updateResult = { acknowledged: true }, docs = [] } = {}) {
  const cursor = {
    sort: vi.fn(function sort() { return this; }),
    toArray: vi.fn(async () => docs)
  };
  return {
    insertOne: vi.fn(async () => ({ insertedId })),
    find: vi.fn(() => cursor),
    updateOne: vi.fn(async () => updateResult),
    __cursor: cursor
  };
}

function makeFakeDb(collection) {
  return {
    collection: vi.fn(() => collection)
  };
}

describe('securityAlerts.service', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    securityAlertsService.db = null;
    securityAlertsService.alertHandlers = [];
    securityAlertsService.mailHandlerRegistered = false;
    delete process.env.ALERT_EMAIL_TO;
    vi.restoreAllMocks();
  });

  describe('logSecurityAlert', () => {
    it('returns undefined and never calls db.collection when db is not initialized', async () => {
      const result = await securityAlertsService.logSecurityAlert({
        type: 'CONSENT_BLOCKED',
        severity: 'high'
      });

      expect(result).toBeUndefined();
    });

    it('inserts a well-formed alert with sanitized details and returns insertedId', async () => {
      const collection = makeFakeCollection({ insertedId: 'abc123' });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.logSecurityAlert({
        type: 'CONSENT_BLOCKED',
        severity: 'high',
        patientID: 'p1',
        userID: 'u1',
        action: 'ACCESS_DENIED',
        reason: 'no consent',
        details: { cpf: '12345678900', note: 'ok' },
        sourceIP: '1.2.3.4',
        userAgent: 'jest',
        affectedResources: [{ type: 'Patient', id: 'p1' }]
      });

      expect(result).toBe('abc123');
      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const insertedAlert = collection.insertOne.mock.calls[0][0];
      expect(insertedAlert.type).toBe('CONSENT_BLOCKED');
      expect(insertedAlert.severity).toBe('high');
      expect(insertedAlert.status).toBe('open');
      expect(insertedAlert.acknowledged).toBe(false);
      expect(insertedAlert.acknowledgedBy).toBeNull();
      // sanitizeSensitiveData redacts the 'cpf' field by default
      expect(insertedAlert.details.cpf).toBe('***REDATADO***');
      expect(insertedAlert.details.note).toBe('ok');
    });

    it('triggers all registered handlers with the built alert', async () => {
      const collection = makeFakeCollection();
      securityAlertsService.init(makeFakeDb(collection));

      const handler1 = vi.fn(async () => {});
      const handler2 = vi.fn(async () => {});
      securityAlertsService.registerAlertHandler(handler1);
      securityAlertsService.registerAlertHandler(handler2);

      await securityAlertsService.logSecurityAlert({
        type: 'CONSENT_BLOCKED',
        severity: 'high'
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler1.mock.calls[0][0].type).toBe('CONSENT_BLOCKED');
    });

    it('does not let a throwing handler stop other handlers from running', async () => {
      const collection = makeFakeCollection();
      securityAlertsService.init(makeFakeDb(collection));

      const badHandler = vi.fn(async () => { throw new Error('handler boom'); });
      const goodHandler = vi.fn(async () => {});
      securityAlertsService.registerAlertHandler(badHandler);
      securityAlertsService.registerAlertHandler(goodHandler);

      const result = await securityAlertsService.logSecurityAlert({
        type: 'CONSENT_BLOCKED',
        severity: 'high'
      });

      expect(badHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('catches errors thrown by insertOne and returns undefined', async () => {
      const collection = makeFakeCollection();
      collection.insertOne = vi.fn(async () => { throw new Error('db down'); });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.logSecurityAlert({
        type: 'CONSENT_BLOCKED',
        severity: 'high'
      });

      expect(result).toBeUndefined();
    });
  });

  describe('alertConsentBlocked', () => {
    it('calls logSecurityAlert with CONSENT_BLOCKED shape', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      await securityAlertsService.alertConsentBlocked('p1', 'READ', 'no consent', '1.1.1.1', 'ua');

      expect(spy).toHaveBeenCalledTimes(1);
      const params = spy.mock.calls[0][0];
      expect(params.type).toBe('CONSENT_BLOCKED');
      expect(params.severity).toBe('high');
      expect(params.action).toBe('ACCESS_DENIED');
      expect(params.reason).toBe('no consent');
      expect(params.patientID).toBe('p1');
      expect(params.details.operation).toBe('READ');
      expect(params.affectedResources).toEqual([{ type: 'Patient', id: 'p1' }]);
    });
  });

  describe('alertConsentRevoked', () => {
    it('calls logSecurityAlert with REVOKED_ACCESS shape', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      await securityAlertsService.alertConsentRevoked('p1', ['scopeA'], '1.1.1.1', 'ua');

      expect(spy).toHaveBeenCalledTimes(1);
      const params = spy.mock.calls[0][0];
      expect(params.type).toBe('REVOKED_ACCESS');
      expect(params.severity).toBe('high');
      expect(params.action).toBe('CONSENT_REVOKED');
      expect(params.details.revokedScopes).toEqual(['scopeA']);
      expect(params.affectedResources).toEqual([{ type: 'PatientConsent', id: 'p1' }]);
    });
  });

  describe('alertPIIExposure', () => {
    it('calls logSecurityAlert with PII_EXPOSURE shape and default critical severity', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      await securityAlertsService.alertPIIExposure('leaked cpf', ['logs']);

      expect(spy).toHaveBeenCalledTimes(1);
      const params = spy.mock.calls[0][0];
      expect(params.type).toBe('PII_EXPOSURE');
      expect(params.severity).toBe('critical');
      expect(params.action).toBe('PII_DETECTED');
      expect(params.reason).toBe('leaked cpf');
      expect(params.details.locations).toEqual(['logs']);
    });

    it('honors an explicit severity override', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      await securityAlertsService.alertPIIExposure('minor leak', ['logs'], 'low');

      expect(spy.mock.calls[0][0].severity).toBe('low');
    });
  });

  describe('alertBypassAttempt', () => {
    it('calls logSecurityAlert with SECURITY_BYPASS_ATTEMPT shape', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      await securityAlertsService.alertBypassAttempt('u1', 'CONSENT_MIDDLEWARE_SKIP', { note: 'x' }, '1.1.1.1', 'ua');

      expect(spy).toHaveBeenCalledTimes(1);
      const params = spy.mock.calls[0][0];
      expect(params.type).toBe('SECURITY_BYPASS_ATTEMPT');
      expect(params.severity).toBe('critical');
      expect(params.action).toBe('BYPASS_DETECTED');
      expect(params.userID).toBe('u1');
      expect(params.details).toEqual({ note: 'x' });
      expect(params.affectedResources).toEqual([{ type: 'SecurityControl', id: 'CONSENT_MIDDLEWARE_SKIP' }]);
    });
  });

  describe('detectSuspiciousActivity', () => {
    it('returns undefined and does not call logSecurityAlert when attempts.length < 3', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');

      const result = await securityAlertsService.detectSuspiciousActivity('p1', 'u1', [{ timestamp: 1 }, { timestamp: 2 }], '1.1.1.1', 'ua');

      expect(result).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls logSecurityAlert with SUSPICIOUS_ACTIVITY shape when attempts.length >= 3', async () => {
      const spy = vi.spyOn(securityAlertsService, 'logSecurityAlert').mockResolvedValue('id');
      const attempts = [{ timestamp: 1, reason: 'a' }, { timestamp: 2, reason: 'b' }, { timestamp: 3, reason: 'c' }];

      await securityAlertsService.detectSuspiciousActivity('p1', 'u1', attempts, '1.1.1.1', 'ua');

      expect(spy).toHaveBeenCalledTimes(1);
      const params = spy.mock.calls[0][0];
      expect(params.type).toBe('SUSPICIOUS_ACTIVITY');
      expect(params.severity).toBe('critical');
      expect(params.details.attemptCount).toBe(3);
      expect(params.affectedResources).toEqual([
        { type: 'Patient', id: 'p1' },
        { type: 'User', id: 'u1' }
      ]);
    });
  });

  describe('getOpenAlerts', () => {
    it('returns [] and does not call db.collection when db is not initialized', async () => {
      const result = await securityAlertsService.getOpenAlerts();
      expect(result).toEqual([]);
    });

    it('returns alerts array and merges extra filters with status:open', async () => {
      const docs = [{ _id: '1', severity: 'critical' }];
      const collection = makeFakeCollection({ docs });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.getOpenAlerts({ patientID: 'p1' });

      expect(result).toEqual(docs);
      expect(collection.find).toHaveBeenCalledWith({ status: 'open', patientID: 'p1' });
      expect(collection.__cursor.sort).toHaveBeenCalledWith({ severity: -1, timestamp: -1 });
    });

    it('returns [] when the query throws', async () => {
      const collection = makeFakeCollection();
      collection.find = vi.fn(() => { throw new Error('query failed'); });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.getOpenAlerts();

      expect(result).toEqual([]);
    });
  });

  describe('acknowledgeAlert', () => {
    it('returns undefined when db is not initialized', async () => {
      const result = await securityAlertsService.acknowledgeAlert('alert1', 'u1');
      expect(result).toBeUndefined();
    });

    it('calls updateOne with the right filter/$set shape and returns the result', async () => {
      const updateResult = { acknowledged: true, modifiedCount: 1 };
      const collection = makeFakeCollection({ updateResult });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.acknowledgeAlert('alert1', 'u1');

      expect(result).toBe(updateResult);
      expect(collection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = collection.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: 'alert1' });
      expect(update.$set.acknowledged).toBe(true);
      expect(update.$set.acknowledgedBy).toBe('u1');
      expect(update.$set.status).toBe('acknowledged');
      expect(update.$set.acknowledgedAt).toBeInstanceOf(Date);
    });

    it('returns undefined when updateOne throws', async () => {
      const collection = makeFakeCollection();
      collection.updateOne = vi.fn(async () => { throw new Error('boom'); });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.acknowledgeAlert('alert1', 'u1');

      expect(result).toBeUndefined();
    });
  });

  describe('resolveAlert', () => {
    it('returns undefined when db is not initialized', async () => {
      const result = await securityAlertsService.resolveAlert('alert1', 'fixed', 'u1');
      expect(result).toBeUndefined();
    });

    it('calls updateOne with the right filter/$set shape and returns the result', async () => {
      const updateResult = { acknowledged: true, modifiedCount: 1 };
      const collection = makeFakeCollection({ updateResult });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.resolveAlert('alert1', 'fixed', 'u1');

      expect(result).toBe(updateResult);
      const [filter, update] = collection.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: 'alert1' });
      expect(update.$set.status).toBe('resolved');
      expect(update.$set.resolution).toBe('fixed');
      expect(update.$set.resolvedBy).toBe('u1');
      expect(update.$set.resolvedAt).toBeInstanceOf(Date);
    });

    it('returns undefined when updateOne throws', async () => {
      const collection = makeFakeCollection();
      collection.updateOne = vi.fn(async () => { throw new Error('boom'); });
      securityAlertsService.init(makeFakeDb(collection));

      const result = await securityAlertsService.resolveAlert('alert1', 'fixed', 'u1');

      expect(result).toBeUndefined();
    });
  });

  describe('registerAlertHandler', () => {
    it('pushes a function handler onto alertHandlers', () => {
      const handler = vi.fn();
      securityAlertsService.registerAlertHandler(handler);
      expect(securityAlertsService.alertHandlers).toContain(handler);
    });

    it('silently ignores a non-function handler', () => {
      securityAlertsService.registerAlertHandler('not a function');
      securityAlertsService.registerAlertHandler(123);
      securityAlertsService.registerAlertHandler(null);
      expect(securityAlertsService.alertHandlers).toHaveLength(0);
    });
  });

  describe('init mail handler', () => {
    it('sends a high alert through NotificationService when ALERT_EMAIL_TO is set', async () => {
      process.env.ALERT_EMAIL_TO = 'e2e-admin@bioavanced.test';
      const notificationService = require('../../../src/services/NotificationService');
      const sendEmail = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      const collection = makeFakeCollection();
      securityAlertsService.init(makeFakeDb(collection));

      await securityAlertsService.logSecurityAlert({
        type: 'SUSPICIOUS_ACTIVITY',
        severity: 'high',
        reason: 'tentativa repetida',
      });

      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'e2e-admin@bioavanced.test',
        notificationType: 'SECURITY_ALERT',
      }));
    });
  });

  describe('createEmailHandler', () => {
    it('does not call nodemailer.sendEmail for low/medium severity', async () => {
      const nodemailer = { sendEmail: vi.fn(async () => {}) };
      const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'a@b.com' });

      await handler({ severity: 'low', type: 'X', reason: 'r', timestamp: new Date(), details: {} });
      await handler({ severity: 'medium', type: 'X', reason: 'r', timestamp: new Date(), details: {} });

      expect(nodemailer.sendEmail).not.toHaveBeenCalled();
    });

    it('calls nodemailer.sendEmail with to/subject/html for high/critical severity', async () => {
      const nodemailer = { sendEmail: vi.fn(async () => {}) };
      const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'a@b.com' });

      const alert = { severity: 'critical', type: 'PII_EXPOSURE', reason: 'leak', timestamp: new Date(), details: { x: 1 } };
      await handler(alert);

      expect(nodemailer.sendEmail).toHaveBeenCalledTimes(1);
      const sentArgs = nodemailer.sendEmail.mock.calls[0][0];
      expect(sentArgs.to).toBe('a@b.com');
      expect(sentArgs.subject).toContain('PII_EXPOSURE');
      expect(sentArgs.html).toContain('leak');
    });
  });

  describe('createSlackHandler', () => {
    it('resolves without throwing and without acting for low severity', async () => {
      const webhook = 'https://hooks.slack.example/xyz';
      const handler = securityAlertsService.constructor.createSlackHandler(webhook);

      await expect(handler({ severity: 'low', type: 'X' })).resolves.toBeUndefined();
    });

    it('resolves without throwing for high/critical severity', async () => {
      const webhook = 'https://hooks.slack.example/xyz';
      const handler = securityAlertsService.constructor.createSlackHandler(webhook);

      await expect(handler({ severity: 'critical', type: 'SECURITY_BYPASS_ATTEMPT' })).resolves.toBeUndefined();
    });
  });
});
