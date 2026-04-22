const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const analysisTypeController = require('../../controllers/analysis-type.controller');

router.get('/', authenticate, analysisTypeController.getAnalysisTypes);
router.post('/', authenticate, requireRole(4), analysisTypeController.createAnalysisType);

module.exports = router;
