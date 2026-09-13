import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// #1097: eConsent.js read CONSENT_SECRET at MODULE SCOPE and threw there when
// it was missing. Because server.js:3 does `require("./app")` and app.js
// mounts this router, that throw landed BEFORE server.js:40 installs the
// #1040 uncaughtException handler and before startServer()'s
// critical-variable guards ever ran -- so a missing secret killed the backend
// with a bare Node loader stack trace, unattributed, and masked every other
// boot guard (#972's USER_ANON_SALT, #1085's encryption posture) by firing
// first.
//
// The refusal is right; the SHAPE was wrong. The remedy is the one
// `bioavanced-v2-conventions` already names for this exact class -- lazy
// initialization in the module plus a loud, logged boot check -- and the
// repo already had the pattern: fhir-import-staging.service.js's
// getConsentSecret() reads and validates at call time.
//
// Every test file that touches this router currently sets CONSENT_SECRET at
// module scope before importing it. That is not belt-and-braces; it was
// mandatory, and it is the symptom this file pins.
describe('#1097: eConsent.js does not throw at module load without CONSENT_SECRET', () => {
  const ROUTER = require.resolve('../../src/routes/eConsent.js');
  let originalSecret;

  beforeEach(() => {
    originalSecret = process.env.CONSENT_SECRET;
    delete require.cache[ROUTER];
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalSecret;
    delete require.cache[ROUTER];
  });

  it('requires cleanly with CONSENT_SECRET unset, instead of throwing at import time', () => {
    delete process.env.CONSENT_SECRET;

    expect(() => require(ROUTER)).not.toThrow();
  });

  it('requires cleanly with CONSENT_SECRET set to whitespace only', () => {
    process.env.CONSENT_SECRET = '   ';

    expect(() => require(ROUTER)).not.toThrow();
  });

  it('still exposes a mounted router when the secret is absent', () => {
    delete process.env.CONSENT_SECRET;

    const router = require(ROUTER);

    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  // Control case: unchanged before and after the fix, so a red here is the
  // fixture rather than the behaviour under test (#695).
  it('control: requires cleanly with a real CONSENT_SECRET, as it always did', () => {
    process.env.CONSENT_SECRET = 'um-segredo-de-teste';

    expect(() => require(ROUTER)).not.toThrow();
  });
});

// The refusal itself must survive the move -- lazily, at call time, with the
// same message shape fhir-import-staging.service.js already uses.
describe('#1097: the secret is still REQUIRED, just not at import time', () => {
  const ROUTER = require.resolve('../../src/routes/eConsent.js');
  let originalSecret;

  beforeEach(() => {
    originalSecret = process.env.CONSENT_SECRET;
    delete require.cache[ROUTER];
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CONSENT_SECRET;
    else process.env.CONSENT_SECRET = originalSecret;
    delete require.cache[ROUTER];
  });

  function findLayer(router, method, routePath) {
    return router.stack.find(
      (layer) => layer.route && layer.route.path === routePath && layer.route.methods[method]
    );
  }

  it('refuses to mint a consent link when the secret is missing at request time', async () => {
    delete process.env.CONSENT_SECRET;
    const router = require(ROUTER);

    const layer = findLayer(router, 'post', '/generate-link');
    expect(layer).toBeTruthy();

    // The route's own handler is the LAST entry in its stack (authenticate and
    // requirePermission sit ahead of it); call it directly so no auth fixture
    // is needed to reach the secret read.
    const handlers = layer.route.stack.map((s) => s.handle);
    const handler = handlers[handlers.length - 1];

    const req = {
      body: { participantId: 'p-1', email: 'a@b.com' },
      // The email MUST match: the handler 403s on a mismatch well before it
      // reaches the secret, which would make this test green for the wrong
      // reason (#676 -- read the failure, not just its colour).
      app: {
        locals: {
          db: {
            collection: () => ({
              findOne: async () => ({ _id: 'p-1', participantId: 'p-1', email: 'a@b.com' }),
            }),
          },
        },
      },
      user: { userID: 'u-1' },
    };
    let status = null;
    let payload = null;
    const res = {
      status(code) { status = code; return this; },
      json(body) { payload = body; return this; },
    };

    await handler(req, res, () => {});

    expect(status).toBe(500);
    expect(JSON.stringify(payload)).toMatch(/CONSENT_SECRET/);
  });
});
