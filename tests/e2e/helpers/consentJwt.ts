import crypto from 'node:crypto';

// Mints the HS256 JWT that routes/eConsent.js issues for the participant
// e-consent page, so a spec can reach that page without going through
// POST /api/e-consent/generate-link.
//
// Why not use the real endpoint: it sends an invitation email, and **no email
// can be sent on the test stack at all** -- NotificationService.sendEmail is
// Resend-only against a deliberately-dummy RESEND_API_KEY, and the smtp-test
// (Mailpit) container running beside it is reachable by no backend code path
// (#833). So `generate-link` cannot return 200 there for structural reasons,
// not because of anything a spec does. participant-e-consent-page.spec.ts
// keeps one test.fixme on the real endpoint as the marker for #833; everything
// about the *page* is exercised through this helper instead.
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

/**
 * @param participantId the 8-digit id the route puts in the payload
 * @param ttlSeconds    defaults to the route's own CONSENT_EXPIRATION (2h)
 */
export function mintConsentToken(participantId: string, ttlSeconds = 60 * 60 * 2): string {
  // Matches compose.test.yml's x-test-env. Deliberately a throwaway; never a
  // real secret, same convention as every other value in that block.
  const secret = process.env.E2E_CONSENT_SECRET || 'vitest-consent-secret-key';

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ participantId, iat: issuedAt, exp: issuedAt + ttlSeconds })
  );

  const signature = base64url(
    crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  );

  return `${header}.${payload}.${signature}`;
}

/** The path the emailed link points at, relative to the frontend origin. */
export function consentLinkPath(participantId: string): string {
  return `/patient/e-consent/${mintConsentToken(participantId)}`;
}
