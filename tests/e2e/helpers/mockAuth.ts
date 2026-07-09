import { Page } from '@playwright/test';

/**
 * Builds an unsigned JWT-shaped token good enough for the frontend's own
 * client-side decode (AuthContext.decodeUserFromToken) — the mocked specs
 * never send this to a real backend, so no valid signature is required.
 */
function buildMockToken(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const header = { alg: 'none', typ: 'JWT' };
  return `${base64url(header)}.${base64url(payload)}.mock-signature`;
}

export interface MockUser {
  id: number;
  username: string;
  name: string;
  email: string;
  accessType: number; // 1=Usuário Externo, 2=Técnico, 3=Coordenador, 4=Administrador
  roleName: string;
}

export const ADMIN_USER: MockUser = {
  id: 1,
  username: 'e2e-admin',
  name: 'E2E Admin',
  email: 'e2e-admin@example.com',
  accessType: 4,
  roleName: 'Administrador',
};

/**
 * Seeds localStorage with a mock auth token before any app script runs, so
 * ProtectedRoute sees an authenticated user on first render without a real
 * backend. Call before page.goto().
 */
export async function mockLogin(page: Page, user: MockUser = ADMIN_USER): Promise<void> {
  const token = buildMockToken(user);

  await page.addInitScript(
    ([tokenValue, userValue]) => {
      window.localStorage.setItem('token', tokenValue as string);
      window.localStorage.setItem('user', userValue as string);
    },
    [token, JSON.stringify(user)]
  );

  // AuthContext calls this on mount; response is swallowed on error so this
  // route is not strictly required, but mocking it avoids console noise and
  // a stale-token race during the test.
  await page.route('**/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user, valid: true } }),
    });
  });
}
