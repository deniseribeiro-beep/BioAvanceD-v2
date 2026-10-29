import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notificationService = require('../../../src/services/NotificationService');

const ENV_KEYS = [
  'CONSENT_DEFAULT_COUNTRY_CODE',
  'DEFAULT_COUNTRY_CODE',
  'NODE_ENV',
  'ADMIN_EMAIL',
  'FRONTEND_URL',
  'TELEMETRY_MIN_TEMP_ALERT',
  'TELEMETRY_MAX_TEMP_ALERT'
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('NotificationService - normalizePhoneE164', () => {
  it('returns null for null/empty/whitespace input', () => {
    expect(notificationService.normalizePhoneE164(null)).toBeNull();
    expect(notificationService.normalizePhoneE164('')).toBeNull();
    expect(notificationService.normalizePhoneE164('   ')).toBeNull();
  });

  it('returns an already "+"-prefixed number trimmed, unchanged otherwise', () => {
    expect(notificationService.normalizePhoneE164('  +5511999998888  ')).toBe('+5511999998888');
  });

  it('strips non-digit characters before normalizing', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    delete process.env.DEFAULT_COUNTRY_CODE;
    expect(notificationService.normalizePhoneE164('(11) 99999-8888')).toBe('+5511999998888');
  });

  it('strips a leading 00 international prefix', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    delete process.env.DEFAULT_COUNTRY_CODE;
    expect(notificationService.normalizePhoneE164('0055 11 999998888')).toBe('+5511999998888');
  });

  it('does not double-prefix when digits already start with the default country code (default 55)', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    delete process.env.DEFAULT_COUNTRY_CODE;
    expect(notificationService.normalizePhoneE164('5511999998888')).toBe('+5511999998888');
  });

  it('prefixes the default country code when absent', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    delete process.env.DEFAULT_COUNTRY_CODE;
    expect(notificationService.normalizePhoneE164('11999998888')).toBe('+5511999998888');
  });

  it('honors CONSENT_DEFAULT_COUNTRY_CODE env var over the built-in default', () => {
    process.env.CONSENT_DEFAULT_COUNTRY_CODE = '1';
    delete process.env.DEFAULT_COUNTRY_CODE;
    expect(notificationService.normalizePhoneE164('2025551234')).toBe('+12025551234');
  });

  it('falls back to DEFAULT_COUNTRY_CODE when CONSENT_DEFAULT_COUNTRY_CODE is unset', () => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    process.env.DEFAULT_COUNTRY_CODE = '44';
    expect(notificationService.normalizePhoneE164('7911123456')).toBe('+447911123456');
  });

  it('prefers CONSENT_DEFAULT_COUNTRY_CODE over DEFAULT_COUNTRY_CODE when both are set', () => {
    process.env.CONSENT_DEFAULT_COUNTRY_CODE = '1';
    process.env.DEFAULT_COUNTRY_CODE = '44';
    expect(notificationService.normalizePhoneE164('2025551234')).toBe('+12025551234');
  });
});

describe('NotificationService - resolvePatientEmail', () => {
  it('prefers email over emailAddress and contactEmail', () => {
    expect(
      notificationService.resolvePatientEmail({
        email: 'a@x.com',
        emailAddress: 'b@x.com',
        contactEmail: 'c@x.com'
      })
    ).toBe('a@x.com');
  });

  it('falls back to emailAddress when email is absent', () => {
    expect(
      notificationService.resolvePatientEmail({ emailAddress: 'b@x.com', contactEmail: 'c@x.com' })
    ).toBe('b@x.com');
  });

  it('falls back to contactEmail when email and emailAddress are absent', () => {
    expect(notificationService.resolvePatientEmail({ contactEmail: 'c@x.com' })).toBe('c@x.com');
  });

  it('returns null when no email field is present', () => {
    expect(notificationService.resolvePatientEmail({})).toBeNull();
  });
});

