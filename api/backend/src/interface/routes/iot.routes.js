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
if (process.env.NODE_ENV !== 'production') {
  router.post('/telemetry-monitor/run-cycle', async (req, res) => {
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
}

module.exports = router;