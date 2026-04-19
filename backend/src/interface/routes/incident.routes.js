const express = require('express');
const router = express.Router();
const incidentController = require('../../controllers/incident.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');

// Criar ou atualizar incidente (sistema registra automaticamente)
router.post('/create',
  incidentController.createOrUpdateIncident
);

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
