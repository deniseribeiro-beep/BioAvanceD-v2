import { describe, it, expect } from 'vitest';
const consentService = require('../../src/services/consent.service');

describe('ConsentService.parseVersionNumber', () => {
  it('parses integer string', () => {
    expect(consentService.parseVersionNumber('3')).toBe(3);
  });

  it('parses v-prefixed version', () => {
    expect(consentService.parseVersionNumber('v5')).toBe(5);
  });

  it('parses V-prefixed version (case insensitive)', () => {
    expect(consentService.parseVersionNumber('V2')).toBe(2);
  });

  it('returns 0 for null', () => {
    expect(consentService.parseVersionNumber(null)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(consentService.parseVersionNumber('')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(consentService.parseVersionNumber('abc')).toBe(0);
  });

  it('returns 0 for decimal version', () => {
    expect(consentService.parseVersionNumber('1.2')).toBe(0);
  });

  it('parses numeric type directly', () => {
    expect(consentService.parseVersionNumber(7)).toBe(7);
  });
});

describe('ConsentService.normalizeSignaturePayload', () => {
  it('returns empty signature when no image provided', () => {
    const result = consentService.normalizeSignaturePayload({ signatureName: 'Test User' });
    expect(result.signatureName).toBe('Test User');
    expect(result.signatureImageBase64).toBe('');
    expect(result.signatureHash).toBeNull();
  });

  it('defaults signatureMimeType to image/png', () => {
    const result = consentService.normalizeSignaturePayload({});
    expect(result.signatureMimeType).toBe('image/png');
  });

  it('computes sha256 hash when image provided', () => {
    const fakeBase64 = Buffer.from('fake-image-data').toString('base64');
    const result = consentService.normalizeSignaturePayload({ signatureImageBase64: fakeBase64 });
    expect(result.signatureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws when signature exceeds max size', () => {
    const huge = 'x'.repeat(7 * 1024 * 1024);
    expect(() => consentService.normalizeSignaturePayload({ signatureImageBase64: huge })).toThrow('tamanho');
  });

  it('throws for invalid mime type', () => {
    const base64 = Buffer.from('data').toString('base64');
    expect(() =>
      consentService.normalizeSignaturePayload({ signatureImageBase64: base64, signatureMimeType: 'application/pdf' })
    ).toThrow('inválido');
  });

  it('extracts mime from data URL prefix', () => {
    const content = Buffer.from('img').toString('base64');
    const dataUrl = `data:image/jpeg;base64,${content}`;
    const result = consentService.normalizeSignaturePayload({ signatureImageBase64: dataUrl });
    expect(result.signatureMimeType).toBe('image/jpeg');
  });

  it('trims signatureName', () => {
    const result = consentService.normalizeSignaturePayload({ signatureName: '  João  ' });
    expect(result.signatureName).toBe('João');
  });
});

describe('ConsentService.validateTemplatePayload', () => {
  const validTemplate = { title: 'Consent Form', content: 'Terms here' };

  it('does not throw for valid template', () => {
    expect(() => consentService.validateTemplatePayload(validTemplate)).not.toThrow();
  });

  it('throws when title is missing', () => {
    expect(() => consentService.validateTemplatePayload({ content: 'Terms' })).toThrow();
  });

  it('throws when content is missing', () => {
    expect(() => consentService.validateTemplatePayload({ title: 'Title' })).toThrow();
  });

  it('throws for empty title', () => {
    expect(() => consentService.validateTemplatePayload({ title: '', content: 'Terms' })).toThrow();
  });
});

describe('ConsentService.validatePolicyPayload', () => {
  const validPolicy = {
    title: 'Privacy Policy',
    htmlContent: '<p>Content</p>',
    version: 'v1',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-12-31T23:59:59.000Z',
    granularPermissions: [{ key: 'analytics', label: 'Analytics' }],
  };

  it('does not throw for valid policy', () => {
    expect(() => consentService.validatePolicyPayload(validPolicy)).not.toThrow();
  });

  it('throws when required field is missing', () => {
    const { title: _t, ...noTitle } = validPolicy;
    expect(() => consentService.validatePolicyPayload(noTitle)).toThrow();
  });

  it('throws when granularPermissions is empty', () => {
    expect(() =>
      consentService.validatePolicyPayload({ ...validPolicy, granularPermissions: [] })
    ).toThrow();
  });
});

describe('ConsentService.validatePatientConsentPayload', () => {
  const validConsent = { patientId: 'P12345678', templateId: 'abc123', responses: {} };

  it('does not throw for valid consent', () => {
    expect(() => consentService.validatePatientConsentPayload(validConsent)).not.toThrow();
  });

  it('throws when patientId is missing', () => {
    expect(() =>
      consentService.validatePatientConsentPayload({ templateId: 'abc', responses: {} })
    ).toThrow();
  });

  it('throws when templateId is missing', () => {
    expect(() =>
      consentService.validatePatientConsentPayload({ patientId: 'P1', responses: {} })
    ).toThrow();
  });
});

describe('ConsentService.ensureUniquePermissionKeys', () => {
  it('does not throw when keys are unique', () => {
    const perms = [{ key: 'analytics' }, { key: 'marketing' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).not.toThrow();
  });

  it('throws when a key is duplicated', () => {
    const perms = [{ key: 'analytics' }, { key: 'analytics' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).toThrow('duplicada');
  });

  it('trims keys before comparing', () => {
    const perms = [{ key: ' analytics ' }, { key: 'analytics' }];
    expect(() => consentService.ensureUniquePermissionKeys(perms)).toThrow('duplicada');
  });

  it('does not throw for empty array', () => {
    expect(() => consentService.ensureUniquePermissionKeys([])).not.toThrow();
  });
});

describe('ConsentService.validateResponsesAgainstTemplate', () => {
  const template = {
    permissions: [
      { key: 'analytics', required: false },
      { key: 'marketing', required: true },
    ],
  };

  it('does not throw for valid responses', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: false, marketing: true })
    ).not.toThrow();
  });

  it('throws when required permission is false', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: false, marketing: false })
    ).toThrow('obrigatórias');
  });

  it('throws when response is missing for a permission', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: true })
    ).toThrow('inválidas');
  });

  it('throws when extra keys are present', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate(template, { analytics: true, marketing: true, extra: true })
    ).toThrow('inválidas');
  });

  it('handles template with no permissions', () => {
    expect(() =>
      consentService.validateResponsesAgainstTemplate({ permissions: [] }, {})
    ).not.toThrow();
  });
});
