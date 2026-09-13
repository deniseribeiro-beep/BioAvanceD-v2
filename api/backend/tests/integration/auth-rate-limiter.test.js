/**
 * #350: authLimiter's budget (10 req/min) is shared per-IP across the
 * whole /api/auth surface. The real Docker dev stack (compose.yml +
 * compose.dev.yml) applies this limiter — only NODE_ENV=test skips it —
 * so a Playwright spec file doing >10 real logins/2FA calls within a
 * minute (auth-access-security.spec.ts, run as a full file) reliably
 * 429s partway through, even though every individual test is correct in
 * isolation.
 *
 * #359 / RNF008.6: the relaxed budget must not be inferred from
 * NODE_ENV/isDev alone (a generic environment indicator every
 * non-production run shares, including a staging deploy that just left
 * NODE_ENV unset) — it requires the explicit, isolated
 * AUTH_RATE_LIMIT_RELAXED opt-in that only compose.dev.yml's
 * .env.docker sets, and never applies in production even if set.
 *
 * These tests load app.js fresh per env combination so each gets its own
 * rateLimit store (module cache is reset by vitest's `isolate: true` +
 * `pool: forks` between files, but not within one file's `describe`
 * blocks without an explicit cache clear).
 */
import { describe, it, expect, afterEach } from 'vitest';
const request = require('supertest');

const appPath = require.resolve('../../app');
const envPath = require.resolve('../../src/config/env');

function loadAppWithEnv(nodeEnv, { relaxed = false } = {}) {
  delete require.cache[appPath];
  delete require.cache[envPath];
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
  if (relaxed) {
    process.env.AUTH_RATE_LIMIT_RELAXED = 'true';
  } else {
    delete process.env.AUTH_RATE_LIMIT_RELAXED;
  }
  const app = require('../../app');
  app.locals.db = { collection: () => ({ findOne: () => Promise.resolve(null) }) };
  return app;
}

afterEach(() => {
  delete require.cache[appPath];
  delete require.cache[envPath];
  delete process.env.AUTH_RATE_LIMIT_RELAXED;
});

async function postLoginAttempts(app, count) {
  const responses = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    responses.push(await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' }));
  }
  return responses;
}

describe('#359: authLimiter budget requires the explicit AUTH_RATE_LIMIT_RELAXED opt-in', () => {
  // #1038: this test measured at 3966ms of the default 5000ms budget (79%)
  // on an idle machine, and timed out under scheduling pressure in a full
  // 458-file regression run. The duration is INHERENT to what the test
  // proves: exhausting the strict (non-relaxed) budget requires actually
  // firing enough real requests to exceed it, so this is real work, not a
  // sleep to optimise away. 15000ms leaves generous headroom over the
  // measured cost and matches this repo's convention for slow tests
  // (see tests/unit/iot.controller.test.js).
  it('stays strict under NODE_ENV=development alone, with no explicit opt-in set', async () => {
    const app = loadAppWithEnv('development', { relaxed: false });

    const responses = await postLoginAttempts(app, 12);

    const rateLimited = responses.filter((res) => res.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  }, 15000);

  it('allows more than 10 /api/auth requests/min when the explicit opt-in is set (real Docker dev stack)', async () => {
    const app = loadAppWithEnv('development', { relaxed: true });

    const responses = await postLoginAttempts(app, 15);

    const rateLimited = responses.filter((res) => res.status === 429);
    expect(rateLimited).toHaveLength(0);
  });

  it('stays strict in production even if the opt-in is set', async () => {
    const app = loadAppWithEnv('production', { relaxed: true });

    const responses = await postLoginAttempts(app, 12);

    const rateLimited = responses.filter((res) => res.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
