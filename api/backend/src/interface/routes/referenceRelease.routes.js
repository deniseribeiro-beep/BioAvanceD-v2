const express = require('express');
const router = express.Router();
const referenceReleaseController = require('../../controllers/referenceRelease.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');

// RF028 AC8/AC9 (#1319): explicit promotion and rollback of a reference
// release. RF028's primary actor is the Administrador, the same requireRole(4)
// gate retentionPolicy.js puts on the Administrador's policy routes.
router.post('/:id/promote', authenticate, requireRole(4), referenceReleaseController.promote.bind(referenceReleaseController));
router.post('/datasets/:datasetCode/rollback', authenticate, requireRole(4), referenceReleaseController.rollback.bind(referenceReleaseController));

module.exports = router;
