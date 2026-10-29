const express = require('express');
const router = express.Router();
const iotController = require('../../controllers/iot.controller');
const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../utils/testSupportGate');
const { requireMachineIngestSecret } = require('../../utils/machineIngestGate');

// #1063: this was the SECOND unauthenticated machine-ingest route in the repo.
// #1054 fixed POST /api/temperature/system/reading and described it as "the only
// route in the file with no middleware at all" -- true of that file, false of the
// system, and this one was the other half.
//
// What makes it pointed rather than merely missed: the fail-closed shared-secret
// pattern it needed was already applied a few lines below, to the *test-support*
// routes in this same router. The diagnostic endpoints were better protected than
// the one that writes production telemetry into InfluxDB and fires excursion
// alerts off it.
//
// Same gate as #1054's, and deliberately not testSupportGate's: that one requires
// NODE_ENV !== 'production' by design and so refuses to register in production,
// which is exactly what a telemetry ingest path cannot do. See
// utils/machineIngestGate.js. Fails closed when TELEMETRY_INGEST_SECRET is unset.
router.post('/telemetry', requireMachineIngestSecret, iotController.ingestTelemetry);

// Test-support only: TelemetryMonitor's cron defaults to a 5-minute
// interval (TELEMETRY_MONITOR_CRON), too slow for e2e assertions to wait
// on. This runs the real checkMissingReadings() (real Influx query, real
// Mongo writes) synchronously on demand instead of faking any of its
// behavior — same real-backend bar as the rest of this route, just
// deterministically triggered. Gated out of production so it's never a
// reachable control surface there.
//
// Deliberately calls checkMissingReadings() directly, not the full
// runCycle(), which also runs the critical-freezer query and appends
// compromise events; this route proves the missing-reading check alone.
// (runCycle() used to open a Neo4j driver and re-pay a ~60s connect
// backoff whenever it was down; since #1312 it reaches the graph only
// through the outbox.)
// Defense in depth for the test-support routes below (#307, hardened by
// #675): registration itself requires testSupportRoutesEnabled()'s two
// independent signals (not production AND explicitly opted in), and each
// request additionally requires the shared secret via header --
// requireTestSupportSecret fails closed if TEST_SUPPORT_SECRET isn't
// configured, since an unset secret must never be treated as "no auth
// required". See utils/testSupportGate.js for the shared implementation.
if (testSupportRoutesEnabled()) {
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
  // never touches the graph (only propagateCompromise, called from
  // runCycle, appends to the outbox).
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

  // Test-support only, #304: proves propagateCompromise() end-to-end (since
  // #1312 an outbox append the projection worker applies to Neo4j, so a
  // caller polls the graph) — unlike find-critical-freezers above, this
  // deliberately DOES go through the full runCycle() (findCriticalFreezers
  // -> propagateCompromise), since propagateCompromise is exactly what
  // this route exists to exercise. Accepts the same threshold overrides so
  // a handful of one-minute-apart points can prove a sustained breach fast.
  router.post('/telemetry-monitor/run-cycle-full', requireTestSupportSecret, async (req, res) => {
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
      await telemetryMonitor.runCycle();
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    } finally {
      Object.assign(telemetryMonitor, previousValues);
    }
  });
}

module.exports = router;