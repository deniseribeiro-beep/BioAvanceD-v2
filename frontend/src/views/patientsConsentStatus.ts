import type { ConsentStatus } from '../components/Consent/StatusBadge';

// #1044: RF010's accept-consent path writes status: 'ACTIVE' (and some
// legacy/import paths write 'CONSENTED'), but the patients-directory badge
// never recognised either value -- it fell through to the catch-all branch,
// which used to hard-code 'EXPIRED'. That made a just-accepted TCLE render
// as "Expirado" with "Coletar Assinatura" still offered.
//
// #1383: the backend sends consentStatus as the state RF010 AC5 derives
// (active, partially_revoked, revoked, superseded), and the badge reads it:
// partially_revoked and superseded each have their own value and label.
//
// Extracted out of PatientsPage.tsx so this mapping can be unit-tested
// directly (see patientsConsentStatus.test.ts), matching this repo's
// convention of testing pure exported helpers rather than rendering
// components (see sampleListFormatters.ts / .test.ts).
export function normalizeConsentStatus(value?: string): ConsentStatus {
  const normalized = (value || '').trim().toUpperCase();
  if (normalized === 'GRANTED' || normalized === 'SIGNED' || normalized === 'ACTIVE' || normalized === 'CONSENTED') {
    return 'GRANTED';
  }
  if (normalized === 'PARTIALLY_REVOKED') return 'PARTIALLY_REVOKED';
  if (normalized === 'SUPERSEDED') return 'SUPERSEDED';
  if (normalized === 'REVOKED') return 'REVOKED';
  if (normalized === 'PENDING' || normalized === 'PENDING_CONSENT') return 'PENDING';
  if (normalized === 'EXPIRED') return 'EXPIRED';
  // Anything unrecognised is UNKNOWN, not EXPIRED -- an unrecognised wire
  // value should never assert a specific (and possibly wrong) consent claim.
  return 'UNKNOWN';
}

// True when the status names a consent that exists, so its history can be
// read. A pending or empty status, and a patient's own status with no
// consent meaning (INACTIVE, or anything unrecognised), name none.
export function hasConsentRecord(value?: string): boolean {
  const status = normalizeConsentStatus(value);
  return (
    status === 'GRANTED' ||
    status === 'PARTIALLY_REVOKED' ||
    status === 'REVOKED' ||
    status === 'SUPERSEDED' ||
    status === 'EXPIRED'
  );
}
