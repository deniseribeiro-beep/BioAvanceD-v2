const express = require('express');
const router = express.Router();
const temperatureController = require('../../controllers/temperature.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

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
router.get('/history',
  authenticate,
  requirePermission('viewTemperature'),
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
  temperatureController.getAll.bind(temperatureController)
);

// Buscar leitura por ID
router.get('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  temperatureController.getById.bind(temperatureController)
);

// Visualizar controle de temperatura
router.get('/control',
  authenticate,
  requirePermission('viewTemperature'),
  temperatureController.getControl.bind(temperatureController)
);

module.exports = router;

