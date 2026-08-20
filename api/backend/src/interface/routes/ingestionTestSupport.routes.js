const express = require('express');
const router = express.Router();
const auditLogger = require('../../utils/auditLogger');
const { ingestRecord } = require('../../ingestion/ingestionGateway');
const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../utils/testSupportGate');

// Test-support only, same rationale/shape as iot.routes.js's
// requireTestSupportSecret routes (#307): RF029 slice 1/6 (#669) is the
// ingestion gateway's generic machinery — no entity slice (#670-673) is
// wired to a real route yet, so there is no natural HTTP trigger to prove
// the gateway against a real backend. This route calls the real
// ingestRecord() (real Mongo reads/writes, no faked behavior) on demand,
// purely so pipeline-continuity.spec.ts can exercise it as one of RF029's
// milestone e2e specs (E2E_TRACEABILITY_PLAN.md maps RF029 to that file).
// Registration requires testSupportRoutesEnabled()'s two independent
// signals (#675 hardening -- see utils/testSupportGate.js), on top of the
// per-request requireTestSupportSecret check, so it's never a reachable
// control surface outside a deliberately opted-in environment.
if (testSupportRoutesEnabled()) {
  router.post('/probe', requireTestSupportSecret, async (req, res) => {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    const { entityType, schemaId, aliasMap, payload, provenance, idempotencyKey, references, referenceCodes } = req.body || {};

    try {
      const outcome = await ingestRecord({
        db,
        entityType,
        schemaId: schemaId || null,
        aliasMap: aliasMap || {},
        payload,
        provenance,
        idempotencyKey: idempotencyKey || null,
        references: references || [],
        referenceCodes: referenceCodes || [],
      });

      // AC 8 (#669's own scope note: "needs no new infrastructure"):
      // auditing an ingestion attempt applies regardless of outcome or
      // entity type, so the gateway's own foundation route does it here.
      // Projecting into Neo4j (GraphProjectionService.appendXEvent) is
      // entity-specific — it needs a real created aggregate to reference —
      // so it's each entity slice's own route that adds that call on its
      // own `accepted` path, reusing GraphProjectionService exactly as
      // routes/eConsent.js/etc. already do; this foundation route has no
      // aggregate of its own to project.
      auditLogger.init(db);
      await auditLogger.log({
        action: 'INGESTION_GATEWAY_PROBE',
        resourceType: entityType || 'Unknown',
        resourceId: outcome.quarantineRecord?.ingestionQuarantineRecordId || null,
        status: outcome.status === 'quarantined' ? 'warning' : 'success',
        severity: outcome.status === 'quarantined' ? 'warning' : 'info',
        message: `Ingestion gateway probe: ${outcome.status}`,
        payload: { entityType, status: outcome.status, violationCount: outcome.violations?.length || 0 },
        req,
        module: 'Importação',
      });

      return res.status(200).json({ success: true, ...outcome });
    } catch (error) {
      return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || String(error) });
    }
  });
}

module.exports = router;
