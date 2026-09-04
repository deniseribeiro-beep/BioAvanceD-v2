const express = require('express');
const router = express.Router();
const sensorController = require('../../controllers/sensor.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

// #1029: #634 gated only list and get, leaving five of the seven routes
// cross-org. requireOrganizationScope is added to all five here; the four
// that act on an EXISTING sensor additionally do a fetch-404-then-403
// ownership check in sensor.controller.js, because the middleware only
// ATTACHES req.organizationScope -- it does not compare it to anything.
//
// On POST / the middleware alone is the whole change: it refuses an
// org-less caller, which is a real gate, but it does not decide WHICH
// organizationId a create stamps when the caller holds several. That
// question is the same for sensor, equipment and temperature and is filed
// rather than answered one module at a time.
//
// RF009 - Gerenciamento de Sensores
router.post('/',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
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
  requireOrganizationScope,
  sensorController.collectReading.bind(sensorController)
);

// Alias para collect-reading
router.post('/:id/collect-reading',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  sensorController.collectReading.bind(sensorController)
);

// Atualizar sensor
router.put('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  sensorController.update.bind(sensorController)
);

// Deletar sensor
router.delete('/:id',
  authenticate,
  requirePermission('viewTemperature'),
  requireOrganizationScope,
  sensorController.delete.bind(sensorController)
);

module.exports = router;

