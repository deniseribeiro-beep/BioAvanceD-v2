import type { Page, Route } from '@playwright/test';

type MockUser = {
  id: string;
  userID: string;
  accessType: number;
  roleName: string;
  name: string;
  username: string;
  email: string;
};

const DEFAULT_ADMIN_USER: MockUser = {
  id: '507f1f77bcf86cd799439011',
  userID: '507f1f77bcf86cd799439011',
  accessType: 4,
  roleName: 'Administrador',
  name: 'QA Admin',
  username: 'admin',
  email: 'admin@bioavanced.com.br',
};

export function createMockJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

export function createAdminAuthContext(overrides: Partial<MockUser> = {}) {
  const user = { ...DEFAULT_ADMIN_USER, ...overrides };
  return {
    token: createMockJwt(user),
    user,
  };
}

export async function injectSessionToken(page: Page, token: string) {
  await page.addInitScript((sessionToken) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('token', sessionToken);
  }, token);
}

export async function mockAuthVerifyKeepalive(page: Page, user: MockUser = DEFAULT_ADMIN_USER) {
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/verify') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            valid: true,
            user,
          },
        }),
      });
      return;
    }

    if (url.includes('/auth/keepalive') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { valid: true } }),
      });
      return;
    }

    await route.fallback();
  });
}
