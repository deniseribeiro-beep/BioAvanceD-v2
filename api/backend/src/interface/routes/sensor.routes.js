const express = require('express');
const router = express.Router();
const sensorController = require('../../controllers/sensor.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

// #1029: #634 gated only list and get, leaving five of the seven routes
// cross-org (#1387 later removed the two reading routes).
// requireOrganizationScope is added to all five here; the four
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
// #1073: the two GETs keep 'viewTemperature'; the five writes (#1387 later
// removed the two reading routes) moved to
// 'manageSensor' (lifecycle) and 'recordTemperature' (reading ingestion).
// Both are seeded to exactly the roles that already held viewTemperature, so
// no caller gains or loses a capability today -- what changes is that
// deleting a sensor is no longer the same permission as looking at a
// temperature. Whether Tecnico should keep manageSensor is now a catalogue
// edit rather than a code change, and it is Denise's call.
//
// RF009 - Gerenciamento de Sensores
router.post('/',
  authenticate,
  requirePermission('manageSensor'),
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

// #1387: the operator-initiated sensor read (POST /:id/reading and its alias
// /:id/collect-reading) was removed; no requirement names it (RF009's actor is
// the system). An on-demand read is new work on the telemetry read path.

// Atualizar sensor
router.put('/:id',
  authenticate,
  requirePermission('manageSensor'),
  requireOrganizationScope,
  sensorController.update.bind(sensorController)
);

// Deletar sensor
router.delete('/:id',
  authenticate,
  requirePermission('manageSensor'),
  requireOrganizationScope,
  sensorController.delete.bind(sensorController)
);

module.exports = router;

