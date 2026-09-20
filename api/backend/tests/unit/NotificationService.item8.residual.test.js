import { afterEach, describe, expect, it, vi } from 'vitest';

const notificationModule = require('../../src/services/NotificationService');
const { NotificationService, isLoopbackHostname } = notificationModule;

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('NotificationService item 8 residual branches', () => {
  it('recognizes loopback host variants and rejects remote hostnames', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('LOCALHOST')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('example.com')).toBe(false);
    expect(isLoopbackHostname(null)).toBe(false);
  });

  it('requires FRONTEND_URL and validates absolute/HTTPS transport rules', () => {
    delete process.env.FRONTEND_URL;
    const service = new NotificationService();

    expect(() => service.getFrontendUrl()).toThrow('FRONTEND_URL é obrigatório');

    process.env.FRONTEND_URL = 'not a url';
    expect(() => service.validateFrontendUrl()).toThrow('Invalid URL');
    try {
      service.validateFrontendUrl();
    } catch (error) {
      expect(error.code).toBe('ERR_INVALID_URL');
    }

    process.env.NODE_ENV = 'test';
    const nonDev = new NotificationService();
    process.env.FRONTEND_URL = 'http://localhost:5173';
    expect(() => nonDev.validateFrontendUrl()).toThrow(/deve usar HTTPS/);

    process.env.NODE_ENV = 'development';
    const dev = new NotificationService();
    expect(dev.validateFrontendUrl().hostname).toBe('localhost');

    process.env.FRONTEND_URL = 'https://example.com';
    expect(dev.validateFrontendUrl({ remote: true }).hostname).toBe('example.com');

    process.env.FRONTEND_URL = 'http://localhost:5173';
    expect(() => dev.validateFrontendUrl({ remote: true })).toThrow(/HTTPS externamente acessível/);

    process.env.FRONTEND_URL = 'https://localhost';
    expect(() => dev.validateFrontendUrl({ remote: true })).toThrow(/HTTPS externamente acessível/);
  });

  it('normalizes E.164 phones across empty, plus-prefixed, 00 and default-country inputs', () => {
    process.env.CONSENT_DEFAULT_COUNTRY_CODE = '55';
    const service = new NotificationService();

    expect(service.normalizePhoneE164(null)).toBeNull();
    expect(service.normalizePhoneE164('   ')).toBeNull();
    expect(service.normalizePhoneE164('+5511999999999')).toBe('+5511999999999');
    expect(service.normalizePhoneE164('abc')).toBeNull();
    expect(service.normalizePhoneE164('005511999999999')).toBe('+5511999999999');
    expect(service.normalizePhoneE164('55 11 99999-9999')).toBe('+5511999999999');
    expect(service.normalizePhoneE164('11 99999-9999')).toBe('+5511999999999');
  });

  it('uses DEFAULT_COUNTRY_CODE and final 55 fallback when consent-specific code is absent', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    process.env.DEFAULT_COUNTRY_CODE = '1';
    const us = new NotificationService();
    expect(us.normalizePhoneE164('2025550100')).toBe('+12025550100');

    delete process.env.DEFAULT_COUNTRY_CODE;
    const br = new NotificationService();
    expect(br.normalizePhoneE164('11999999999')).toBe('+5511999999999');
  });

  it('resolves email/phone aliases and formats patient fallback name', () => {
    const service = new NotificationService();

    expect(service.resolvePatientEmail({ email: 'a@test' })).toBe('a@test');
    expect(service.resolvePatientEmail({ emailAddress: 'b@test' })).toBe('b@test');
    expect(service.resolvePatientEmail({ contactEmail: 'c@test' })).toBe('c@test');
    expect(service.resolvePatientEmail({})).toBeNull();

    expect(service.resolvePatientPhone({ mobile: '+12025550100' })).toBe('+12025550100');
    expect(service.resolvePatientPhone({ whatsapp: '11999999999' })).toMatch(/^\+55/);
    expect(service.resolvePatientPhone({})).toBeNull();

    expect(service.formatConsentMessage('', 'https://x')).toContain('Olá Paciente');
    expect(service.formatConsentMessage('Ana', 'https://x')).toContain('Olá Ana');
  });

  it('resolves recipients safely in production and redirects in development', () => {
    process.env.NODE_ENV = 'test';
    let service = new NotificationService();
    expect(() => service.resolveRecipient('')).toThrow('Destinatário é obrigatório');
    expect(service.resolveRecipient(' user@test.com ')).toEqual({
      to: 'user@test.com',
      redirected: false,
      originalTo: 'user@test.com',
    });

    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_EMAIL;
    service = new NotificationService();
    expect(() => service.resolveRecipient('user@test.com')).toThrow(/ADMIN_EMAIL/);

    process.env.ADMIN_EMAIL = 'admin@test.com';
    service = new NotificationService();
    expect(service.resolveRecipient('user@test.com')).toEqual({
      to: 'admin@test.com',
      redirected: true,
      originalTo: 'user@test.com',
    });
    expect(service.resolveRecipient('admin@test.com').redirected).toBe(false);
  });

  it('builds consent metadata and link, rejecting missing participant id', () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'https://frontend.example.test/';
    const service = new NotificationService();

    vi.spyOn(service, 'generateConsentToken').mockReturnValue('token value');
    const metadata = service.buildConsentMetadata();
    expect(metadata).toMatchObject({ token: 'token value' });
    expect(metadata.createdAt).toBeInstanceOf(Date);
    expect(metadata.expiresAt.getTime()).toBeGreaterThan(metadata.createdAt.getTime());

    expect(() => service.buildConsentLink({}, 'abc')).toThrow(/participantId/);
    expect(service.buildConsentLink({ participantId: 'P 1' }, 'token value'))
      .toBe('https://frontend.example.test/patients/P%201/consent?token=token%20value');
  });

  it('covers consent email recipient guard and successful delegated delivery', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'https://frontend.example.test';
    const service = new NotificationService();

    await expect(service.sendConsentEmail({ participantId: 'P1' }, 'https://link'))
      .rejects.toMatchObject({ code: 'CONSENT_RECIPIENT_REQUIRED' });

    const send = vi.spyOn(service, 'sendEmail').mockResolvedValue({ channel: 'email', provider: 'smtp' });
    await expect(service.sendConsentEmail({
      participantId: 'P1',
      patientName: 'Ana',
      email: 'ana@example.test',
    }, 'https://link')).resolves.toMatchObject({
      success: true,
      channel: 'email',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ana@example.test',
      notificationType: 'RF_CONSENT_NOTIFICATION',
      metadata: { participantId: 'P1' },
    }));
  });

  it('covers SMS fallback missing phone/email and successful email-backed simulation', async () => {
    const service = new NotificationService();

    await expect(service.sendConsentSmsFallback({}, 'https://link'))
      .resolves.toMatchObject({ success: false, reason: 'missing_phone' });

    delete process.env.ALERT_EMAIL_TO;
    service.adminEmail = '';
    await expect(service.sendConsentSmsFallback({ phone: '11999999999' }, 'https://link'))
      .resolves.toMatchObject({ success: false, reason: 'missing_sms_fallback_email' });

    service.adminEmail = 'admin@example.test';
    const send = vi.spyOn(service, 'sendEmail').mockResolvedValue({ success: true });
    await expect(service.sendConsentSmsFallback({
      patientID: 'legacy-id',
      patientName: 'Ana',
      phone: '11999999999',
    }, 'https://link')).resolves.toMatchObject({
      channel: 'sms',
      success: true,
      mocked: true,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@example.test',
      notificationType: 'RF_CONSENT_SMS_FALLBACK',
    }));
  });

  it('covers WhatsApp fallback missing phone and successful simulation', async () => {
    const service = new NotificationService();
    await expect(service.sendConsentWhatsappFallback({}, 'https://link'))
      .resolves.toMatchObject({ success: false, reason: 'missing_phone' });
    await expect(service.sendConsentWhatsappFallback({ phone: '11999999999' }, 'https://link'))
      .resolves.toMatchObject({ channel: 'whatsapp', success: true, mocked: true });
  });

  it('maps Promise.allSettled consent notification successes and failures', async () => {
    const service = new NotificationService();
    vi.spyOn(service, 'sendConsentEmail').mockRejectedValue(new Error('email failed'));
    vi.spyOn(service, 'sendConsentWhatsappFallback').mockResolvedValue({
      channel: 'whatsapp',
      success: true,
    });

    const result = await service.notifyPatientConsent({}, 'https://link');
    expect(result).toEqual([
      { channel: 'unknown', success: false, reason: 'email failed' },
      { channel: 'whatsapp', success: true },
    ]);
  });

  it('falls back to a generic failure reason when a rejection has no message', async () => {
    const service = new NotificationService();
    vi.spyOn(service, 'sendConsentEmail').mockRejectedValue({});
    vi.spyOn(service, 'sendConsentWhatsappFallback').mockResolvedValue({ channel: 'whatsapp', success: true });

    const result = await service.notifyPatientConsent({}, 'https://link');
    expect(result[0]).toEqual({ channel: 'unknown', success: false, reason: 'failed' });
  });

  it('uses direct delivery when queue is absent and queues when one is available', async () => {
    const service = new NotificationService();
    vi.spyOn(service, 'getNotificationQueue').mockReturnValueOnce(null);
    vi.spyOn(service, 'notifyPatientConsent').mockResolvedValueOnce([{ channel: 'email', success: true }]);

    await expect(service.enqueueConsentNotification({ participantId: 'P1' }, 'https://link'))
      .resolves.toEqual([{ channel: 'email', success: true }]);

    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    service.getNotificationQueue.mockReturnValueOnce(queue);
    await expect(service.enqueueConsentNotification({ participantId: 'P1' }, 'https://link'))
      .resolves.toEqual([{ channel: 'queue', success: true, provider: 'bullmq' }]);
    expect(queue.add).toHaveBeenCalledWith('consent-notification', {
      patientData: { participantId: 'P1' },
      consentLink: 'https://link',
    });
  });

  it('computes queue stats from missing and populated counts', async () => {
    const service = new NotificationService();

    vi.spyOn(service, 'getNotificationQueue').mockReturnValueOnce(null);
    await expect(service.getConsentQueueStats()).resolves.toEqual({
      available: false,
      counts: { waiting: 0, delayed: 0, active: 0, failed: 0 },
      totalQueued: 0,
    });

    service.getNotificationQueue.mockReturnValueOnce({
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, delayed: 3, active: 1 }),
    });
    await expect(service.getConsentQueueStats()).resolves.toEqual({
      available: true,
      counts: { waiting: 2, delayed: 3, active: 1, failed: 0 },
      totalQueued: 5,
      active: 1,
    });
  });

  it('delegates queued job processing and covers notification methods with no socket', async () => {
    const service = new NotificationService();
    vi.spyOn(service, 'notifyPatientConsent').mockResolvedValue([{ success: true }]);
    await expect(service.processConsentNotificationJob({
      patientData: { participantId: 'P1' },
      consentLink: 'https://link',
    })).resolves.toEqual([{ success: true }]);

    await expect(service.notifyJobQueued('u1', {})).resolves.toBeUndefined();
    await expect(service.notifyJobStarted('u1', { jobID: 'j1' })).resolves.toBeUndefined();
    await expect(service.notifyJobProgress('u1', { jobID: 'j1' })).resolves.toBeUndefined();
  });

  it('emits user and job-room events when socket transport is configured', async () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const service = new NotificationService();
    service.io = { to };

    await service.notifyJobQueued('u1', { x: 1 });
    await service.notifyJobStarted('u1', { jobID: 'j1' });
    await service.notifyJobStarted('u1', {});
    await service.notifyJobProgress('u1', { jobID: 'j2' });
    await service.notifyJobProgress('u1', {});

    expect(to).toHaveBeenCalledWith('user-u1');
    expect(to).toHaveBeenCalledWith('j1');
    expect(to).toHaveBeenCalledWith('j2');
  });

  it('covers completed/failed job notifications with socket rooms and optional email', async () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const service = new NotificationService();
    service.io = { to };
    const send = vi.spyOn(service, 'sendEmail').mockResolvedValue({ success: true });

    await service.notifyJobCompleted('u1', {
      jobID: 'j1',
      status: 'completed',
      dataType: 'samples',
      successCount: 4,
      errorCount: 1,
      userEmail: 'user@example.test',
    });
    await service.notifyJobCompleted('u1', {
      jobID: '',
      status: 'completed',
      dataType: 'patients',
      successCount: 1,
      errorCount: 0,
    });

    await service.notifyJobFailed('u1', {
      jobID: 'j2',
      status: 'failed',
      dataType: 'samples',
      error: 'boom',
      userEmail: 'user@example.test',
    });
    await service.notifyJobFailed('u1', {
      jobID: '',
      status: 'failed',
      dataType: 'patients',
      error: null,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(service.generateJobEmailTemplate({
      dataType: 'samples', successCount: 1, errorCount: 2, jobID: 'j'
    })).toContain('Importação Concluída');
    expect(service.generateJobErrorEmailTemplate({
      dataType: 'samples', jobID: 'j'
    })).toContain('Erro desconhecido');
  });

  it('swallows job notification send failures after logging', async () => {
    const service = new NotificationService();
    vi.spyOn(service, 'sendEmail').mockRejectedValue(new Error('mail down'));

    await expect(service.notifyJobCompleted('u1', {
      jobID: 'j1',
      dataType: 'samples',
      userEmail: 'u@test',
    })).resolves.toBeUndefined();

    await expect(service.notifyJobFailed('u1', {
      jobID: 'j1',
      dataType: 'samples',
      userEmail: 'u@test',
    })).resolves.toBeUndefined();
  });

  it('validates auth/reset convenience methods and delegates their email payloads', async () => {
    const service = new NotificationService();
    const send = vi.spyOn(service, 'sendEmail').mockResolvedValue({ success: true });

    await expect(service.sendAuthCode('', '123456')).rejects.toThrow(/email e code/);
    await expect(service.sendAuthCode('a@test', '')).rejects.toThrow(/email e code/);
    await service.sendAuthCode('a@test', '123456');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: 'RF001_MFA_AUTH_CODE',
      metadata: { codeLength: 6 },
    }));

    await expect(service.sendPasswordReset('', 'https://x')).rejects.toThrow(/email e link/);
    await expect(service.sendPasswordReset('a@test', '')).rejects.toThrow(/email e link/);
    await service.sendPasswordReset('a@test', 'https://x/reset');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: 'RF003_PASSWORD_RESET',
      metadata: { linkDomain: 'x' },
    }));
  });

  it('covers temperature alert target selection and critical-range branches', async () => {
    const service = new NotificationService();

    delete process.env.ALERT_EMAIL_TO;
    service.adminEmail = '';
    await expect(service.sendTemperatureAlert('S1', -70)).rejects.toThrow(/ALERT_EMAIL_TO/);

    const send = vi.spyOn(service, 'sendEmail').mockResolvedValue({ success: true });
    await service.sendTemperatureAlert('S1', -70, { email: 'ops@example.test' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.test',
      notificationType: 'RF016_TEMPERATURE_ALERT',
    }));

    await expect(service.sendCriticalTempAlert('S1', -100, { minTemp: -196, maxTemp: -80 }))
      .resolves.toMatchObject({ triggered: false });

    vi.spyOn(service, 'sendTemperatureAlert').mockResolvedValue({ success: true, channel: 'email' });
    await expect(service.sendCriticalTempAlert('S1', -70, { minTemp: -196, maxTemp: -80 }))
      .resolves.toMatchObject({
        triggered: true,
        sampleId: 'S1',
        temp: -70,
        minTemp: -196,
        maxTemp: -80,
        sms: { success: true, mocked: true },
      });
  });

  it('covers legacy SMS fallback and recovery-link construction', async () => {
    const service = new NotificationService();
    service.adminEmail = '';
    delete process.env.ALERT_EMAIL_TO;
    await expect(service.sendOTPSMS('11999999999', '123456')).rejects.toThrow(/ADMIN_EMAIL/);

    service.adminEmail = 'admin@example.test';
    vi.spyOn(service, 'sendAuthCode').mockResolvedValue({ success: true });
    await expect(service.sendOTPSMS('11999999999', '123456')).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      mocked: true,
    });

    process.env.APP_DOMAIN = 'https://app.example.test/';
    const reset = vi.spyOn(service, 'sendPasswordReset').mockResolvedValue({ success: true });
    await service.sendRecoveryEmail('a@test', 'token value');
    expect(reset).toHaveBeenCalledWith(
      'a@test',
      'https://app.example.test/recover-password?token=token%20value'
    );
  });

  it('covers cached provider clients and missing Resend configuration', () => {
    const service = new NotificationService();

    service.resendClient = { cached: true };
    expect(service.getResendClient()).toBe(service.resendClient);

    service.resendClient = null;
    delete process.env.RESEND_API_KEY;
    expect(() => service.getResendClient()).toThrow(/RESEND_API_KEY/);

    service.smtpTransport = { cached: true };
    expect(service.getSmtpTransport()).toBe(service.smtpTransport);
  });

  it('keeps compliance persistence fail-open when its database dependency is unavailable', async () => {
    const service = new NotificationService({
      connectDatabase: vi.fn().mockRejectedValue(new Error('mongo unavailable')),
    });

    await expect(service.persistComplianceLog({
      notificationType: 'synthetic',
      deliveryStatus: 'DELIVERY_FAILED',
    })).resolves.toBeUndefined();
  });

  it('suppresses development previews outside development and renders placeholder bodies inside it', () => {
    process.env.NODE_ENV = 'test';
    let service = new NotificationService();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    service.logDevelopmentPreview({
      subject: 'Synthetic',
      text: '',
      html: '',
      originalTo: 'a@test',
      effectiveTo: 'a@test',
      notificationType: 'TEST',
    });
    expect(output).not.toHaveBeenCalled();

    process.env.NODE_ENV = 'development';
    service = new NotificationService();
    service.logDevelopmentPreview({
      subject: 'Synthetic',
      text: '',
      html: '',
      originalTo: 'a@test',
      effectiveTo: 'admin@test',
      notificationType: 'TEST',
    });

    expect(output).toHaveBeenCalledWith('[sem versão texto]');
    expect(output).toHaveBeenCalledWith('[sem versão html]');
  });

  it('reuses an initialized Socket.IO instance and wires a supplied io-compatible transport', () => {
    const service = new NotificationService();
    const existing = { existing: true };
    service.io = existing;
    expect(service.initSocketIO({})).toBe(existing);

    service.io = null;
    let connectionHandler;
    const io = {
      of: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event, handler) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    };

    expect(service.initSocketIO(io)).toBe(io);
    expect(typeof connectionHandler).toBe('function');

    const socketHandlers = {};
    const socket = {
      id: 'socket-1',
      join: vi.fn(),
      on: vi.fn((event, handler) => {
        socketHandlers[event] = handler;
      }),
    };
    connectionHandler(socket);

    socketHandlers['subscribe:user']('');
    socketHandlers['subscribe:user']('u1');
    socketHandlers['subscribe:job']('');
    socketHandlers['subscribe:job']('j1');
    socketHandlers.disconnect();

    expect(socket.join).toHaveBeenCalledWith('user-u1');
    expect(socket.join).toHaveBeenCalledWith('j1');
  });

  it('uses environment temperature thresholds when explicit options are absent', async () => {
    process.env.TELEMETRY_MIN_TEMP_ALERT = '-190';
    process.env.TELEMETRY_MAX_TEMP_ALERT = '-70';
    const service = new NotificationService();

    await expect(service.sendCriticalTempAlert('S1', -100))
      .resolves.toMatchObject({ triggered: false });

    vi.spyOn(service, 'sendTemperatureAlert').mockResolvedValue({ success: true });
    await expect(service.sendCriticalTempAlert('S1', -60))
      .resolves.toMatchObject({
        triggered: true,
        minTemp: -190,
        maxTemp: -70,
      });
  });

});


