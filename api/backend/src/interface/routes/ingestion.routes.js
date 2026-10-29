const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const auditLogger = require('../../utils/auditLogger');
const rbacAssignment = require('../../services/rbac-assignment.service');
const { ingestAndPersist } = require('../../ingestion/productionIngestion');

// RF029 (#1318): the production ingestion route. ingestionTestSupport.routes.js
// stays the test-support probe of the bare gateway; this route persists an
// accepted record with its outbox event (productionIngestion.js) and audits
// every outcome, the refusals included (RF029 AC10).
const router = express.Router();
router.use(authenticate);

const AUDIT = {
  accepted: { action: 'INGESTION_ACCEPTED', severity: 'info', status: 'success' },
  quarantined: { action: 'INGESTION_QUARANTINED', severity: 'warning', status: 'warning' },
  idempotent_replay: { action: 'INGESTION_REPLAYED', severity: 'info', status: 'success' },
  quarantine_replay: { action: 'INGESTION_REPLAYED', severity: 'warning', status: 'warning' },
  refused: { action: 'INGESTION_REFUSED', severity: 'warning', status: 'warning' },
  failed: { action: 'INGESTION_REFUSED', severity: 'error', status: 'error' },
};

async function auditOutcome(req, db, kind, { entityType, resourceId = null, violationCount = 0, canonicalModelReleaseId = null, configurationReleaseId = null, purpose = null, outcome = undefined, message }) {
  const entry = AUDIT[kind];
  const status = kind === 'quarantine_replay' ? 'idempotent_replay' : kind;
  auditLogger.init(db);
  await auditLogger.log({
    action: entry.action,
    resourceType: entityType || 'Unknown',
    resourceId,
    status: entry.status,
    severity: entry.severity,
    message,
    payload: { entityType, status, ...(outcome !== undefined ? { outcome } : {}), violationCount, canonicalModelReleaseId, configurationReleaseId, purpose },
    req,
    module: 'Importação',
  });
}

// INFERENCE, not a citation: datasets, workflow runs and assays are written
// by roles 3 and 4 on their master-data mounts (app.js), so ingesting one
// takes the same roles. An assay's laboratoryId is held to the caller's
// organization scope, as on its mount (#1182, productionIngestion.js).
router.post('/records', requireRole(3, 4), async (req, res) => {
  const db = req.app.locals.db;
  if (!db) {
    return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
  }

  const { entityType, payload, provenance, idempotencyKey, missingDataReasons } = req.body || {};
  const purpose = typeof provenance?.purpose === 'string' ? provenance.purpose : null;

  let result;
  try {
    result = await ingestAndPersist({
      db,
      entityType,
      payload,
      provenance,
      idempotencyKey: idempotencyKey || null,
      missingDataReasons,
      actorId: req.user?.userID,
      resolveOrganizationScope: () => rbacAssignment.resolveUserOrganizationScope(db, req.user?.userID),
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    const message = error?.message || String(error);
    await auditOutcome(req, db, error?.statusCode ? 'refused' : 'failed', {
      entityType,
      canonicalModelReleaseId: error?.canonicalModelReleaseId || null,
      configurationReleaseId: error?.configurationReleaseId || null,
      purpose,
      message: `Ingestão recusada: ${message}`,
    });
    if (!error?.statusCode) {
      return res.status(500).json({ success: false, error: 'INGESTION_FAILED', message, details: [message] });
    }
    return res.status(statusCode).json({
      success: false,
      error: error.code,
      message,
      details: Array.isArray(error.details) ? error.details : [message],
    });
  }

  const releases = {
    canonicalModelReleaseId: result.canonicalModelReleaseId || null,
    configurationReleaseId: result.configurationReleaseId || null,
  };

  if (result.status === 'quarantined') {
    const message = 'Registro em quarentena: violações de ingestão';
    await auditOutcome(req, db, 'quarantined', {
      entityType,
      resourceId: result.ingestionQuarantineRecordId,
      violationCount: result.violations.length,
      ...releases,
      purpose,
      message,
    });
    return res.status(422).json({
      success: false,
      error: 'INGESTION_QUARANTINED',
      message,
      details: result.violations.map((v) => v.message),
      ingestionQuarantineRecordId: result.ingestionQuarantineRecordId,
      dataQualityAssessmentId: result.dataQualityAssessmentId,
    });
  }

  // A replay of a quarantined key answers as the first call did.
  if (result.status === 'idempotent_replay' && result.outcome === 'quarantined') {
    const message = 'Registro em quarentena: violações de ingestão';
    await auditOutcome(req, db, 'quarantine_replay', {
      entityType,
      resourceId: result.ingestionQuarantineRecordId,
      violationCount: result.violations.length,
      ...releases,
      purpose,
      outcome: result.outcome,
      message: 'Ingestão repetida: quarentena anterior devolvida',
    });
    return res.status(422).json({
      success: false,
      error: 'INGESTION_QUARANTINED',
      message,
      details: result.violations.map((v) => v.message),
      ingestionQuarantineRecordId: result.ingestionQuarantineRecordId,
    });
  }

  if (result.status === 'idempotent_replay') {
    await auditOutcome(req, db, 'idempotent_replay', {
      entityType,
      resourceId: result.resultRef,
      ...releases,
      purpose,
      outcome: result.outcome,
      message: 'Ingestão repetida: resultado anterior devolvido',
    });
    return res.status(200).json({ success: true, ...result });
  }

  await auditOutcome(req, db, 'accepted', {
    entityType,
    resourceId: result.entityId,
    ...releases,
    purpose,
    message: 'Ingestão aceita e persistida',
  });
  return res.status(201).json({ success: true, ...result });
});

module.exports = router;
