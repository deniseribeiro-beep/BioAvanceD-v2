const express = require('express');
const os = require('os');
const router = express.Router();
const env = require('../../config/env');
const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../utils/testSupportGate');

// Test-support only, RF022/RNF031 (#1485): the Foundation job runs once, as
// the stack's one-shot bootstrap, before the API. Running it again on the
// stack's own database to prove a rollback or a failing gate would block the
// API's ReadinessReport and rewrite the newest FoundationDataRun every other
// test reads. Same answer as the reference import route (#1476): a route
// gated by testSupportRoutesEnabled() and requireTestSupportSecret that calls
// the job's own runSeed() on demand, here against a scratch database on the
// same Mongo server, named e2e_foundation_<suffix>, so the stack's database
// is never read or written. The job is required inside the handler, never
// at the top: server startup must not load it.
const SCRATCH_DATABASE = /^e2e_foundation_[a-z0-9_]{1,40}$/;
const MODES = ['dry_run', 'apply', 'validate', 'rollback'];

if (testSupportRoutesEnabled()) {
  router.post('/run', requireTestSupportSecret, async (req, res) => {
    const { database, mode } = req.body || {};
    if (typeof database !== 'string' || !SCRATCH_DATABASE.test(database)) {
      return res.status(400).json({ success: false, error: 'invalid_database' });
    }
    if (typeof mode !== 'string' || !MODES.includes(mode)) {
      return res.status(400).json({ success: false, error: 'invalid_mode' });
    }
    const db = req.app.locals.db;
    if (!db || !db.client || database === db.databaseName) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    const { runSeed, exitCodeFor } = require('../../../scripts/seed-essential-reference-data');
    let result;
    try {
      result = await runSeed({
        db: db.client.db(database),
        args: { mode, list: false, only: null },
        environment: env.NODE_ENV,
        deploymentId: os.hostname(),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error.message || error).slice(0, 300) });
    }

    return res.status(200).json({
      success: true,
      data: { run: result.run, report: result.report, exitCode: exitCodeFor(result) },
    });
  });
}

module.exports = router;