describe('NotificationService - resolvePatientPhone', () => {
  beforeEach(() => {
    delete process.env.CONSENT_DEFAULT_COUNTRY_CODE;
    delete process.env.DEFAULT_COUNTRY_CODE;
  });

  it('prefers phone over mobile, whatsapp, phoneNumber', () => {
    expect(
      notificationService.resolvePatientPhone({
        phone: '5511911112222',
        mobile: '5511933334444',
        whatsapp: '5511955556666',
        phoneNumber: '5511977778888'
      })
    ).toBe('+5511911112222');
  });

  it('falls back to mobile, then whatsapp, then phoneNumber in order', () => {
    expect(notificationService.resolvePatientPhone({ mobile: '5511933334444' })).toBe('+5511933334444');
    expect(notificationService.resolvePatientPhone({ whatsapp: '5511955556666' })).toBe('+5511955556666');
    expect(notificationService.resolvePatientPhone({ phoneNumber: '5511977778888' })).toBe('+5511977778888');
  });

  it('normalizes the resolved phone through normalizePhoneE164', () => {
    expect(notificationService.resolvePatientPhone({ phone: '11988887777' })).toBe('+5511988887777');
  });

  it('returns null when no phone field is present', () => {
    expect(notificationService.resolvePatientPhone({})).toBeNull();
  });
});

describe('NotificationService - formatConsentMessage', () => {
  it('defaults to "Paciente" when name is falsy', () => {
    const msg = notificationService.formatConsentMessage(null, 'https://x.com/consent');
    expect(msg).toContain('Paciente');
    expect(msg).toContain('https://x.com/consent');
  });

  it('interpolates the given name and link', () => {
    const msg = notificationService.formatConsentMessage('Maria', 'https://x.com/c/123');
    expect(msg).toContain('Maria');
    expect(msg).toContain('https://x.com/c/123');
  });
});

describe('NotificationService - resolveRecipient', () => {
  it('throws when originalTo is empty or blank', () => {
    expect(() => notificationService.resolveRecipient('')).toThrow();
    expect(() => notificationService.resolveRecipient('   ')).toThrow();
    expect(() => notificationService.resolveRecipient(undefined)).toThrow();
  });

  it('in non-development mode, returns the original recipient without redirection', () => {
    vi.resetModules();
    delete require.cache[require.resolve('../../../src/services/NotificationService')];
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_EMAIL;
    // eslint-disable-next-line global-require
    const freshService = require('../../../src/services/NotificationService');

    const result = freshService.resolveRecipient('patient@example.com');
    expect(result).toEqual({
      to: 'patient@example.com',
      redirected: false,
      originalTo: 'patient@example.com'
    });
  });

  it('in development mode without ADMIN_EMAIL configured, throws', () => {
    vi.resetModules();
    delete require.cache[require.resolve('../../../src/services/NotificationService')];
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_EMAIL;
    // eslint-disable-next-line global-require
    const freshService = require('../../../src/services/NotificationService');

    expect(() => freshService.resolveRecipient('patient@example.com')).toThrow();
  });

  it('in development mode with ADMIN_EMAIL configured, redirects when different from the target', () => {
    vi.resetModules();
    delete require.cache[require.resolve('../../../src/services/NotificationService')];
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    // eslint-disable-next-line global-require
    const freshService = require('../../../src/services/NotificationService');

    const result = freshService.resolveRecipient('patient@example.com');
    expect(result).toEqual({
      to: 'admin@example.com',
      redirected: true,
      originalTo: 'patient@example.com'
    });
  });

  it('in development mode with ADMIN_EMAIL configured, does not flag redirection when the target equals the admin email', () => {
    vi.resetModules();
    delete require.cache[require.resolve('../../../src/services/NotificationService')];
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    // eslint-disable-next-line global-require
    const freshService = require('../../../src/services/NotificationService');

    const result = freshService.resolveRecipient('admin@example.com');
    expect(result).toEqual({
      to: 'admin@example.com',
      redirected: false,
      originalTo: 'admin@example.com'
    });
  });
});

describe('NotificationService - generateConsentToken', () => {
  it('returns a 64-character hex string', () => {
    const token = notificationService.generateConsentToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different value on each call', () => {
    const first = notificationService.generateConsentToken();
    const second = notificationService.generateConsentToken();
    expect(first).not.toBe(second);
  });
});

