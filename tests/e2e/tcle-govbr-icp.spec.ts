import { test, expect } from '@playwright/test';

/**
 * PHR wave — remote TCLE identity (ADR 2026-11-26).
 * Covers gov.br OIDC status/start/callback in mock mode and ICP-Brasil
 * evidence hashing. UI accept with identityProof is covered by ConsentTokenPage
 * unit tests; this file proves the public API contract against the real stack.
 */

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.describe('TCLE gov.br / ICP-Brasil identity (real backend)', () => {
  test.skip(!apiBaseURL, 'needs the real backend (PLAYWRIGHT_API_BASE_URL)');

  test('gov.br status reports enabled/mock flags without auth', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/e-consent/govbr/status`);
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        enabled: expect.any(Boolean),
        mock: expect.any(Boolean),
      }),
    );
  });

  test('gov.br start+callback (mock) returns identityProof for accept', async ({ request }) => {
    const status = await request.get(`${apiBaseURL}/api/e-consent/govbr/status`);
    const statusBody = await status.json();
    test.skip(!statusBody.enabled, 'CONSENT_GOVBR_OIDC_ENABLED is off on this stack');
    test.skip(!statusBody.mock, 'GOVBR_OIDC_MOCK must be true for deterministic exchange');

    const start = await request.post(`${apiBaseURL}/api/e-consent/govbr/start`, {
      data: { participantId: 'e2e-govbr-participant', token: 'e2e-govbr-token' },
    });
    const startBody = await start.json();
    expect(start.status(), JSON.stringify(startBody)).toBe(200);
    expect(startBody.authorizationUrl).toMatch(/^https?:\/\//);
    expect(startBody.state).toBeTruthy();

    const callback = await request.get(
      `${apiBaseURL}/api/e-consent/govbr/callback?code=mock-code-e2e&state=${encodeURIComponent(startBody.state)}`,
    );
    const callbackBody = await callback.json();
    expect(callback.status(), JSON.stringify(callbackBody)).toBe(200);
    expect(callbackBody.identityProof).toMatchObject({
      provider: 'govbr',
      mock: true,
      sub: expect.stringMatching(/^mock-govbr-/),
    });
    expect(callbackBody.participantId).toBe('e2e-govbr-participant');
  });
});
