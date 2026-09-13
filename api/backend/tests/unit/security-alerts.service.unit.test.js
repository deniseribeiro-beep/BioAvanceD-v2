import { describe, it, expect, vi } from 'vitest';
const securityAlertsService = require('../../src/services/securityAlerts.service');
const { SecurityAlertsService } = (() => {
  // Require original class via module exports
  const mod = require('../../src/services/securityAlerts.service');
  return { SecurityAlertsService: mod.constructor };
})();

describe('SecurityAlertsService.registerAlertHandler', () => {
  it('does not throw when registering a function handler', () => {
    const handler = vi.fn();
    expect(() => securityAlertsService.registerAlertHandler(handler)).not.toThrow();
  });

  it('does not register non-function handlers', () => {
    const before = securityAlertsService.alertHandlers?.length ?? 0;
    securityAlertsService.registerAlertHandler('not-a-function');
    const after = securityAlertsService.alertHandlers?.length ?? 0;
    expect(after).toBe(before);
  });
});

describe('SecurityAlertsService.createEmailHandler', () => {
  it('returns a function', () => {
    const handler = securityAlertsService.constructor.createEmailHandler({}, {});
    expect(typeof handler).toBe('function');
  });

  it('calls sendEmail for high severity alert', async () => {
    const nodemailer = { sendEmail: vi.fn().mockResolvedValue(true) };
    const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'admin@test.com' });
    await handler({ severity: 'high', type: 'LOGIN_FAILURE', reason: 'Too many attempts', timestamp: new Date(), details: {} });
    expect(nodemailer.sendEmail).toHaveBeenCalledOnce();
  });

  it('calls sendEmail for critical severity alert', async () => {
    const nodemailer = { sendEmail: vi.fn().mockResolvedValue(true) };
    const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'admin@test.com' });
    await handler({ severity: 'critical', type: 'PII_EXPOSURE', reason: 'Exposure detected', timestamp: new Date(), details: {} });
    expect(nodemailer.sendEmail).toHaveBeenCalledOnce();
  });

  it('does not call sendEmail for low severity alert', async () => {
    const nodemailer = { sendEmail: vi.fn().mockResolvedValue(true) };
    const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'admin@test.com' });
    await handler({ severity: 'low', type: 'INFO', reason: 'Test', timestamp: new Date(), details: {} });
    expect(nodemailer.sendEmail).not.toHaveBeenCalled();
  });

  it('handles sendEmail error gracefully', async () => {
    const nodemailer = { sendEmail: vi.fn().mockRejectedValue(new Error('SMTP error')) };
    const handler = securityAlertsService.constructor.createEmailHandler(nodemailer, { to: 'admin@test.com' });
    await expect(handler({ severity: 'critical', type: 'TEST', reason: 'test', timestamp: new Date(), details: {} })).resolves.not.toThrow();
  });
});

describe('SecurityAlertsService.createSlackHandler', () => {
  it('returns a function', () => {
    const handler = securityAlertsService.constructor.createSlackHandler('https://hooks.slack.com/test');
    expect(typeof handler).toBe('function');
  });

  it('does not throw for high severity alert', async () => {
    const handler = securityAlertsService.constructor.createSlackHandler('https://hooks.slack.com/test');
    await expect(handler({ severity: 'high', type: 'TEST', reason: 'test', timestamp: new Date(), details: {} })).resolves.not.toThrow();
  });

  it('does not throw for low severity alert (skips notification)', async () => {
    const handler = securityAlertsService.constructor.createSlackHandler('https://hooks.slack.com/test');
    await expect(handler({ severity: 'info', type: 'TEST' })).resolves.not.toThrow();
  });
});
