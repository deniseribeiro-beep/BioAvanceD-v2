const express = require('express');
const router = express.Router();
const importController = require('../../controllers/import.controller');
const importAsyncController = require('../../controllers/import-async.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

// RF007 - Upload e Importação de Dados
// Requer autenticação e permissão de upload

// ============================================
// ENDPOINTS ASSÍNCRONOS (NOVOS - CONFORME AUDITORIA)
// ============================================

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

module.exports = router;