describe('NotificationService - buildConsentMetadata', () => {
  it('returns a token, createdAt, and expiresAt exactly 7 days after createdAt', () => {
    const metadata = notificationService.buildConsentMetadata();
    expect(metadata.token).toMatch(/^[0-9a-f]{64}$/);
    expect(metadata.createdAt).toBeInstanceOf(Date);
    expect(metadata.expiresAt).toBeInstanceOf(Date);

    const diffMs = metadata.expiresAt.getTime() - metadata.createdAt.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('NotificationService - buildConsentLink', () => {
  // getFrontendUrl has no default fallback (intentionally removed in 5e571099,
  // see issue #180) — an unset FRONTEND_URL must throw, not silently link to
  // http://localhost:5173.
  it('throws when FRONTEND_URL is unset', () => {
    delete process.env.FRONTEND_URL;
    expect(() => notificationService.buildConsentLink({ participantId: 'P1' }, 'tok en')).toThrow(
      'FRONTEND_URL deve ser uma URL absoluta válida'
    );
  });

  it('honors FRONTEND_URL and strips a trailing slash', () => {
    process.env.FRONTEND_URL = 'https://app.example.com/';
    const link = notificationService.buildConsentLink({ participantId: 'P2' }, 'abc');
    expect(link).toBe('https://app.example.com/patients/P2/consent?token=abc');
  });

  // #805: was 'prefers patientID, then patientId, then id'. That chain was
  // the bug -- all three are prohibited legacy aliases (canonical-data-
  // contract-v1.md) that no caller passes, so the assertion passed only
  // because it invented shapes production never emits (#803). Inverted: the
  // aliases must now be ignored, not preferred.
  it('ignores the prohibited legacy aliases and requires participantId', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(
      notificationService.buildConsentLink({ patientID: 'A', patientId: 'B', id: 'C', participantId: 'D' }, 'tok')
    ).toContain('/patients/D/');
    expect(() =>
      notificationService.buildConsentLink({ patientID: 'A', patientId: 'B', id: 'C' }, 'tok')
    ).toThrow(expect.objectContaining({ code: 'CONSENT_PARTICIPANT_ID_REQUIRED' }));
  });

  it('URL-encodes the token', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const link = notificationService.buildConsentLink({ participantId: 'X' }, 'a/b c&d');
    expect(link).toBe('https://app.example.com/patients/X/consent?token=a%2Fb%20c%26d');
  });
});

describe('NotificationService - generateJobEmailTemplate', () => {
  it('includes dataType, successCount, errorCount, and jobID in the rendered HTML', () => {
    const html = notificationService.generateJobEmailTemplate({
      dataType: 'patients',
      successCount: 42,
      errorCount: 3,
      jobID: 'job-123'
    });

    expect(html).toContain('patients');
    expect(html).toContain('42');
    expect(html).toContain('3');
    expect(html).toContain('job-123');
  });
});

describe('NotificationService - generateJobErrorEmailTemplate', () => {
  it('includes dataType, jobID, and error in the rendered HTML', () => {
    const html = notificationService.generateJobErrorEmailTemplate({
      dataType: 'samples',
      jobID: 'job-456',
      error: 'Something went wrong'
    });

    expect(html).toContain('samples');
    expect(html).toContain('job-456');
    expect(html).toContain('Something went wrong');
  });

  it('falls back to a default error message when error is absent', () => {
    const html = notificationService.generateJobErrorEmailTemplate({
      dataType: 'samples',
      jobID: 'job-789'
    });

    expect(html).toContain('Erro desconhecido');
  });
});

describe('NotificationService - sendCriticalTempAlert threshold logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not trigger an alert for a temperature within the default range', async () => {
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true });

    const result = await notificationService.sendCriticalTempAlert('sample-1', -150);

    expect(spy).not.toHaveBeenCalled();
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('does not trigger an alert exactly at the range boundaries', async () => {
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true });

    const atMin = await notificationService.sendCriticalTempAlert('sample-1', -196);
    const atMax = await notificationService.sendCriticalTempAlert('sample-1', -80);

    expect(spy).not.toHaveBeenCalled();
    expect(atMin.triggered).toBe(false);
    expect(atMax.triggered).toBe(false);
  });

  it('triggers an alert for a temperature above the default max', async () => {
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true, provider: 'resend' });

    const result = await notificationService.sendCriticalTempAlert('sample-1', -10);

    expect(spy).toHaveBeenCalledWith('sample-1', -10, {});
    expect(result.triggered).toBe(true);
    expect(result.sms).toBeDefined();
    expect(result.email).toBeDefined();
  });

  it('triggers an alert for a temperature below the default min', async () => {
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true, provider: 'resend' });

    const result = await notificationService.sendCriticalTempAlert('sample-1', -200);

    expect(spy).toHaveBeenCalledWith('sample-1', -200, {});
    expect(result.triggered).toBe(true);
    expect(result.sms).toBeDefined();
    expect(result.email).toBeDefined();
  });

  it('honors overridden thresholds passed via options', async () => {
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true });

    const withinCustomRange = await notificationService.sendCriticalTempAlert('sample-1', -10, {
      minTemp: -20,
      maxTemp: 0
    });
    expect(spy).not.toHaveBeenCalled();
    expect(withinCustomRange.triggered).toBe(false);

    const outsideCustomRange = await notificationService.sendCriticalTempAlert('sample-1', 5, {
      minTemp: -20,
      maxTemp: 0
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outsideCustomRange.triggered).toBe(true);
  });

  it('honors overridden thresholds passed via env vars', async () => {
    process.env.TELEMETRY_MIN_TEMP_ALERT = '-30';
    process.env.TELEMETRY_MAX_TEMP_ALERT = '-10';
    const spy = vi.spyOn(notificationService, 'sendTemperatureAlert').mockResolvedValue({ mocked: true });

    const withinEnvRange = await notificationService.sendCriticalTempAlert('sample-1', -20);
    expect(spy).not.toHaveBeenCalled();
    expect(withinEnvRange.triggered).toBe(false);

    const outsideEnvRange = await notificationService.sendCriticalTempAlert('sample-1', -5);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outsideEnvRange.triggered).toBe(true);
  });
});

