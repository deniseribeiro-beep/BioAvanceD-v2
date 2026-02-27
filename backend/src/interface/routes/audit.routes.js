const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const auditController = require('../../controllers/audit.controller');

router.get('/root/:date', authenticate, requirePermission('viewReports'), auditController.getMerkleRoot.bind(auditController));
router.get('/report/:date', authenticate, requirePermission('viewReports'), auditController.report.bind(auditController));
router.get('/compare/:date', authenticate, requirePermission('viewReports'), auditController.compare.bind(auditController));
router.get('/hl7/:date', authenticate, requirePermission('viewReports'), auditController.hl7Report.bind(auditController));
router.get('/dashboard/dates', authenticate, requirePermission('viewReports'), auditController.dashboardDates.bind(auditController));
router.get('/dashboard/stats/:date', authenticate, requirePermission('viewReports'), auditController.dashboardStats.bind(auditController));
router.get('/dashboard/roots', authenticate, requirePermission('viewReports'), auditController.dashboardRoots.bind(auditController));
router.post('/verify', authenticate, requirePermission('viewReports'), auditController.verifyAudit.bind(auditController));

module.exports = router;
