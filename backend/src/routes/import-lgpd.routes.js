const express = require('express');
const router = express.Router();
const importLGPDController = require('../controllers/import-lgpd.controller');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

/**
 * Rotas de Importação LGPD
 * Implementa importação de pacientes e amostras via CSV/Excel
 * com total conformidade com anonimização LGPD
 */

// Importação de pacientes (gera IDs automaticamente)
router.post('/pacientes',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.uploadMiddleware(),
  importLGPDController.importPatients.bind(importLGPDController)
);

// Importação de amostras (valida IDs de pacientes)
router.post('/amostras',
  authenticate,
  requirePermission('createSample'),
  importLGPDController.uploadMiddleware(),
  importLGPDController.importSamples.bind(importLGPDController)
);

// Download de templates - Pacientes Excel
router.get('/pacientes/template/xlsx',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.downloadPatientTemplateExcel.bind(importLGPDController)
);

// Download de templates - Amostras CSV
router.get('/amostras/template/csv',
  authenticate,
  requirePermission('createSample'),
  importLGPDController.downloadSampleTemplateCSV.bind(importLGPDController)
);

// Download de templates - Amostras Excel
router.get('/amostras/template/xlsx',
  authenticate,
  requirePermission('createSample'),
  importLGPDController.downloadSampleTemplateExcel.bind(importLGPDController)
);

module.exports = router;

