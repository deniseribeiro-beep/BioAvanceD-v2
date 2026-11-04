/**
 * #832 (and the rate-limiting half of #823): six routes on the e-consent
 * router carry no `authenticate` -- the emailed token IS the credential --
 * so they verify a secret on every call with no session behind them. That is
 * authLimiter's shape, and until consentLimiter they had only globalLimiter's
 * shared 1000-per-15-min budget, which is a weak ceiling for walking an
 * 8-digit participantId space (#823) or replaying a leaked consent JWT
 * against the now-writing POST /update (#832).
 *
 * RNF008.6, as established for authLimiter by #359: the relaxed budget is an
 * explicit, isolated opt-in, never inferred from NODE_ENV, and never applied
 * in production. CONSENT_RATE_LIMIT_RELAXED is deliberately a SEPARATE flag
 * from AUTH_RATE_LIMIT_RELAXED -- the fourth test below is what pins that,
 * since reusing the auth flag would pass every other test here.
 *
 * Structure copied from auth-rate-limiter.test.js: app.js is loaded fresh per
 * env combination so each gets its own rateLimit store.
 */
import { describe, it, expect, afterEach } from 'vitest';
const request = require('supertest');

const appPath = require.resolve('../../app');
const envPath = require.resolve('../../src/config/env');

// #1428: warm app.js once at file load. Each loadAppWithEnv still deletes
// require.cache and reloads for env isolation; the first cold graph then
// sits outside any it() timeout budget under full coverage.
require(appPath);

// The unauthenticated token-credential surface, one path per mount in app.js.
// A junk token is enough: the limiter runs before the handler, and every one
// of these answers 4xx for a bad token, so only the 429s are the signal.
const LIMITED = [
  { method: 'get', path: '/api/e-consent/validate/not-a-real-jwt' },
  { method: 'post', path: '/api/e-consent/update' },
  { method: 'post', path: '/api/e-consent/consent-tokens/validate' },
  { method: 'post', path: '/api/e-consent/consent-tokens/accept' },
  { method: 'get', path: '/api/e-consent/import/fhir/consent/not-a-real-token' },
];

function loadAppWithEnv(nodeEnv, { relaxed = false, authRelaxed = false } = {}) {
  delete require.cache[appPath];
  delete require.cache[envPath];
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
  process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'vitest-consent-secret-key';
  if (relaxed) {
    process.env.CONSENT_RATE_LIMIT_RELAXED = 'true';
  } else {
    delete process.env.CONSENT_RATE_LIMIT_RELAXED;
  }
  if (authRelaxed) {
    process.env.AUTH_RATE_LIMIT_RELAXED = 'true';
  } else {
    delete process.env.AUTH_RATE_LIMIT_RELAXED;
  }
  const app = require('../../app');
  app.locals.db = {
    collection: () => ({
      findOne: () => Promise.resolve(null),
      updateOne: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
      createIndex: () => Promise.resolve('idx'),
      find: () => ({
        sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([]) }) }),
        toArray: () => Promise.resolve([]),
      }),
    }),
  };
  return app;
}

afterEach(() => {
  delete require.cache[appPath];
  delete require.cache[envPath];
  delete process.env.CONSENT_RATE_LIMIT_RELAXED;
  delete process.env.AUTH_RATE_LIMIT_RELAXED;
});

async function hammer(app, target, count) {
  const responses = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    responses.push(
      await request(app)[target.method](target.path).send({ patientId: '00000000', token: 'junk' })
    );
  }
  return responses;
}

describe('#832: consentLimiter covers the unauthenticated e-consent token routes', () => {
  // Same inherent cost as auth-rate-limiter.test.js's strict cases: proving a
  // budget is enforced means actually exceeding it. 15000ms matches that file.
  for (const target of LIMITED) {
    it(`429s ${target.method.toUpperCase()} ${target.path} past the strict budget`, async () => {
      const app = loadAppWithEnv('development', { relaxed: false });

      const responses = await hammer(app, target, 12);

      const rateLimited = responses.filter((res) => res.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    }, 15000);
  }

  it('allows the relaxed budget when the explicit opt-in is set (real Docker dev stack)', async () => {
    const app = loadAppWithEnv('development', { relaxed: true });

    const responses = await hammer(app, LIMITED[2], 15);

    expect(responses.filter((res) => res.status === 429)).toHaveLength(0);
  }, 15000);

  it('stays strict in production even if the opt-in is set', async () => {
    const app = loadAppWithEnv('production', { relaxed: true });

    const responses = await hammer(app, LIMITED[2], 12);

    expect(responses.filter((res) => res.status === 429).length).toBeGreaterThan(0);
  }, 15000);

  // The flag-separation pin. Without it, wiring consentLimiter to
  // env.AUTH_RATE_LIMIT_RELAXED would satisfy every test above.
  it('is NOT relaxed by AUTH_RATE_LIMIT_RELAXED -- the flags are separate controls', async () => {
    const app = loadAppWithEnv('development', { relaxed: false, authRelaxed: true });

    const responses = await hammer(app, LIMITED[2], 12);

    expect(responses.filter((res) => res.status === 429).length).toBeGreaterThan(0);
  }, 15000);

  // CONTROL. The authenticated operator surface on the same router must NOT
  // share this budget -- a coordinator doing bulk consent work would 429.
  // 401 (no token) rather than 429 is the pass: the request reached the auth
  // middleware, so no consent limiter stood in front of it.
  it('CONTROL: the authenticated e-consent operator routes are not rate-limited by it', async () => {
    const app = loadAppWithEnv('development', { relaxed: false });

    const responses = [];
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(await request(app).get('/api/e-consent/consent-templates'));
    }

    expect(responses.filter((res) => res.status === 429)).toHaveLength(0);
    expect(responses.every((res) => res.status === 401)).toBe(true);
  }, 15000);
});
