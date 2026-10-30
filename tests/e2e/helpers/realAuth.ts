import { APIRequestContext, Page } from '@playwright/test';

export interface RealAuthUser {
  _id: string;
  name: string;
  email: string;
  username: string;
  accessType: number;
  roleName: string;
}

export interface RealAuthSession {
  token: string;
  user: RealAuthUser;
}

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

/**
 * Logs in against the real backend (POST /api/auth/login) using
 * TEST_USER/TEST_PASS and returns the real, backend-issued session.
 * Requires PLAYWRIGHT_API_BASE_URL — only meaningful against
 * `npm run test:e2e:docker` / a real backend, never the mocked suite.
 */
export async function realLogin(request: APIRequestContext): Promise<RealAuthSession> {
  if (!apiBaseURL) {
    throw new Error('PLAYWRIGHT_API_BASE_URL not set — realAuth requires the real backend (run via npm run test:e2e:docker)');
  }

  const testUser = process.env.TEST_USER || 'admin';
  const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

  // #1234: one retry on a transport reset (socket hang up / connection reset)
  // before the first HTTP status. The host-side Docker Desktop proxy and the
  // in-container forwarder have each shown a single-request stall or reset at
  // ~1/256; a second POST on a fresh connection settles which side it was
  // without masking a real 4xx/5xx.
  let response;
  let lastTransportError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await request.post(`${apiBaseURL}/api/auth/login`, {
        data: { username: testUser, password: testPass },
      });
      lastTransportError = undefined;
      break;
    } catch (error) {
      lastTransportError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransport =
        /socket hang up|ECONNRESET|ECONNREFUSED|Request context disposed/i.test(message);
      if (!isTransport || attempt === 2) throw error;
      console.error(
        `[e2e-auth] ${new Date().toISOString()} realLogin transport error on attempt ${attempt}, retrying once: ${message}`
      );
    }
  }
  if (!response) {
    throw lastTransportError instanceof Error
      ? lastTransportError
      : new Error(`realAuth: login transport failed: ${String(lastTransportError)}`);
  }

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`realAuth: login failed (${response.status()}): ${body}`);
  }

  const body = await response.json();
  // Token/user live under data.* (see auth.controller.js login response shape)
  const token = body?.data?.token;
  const user = body?.data?.user;

  if (!token || !user) {
    throw new Error(`realAuth: login response missing token/user: ${JSON.stringify(body)}`);
  }

  return { token, user };
}

/**
 * Seeds localStorage with a real, backend-issued token before any app
 * script runs, so ProtectedRoute sees an authenticated user on first
 * render — mirrors mockAuth.ts's addInitScript mechanism, but the token
 * is real (AuthContext decodes accessType/roleName from its own claims).
 * Call before page.goto().
 */
export async function seedRealAuth(page: Page, session: RealAuthSession): Promise<void> {
  await page.addInitScript(
    ([tokenValue, userValue]) => {
      window.localStorage.setItem('token', tokenValue as string);
      window.localStorage.setItem('user', userValue as string);
    },
    [session.token, JSON.stringify(session.user)]
  );
}

/**
 * Convenience wrapper: real-login via the API, then seed the result into
 * the page. Use as the beforeEach for any spec that needs an authenticated
 * real session but doesn't need to exercise the login form itself.
 */
export async function realAuthLogin(request: APIRequestContext, page: Page): Promise<RealAuthSession> {
  const session = await realLogin(request);
  await seedRealAuth(page, session);
  return session;
}
