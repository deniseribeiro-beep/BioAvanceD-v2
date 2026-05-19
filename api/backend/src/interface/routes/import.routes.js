const express = require('express');
const router = express.Router();
const importController = require('../../controllers/import.controller');
const importAsyncController = require('../../controllers/import-async.controller');
const importBatchController = require('../../controllers/import-batch.controller');
const fhirImportStagingController = require('../../controllers/fhir-import-staging.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

// RF007 - Upload e Importação de Dados
// Requer autenticação e permissão de upload

// ============================================
// ENDPOINTS ASSÍNCRONOS (NOVOS - CONFORME AUDITORIA)
// ============================================

// Batch import staging (nova camada ETL)
router.post('/batch',
  authenticate,
  requirePermission('uploadFiles'),
  importBatchController.uploadMiddleware(),
  importBatchController.createBatchImport.bind(importBatchController)
);

router.get('/batch/:jobId',
  authenticate,
  requirePermission('uploadFiles'),
  importBatchController.getBatchImportStatus.bind(importBatchController)
);

router.get('/status/:jobId',
  authenticate,
  requirePermission('uploadFiles'),
  importBatchController.getBatchImportStatus.bind(importBatchController)
);

router.post('/fhir/stage',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.uploadMiddleware(),
  fhirImportStagingController.stage.bind(fhirImportStagingController)
);

router.get('/fhir/batches/:id',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.getBatch.bind(fhirImportStagingController)
);

router.post('/fhir/batches/:id/validate',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.validate.bind(fhirImportStagingController)
);

router.post('/fhir/batches/:id/send-consents',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.sendConsents.bind(fhirImportStagingController)
);

router.get('/fhir/batches/:id/consent-status',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.consentStatus.bind(fhirImportStagingController)
);

router.post('/fhir/batches/:id/commit',
  authenticate,
  requirePermission('uploadFiles'),
  fhirImportStagingController.commit.bind(fhirImportStagingController)
);

// Validação separada (endpoint de validação)
router.post('/validate',
  authenticate,
  requirePermission('uploadFiles'),
  importAsyncController.uploadMiddleware(),
  importAsyncController.validate.bind(importAsyncController)
);

// Criação de job de importação (endpoint de processamento)
router.post('/import',
  authenticate,
  requirePermission('uploadFiles'),
  importAsyncController.uploadMiddleware(),
  importAsyncController.createImportJob.bind(importAsyncController)
);

router.post('/import/samples',
  authenticate,
  requirePermission('uploadFiles'),
  importAsyncController.uploadMiddleware(),
  importAsyncController.createSampleImportJob.bind(importAsyncController)
);

// Endpoints de jobs de importação
router.get('/jobs',
  authenticate,
  importAsyncController.listJobs.bind(importAsyncController)
);

router.get('/job/:jobID',
  authenticate,
  importAsyncController.getJobStatus.bind(importAsyncController)
);

router.post('/job/:jobID/cancel',
  authenticate,
  importAsyncController.cancelJob.bind(importAsyncController)
);

router.get('/job/:jobID/report',
  authenticate,
  importAsyncController.getJobReport.bind(importAsyncController)
);

// ============================================
// ENDPOINTS SÍNCRONOS (MANTIDOS PARA COMPATIBILIDADE)
// ============================================

// Compatível com frontend (mantido para compatibilidade)
router.post('/upload',
  authenticate,
  requirePermission('uploadFiles'),
  importController.uploadMiddleware(),
  importController.import.bind(importController)
);


// Importação FHIR direta (JSON) com autenticação e autorização
const { importFhirBundle } = require('../../controllers/import.controller');
router.post('/fhir',
  authenticate,
  requirePermission('uploadFiles'),
  importFhirBundle
);

module.exports = router;

