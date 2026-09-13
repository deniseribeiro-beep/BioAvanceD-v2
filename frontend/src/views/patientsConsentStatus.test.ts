import { describe, expect, it } from 'vitest';
import { normalizeConsentStatus } from './patientsConsentStatus';

// #1044: the RF010 accept-consent path writes status: 'ACTIVE', which used
// to fall through to a hard-coded 'EXPIRED' in the patients-directory
// badge. These cases pin the accepted-consent branch (ACTIVE/CONSENTED),
// the pre-existing branches, an explicit EXPIRED branch, and the
// unrecognised-value fallback landing on UNKNOWN instead of EXPIRED.
describe('normalizeConsentStatus', () => {
  it('maps ACTIVE to GRANTED', () => {
    expect(normalizeConsentStatus('ACTIVE')).toBe('GRANTED');
  });

  it('maps CONSENTED to GRANTED', () => {
    expect(normalizeConsentStatus('CONSENTED')).toBe('GRANTED');
  });

  it('maps GRANTED to GRANTED', () => {
    expect(normalizeConsentStatus('GRANTED')).toBe('GRANTED');
  });

  it('maps SIGNED to GRANTED', () => {
    expect(normalizeConsentStatus('SIGNED')).toBe('GRANTED');
  });

  it('maps REVOKED to REVOKED', () => {
    expect(normalizeConsentStatus('REVOKED')).toBe('REVOKED');
  });

  it('maps PENDING to PENDING', () => {
    expect(normalizeConsentStatus('PENDING')).toBe('PENDING');
  });

  it('maps PENDING_CONSENT to PENDING', () => {
    expect(normalizeConsentStatus('PENDING_CONSENT')).toBe('PENDING');
  });

  it('maps an explicit EXPIRED to EXPIRED', () => {
    expect(normalizeConsentStatus('EXPIRED')).toBe('EXPIRED');
  });

  it('maps an unrecognised value to UNKNOWN, not EXPIRED', () => {
    expect(normalizeConsentStatus('SOME_UNKNOWN_STATE')).toBe('UNKNOWN');
  });

  it('maps undefined to UNKNOWN', () => {
    expect(normalizeConsentStatus(undefined)).toBe('UNKNOWN');
  });

  it('maps an empty string to UNKNOWN', () => {
    expect(normalizeConsentStatus('')).toBe('UNKNOWN');
  });

  it('is case-insensitive', () => {
    expect(normalizeConsentStatus('active')).toBe('GRANTED');
    expect(normalizeConsentStatus('Revoked')).toBe('REVOKED');
    expect(normalizeConsentStatus('pending')).toBe('PENDING');
    expect(normalizeConsentStatus('expired')).toBe('EXPIRED');
  });

  it('is whitespace-insensitive', () => {
    expect(normalizeConsentStatus('  ACTIVE  ')).toBe('GRANTED');
    expect(normalizeConsentStatus('  pending_consent \n')).toBe('PENDING');
  });
});
