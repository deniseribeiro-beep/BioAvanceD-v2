const express = require('express');
const router = express.Router();
const sensorController = require('../../controllers/sensor.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

// RF009 - Gerenciamento de Sensores
router.post('/',
  authenticate,
  requirePermission('viewTemperature'),
  sensorController.create.bind(sensorController)
);

// #634: requireOrganizationScope filters/gates by the caller's own
// organizationId scope -- see sensor.controller.js's list/get.
router.get('/',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  sensorController.list.bind(sensorController)
);

router.get('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  sensorController.get.bind(sensorController)
);

router.post('/:id/reading',
  authenticate,
  requirePermission('viewTemperature'),
  sensorController.collectReading.bind(sensorController)
);

// Alias para collect-reading
router.post('/:id/collect-reading',
  authenticate,
  requirePermission('viewTemperature'),
  sensorController.collectReading.bind(sensorController)
);

// Atualizar sensor
router.put('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  sensorController.update.bind(sensorController)
);

// Deletar sensor
router.delete('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  sensorController.delete.bind(sensorController)
);

module.exports = router;

