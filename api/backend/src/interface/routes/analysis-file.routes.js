const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const uploadController = require('../../controllers/upload.controller');
const analysisValidationService = require('../../services/analysisValidation.service');
const logger = require('../../utils/logger');

// Validar elegibilidade da amostra (verificar se existe e se paciente tem consentimento)
router.get(
  '/validate/:sampleIdentifier',
  authenticate,
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      const { sampleIdentifier } = req.params;
      const validation = await analysisValidationService.validateUploadEligibility(db, sampleIdentifier);

      if (!validation.success) {
        return res.status(validation.patientStatus === 'PENDING_CONSENT' ? 409 : 404).json({
          success: false,
          error: validation.error,
          code: validation.patientStatus ? 'CONSENT_PENDING' : 'SAMPLE_NOT_FOUND'
        });
      }

      return res.json({
        success: true,
        eligible: true,
        sample: validation.sample,
        patient: validation.patient
      });
    } catch (error) {
      logger.error('Erro ao validar elegibilidade:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao validar elegibilidade da amostra'
      });
    }
  }
);

// Upload do arquivo de análise
router.post(
  '/upload',
  authenticate,
  uploadController.uploadMiddleware(),
  (req, res) => uploadController.uploadAnalysisFile(req, res)
);

module.exports = router;
