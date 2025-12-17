const express = require('express');
const router = express.Router();

const auditController = require('../controllers/audit.controller');

const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

// ============================================================
// GET /api/audit/merkle-root/:date
// Gera Merkle Root do dia (não persiste)
// ============================================================
router.get(
  '/merkle-root/:date',
  authenticate,
  requirePermission('viewReports'),
  auditController.getMerkleRoot.bind(auditController)
);

// ============================================================
// POST /api/audit/verify
// Verifica se um auditHash pertence ao Merkle Tree do dia
// ============================================================
router.post(
  '/verify',
  authenticate,
  requirePermission('viewReports'),
  auditController.verifyAudit.bind(auditController)
);

// ============================================================
// GET /api/audit/report/:date
// Retorna root persistida, recalculada, proof, leafCount, previousRootHash
// ============================================================
router.get(
  '/report/:date',
  authenticate,
  requirePermission('viewReports'),
  auditController.report.bind(auditController)
);

// ============================================================
// GET /api/audit/compare/:date
// Compara root persistida vs recalculada
// ============================================================
router.get(
  '/compare/:date',
  authenticate,
  requirePermission('viewReports'),
  auditController.compare.bind(auditController)
);

// ============================================================
// GET /api/audit/hl7/:date
// HL7/FHIR hashes and merkle
// ============================================================
router.get(
  '/hl7/:date',
  authenticate,
  requirePermission('viewReports'),
  auditController.hl7Report.bind(auditController)
);

// ============================================================
// Dashboard routes
// ============================================================
router.get(
  '/dashboard/dates',
  authenticate,
  requirePermission('viewReports'),
  auditController.dashboardDates.bind(auditController)
);

router.get(
  '/dashboard/stats/:date',
  authenticate,
  requirePermission('viewReports'),
  auditController.dashboardStats.bind(auditController)
);

router.get(
  '/dashboard/roots',
  authenticate,
  requirePermission('viewReports'),
  auditController.dashboardRoots.bind(auditController)
);

module.exports = router;
