// #1054: shared credential gate for the routes a MACHINE calls -- an IoT
// sensor or a gateway posting telemetry -- as opposed to a route a human's
// session reaches.
//
// The problem it closes: `POST /api/temperature/system/reading` was mounted
// with no middleware at all. Its comment said "sem autenticação de usuário",
// which is a coherent intention for a machine caller -- but the usual second
// half was missing. Machine callers are normally authenticated by something
// other than a session, and there was nothing else. An anonymous caller could
// write into the RF009 cold-chain record, choose the organizationId and
// sensorId the reading was attributed to, and -- because temperature.controller
// guards its audit block on `if (req.user)` -- do it with no audit row at all.
//
// This is deliberately NOT utils/testSupportGate.js, and the difference is the
// whole reason a second file exists: that gate's `testSupportRoutesEnabled()`
// requires `NODE_ENV !== 'production'` by design, so it refuses to register in
// production. A telemetry ingest path has to work in production. What carries
// over is its per-request property, which #675 stated and hardened:
//
//   requireTestSupportSecret fails closed if TEST_SUPPORT_SECRET isn't
//   configured, since an unset secret must never be treated as
//   "no auth required".
//
// That is the property that matters here too, and it is why an unconfigured
// TELEMETRY_INGEST_SECRET closes the route rather than opening it. A stack that
// has not configured machine ingest does not have an anonymous write endpoint;
// it has no machine ingest.
//
// Read from `process.env` rather than `config/env.js`, matching
// testSupportGate.js exactly -- neither TEST_SUPPORT_SECRET nor
// ENABLE_TEST_SUPPORT_ROUTES is declared there either. Declaring it would put
// it under env-declarations.arch.test.js's declared-key-must-have-a-reader
// rule for no gain, and would make this gate the odd one out among the
// request-time secrets.
//
// The comparison is a plain `!==`, the same as testSupportGate.js's. A
// constant-time compare would be defensible here, and this file is the more
// exposed of the two -- but making ONE of two sibling secret checks
// timing-hardened without the other is precisely the undocumented divergence
// that later reads as a mistake in whichever direction the next reader
// approaches it from. If it is worth doing it is worth doing to both, as one
// decision; that is filed rather than settled here.
function machineIngestEnabled() {
  return Boolean(String(process.env.TELEMETRY_INGEST_SECRET || '').trim());
}

function requireMachineIngestSecret(req, res, next) {
  const expected = process.env.TELEMETRY_INGEST_SECRET;
  const provided = req.get('x-telemetry-ingest-secret');
  if (!expected || provided !== expected) {
    return res.status(403).json({
      success: false,
      error: 'Não autorizado',
      message: 'Esta rota exige uma credencial de máquina (x-telemetry-ingest-secret).'
    });
  }
  return next();
}

module.exports = { machineIngestEnabled, requireMachineIngestSecret };
