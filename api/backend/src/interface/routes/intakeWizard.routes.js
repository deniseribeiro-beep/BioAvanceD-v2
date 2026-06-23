// backend/src/interface/routes/intakeWizard.routes.js
const express = require('express');
const intakeWizardRouter = require('../../../src/routes/intakeWizard');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

const router = express.Router();

router.use(authenticate, requirePermission('createSample'), intakeWizardRouter);

module.exports = router;