describe('NotificationService - getNotificationQueue', () => {
  it('returns null and warns when initRedis resolves to no connection (dev mode, missing Redis config)', () => {
    vi.resetModules();
    delete require.cache[require.resolve('../../../src/services/NotificationService')];
    process.env.NODE_ENV = 'development';
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    // eslint-disable-next-line global-require
    const freshService = require('../../../src/services/NotificationService');
    const warnSpy = vi.spyOn(require('../../../src/utils/logger'), 'warn').mockImplementation(() => {});

    const queue = freshService.getNotificationQueue();

    expect(queue).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Fila de notificações não inicializada'));
  });
});

// #805: buildConsentLink against the shapes its six production callers
// actually pass. Every one of them hands it either a PatientModel.create()
// result or a spread of a patients-collection document; both carry
// `participantId` (models/Patient.js CANONICAL_FIELDS) and neither carries
// patientID/patientId/id. The link's id segment is consumed by
// POST /api/e-consent/consent-tokens/{validate,accept}, which look the
// patient up by participantId -- so participantId is the only value that
// can work here, per that endpoint's own contract.
describe('NotificationService - buildConsentLink against real caller shapes (#805)', () => {
  it('uses participantId, the field every production caller actually carries', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const patient = {
      participantId: '00000042',
      sex: 'F',
      email: 'p@example.com',
      status: 'PENDING_CONSENT',
      consentToken: 'a'.repeat(64)
    };
    expect(notificationService.buildConsentLink(patient, 'a'.repeat(64)))
      .toBe(`https://app.example.com/patients/00000042/consent?token=${'a'.repeat(64)}`);
  });

  it('throws rather than emailing a URL with an undefined id segment', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(() => notificationService.buildConsentLink({ sex: 'F' }, 'tok')).toThrow(
      expect.objectContaining({ code: 'CONSENT_PARTICIPANT_ID_REQUIRED' })
    );
    expect(() => notificationService.buildConsentLink({ participantId: '   ' }, 'tok')).toThrow(
      expect.objectContaining({ code: 'CONSENT_PARTICIPANT_ID_REQUIRED' })
    );
  });

  it('URL-encodes the participantId segment as well as the token', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(notificationService.buildConsentLink({ participantId: 'a/b' }, 'c d'))
      .toBe('https://app.example.com/patients/a%2Fb/consent?token=c%20d');
  });
});