describe('NotificationService item 8 transport alternate outcomes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('records pre-transport validation failures for missing payload, sender and recipient', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_FROM = 'bio@example.test';
    let service = new NotificationService();
    let persist = vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);

    await expect(service.sendEmail({ to: 'user@example.test', subject: '', html: '', text: '' }))
      .rejects.toThrow(/subject e html\/text/);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      deliveryStatus: 'DELIVERY_FAILED',
      errorCode: 'VALIDATION_FAILED',
    }));

    delete process.env.EMAIL_FROM;
    service = new NotificationService();
    persist = vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);
    await expect(service.sendEmail({ to: 'user@example.test', subject: 'S', text: 'body' }))
      .rejects.toThrow(/EMAIL_FROM/);
    expect(persist).toHaveBeenCalled();

    process.env.EMAIL_FROM = 'bio@example.test';
    service = new NotificationService();
    persist = vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);
    await expect(service.sendEmail({ to: '   ', subject: 'S', text: 'body' }))
      .rejects.toThrow(/Destinatário/);
    expect(persist).toHaveBeenCalled();
  });

  it('sends through SMTP and preserves a null provider message id when the transport omits it', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_FROM = 'bio@example.test';
    process.env.SMTP_HOST = 'mailpit';
    const service = new NotificationService();
    vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);
    const sendMail = vi.fn().mockResolvedValue({});
    vi.spyOn(service, 'getSmtpTransport').mockReturnValue({ sendMail });

    const result = await service.sendEmail({
      to: 'user@example.test',
      subject: 'Synthetic',
      text: 'body',
    });

    expect(result).toMatchObject({
      success: true,
      provider: 'smtp',
      messageId: null,
      notificationType: 'generic',
      redirectedByEnvironment: false,
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'bio@example.test',
      to: 'user@example.test',
    }));
    expect(service.persistComplianceLog).toHaveBeenCalledTimes(2);
  });

  it('sends through Resend with and without a provider id and surfaces provider response errors', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_FROM = 'bio@example.test';
    delete process.env.SMTP_HOST;
    const service = new NotificationService();
    vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);
    const send = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'resend-1' } })
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ error: {} });
    vi.spyOn(service, 'getResendClient').mockReturnValue({ emails: { send } });

    await expect(service.sendEmail({
      to: 'user@example.test', subject: 'S1', html: '<p>body</p>', notificationType: 'TEST',
    })).resolves.toMatchObject({ provider: 'resend', messageId: 'resend-1' });

    await expect(service.sendEmail({
      to: 'user@example.test', subject: 'S2', text: 'body',
    })).resolves.toMatchObject({ provider: 'resend', messageId: null });

    await expect(service.sendEmail({
      to: 'user@example.test', subject: 'S3', text: 'body',
    })).rejects.toThrow('Falha ao enviar e-mail via Resend');

    expect(service.persistComplianceLog).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'resend',
      deliveryStatus: 'DELIVERY_FAILED',
      errorCode: 'CONSENT_DELIVERY_FAILED',
    }));
  });

  it('records a transport-specific failure code without masking the original SMTP error', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_FROM = 'bio@example.test';
    process.env.SMTP_HOST = 'mailpit';
    const service = new NotificationService();
    vi.spyOn(service, 'persistComplianceLog').mockResolvedValue(undefined);
    const transportError = new Error('smtp refused');
    transportError.code = 'ECONNREFUSED';
    vi.spyOn(service, 'getSmtpTransport').mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(transportError),
    });

    await expect(service.sendEmail({
      to: 'user@example.test', subject: 'S', text: 'body', metadata: { purpose: 'test' },
    })).rejects.toBe(transportError);

    expect(service.persistComplianceLog).toHaveBeenCalledWith(expect.objectContaining({
      deliveryStatus: 'DELIVERY_FAILED',
      errorCode: 'ECONNREFUSED',
      metadata: { purpose: 'test' },
    }));
  });

  it('wraps a missing frontend URL into the canonical consent transport error', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FRONTEND_URL;
    const service = new NotificationService();

    expect(() => service.validateFrontendUrl()).toThrow(/FRONTEND_URL/);
    try {
      service.validateFrontendUrl();
    } catch (error) {
      expect(error.code).toBe('CONSENT_FRONTEND_URL_INVALID');
    }
  });
});
