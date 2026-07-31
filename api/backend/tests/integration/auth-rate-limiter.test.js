/**
 * #350: authLimiter's budget (10 req/min) is shared per-IP across the
 * whole /api/auth surface. The real Docker dev stack (compose.yml +
 * compose.dev.yml, NODE_ENV=development) applies this limiter — only
 * NODE_ENV=test skips it — so a Playwright spec file doing >10 real
 * logins/2FA calls within a minute (auth-access-security.spec.ts, run as
 * a full file) reliably 429s partway through, even though every
 * individual test is correct in isolation.
 *
 * These tests load app.js fresh per NODE_ENV so each gets its own
 * rateLimit store (module cache is reset by vitest's `isolate: true` +
 * `pool: forks` between files, but not within one file's two `describe`
 * blocks without an explicit cache clear).
 */
import { describe, it, expect, afterEach } from 'vitest';
const request = require('supertest');

const appPath = require.resolve('../../app');
const envPath = require.resolve('../../src/config/env');

function loadAppWithEnv(nodeEnv) {
  delete require.cache[appPath];
  delete require.cache[envPath];
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
  const app = require('../../app');
  app.locals.db = { collection: () => ({ findOne: () => Promise.resolve(null) }) };
  return app;
}

afterEach(() => {
  delete require.cache[appPath];
  delete require.cache[envPath];
});

describe('#350: authLimiter budget in development (real Docker dev stack)', () => {
  it('allows more than 10 /api/auth requests/min so a full real-backend spec file does not 429 mid-run', async () => {
    const app = loadAppWithEnv('development');

    const responses = [];
    for (let i = 0; i < 15; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' }));
    }

    const rateLimited = responses.filter((res) => res.status === 429);
    expect(rateLimited).toHaveLength(0);
  });
});

describe('#350: authLimiter stays strict in production', () => {
  it('still 429s after the 10th /api/auth request/min', async () => {
    const app = loadAppWithEnv('production');

    const responses = [];
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' }));
    }

    const rateLimited = responses.filter((res) => res.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
