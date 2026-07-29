const express = require('express');
const router = express.Router();
const iotController = require('../../controllers/iot.controller');

router.post('/telemetry', iotController.ingestTelemetry);

// Test-support only: TelemetryMonitor's cron defaults to a 5-minute
// interval (TELEMETRY_MONITOR_CRON), too slow for e2e assertions to wait
// on. This runs the real checkMissingReadings() (real Influx query, real
// Mongo writes) synchronously on demand instead of faking any of its
// behavior — same real-backend bar as the rest of this route, just
// deterministically triggered. Gated out of production so it's never a
// reachable control surface there.
//
// Deliberately calls checkMissingReadings() directly, not the full
// runCycle() — runCycle() also calls getNeo4jDriver(), which retries a
// full ~60s connectNeo4j() backoff chain on every invocation whenever the
// driver isn't already connected (observed against this repo's Neo4j test
// container: a "Graph not found" failure at boot leaves it permanently
// disconnected, so every runCycle() call re-pays that ~60s retry cost —
// unrelated to and far slower than the missing-reading check itself,
// which doesn't touch Neo4j at all).
// Defense in depth for the test-support routes below (#307): the NODE_ENV
// gate is the only thing keeping them unmounted in production, so they also
// require a shared secret via header — fails closed if TEST_SUPPORT_SECRET
// isn't configured, since an unset secret must never be treated as "no auth
// required".
function requireTestSupportSecret(req, res, next) {
  const expected = process.env.TEST_SUPPORT_SECRET;
  const provided = req.get('x-test-support-secret');
  if (!expected || provided !== expected) {
    return res.status(403).json({ success: false, error: 'Não autorizado' });
  }
  next();
}

if (process.env.NODE_ENV !== 'production') {
  router.post('/telemetry-monitor/run-cycle', requireTestSupportSecret, async (req, res) => {
    const telemetryMonitor = req.app.locals.telemetryMonitor;
    if (!telemetryMonitor) {
      return res.status(503).json({ success: false, error: 'telemetryMonitor não inicializado' });
    }
    try {
      await telemetryMonitor.checkMissingReadings();
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  // Test-support only, same rationale as run-cycle above: proves the real
  // findCriticalFreezers() Influx detection deterministically without
  // waiting on the cron interval. Unlike run-cycle, this deliberately does
  // NOT go through the full runCycle() — findCriticalFreezers() itself
  // never touches Neo4j (only propagateCompromise, called from runCycle,
  // does), so this sidesteps the same Neo4j retry cost run-cycle avoids.
  // Accepts optional duration/interval overrides in the body so e2e tests
  // can prove a sustained breach without waiting out the real
  // criticalDurationHours/expectedReadingIntervalMinutes window.
  router.post('/telemetry-monitor/find-critical-freezers', requireTestSupportSecret, async (req, res) => {
    const telemetryMonitor = req.app.locals.telemetryMonitor;
    if (!telemetryMonitor) {
      return res.status(503).json({ success: false, error: 'telemetryMonitor não inicializado' });
    }

    const overridableFields = ['criticalDurationHours', 'lookbackHours', 'expectedReadingIntervalMinutes'];
    const previousValues = {};
    for (const field of overridableFields) {
      if (req.body?.[field] !== undefined) {
        previousValues[field] = telemetryMonitor[field];
        telemetryMonitor[field] = Number(req.body[field]);
      }
    }

    try {
      const criticalFreezers = await telemetryMonitor.findCriticalFreezers();
      return res.status(200).json({ success: true, criticalFreezers });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    } finally {
      Object.assign(telemetryMonitor, previousValues);
    }
  });
}

module.exports = router;