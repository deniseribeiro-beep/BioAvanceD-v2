import crypto from 'node:crypto';

// Mints the HS256 JWT that routes/eConsent.js issues for the participant
// e-consent page, so a spec can reach that page without going through
// POST /api/e-consent/generate-link.
//
// Why not use the real endpoint: it sends an invitation email, and going
// through generate-link for every page test would tie four page-focused
// specs to the email transport being up, which is a separate concern from
// what these tests are proving. #833 (fixed) means NotificationService.sendEmail
// can now actually send on this stack -- it selects a real SMTP transport
// against the smtp-test (Mailpit) container when SMTP_HOST is set, rather
// than being Resend-only against a deliberately-dummy RESEND_API_KEY -- and
// participant-e-consent-page.spec.ts has one un-fixme'd test that exercises
// the real endpoint end to end. Everything about the *page* is still
// exercised through this helper instead, to keep those tests independent of
// the email transport.
//
// Written with node:crypto rather than `jsonwebtoken` on purpose: that package
// is not a repo-root dependency, and this repo has twice had to clean up root
// devDependencies nothing referenced (#764, #783). HS256 is a 3-line
// construction; adding a dependency for it is not worth the drift.

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Matches compose.test.yml's x-test-env. Deliberately a throwaway; never a
// real secret, same convention as every other value in that block.
function consentSecret(): string {
  return process.env.E2E_CONSENT_SECRET || 'vitest-consent-secret-key';
}

function signHs256(claims: Record<string, unknown>, ttlSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ ...claims, iat: issuedAt, exp: issuedAt + ttlSeconds }));

  const signature = base64url(
    crypto.createHmac('sha256', consentSecret()).update(`${header}.${payload}`).digest()
  );

  return `${header}.${payload}.${signature}`;
}

/**
 * @param participantId the 8-digit id the route puts in the payload
 * @param ttlSeconds    defaults to the route's own CONSENT_EXPIRATION (2h)
 */
export function mintConsentToken(participantId: string, ttlSeconds = 60 * 60 * 2): string {
  return signHs256({ participantId }, ttlSeconds);
}

/**
 * #1173: the FHIR-import consent token, as buildImportConsentToken
 * (fhir-import-staging.service.js) signs it -- same secret, its own scope,
 * and the staging coordinates validateImportConsentToken looks up.
 */
export function mintImportConsentToken(
  claims: { batchId: string; recordId: string; participantId: string },
  ttlSeconds = 60 * 60 * 2
): string {
  return signHs256({ scope: 'fhir-import-consent', ...claims }, ttlSeconds);
}

/** The path the emailed link points at, relative to the frontend origin. */
export function consentLinkPath(participantId: string): string {
  return `/patient/e-consent/${mintConsentToken(participantId)}`;
}
