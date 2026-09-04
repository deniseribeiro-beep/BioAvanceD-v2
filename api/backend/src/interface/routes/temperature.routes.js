const express = require('express');
const router = express.Router();
const temperatureController = require('../../controllers/temperature.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { requireMachineIngestSecret } = require('../../utils/machineIngestGate');

// RF009 - Registro de Temperatura, por um usuário autenticado.
//
// #1073: this write was gated on 'viewTemperature', a read permission. It
// now gates on 'recordTemperature'; the file's five GETs keep
// viewTemperature. GET /alerts is separately cross-tenant -- see #1062,
// which needs a schema change rather than a middleware line.
//
// #1054: the comment that stood here said "Sistema pode registrar
// automaticamente (sem autenticação)" -- describing the route BELOW, not this
// one, which has always required a session. The two comments had drifted apart
// from whatever arrangement they once described, so neither was a statement of
// current intent. Both are rewritten to say what the code does.
router.post('/reading',
  authenticate,
  requirePermission('recordTemperature'),
  temperatureController.createReading.bind(temperatureController)
);

// RF009 - ingestão por máquina: um sensor ou gateway, sem sessão de usuário.
//
// #1054: this route was mounted with NO middleware at all -- the only route in
// the file without any -- while binding the same controller method as its
// authenticated sibling above. "Sem autenticação de usuário" is a coherent
// intention for a machine caller; the missing half was that a machine caller
// still needs A credential, just not a session one. Anonymous, it accepted
// writes into the cold-chain compliance record, let the caller choose the
// organizationId and sensorId the reading was attributed to, and left no audit
// row -- temperature.controller.js guards its auditLogger block on
// `if (req.user)`, which is undefined here.
//
// The gate FAILS CLOSED when TELEMETRY_INGEST_SECRET is unset, per #675's rule
// that an unset secret must never be read as "no auth required". See
// utils/machineIngestGate.js for why this is not testSupportGate.js.
router.post('/system/reading',
  requireMachineIngestSecret,
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

