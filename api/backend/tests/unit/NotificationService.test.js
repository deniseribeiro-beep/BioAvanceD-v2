import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const notificationService = require('../../src/services/NotificationService');
const { isLoopbackHostname } = require('../../src/services/NotificationService');
const logger = require('../../src/utils/logger');

describe('NotificationService', () => {
  let originalEnv;
  let originalIsDevelopment;
  let originalAdminEmail;
  let originalResendClient;
  let originalEmailFrom;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalIsDevelopment = notificationService.isDevelopment;
    originalAdminEmail = notificationService.adminEmail;
    originalResendClient = notificationService.resendClient;
    originalEmailFrom = notificationService.emailFrom;
  });

  afterEach(() => {
    process.env = originalEnv;
    notificationService.isDevelopment = originalIsDevelopment;
    notificationService.adminEmail = originalAdminEmail;
    notificationService.resendClient = originalResendClient;
    notificationService.emailFrom = originalEmailFrom;
    notificationService.io = null;
    vi.restoreAllMocks();
  });

  describe('getFrontendUrl', () => {
    // No default fallback (intentionally removed in 5e571099, see issue #180)
    // — an unset FRONTEND_URL must throw, not silently resolve to a default.
    it('throws when FRONTEND_URL is not set', () => {
      delete process.env.FRONTEND_URL;
      expect(() => notificationService.getFrontendUrl()).toThrow(
        'FRONTEND_URL é obrigatório para gerar links de consentimento'
      );
    });

    it('returns the configured FRONTEND_URL when set', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      expect(notificationService.getFrontendUrl()).toBe('https://app.example.com');
    });
  });

  describe('normalizePhoneE164 (via resolvePatientPhone)', () => {
    it('returns null when no phone-like field is present', () => {
      expect(notificationService.resolvePatientPhone({})).toBeNull();
    });

    it('preserves an already-E164 formatted phone number', () => {
      expect(notificationService.resolvePatientPhone({ phone: '+15551234567' })).toBe('+15551234567');
    });

    it('strips a leading 00 international prefix', () => {
      delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
      delete process.env.DEFAULT_COUNTRY_CODE;
      // 0055 11 91234-5678 -> +5511912345678
      expect(notificationService.resolvePatientPhone({ mobile: '0055 11 91234-5678' })).toBe('+5511912345678');
    });

    it('prepends the default country code when digits do not already start with it', () => {
      delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
      delete process.env.DEFAULT_COUNTRY_CODE;
      expect(notificationService.resolvePatientPhone({ whatsapp: '11912345678' })).toBe('+5511912345678');
    });

    it('does not duplicate the default country code when digits already start with it', () => {
      delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
      delete process.env.DEFAULT_COUNTRY_CODE;
      expect(notificationService.resolvePatientPhone({ phoneNumber: '5511912345678' })).toBe('+5511912345678');
    });

    it('honors CONSENT_DEFAULT_COUNTRY_CODE override', () => {
      process.env.CONSENT_DEFAULT_COUNTRY_CODE = '1';
      expect(notificationService.resolvePatientPhone({ phone: '5551234567' })).toBe('+15551234567');
    });
  });

  describe('resolvePatientEmail', () => {
    it('prefers email over emailAddress/contactEmail', () => {
      expect(
        notificationService.resolvePatientEmail({
          email: 'a@x.com',
          emailAddress: 'b@x.com',
          contactEmail: 'c@x.com'
        })
      ).toBe('a@x.com');
    });

    it('falls back to contactEmail when email and emailAddress are absent', () => {
      expect(notificationService.resolvePatientEmail({ contactEmail: 'c@x.com' })).toBe('c@x.com');
    });

    it('returns null when no email-like field is present', () => {
      expect(notificationService.resolvePatientEmail({})).toBeNull();
    });
  });

  describe('formatConsentMessage', () => {
    it('includes the patient name and link when name is provided', () => {
      const msg = notificationService.formatConsentMessage('Maria', 'http://link');
      expect(msg).toContain('Maria');
      expect(msg).toContain('http://link');
    });

    it('falls back to "Paciente" when name is missing', () => {
      const msg = notificationService.formatConsentMessage(null, 'http://link');
      expect(msg).toContain('Paciente');
    });
  });

  describe('getResendClient', () => {
    // No development-mode fallback (intentionally removed in 5e571099, see issue #181)
    // — a missing RESEND_API_KEY must throw regardless of environment.
    it('throws in development mode when RESEND_API_KEY is absent', () => {
      notificationService.isDevelopment = true;
      notificationService.resendClient = null;
      delete process.env.RESEND_API_KEY;
      expect(() => notificationService.getResendClient()).toThrow('RESEND_API_KEY');
    });

    it('throws in non-development mode when RESEND_API_KEY is absent', () => {
      notificationService.isDevelopment = false;
      notificationService.resendClient = null;
      delete process.env.RESEND_API_KEY;
      expect(() => notificationService.getResendClient()).toThrow('RESEND_API_KEY');
    });

    it('caches the client instance across calls once created', () => {
      const fakeClient = { emails: { send: vi.fn() } };
      notificationService.resendClient = fakeClient;
      expect(notificationService.getResendClient()).toBe(fakeClient);
    });
  });

  describe('resolveRecipient', () => {
    it('throws when no recipient is provided', () => {
      expect(() => notificationService.resolveRecipient('   ')).toThrow('Destinatário é obrigatório');
    });

    it('returns the original recipient unchanged when not in development mode', () => {
      notificationService.isDevelopment = false;
      const result = notificationService.resolveRecipient('patient@example.com');
      expect(result).toEqual({
        to: 'patient@example.com',
        redirected: false,
        originalTo: 'patient@example.com'
      });
    });

    it('throws in development mode when ADMIN_EMAIL is not configured', () => {
      notificationService.isDevelopment = true;
      notificationService.adminEmail = '';
      expect(() => notificationService.resolveRecipient('patient@example.com')).toThrow('ADMIN_EMAIL');
    });

    it('redirects to ADMIN_EMAIL in development mode and flags redirected=true', () => {
      notificationService.isDevelopment = true;
      notificationService.adminEmail = 'admin@example.com';
      const result = notificationService.resolveRecipient('patient@example.com');
      expect(result).toEqual({
        to: 'admin@example.com',
        redirected: true,
        originalTo: 'patient@example.com'
      });
    });

    it('does not flag redirected when the recipient already equals ADMIN_EMAIL', () => {
      notificationService.isDevelopment = true;
      notificationService.adminEmail = 'admin@example.com';
      const result = notificationService.resolveRecipient('admin@example.com');
      expect(result.redirected).toBe(false);
    });
  });

  describe('persistComplianceLog', () => {
    it('swallows persistence errors and logs them instead of throwing (no MONGO_URI configured in tests)', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      await expect(
        notificationService.persistComplianceLog({ messageId: 'm1', notificationType: 'x' })
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('sendEmail', () => {
    it('throws when subject is missing', async () => {
      await expect(notificationService.sendEmail({ to: 'a@x.com', html: '<p>x</p>' })).rejects.toThrow(
        'subject e html/text são obrigatórios'
      );
    });

    it('throws when neither html nor text is provided', async () => {
      await expect(notificationService.sendEmail({ to: 'a@x.com', subject: 'Hi' })).rejects.toThrow(
        'subject e html/text são obrigatórios'
      );
    });

    // getResendClient no longer has a development-mode null fallback
    // (intentionally removed in 5e571099, see issue #181) — sendEmail always
    // routes through a real resend client, even in development; only the
    // recipient redirection is dev-mode-specific.
    it('redirects to ADMIN_EMAIL in development mode while still sending via the resend client', async () => {
      notificationService.isDevelopment = true;
      notificationService.adminEmail = 'admin@example.com';
      notificationService.emailFrom = 'notifications@example.com';
      const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      const result = await notificationService.sendEmail({
        to: 'patient@example.com',
        subject: 'Hello',
        text: 'body',
        notificationType: 'TEST'
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@example.com', subject: 'Hello' })
      );
      expect(result.success).toBe(true);
      expect(result.to).toBe('admin@example.com');
      expect(result.redirectedByEnvironment).toBe(true);
    });

    it('sends via the real resend client and returns the messageId when a client is available', async () => {
      notificationService.isDevelopment = false;
      notificationService.emailFrom = 'notifications@example.com';
      const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      const result = await notificationService.sendEmail({
        to: 'patient@example.com',
        subject: 'Hello',
        html: '<p>body</p>',
        notificationType: 'TEST'
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'patient@example.com', subject: 'Hello', html: '<p>body</p>' })
      );
      expect(result.success).toBe(true);
      expect(result.mocked).toBe(false);
      expect(result.messageId).toBe('msg-123');
    });

    it('throws when the resend client responds with an error', async () => {
      notificationService.isDevelopment = false;
      notificationService.emailFrom = 'notifications@example.com';
      const sendMock = vi.fn().mockResolvedValue({ error: { message: 'invalid domain' } });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({ to: 'patient@example.com', subject: 'Hello', html: '<p>x</p>' })
      ).rejects.toThrow('invalid domain');
    });
  });


  // #796 / #811 -- RF015 AC#3 ("Registrar tentativas, falhas, entrega e
  // confirmacao"). persistComplianceLog used to run only on the success
  // path, so a failed send left no record anywhere; the one function that
  // tried to record consent-delivery failures
  // (persistConsentDeliveryFailure) was a permanent no-op writing
  // non-canonical fields onto Patient, and was deleted.
  describe('sendEmail failure recording (#796 / RF015 AC#3)', () => {
    beforeEach(() => {
      notificationService.isDevelopment = false;
      notificationService.emailFrom = 'notifications@example.com';
    });

    // #903: persistComplianceLog now also writes an ATTEMPTED row before the
    // transport is touched (RF015 AC#3, "Registrar tentativas"), so the
    // failure path is two calls, not one -- the count assertion below is a
    // deliberate strengthening, not a loosening, of what this test pins.
    it('records a DELIVERY_FAILED compliance log when the provider returns an error', async () => {
      const sendMock = vi.fn().mockResolvedValue({ error: { message: 'invalid domain' } });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({
          to: 'patient@example.com',
          subject: 'Hello',
          html: '<p>x</p>',
          notificationType: 'RF_CONSENT_NOTIFICATION',
          metadata: { participantId: '00000042' }
        })
      ).rejects.toThrow('invalid domain');

      expect(complianceSpy).toHaveBeenCalledTimes(2);
      expect(complianceSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({ deliveryStatus: 'ATTEMPTED', attemptedAt: expect.any(Date) })
      );
      const lastCall = complianceSpy.mock.calls[complianceSpy.mock.calls.length - 1][0];
      expect(lastCall).toEqual(
        expect.objectContaining({
          notificationType: 'RF_CONSENT_NOTIFICATION',
          deliveryStatus: 'DELIVERY_FAILED',
          errorCode: 'CONSENT_DELIVERY_FAILED',
          to: 'patient@example.com',
          metadata: { participantId: '00000042' },
          failedAt: expect.any(Date)
        })
      );
    });

    it('records the failure when the transport itself rejects, and preserves the original error', async () => {
      const sendMock = vi.fn().mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({ to: 'p@example.com', subject: 'S', text: 'x' })
      ).rejects.toThrow('socket hang up');

      expect(complianceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryStatus: 'DELIVERY_FAILED', errorCode: 'ECONNRESET' })
      );
    });

    // #903: same as above -- the success path is now ATTEMPTED followed by
    // the sentAt row, so it is two calls, not one; strengthened accordingly.
    it('records exactly two compliance logs on the success path: ATTEMPTED then the sentAt row', async () => {
      const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-1' } });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await notificationService.sendEmail({ to: 'p@example.com', subject: 'S', text: 'x' });

      expect(complianceSpy).toHaveBeenCalledTimes(2);
      expect(complianceSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({ deliveryStatus: 'ATTEMPTED', attemptedAt: expect.any(Date) })
      );
      const payload = complianceSpy.mock.calls[complianceSpy.mock.calls.length - 1][0];
      expect(payload.sentAt).toBeInstanceOf(Date);
      expect(payload.sentAtLocal).toEqual(expect.stringMatching(/\d{2}\/\d{2}\/\d{4}/));
      expect(payload.location.machine).toEqual(expect.any(String));
      expect(payload.deliveryStatus).toBe('SENT');
    });

    it('no longer exposes persistConsentDeliveryFailure', () => {
      expect(notificationService.persistConsentDeliveryFailure).toBeUndefined();
    });

    // #903: writes the ATTEMPTED row before the transport call on both
    // paths, so a crash mid-send still leaves a "we tried" record.
    it('writes the ATTEMPTED compliance row before invoking the transport', async () => {
      const order = [];
      const sendMock = vi.fn().mockImplementation(async () => {
        order.push('send');
        return { data: { id: 'msg-order' } };
      });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockImplementation(async (payload) => {
        if (payload.deliveryStatus === 'ATTEMPTED') order.push('attempted');
      });

      await notificationService.sendEmail({ to: 'p@example.com', subject: 'S', text: 'x' });

      expect(order).toEqual(['attempted', 'send']);
    });

    it('writes the ATTEMPTED compliance row before invoking the transport, even when the send later fails', async () => {
      const order = [];
      const sendMock = vi.fn().mockImplementation(async () => {
        order.push('send');
        return { error: { message: 'invalid domain' } };
      });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockImplementation(async (payload) => {
        if (payload.deliveryStatus === 'ATTEMPTED') order.push('attempted');
      });

      await expect(
        notificationService.sendEmail({ to: 'p@example.com', subject: 'S', text: 'x' })
      ).rejects.toThrow('invalid domain');

      expect(order).toEqual(['attempted', 'send']);
    });

    // #903: the two pre-send validation throws had no recipient resolved yet
    // to record against, so they used to leave no compliance row at all.
    it('records a VALIDATION_FAILED compliance log before throwing when subject is missing, without changing the thrown message', async () => {
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({ to: 'a@x.com', html: '<p>x</p>' })
      ).rejects.toThrow('subject e html/text são obrigatórios para envio de e-mail');

      expect(complianceSpy).toHaveBeenCalledTimes(1);
      expect(complianceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTo: 'a@x.com',
          deliveryStatus: 'DELIVERY_FAILED',
          errorCode: 'VALIDATION_FAILED',
          failedAt: expect.any(Date)
        })
      );
    });

    it('records a VALIDATION_FAILED compliance log before throwing when resolveRecipient rejects (e.g. empty recipient)', async () => {
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({ to: '   ', subject: 'Hello', text: 'body' })
      ).rejects.toThrow('Destinatário é obrigatório');

      expect(complianceSpy).toHaveBeenCalledTimes(1);
      expect(complianceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: 'DELIVERY_FAILED',
          errorCode: 'VALIDATION_FAILED',
          failedAt: expect.any(Date)
        })
      );
    });
  });

  // #833: a real SMTP transport, selected by environment (option 1). This
  // repo's Vitest setup does not let vi.mock() reliably intercept require()
  // (NotificationService.js is loaded via a native createRequire, outside
  // Vitest's module graph -- see e.g. tests/unit/database-mongo.test.js's
  // note on the same pattern), so SMTP is stubbed the same way getResendClient
  // already is above: by spying on the lazy getter, not by mocking the
  // 'nodemailer' package itself.
  describe('sendEmail SMTP transport selection (#833)', () => {
    beforeEach(() => {
      notificationService.isDevelopment = false;
      notificationService.emailFrom = 'notifications@example.com';
    });

    it('selects Resend (unchanged) when SMTP_HOST is unset', async () => {
      delete process.env.SMTP_HOST;
      const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-resend' } });
      vi.spyOn(notificationService, 'getResendClient').mockReturnValue({ emails: { send: sendMock } });
      vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      const result = await notificationService.sendEmail({ to: 'p@example.com', subject: 'S', text: 'x' });

      expect(sendMock).toHaveBeenCalled();
      expect(result.provider).toBe('resend');
    });

    it('selects SMTP and sends via nodemailer when SMTP_HOST is set', async () => {
      process.env.SMTP_HOST = 'smtp-test';
      process.env.SMTP_PORT = '1025';
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'smtp-msg-1' });
      vi.spyOn(notificationService, 'getSmtpTransport').mockReturnValue({ sendMail: sendMailMock });
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      const result = await notificationService.sendEmail({
        to: 'patient@example.com',
        subject: 'Hello',
        html: '<p>body</p>',
        notificationType: 'TEST'
      });

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'notifications@example.com',
          to: 'patient@example.com',
          subject: 'Hello',
          html: '<p>body</p>'
        })
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe('smtp');
      expect(result.messageId).toBe('smtp-msg-1');

      const lastCall = complianceSpy.mock.calls[complianceSpy.mock.calls.length - 1][0];
      expect(lastCall).toEqual(
        expect.objectContaining({
          provider: 'smtp',
          deliveryStatus: 'SENT',
          sentAt: expect.any(Date),
          sentAtLocal: expect.stringMatching(/\d{2}\/\d{2}\/\d{4}/),
          location: expect.objectContaining({
            kind: 'smtp_relay',
            host: 'smtp-test',
            port: '1025',
            machine: expect.any(String),
          }),
          messageId: 'smtp-msg-1',
        })
      );
      expect(lastCall.html).toBeUndefined();
      expect(lastCall.text).toBeUndefined();
      const attempt = complianceSpy.mock.calls.find((call) => call[0].deliveryStatus === 'ATTEMPTED')[0];
      expect(attempt.sentAt).toBeInstanceOf(Date);
      expect(attempt.location).toEqual(expect.objectContaining({ host: 'smtp-test', port: '1025' }));
    });

    it('records a resend location when no SMTP host is set, and the default port when the host has none', () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      const resendTrace = notificationService.emailSendTrace();
      expect(resendTrace.provider).toBe('resend');
      expect(resendTrace.sentAtLocal).toEqual(expect.stringMatching(/\d{2}\/\d{2}\/\d{4}/));
      expect(resendTrace.location).toEqual({
        kind: 'resend',
        host: 'resend',
        port: null,
        machine: expect.any(String),
      });

      process.env.SMTP_HOST = '  smtp-test  ';
      delete process.env.SMTP_PORT;
      const smtpTrace = notificationService.emailSendTrace();
      expect(smtpTrace.provider).toBe('smtp');
      expect(smtpTrace.location).toEqual(expect.objectContaining({
        kind: 'smtp_relay',
        host: 'smtp-test',
        port: '1025',
      }));
    });

    it('records a DELIVERY_FAILED row with provider smtp and rethrows when the SMTP transport rejects', async () => {
      process.env.SMTP_HOST = 'smtp-test';
      process.env.SMTP_PORT = '1025';
      const sendMailMock = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      vi.spyOn(notificationService, 'getSmtpTransport').mockReturnValue({ sendMail: sendMailMock });
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendEmail({ to: 'patient@example.com', subject: 'Hello', text: 'body' })
      ).rejects.toThrow('connect ECONNREFUSED');

      const lastCall = complianceSpy.mock.calls[complianceSpy.mock.calls.length - 1][0];
      expect(lastCall).toEqual(
        expect.objectContaining({
          provider: 'smtp',
          deliveryStatus: 'DELIVERY_FAILED',
          errorCode: 'ECONNREFUSED',
          failedAt: expect.any(Date),
          sentAt: expect.any(Date),
          sentAtLocal: expect.stringMatching(/\d{2}\/\d{2}\/\d{4}/),
          location: expect.objectContaining({ kind: 'smtp_relay', host: 'smtp-test', port: '1025' }),
        })
      );
    });
  });

  describe('getConsentQueueStats', () => {
    it('reports unavailable when no notification queue can be initialized', async () => {
      vi.spyOn(notificationService, 'getNotificationQueue').mockReturnValue(null);
      const stats = await notificationService.getConsentQueueStats();
      expect(stats).toEqual({
        available: false,
        counts: { waiting: 0, delayed: 0, active: 0, failed: 0 },
        totalQueued: 0
      });
    });

    it('aggregates job counts when a queue is available', async () => {
      const fakeQueue = {
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, delayed: 1, active: 3, failed: 0 })
      };
      vi.spyOn(notificationService, 'getNotificationQueue').mockReturnValue(fakeQueue);

      const stats = await notificationService.getConsentQueueStats();
      expect(stats).toEqual({
        available: true,
        counts: { waiting: 2, delayed: 1, active: 3, failed: 0 },
        totalQueued: 3,
        active: 3
      });
    });
  });

  describe('generateConsentToken / buildConsentMetadata / buildConsentLink', () => {
    it('generates a 64-char hex token', () => {
      const token = notificationService.generateConsentToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('builds consent metadata with token, createdAt and expiresAt roughly 7 days apart', () => {
      const metadata = notificationService.buildConsentMetadata();
      expect(metadata.token).toMatch(/^[0-9a-f]{64}$/);
      const diffDays = (metadata.expiresAt.getTime() - metadata.createdAt.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(7, 5);
    });

    it('builds a consent link using participantId and the frontend URL, trimming trailing slash', () => {
      process.env.FRONTEND_URL = 'https://app.example.com/';
      const link = notificationService.buildConsentLink({ participantId: 'P-1' }, 'tok en');
      expect(link).toBe('https://app.example.com/patients/P-1/consent?token=tok%20en');
    });

    // #805: was 'falls back to patientId then id when patientID is absent'.
    // That fallback chain never matched any caller's shape and produced
    // /patients/undefined/consent in production; it now throws instead.
    it('throws when participantId is absent instead of emitting an undefined id', () => {
      process.env.FRONTEND_URL = 'https://app.example.com/';
      expect(() => notificationService.buildConsentLink({ id: 'P-9' }, 'tok')).toThrow(
        expect.objectContaining({ code: 'CONSENT_PARTICIPANT_ID_REQUIRED' })
      );
    });
  });

  describe('sendConsentEmail', () => {
    // sendConsentEmail no longer swallows a missing email into a soft
    // {success:false} result (intentionally removed in 5e571099, see issue
    // #181) — it throws, and notifyPatientConsent (the caller) is what turns
    // that throw back into a {channel:'unknown', success:false} entry.
    //
    // #796: this test used to assert persistConsentDeliveryFailure was
    // called, and its comment claimed the catch block "persists a
    // delivery-failure record". It did not -- that function was a permanent
    // no-op, and this test could not notice because it mocked it out (#803
    // class). The function is gone; this failure happens before any send is
    // attempted, so there is no recipient resolved to record against and it
    // is deliberately not written to the compliance log -- see #811.
    it('throws when the patient has no resolvable email', async () => {
      vi.spyOn(notificationService, 'validateFrontendUrl').mockReturnValue(new URL('https://app.example.com'));
      const complianceSpy = vi.spyOn(notificationService, 'persistComplianceLog').mockResolvedValue(undefined);

      await expect(
        notificationService.sendConsentEmail({ participantId: '00000042' }, 'http://link')
      ).rejects.toThrow('E-mail do participante é obrigatório para convite remoto');
      expect(complianceSpy).not.toHaveBeenCalled();
    });

    it('sends the consent email through sendEmail and returns success', async () => {
      vi.spyOn(notificationService, 'validateFrontendUrl').mockReturnValue(new URL('https://app.example.com'));
      const sendEmailSpy = vi
        .spyOn(notificationService, 'sendEmail')
        .mockResolvedValue({ success: true, channel: 'email', provider: 'resend' });
      // #796: was `{ patientID: 'P-1', ... }` asserting `metadata: { patientID: 'P-1' }`.
      // No caller passes `patientID`, so that assertion only held because the
      // test invented the field the product code was wrongly reading.
      const result = await notificationService.sendConsentEmail(
        { participantId: '12345678', patientName: 'Maria', email: 'maria@example.com' },
        'http://link'
      );
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'maria@example.com',
          notificationType: 'RF_CONSENT_NOTIFICATION',
          metadata: { participantId: '12345678' }
        })
      );
      expect(result).toEqual({ channel: 'email', success: true, provider: 'resend' });
    });

    // #796: every test above hands sendConsentEmail `{ patientID: 'P-1' }`,
    // a shape neither real caller produces. Both pass `participantId`:
    //   routes/eConsent.js:31            sendConsentEmail({ participantId, email }, link)
    //   fhir-import-staging.service.js   sendConsentEmail({ participantId: normalized.participantId, ... })
    // Driven with the real shape, the compliance record persisted by
    // sendEmail -> persistComplianceLog carried `patientID: null`, so every
    // RF_CONSENT_NOTIFICATION ever written had no link back to the
    // participant it was sent for. Same shape as #795's audit trail, and the
    // same enabler as #803 (fixture shapes diverging from real callers).
    it('#796: carries the participant identifier into the compliance record, given the shape real callers pass', async () => {
      vi.spyOn(notificationService, 'validateFrontendUrl').mockReturnValue(new URL('https://app.example.com'));
      const sendEmailSpy = vi
        .spyOn(notificationService, 'sendEmail')
        .mockResolvedValue({ success: true, channel: 'email', provider: 'resend' });

      await notificationService.sendConsentEmail(
        { participantId: '12345678', email: 'maria@example.com' },
        'http://link'
      );

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'maria@example.com',
          notificationType: 'RF_CONSENT_NOTIFICATION',
          metadata: { participantId: '12345678' }
        })
      );
    });
  });

  describe('sendConsentSmsFallback', () => {
    it('returns missing_phone failure when phone cannot be resolved', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await notificationService.sendConsentSmsFallback({ participantId: '12345678' }, 'http://link');
      expect(result).toEqual({ channel: 'sms', success: false, reason: 'missing_phone' });
    });

    it('returns missing_sms_fallback_email failure when no admin/alert email is configured', async () => {
      notificationService.adminEmail = '';
      delete process.env.ALERT_EMAIL_TO;
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await notificationService.sendConsentSmsFallback(
        { participantId: '12345678', phone: '11912345678' },
        'http://link'
      );
      expect(result).toEqual({ channel: 'sms', success: false, reason: 'missing_sms_fallback_email' });
    });

    it('routes the SMS content through email fallback when a fallback address is configured', async () => {
      notificationService.adminEmail = 'admin@example.com';
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      const result = await notificationService.sendConsentSmsFallback(
        { participantId: '12345678', phone: '11912345678' },
        'http://link'
      );
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@example.com', notificationType: 'RF_CONSENT_SMS_FALLBACK', metadata: { participantId: '12345678', phone: '+5511912345678' } })
      );
      expect(result).toEqual({ channel: 'sms', success: true, mocked: true, provider: 'resend-email-fallback' });
    });
  });

  describe('sendConsentWhatsappFallback', () => {
    it('returns missing_phone failure when phone cannot be resolved', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await notificationService.sendConsentWhatsappFallback({ participantId: '12345678' }, 'http://link');
      expect(result).toEqual({ channel: 'whatsapp', success: false, reason: 'missing_phone' });
    });

    it('reports a consolidated mocked success when a phone is resolvable (no real WhatsApp send)', async () => {
      const result = await notificationService.sendConsentWhatsappFallback(
        { participantId: '12345678', phone: '11912345678' },
        'http://link'
      );
      expect(result).toEqual({
        channel: 'whatsapp',
        success: true,
        mocked: true,
        provider: 'resend-email-fallback',
        reason: 'Canal WhatsApp consolidado para envio por e-mail rastreável'
      });
    });
  });

  describe('notifyPatientConsent', () => {
    it('aggregates results from email and whatsapp fallback channels', async () => {
      vi.spyOn(notificationService, 'sendConsentEmail').mockResolvedValue({ channel: 'email', success: true });
      vi.spyOn(notificationService, 'sendConsentWhatsappFallback').mockResolvedValue({
        channel: 'whatsapp',
        success: true
      });

      const results = await notificationService.notifyPatientConsent({ patientID: 'P-1' }, 'http://link');
      expect(results).toEqual([
        { channel: 'email', success: true },
        { channel: 'whatsapp', success: true }
      ]);
    });

    it('converts a rejected channel promise into a failed result entry instead of throwing', async () => {
      vi.spyOn(notificationService, 'sendConsentEmail').mockRejectedValue(new Error('boom'));
      vi.spyOn(notificationService, 'sendConsentWhatsappFallback').mockResolvedValue({
        channel: 'whatsapp',
        success: true
      });

      const results = await notificationService.notifyPatientConsent({ patientID: 'P-1' }, 'http://link');
      expect(results[0]).toEqual({ channel: 'unknown', success: false, reason: 'boom' });
      expect(results[1]).toEqual({ channel: 'whatsapp', success: true });
    });
  });

  describe('enqueueConsentNotification', () => {
    it('falls back to direct notifyPatientConsent when no queue is available', async () => {
      vi.spyOn(notificationService, 'getNotificationQueue').mockReturnValue(null);
      const notifySpy = vi
        .spyOn(notificationService, 'notifyPatientConsent')
        .mockResolvedValue([{ channel: 'email', success: true }]);

      const result = await notificationService.enqueueConsentNotification({ patientID: 'P-1' }, 'http://link');
      expect(notifySpy).toHaveBeenCalledWith({ patientID: 'P-1' }, 'http://link');
      expect(result).toEqual([{ channel: 'email', success: true }]);
    });

    it('enqueues a job on the notification queue when available instead of sending directly', async () => {
      const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });
      vi.spyOn(notificationService, 'getNotificationQueue').mockReturnValue({ add: addMock });
      const notifySpy = vi.spyOn(notificationService, 'notifyPatientConsent');

      const result = await notificationService.enqueueConsentNotification({ participantId: '12345678' }, 'http://link');
      expect(addMock).toHaveBeenCalledWith('consent-notification', {
        patientData: { participantId: '12345678' },
        consentLink: 'http://link'
      });
      expect(notifySpy).not.toHaveBeenCalled();
      expect(result).toEqual([{ channel: 'queue', success: true, provider: 'bullmq' }]);
    });

    // #1169: the job body is persisted in Redis (24h, 7 days on failure), so
    // it carries only what the send path reads -- never civil identity or
    // the consent credential.
    // #1166 slice 2 narrows #1169's list to the id alone: the name and the
    // contact are identity data, and the worker resolves them at send time.
    it('#1169/#1166: enqueues only the participantId, no name or contact', async () => {
      const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });
      vi.spyOn(notificationService, 'getNotificationQueue').mockReturnValue({ add: addMock });

      await notificationService.enqueueConsentNotification({
        participantId: '12345678',
        patientName: 'Maria',
        email: 'maria@example.com',
        phone: '11987654321',
        birthDate: new Date(1990, 0, 20),
        identityDocument: '11144477735',
        consentToken: 'secret-token',
        consentTemplateId: 'tpl-1',
      }, 'http://link');

      expect(addMock).toHaveBeenCalledWith('consent-notification', {
        patientData: { participantId: '12345678' },
        consentLink: 'http://link'
      });
    });
  });

  describe('processConsentNotificationJob', () => {
    it('delegates to notifyPatientConsent with the job payload fields', async () => {
      const notifySpy = vi
        .spyOn(notificationService, 'notifyPatientConsent')
        .mockResolvedValue([{ channel: 'email', success: true }]);

      const result = await notificationService.processConsentNotificationJob({
        patientData: { patientID: 'P-9' },
        consentLink: 'http://link/9'
      });

      expect(notifySpy).toHaveBeenCalledWith({ patientID: 'P-9' }, 'http://link/9');
      expect(result).toEqual([{ channel: 'email', success: true }]);
    });

    // #1166 slice 2: the job carries only the participantId, so the worker
    // resolves name and contact from the participant's identity record,
    // decrypting a ciphertext-only one, at send time.
    it('#1166: resolves name and contact from the decrypted identity record', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '12345678',
        patientName: 'Maria',
        email: 'maria@example.com',
        phone: '11987654321',
      });
      const identity = { ...encrypted, patientName: null, email: null, phone: null };
      const findOne = vi.fn(async (filter) => (filter.participantId === '12345678' ? identity : null));
      const db = { collection: vi.fn(() => ({ findOne })) };
      const notifySpy = vi
        .spyOn(notificationService, 'notifyPatientConsent')
        .mockResolvedValue([{ channel: 'email', success: true }]);

      await notificationService.processConsentNotificationJob(
        { patientData: { participantId: '12345678' }, consentLink: 'http://link/9' },
        db
      );

      expect(db.collection).toHaveBeenCalledWith('participantIdentities');
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: '12345678',
          patientName: 'Maria',
          email: 'maria@example.com',
          phone: '11987654321',
        }),
        'http://link/9'
      );
    });

    // #1166 slice 4: the Patient copy is gone, and so is the worker's read of it.
    it('#1166: does not read the contact off patients', async () => {
      const findOne = vi.fn(async () => ({ participantId: '12345678', patientName: 'Maria' }));
      const db = { collection: vi.fn(() => ({ findOne })) };
      vi.spyOn(notificationService, 'notifyPatientConsent').mockResolvedValue([{ channel: 'email', success: true }]);

      await notificationService.processConsentNotificationJob(
        { patientData: { participantId: '12345678' }, consentLink: 'http://link/10' },
        db
      );

      expect(db.collection).not.toHaveBeenCalledWith('patients');
    });
  });

  describe('initSocketIO', () => {
    it('reuses an already-provided io-like object instead of constructing a new socket.io Server', () => {
      const fakeIo = { of: vi.fn(), emit: vi.fn(), on: vi.fn() };
      const result = notificationService.initSocketIO(fakeIo);
      expect(result).toBe(fakeIo);
      expect(notificationService.io).toBe(fakeIo);
      expect(fakeIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('returns the cached io instance on subsequent calls without reprocessing the argument', () => {
      const fakeIo = { of: vi.fn(), emit: vi.fn(), on: vi.fn() };
      notificationService.initSocketIO(fakeIo);
      const anotherFakeIo = { of: vi.fn(), emit: vi.fn(), on: vi.fn() };
      const result = notificationService.initSocketIO(anotherFakeIo);
      expect(result).toBe(fakeIo);
    });

    it('wires up subscribe:user, subscribe:job and disconnect handlers on new connections', () => {
      const handlers = {};
      const fakeSocket = { id: 'sock-1', on: vi.fn((event, cb) => { handlers[event] = cb; }), join: vi.fn() };
      const fakeIo = {
        of: vi.fn(),
        emit: vi.fn(),
        on: vi.fn((event, cb) => {
          if (event === 'connection') cb(fakeSocket);
        })
      };

      notificationService.initSocketIO(fakeIo);

      expect(handlers['subscribe:user']).toBeInstanceOf(Function);
      handlers['subscribe:user']('user-1');
      expect(fakeSocket.join).toHaveBeenCalledWith('user-user-1');

      handlers['subscribe:job']('job-1');
      expect(fakeSocket.join).toHaveBeenCalledWith('job-1');

      expect(handlers['disconnect']).toBeInstanceOf(Function);
      expect(() => handlers['disconnect']()).not.toThrow();
    });
  });

  describe('notifyJobQueued / notifyJobStarted / notifyJobProgress', () => {
    it('does nothing when io has not been initialized', async () => {
      notificationService.io = null;
      await expect(notificationService.notifyJobQueued('u1', { a: 1 })).resolves.toBeUndefined();
    });

    it('emits import-queued to the user room', async () => {
      const toMock = vi.fn().mockReturnValue({ emit: vi.fn() });
      notificationService.io = { to: toMock };
      await notificationService.notifyJobQueued('u1', { a: 1 });
      expect(toMock).toHaveBeenCalledWith('user-u1');
    });

    it('emits import-started to both the user room and job room when jobID is present', async () => {
      const emitMock = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitMock });
      notificationService.io = { to: toMock };
      await notificationService.notifyJobStarted('u1', { jobID: 'job-7' });
      expect(toMock).toHaveBeenCalledWith('user-u1');
      expect(toMock).toHaveBeenCalledWith('job-7');
      expect(emitMock).toHaveBeenCalledTimes(2);
    });

    it('emits import-progress only to the user room when jobID is absent', async () => {
      const emitMock = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitMock });
      notificationService.io = { to: toMock };
      await notificationService.notifyJobProgress('u1', { percent: 50 });
      expect(toMock).toHaveBeenCalledTimes(1);
      expect(toMock).toHaveBeenCalledWith('user-u1');
    });
  });

  describe('notifyJobCompleted', () => {
    it('emits socket events and sends an email when userEmail is present', async () => {
      const emitMock = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitMock });
      notificationService.io = { to: toMock };
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });

      await notificationService.notifyJobCompleted('u1', {
        jobID: 'job-1',
        status: 'done',
        dataType: 'samples',
        successCount: 5,
        errorCount: 0,
        userEmail: 'user@example.com'
      });

      expect(toMock).toHaveBeenCalledWith('user-u1');
      expect(toMock).toHaveBeenCalledWith('job-1');
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', notificationType: 'RF_IMPORT_COMPLETED' })
      );
    });

    it('does not send an email when userEmail is absent', async () => {
      notificationService.io = null;
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      await notificationService.notifyJobCompleted('u1', { jobID: 'job-1', dataType: 'samples' });
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('swallows errors thrown while notifying instead of propagating them', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      notificationService.io = null;
      vi.spyOn(notificationService, 'sendEmail').mockRejectedValue(new Error('smtp down'));
      await expect(
        notificationService.notifyJobCompleted('u1', { dataType: 'samples', userEmail: 'user@example.com' })
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('notifyJobFailed', () => {
    it('emits socket events and sends an error email when userEmail is present', async () => {
      const emitMock = vi.fn();
      const toMock = vi.fn().mockReturnValue({ emit: emitMock });
      notificationService.io = { to: toMock };
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });

      await notificationService.notifyJobFailed('u1', {
        jobID: 'job-2',
        dataType: 'samples',
        error: 'parse error',
        userEmail: 'user@example.com'
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', notificationType: 'RF_IMPORT_FAILED' })
      );
    });

    it('swallows errors thrown while notifying instead of propagating them', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      notificationService.io = null;
      vi.spyOn(notificationService, 'sendEmail').mockRejectedValue(new Error('smtp down'));
      await expect(
        notificationService.notifyJobFailed('u1', { dataType: 'samples', userEmail: 'user@example.com' })
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('generateJobEmailTemplate / generateJobErrorEmailTemplate', () => {
    it('includes dataType, successCount, errorCount and jobID in the success template', () => {
      const html = notificationService.generateJobEmailTemplate({
        dataType: 'samples',
        successCount: 3,
        errorCount: 1,
        jobID: 'job-5'
      });
      expect(html).toContain('samples');
      expect(html).toContain('3');
      expect(html).toContain('job-5');
    });

    it('includes a default error message in the error template when error is absent', () => {
      const html = notificationService.generateJobErrorEmailTemplate({ dataType: 'samples', jobID: 'job-5' });
      expect(html).toContain('Erro desconhecido');
    });

    it('includes the specific error message in the error template when provided', () => {
      const html = notificationService.generateJobErrorEmailTemplate({
        dataType: 'samples',
        jobID: 'job-5',
        error: 'timeout'
      });
      expect(html).toContain('timeout');
    });
  });

  describe('sendAuthCode', () => {
    it('throws when email or code is missing', async () => {
      await expect(notificationService.sendAuthCode(null, '123456')).rejects.toThrow('email e code');
      await expect(notificationService.sendAuthCode('a@x.com', null)).rejects.toThrow('email e code');
    });

    it('sends the MFA code via sendEmail with the expected notification type', async () => {
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      await notificationService.sendAuthCode('a@x.com', '123456');
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@x.com',
          notificationType: 'RF001_MFA_AUTH_CODE',
          metadata: { codeLength: 6 }
        })
      );
      expect(sendEmailSpy.mock.calls[0][0].html).toContain('123456');
    });
  });

  describe('sendPasswordReset', () => {
    it('throws when email or link is missing', async () => {
      await expect(notificationService.sendPasswordReset(null, 'http://link')).rejects.toThrow(
        'email e link'
      );
      await expect(notificationService.sendPasswordReset('a@x.com', null)).rejects.toThrow('email e link');
    });

    it('sends the reset link via sendEmail with the expected notification type', async () => {
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      await notificationService.sendPasswordReset('a@x.com', 'https://app.example.com/reset?token=t1');
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@x.com',
          notificationType: 'RF003_PASSWORD_RESET',
          metadata: { linkDomain: 'app.example.com' }
        })
      );
    });

    // #1203: the text used to promise "30 minutos" whatever the token said.
    it('states the expiry the caller passes, and no fixed duration otherwise', async () => {
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      await notificationService.sendPasswordReset('a@x.com', 'https://app.example.com/reset?token=t1', { expiresInMinutes: 60 });
      await notificationService.sendPasswordReset('a@x.com', 'https://app.example.com/reset?token=t1', { expiresInMinutes: 1440 });
      await notificationService.sendPasswordReset('a@x.com', 'https://app.example.com/reset?token=t1');

      const [hour, day, none] = sendEmailSpy.mock.calls.map(([arg]) => arg);
      expect(hour.text).toContain('expira em 1 hora.');
      expect(day.html).toContain('expira em 24 horas.');
      expect(none.text).toContain('expira em breve.');
      for (const call of [hour, day, none]) {
        expect(call.html).not.toContain('30 minutos');
      }
    });
  });

  describe('sendTemperatureAlert', () => {
    it('throws when no target email can be resolved', async () => {
      notificationService.adminEmail = '';
      delete process.env.ALERT_EMAIL_TO;
      await expect(notificationService.sendTemperatureAlert('S-1', -50, {})).rejects.toThrow(
        'ALERT_EMAIL_TO ou ADMIN_EMAIL'
      );
    });

    it('sends the alert via sendEmail using the explicit options.email over env/admin defaults', async () => {
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true });
      await notificationService.sendTemperatureAlert('S-1', -50, { email: 'oncall@example.com' });
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'oncall@example.com',
          notificationType: 'RF016_TEMPERATURE_ALERT',
          metadata: { sampleId: 'S-1', currentTemp: -50 }
        })
      );
    });
  });

  describe('sendOTPSMS', () => {
    it('throws when no fallback email is configured', async () => {
      notificationService.adminEmail = '';
      delete process.env.ALERT_EMAIL_TO;
      await expect(notificationService.sendOTPSMS('+5511999999999', '123456')).rejects.toThrow(
        'ADMIN_EMAIL é obrigatório'
      );
    });

    it('routes the OTP code through sendAuthCode to the admin fallback email', async () => {
      notificationService.adminEmail = 'admin@example.com';
      const authCodeSpy = vi
        .spyOn(notificationService, 'sendAuthCode')
        .mockResolvedValue({ success: true, messageId: 'm1' });

      const result = await notificationService.sendOTPSMS('+5511999999999', '654321');
      expect(authCodeSpy).toHaveBeenCalledWith('admin@example.com', '654321');
      expect(result).toEqual({
        success: true,
        mocked: true,
        channel: 'sms',
        provider: 'resend-email-fallback',
        note: 'Fluxo legado de SMS redirecionado para e-mail no provedor único Resend',
        emailResult: { success: true, messageId: 'm1' }
      });
    });
  });

  describe('sendCriticalTempAlert', () => {
    it('does not trigger when temperature is within the safe range', async () => {
      const result = await notificationService.sendCriticalTempAlert('S-1', -150, {
        minTemp: -196,
        maxTemp: -80
      });
      expect(result).toEqual({
        triggered: false,
        reason: 'Temperatura -150°C dentro do range -196°C..-80°C'
      });
    });

    it('triggers and sends the alert email when temperature is outside the safe range', async () => {
      const tempAlertSpy = vi
        .spyOn(notificationService, 'sendTemperatureAlert')
        .mockResolvedValue({ success: true, messageId: 'm2' });

      const result = await notificationService.sendCriticalTempAlert('S-1', -50, {
        minTemp: -196,
        maxTemp: -80
      });

      expect(tempAlertSpy).toHaveBeenCalledWith('S-1', -50, { minTemp: -196, maxTemp: -80 });
      expect(result.triggered).toBe(true);
      expect(result.sms).toEqual({
        success: true,
        mocked: true,
        channel: 'sms',
        provider: 'resend-email-fallback',
        reason: 'Canal SMS consolidado em e-mail para operação local e rastreável'
      });
      expect(result.email).toEqual({ success: true, messageId: 'm2' });
    });

    it('falls back to env-configured min/max temp thresholds when options are not provided', async () => {
      process.env.TELEMETRY_MIN_TEMP_ALERT = '-10';
      process.env.TELEMETRY_MAX_TEMP_ALERT = '10';
      const result = await notificationService.sendCriticalTempAlert('S-1', 0, {});
      expect(result).toEqual({
        triggered: false,
        reason: 'Temperatura 0°C dentro do range -10°C..10°C'
      });
    });
  });

  describe('isLoopbackHostname', () => {
    it('recognizes localhost case-insensitively', () => {
      expect(isLoopbackHostname('LOCALHOST')).toBe(true);
    });

    it('recognizes 127.0.0.1', () => {
      expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    });

    it('recognizes bracketed and unbracketed ::1', () => {
      expect(isLoopbackHostname('::1')).toBe(true);
      expect(isLoopbackHostname('[::1]')).toBe(true);
    });

    it('returns false for a non-loopback hostname', () => {
      expect(isLoopbackHostname('app.example.com')).toBe(false);
    });

    it('returns false for an empty/undefined hostname', () => {
      expect(isLoopbackHostname('')).toBe(false);
      expect(isLoopbackHostname(undefined)).toBe(false);
    });
  });

  describe('validateFrontendUrl', () => {
    it('wraps getFrontendUrl\'s plain (code-less) throw into CONSENT_FRONTEND_URL_INVALID', () => {
      process.env.FRONTEND_URL = '';
      // getFrontendUrl throws a plain Error (no .code) when unset, so this
      // exercises the "!error?.code" branch inside the catch, which re-wraps
      // into the consent-specific error rather than surfacing the raw message.
      expect(() => notificationService.validateFrontendUrl()).toThrow(
        'FRONTEND_URL deve ser uma URL absoluta válida'
      );
      try {
        notificationService.validateFrontendUrl();
      } catch (error) {
        expect(error.code).toBe('CONSENT_FRONTEND_URL_INVALID');
      }
    });

    it('rethrows the native URL parse error unchanged (it already carries an ERR_INVALID_URL code)', () => {
      process.env.FRONTEND_URL = 'not-a-url';
      expect(() => notificationService.validateFrontendUrl()).toThrow('Invalid URL');
    });

    it('throws CONSENT_REMOTE_HTTPS_REQUIRED for a remote request against an https loopback URL', () => {
      process.env.FRONTEND_URL = 'https://localhost:5173';
      expect(() => notificationService.validateFrontendUrl({ remote: true })).toThrow(
        'Convites remotos de consentimento exigem FRONTEND_URL HTTPS'
      );
    });

    it('throws CONSENT_REMOTE_HTTPS_REQUIRED for a remote request against a non-https URL', () => {
      notificationService.isDevelopment = true;
      process.env.FRONTEND_URL = 'http://app.example.com';
      expect(() => notificationService.validateFrontendUrl({ remote: true })).toThrow(
        'Convites remotos de consentimento exigem FRONTEND_URL HTTPS'
      );
    });

    it('passes for a remote request against a real https non-loopback URL', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      const parsed = notificationService.validateFrontendUrl({ remote: true });
      expect(parsed.hostname).toBe('app.example.com');
    });

    it('throws CONSENT_FRONTEND_HTTPS_REQUIRED for a non-remote http URL on a non-loopback host', () => {
      process.env.FRONTEND_URL = 'http://app.example.com';
      expect(() => notificationService.validateFrontendUrl()).toThrow(
        'FRONTEND_URL deve usar HTTPS'
      );
    });

    it('throws CONSENT_FRONTEND_HTTPS_REQUIRED for a non-remote http loopback URL when not in development', () => {
      notificationService.isDevelopment = false;
      process.env.FRONTEND_URL = 'http://localhost:5173';
      expect(() => notificationService.validateFrontendUrl()).toThrow(
        'FRONTEND_URL deve usar HTTPS'
      );
    });

    it('allows a non-remote http loopback URL in development mode', () => {
      notificationService.isDevelopment = true;
      process.env.FRONTEND_URL = 'http://localhost:5173';
      const parsed = notificationService.validateFrontendUrl();
      expect(parsed.hostname).toBe('localhost');
    });

    it('passes for a non-remote https URL regardless of development mode', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      const parsed = notificationService.validateFrontendUrl();
      expect(parsed.protocol).toBe('https:');
    });
  });

  describe('getNotificationQueue', () => {
    it('propagates the real initRedis failure when Redis is not configured for this test environment', () => {
      notificationService.notificationQueue = null;
      expect(() => notificationService.getNotificationQueue()).toThrow(/Redis/);
    });
  });

  describe('initSocketIO (real socket.io Server construction)', () => {
    it('constructs a real socket.io Server when given a non-io-like argument', () => {
      const result = notificationService.initSocketIO(undefined);
      expect(result).toBeTruthy();
      expect(typeof result.on).toBe('function');
      expect(notificationService.io).toBe(result);
    });
  });

  describe('notifyJobStarted / notifyJobProgress with no io initialized', () => {
    it('notifyJobStarted does nothing when io has not been initialized', async () => {
      notificationService.io = null;
      await expect(notificationService.notifyJobStarted('u1', { jobID: 'job-1' })).resolves.toBeUndefined();
    });

    it('notifyJobProgress does nothing when io has not been initialized', async () => {
      notificationService.io = null;
      await expect(notificationService.notifyJobProgress('u1', { percent: 10 })).resolves.toBeUndefined();
    });
  });
});
