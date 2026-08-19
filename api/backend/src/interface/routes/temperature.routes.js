const express = require('express');
const router = express.Router();
const temperatureController = require('../../controllers/temperature.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

// RF009 - Registro de Temperatura
// Sistema pode registrar automaticamente (sem autenticação)
router.post('/reading',
  authenticate,
  requirePermission('viewTemperature'),
  temperatureController.createReading.bind(temperatureController)
);

// Endpoint para sistema registrar temperatura (sem autenticação de usuário)
router.post('/system/reading',
  temperatureController.createReading.bind(temperatureController)
);

// Visualizar histórico (requer autenticação)
// #636: requireOrganizationScope filters/gates by the caller's own
// organizationId scope -- see temperature.controller.js's getHistory/
// getAll/getControl/getById.
router.get('/history',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  temperatureController.getHistory.bind(temperatureController)
);

// Visualizar alertas (requer autenticação)
router.get('/alerts',
  authenticate,
  requirePermission('viewTemperature'),
  temperatureController.getAlerts.bind(temperatureController)
);

// Listar todas as leituras
router.get('/',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  temperatureController.getAll.bind(temperatureController)
);

// Visualizar controle de temperatura
router.get('/control',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  temperatureController.getControl.bind(temperatureController)
);

// Buscar leitura por ID
router.get('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  temperatureController.getById.bind(temperatureController)
);

module.exports = router;

