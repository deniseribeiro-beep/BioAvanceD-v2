const express = require('express');
const router = express.Router();
const env = require('../../config/env');
const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../utils/testSupportGate');

// Test-support only, RF023 AC6 / RNF019 C6 C7 (#1502): the projection
// reconciliation is a command line, and the e2e suite runs where no command
// line reaches the backend. Same answer as the Foundation run route (#1485):
// a route gated by testSupportRoutesEnabled() and requireTestSupportSecret
// that calls the script's own reconcile(). It always runs scoped to the
// samples the caller names, never over the whole shared database, so a
// repair touches no other spec's samples or dead letters. The graph is only
// read here; a repair appends to the outbox. The script is required inside
// the handler, never at the top: server startup must not load it.
const SPECIMEN_ID = /^[a-f0-9]{24}$/;
const MAX_SPECIMEN_IDS = 50;

if (testSupportRoutesEnabled()) {
  router.post('/reconcile', requireTestSupportSecret, async (req, res) => {
    const { specimenIds, repair } = req.body || {};
    if (!Array.isArray(specimenIds) || specimenIds.length < 1 || specimenIds.length > MAX_SPECIMEN_IDS
      || !specimenIds.every((id) => typeof id === 'string' && SPECIMEN_ID.test(id))) {
      return res.status(400).json({ success: false, error: 'invalid_specimen_ids' });
    }
    if (typeof repair !== 'boolean') {
      return res.status(400).json({ success: false, error: 'invalid_repair' });
    }
    const db = req.app.locals.db;
    const driver = req.app.locals.neo4jDriver;
    if (!db || !driver) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    let session;
    let result;
    try {
      session = driver.session({ database: env.NEO4J_DATABASE || 'neo4j', defaultAccessMode: 'READ' });
      const { reconcile } = require('../../../scripts/graph-projection-reconcile');
      result = await reconcile(db, { repair, specimenIds, neo4jSession: session });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error.message || error).slice(0, 300) });
    } finally {
      if (session) await session.close();
    }

    return res.status(200).json({ success: true, data: result });
  });
}

module.exports = router;
