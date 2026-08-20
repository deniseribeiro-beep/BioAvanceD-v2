// #675: shared gate for every test-support-only route (currently
// iot.routes.js's telemetry-monitor routes, #307, and
// ingestionTestSupport.routes.js's ingestion probe route, #669) so a
// future entity slice adding its own "no real HTTP trigger yet" route
// reuses one audited gate instead of a third copy of the same logic.
//
// Registration now requires TWO independent signals, not just
// NODE_ENV !== 'production' (#675's own finding: nothing in this repo
// enforces NODE_ENV=production in a real deployment, so that check alone
// is a single point of failure for keeping this attack surface out of a
// misconfigured environment): NODE_ENV must not be 'production', AND
// ENABLE_TEST_SUPPORT_ROUTES must be explicitly 'true' -- same
// "explicit, isolated opt-in" shape .env.docker.example's
// AUTH_RATE_LIMIT_RELAXED already established (#359) for a different
// controlled-suite-only relaxation. requireTestSupportSecret is the
// per-request runtime check underneath that registration gate --
// unchanged from #307's fail-closed behavior, just deduplicated.
function testSupportRoutesEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_SUPPORT_ROUTES === 'true';
}

function requireTestSupportSecret(req, res, next) {
  const expected = process.env.TEST_SUPPORT_SECRET;
  const provided = req.get('x-test-support-secret');
  if (!expected || provided !== expected) {
    return res.status(403).json({ success: false, error: 'Não autorizado' });
  }
  next();
}

module.exports = { testSupportRoutesEnabled, requireTestSupportSecret };
