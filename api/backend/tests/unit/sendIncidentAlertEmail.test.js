import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `resend` is required at the top of src/services/sendIncidentAlertEmail.js via
// `const { Resend } = require('resend')`, and a fresh `new Resend(...)` instance
// is constructed inside sendIncidentAlertEmail() on every call. `resend`'s
// `Resend` class assigns `this.emails = new Emails(this)` in its constructor,
// so `emails` is a per-instance property, not something on `Resend.prototype`.
// That means we cannot spy on `Resend.prototype.emails.send`. But `Emails.send`
// itself lives on the (shared) `Emails.prototype`, which every `new Resend()`
// instance's `.emails` inherits from. So we build one real Resend instance,
// walk its `.emails` object's prototype to reach `Emails.prototype`, and
// `vi.spyOn` that — this intercepts `.send()` for every Resend/Emails instance
// created afterwards, including the ones the source module constructs itself.
const { Resend } = require('resend');
const logger = require('../../src/utils/logger');

const emailsPrototype = Object.getPrototypeOf(new Resend('re_dummy_for_prototype_lookup').emails);

const { sendIncidentAlertEmail } = require('../../src/services/sendIncidentAlertEmail');

describe('sendIncidentAlertEmail', () => {
  let sendSpy;
  let loggerWarnSpy;
  let loggerErrorSpy;
  let originalApiKey;

  const incident = {
    sensorName: 'Freezer A1',
    currentTemperature: -12.5,
    maxTemperature: -18,
    minTemperature: -22,
    sensorKey: 'FRZ-A1',
    openedAt: '2026-07-01T10:00:00.000Z',
    samplesOutOfRange: 5
  };

  beforeEach(() => {
    originalApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_key';
    sendSpy = vi.spyOn(emailsPrototype, 'send');
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    vi.restoreAllMocks();
  });

  it('returns success:false without throwing and without sending when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendIncidentAlertEmail(incident, ['a@example.com']);

    expect(result).toEqual({ success: false, reason: 'RESEND_API_KEY not configured' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy.mock.calls[0][0]).toContain('RESEND_API_KEY');
  });

  it('returns success:false without throwing and without sending when recipients is empty', async () => {
    const result = await sendIncidentAlertEmail(incident, []);

    expect(result).toEqual({ success: false, reason: 'No recipients provided' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy.mock.calls[0][0]).toContain('destinatário');
  });

  it('returns success:false without throwing and without sending when recipients is undefined', async () => {
    const result = await sendIncidentAlertEmail(incident, undefined);

    expect(result).toEqual({ success: false, reason: 'No recipients provided' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('sends to every recipient and reports success when all sends succeed', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const result = await sendIncidentAlertEmail(incident, ['a@example.com', 'b@example.com'], 1);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const calledTos = sendSpy.mock.calls.map(call => call[0].to).sort();
    expect(calledTos).toEqual(['a@example.com', 'b@example.com']);

    const firstCallPayload = sendSpy.mock.calls[0][0];
    expect(firstCallPayload.subject).toContain('Freezer A1');
    expect(firstCallPayload.html).toContain('Freezer A1');
    expect(firstCallPayload.html).toContain('Supervisor');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('reports partial success when one recipient send succeeds and another rejects', async () => {
    sendSpy
      .mockResolvedValueOnce({ data: { id: 'email-ok' }, error: null })
      .mockRejectedValueOnce(new Error('Resend API failure'));

    const result = await sendIncidentAlertEmail(incident, ['good@example.com', 'bad@example.com']);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('fulfilled');
    expect(result.results[1].status).toBe('rejected');
    expect(result.results[1].reason.message).toBe('Resend API failure');
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy.mock.calls[0][0]).toContain('Freezer A1');
  });

  it('reports success:false with all failures when every send rejects', async () => {
    sendSpy.mockRejectedValue(new Error('down'));

    const result = await sendIncidentAlertEmail(incident, ['a@example.com', 'b@example.com']);

    expect(result.success).toBe(false);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('treats a blank/whitespace-only recipient email as a rejected send without calling resend for it', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'email-ok' }, error: null });

    const result = await sendIncidentAlertEmail(incident, ['valid@example.com', '   ']);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe('valid@example.com');
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[1].status).toBe('rejected');
    expect(result.results[1].reason.message).toBe('Invalid email');
  });

  it('maps escalationLevel to the correct label for each documented level, and falls back to Normal for out-of-range values', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'email-ok' }, error: null });

    await sendIncidentAlertEmail(incident, ['a@example.com'], 0);
    expect(sendSpy.mock.calls[0][0].html).toContain('Normal');

    await sendIncidentAlertEmail(incident, ['a@example.com'], 2);
    expect(sendSpy.mock.calls[1][0].html).toContain('Crítico');

    await sendIncidentAlertEmail(incident, ['a@example.com'], 99);
    expect(sendSpy.mock.calls[2][0].html).toContain('Nível de Escalação: Normal');
  });

  it('escapes HTML-significant characters from incident fields into the email body', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'email-ok' }, error: null });

    const maliciousIncident = {
      ...incident,
      sensorName: '<script>alert(1)</script>'
    };

    await sendIncidentAlertEmail(maliciousIncident, ['a@example.com']);

    const html = sendSpy.mock.calls[0][0].html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
