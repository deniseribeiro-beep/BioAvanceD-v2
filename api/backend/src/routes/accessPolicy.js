const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requirePermission } = require('../infrastructure/middleware/rbac');
const accessPolicyController = require('../controllers/accessPolicy.controller');

// RF024 AC2/AC3, POL-001: the AccessPolicy an access request is evaluated
// against. Defining one is the same governance act as deciding a request, so
// it sits behind the same permission as accessRequest.js. A version is never
// updated or deleted: a change is POST /:id/versions.
router.post('/', authenticate, requirePermission('manageAccessRequests'), accessPolicyController.createPolicy.bind(accessPolicyController));
router.post('/:id/versions', authenticate, requirePermission('manageAccessRequests'), accessPolicyController.createVersion.bind(accessPolicyController));
router.get('/:id', authenticate, requirePermission('manageAccessRequests'), accessPolicyController.getVersions.bind(accessPolicyController));
router.get('/', authenticate, requirePermission('manageAccessRequests'), accessPolicyController.getAll.bind(accessPolicyController));

module.exports = router;
