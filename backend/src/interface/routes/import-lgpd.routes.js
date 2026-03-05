const express = require('express');
const router = express.Router();
const importLGPDController = require('../../controllers/import-lgpd.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

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

router.post('/pacientes/predict-mapping',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.uploadMiddleware(),
  importLGPDController.predictPatientsMapping.bind(importLGPDController)
);

router.post('/pacientes/smart-import',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.uploadMiddleware(),
  importLGPDController.importPatientsSmart.bind(importLGPDController)
);

router.get('/pacientes/smart-import/reports',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.listSmartImportReports.bind(importLGPDController)
);

router.get('/pacientes/smart-import/metadata',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.getPatientsSmartImportMetadata.bind(importLGPDController)
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

