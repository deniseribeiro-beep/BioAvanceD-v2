const express = require('express');
const router = express.Router();
const incidentController = require('../../controllers/incident.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { requireMachineIngestSecret } = require('../../utils/machineIngestGate');

// Criar ou atualizar incidente (sistema registra automaticamente)
//
// #1552: this route was registered with NO middleware, and app.js mounts the
// router with none in front, so an anonymous caller could open or grow a
// cold-chain incident -- which also quarantines the samples under the sensor
// and emails the alert recipients. Every other route in this file carries
// authenticate + requirePermission.
//
// The caller is the system, not a session: nothing in the frontend posts here.
// So it takes the machine-ingest gate #1054 put on
// POST /api/temperature/system/reading and #1063 on POST /api/iot/telemetry,
// not a session gate. See utils/machineIngestGate.js. Fails closed when
// TELEMETRY_INGEST_SECRET is unset.
router.post('/create', requireMachineIngestSecret, incidentController.createOrUpdateIncident);

// Listar incidentes
router.get('/',
  authenticate,
  requirePermission('viewTemperature'),
  incidentController.getIncidents
);

// Reconhecer incidente
router.put('/:incidentId/acknowledge',
  authenticate,
  requirePermission('manageTemperature'),
  incidentController.acknowledgeIncident
);

// Resolver incidente
router.put('/:incidentId/resolve',
  authenticate,
  requirePermission('manageTemperature'),
  incidentController.resolveIncident
);

// Escalar incidente
router.put('/:incidentId/escalate',
  authenticate,
  requirePermission('manageTemperature'),
  incidentController.escalateIncident
);

// Adicionar nota ao incidente
router.post('/:incidentId/notes',
  authenticate,
  requirePermission('viewTemperature'),
  incidentController.addNoteToIncident
);

module.exports = router;
