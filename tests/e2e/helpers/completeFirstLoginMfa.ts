import { APIRequestContext } from '@playwright/test';
import { computeTotp } from './totp';
import { RealAuthSession } from './realAuth';

/**
 * Completes RF001's mandatory first-login MFA setup
 * (`POST /api/auth/two-factor/qr-first-login` →
 * `POST /api/auth/two-factor/enable-first-login`, see
 * `authService.setupMFAFirstLogin`/`enableMFAFirstLogin`) for a freshly
 * registered non-admin fixture user, and returns the real,
 * backend-issued session that only exists once MFA is enabled — the
 * setup-only `tempToken` a plain login returns until then cannot access
 * any RBAC-gated route (see #293).
 */
export async function completeFirstLoginMfa(
  request: APIRequestContext,
  apiBaseURL: string,
  username: string,
  password: string
): Promise<RealAuthSession> {
  const qrResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, {
    data: { username, password },
  });
  if (!qrResponse.ok()) {
    throw new Error(`completeFirstLoginMfa: qr-first-login failed (${qrResponse.status()}): ${await qrResponse.text()}`);
  }
  const qrBody = await qrResponse.json();
  const secret = qrBody?.data?.secret;
  if (!secret) {
    throw new Error(`completeFirstLoginMfa: qr-first-login response missing secret: ${JSON.stringify(qrBody)}`);
  }

  const code = computeTotp(secret);
  const enableResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
    data: { username, password, code },
  });
  if (!enableResponse.ok()) {
    throw new Error(
      `completeFirstLoginMfa: enable-first-login failed (${enableResponse.status()}): ${await enableResponse.text()}`
    );
  }
  const enableBody = await enableResponse.json();
  const token = enableBody?.data?.token;
  const user = enableBody?.data?.user;
  if (!token || !user) {
    throw new Error(`completeFirstLoginMfa: enable-first-login response missing token/user: ${JSON.stringify(enableBody)}`);
  }

  return { token, user };
}
