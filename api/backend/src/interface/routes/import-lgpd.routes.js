const express = require('express');
const router = express.Router();
const importLGPDController = require('../../controllers/import-lgpd.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

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

// Leitura de lote em quarentena (#794, RNF011 AC#4)
// Mesma permissao que a importacao que produz o lote -- quem pode importar
// amostras pode revisar as linhas que a importacao rejeitou. Nao introduz
// permissao nova de proposito: uma permissao nova nao chega a uma stack ja
// semeada sem re-seed explicito do catalogo RBAC.
// Listagem de lotes em quarentena (#794 item 2) -- mesma permissao que a
// leitura de um lote. E o unico ponto de entrada navegavel: `stagingBatchId`
// volta na resposta da importacao, mas nenhuma tela chama a importacao LGPD
// (#808), entao ninguem chega a um lote so pelo id.
router.get('/batches',
  authenticate,
  requirePermission('createSample'),
  requireOrganizationScope,
  importLGPDController.listQuarantineBatches.bind(importLGPDController)
);

router.get('/batches/:batchId',
  authenticate,
  requirePermission('createSample'),
  requireOrganizationScope,
  importLGPDController.getQuarantineBatch.bind(importLGPDController)
);

// Download de templates - Pacientes CSV (#815: the fourth combination, missing
// until now -- the frontend client built this URL for a route that never
// existed, and only escaped notice because nothing called it.)
router.get('/pacientes/template/csv',
  authenticate,
  requirePermission('createPatient'),
  importLGPDController.downloadPatientTemplateCSV.bind(importLGPDController)
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

