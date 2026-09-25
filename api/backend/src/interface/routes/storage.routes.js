const express = require('express');
const router = express.Router();
const { createAllocateSampleController } = require('../controllers/allocate-sample.controller');
const { createAutoAssignSampleController } = require('../controllers/auto-assign-sample.controller');
const { createReleaseSampleController } = require('../controllers/release-sample.controller');
const { createMoveSampleController } = require('../controllers/move-sample.controller');
const {
  createListFreezersController,
  createSearchSamplesController,
  createGetSampleLocationController,
  createGetAvailablePositionsController,
  createValidatePositionController,
  createGetFreezerStatsController,
  createCheckBoxIntegrityController,
  createGetFreezerTreeController
} = require('../controllers/storage-query.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
// #888: requireRole is no longer imported -- every gate on this router is now
// a permission code. The role list it carried lives on as the grant list for
// manageStorageAllocation in rbac-catalog-seed.service.js.
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { StorageTopologyAuthoringService } = require('../../services/storage-topology-authoring.service');

/**
 * Storage Routes - Gerenciamento de Armazenagem Física (ISO 20387)
 * Base: /api/storage
 *
 * Data: Feb 12, 2026 (Semana 2)
 */

// ==================== PROTEÇÃO ====================
// Todos os endpoints requerem autenticação
router.use(authenticate);

// ==================== VALIDAÇÃO DE ERRO ====================
router.use((req, res, next) => {
  logger.debug(`[Storage] ${req.method} ${req.path}`);
  next();
});

// ==================== AUTORIZACAO ====================
// #859: authenticate alone is not authorization. Every mutation below is
// gated so that a level-1 Usuario Externo cannot move, allocate or release
// a sample -- RF002 AC#5 requires the backend to enforce this independently
// of what the frontend hides.
//
// #888: this used to read "the RBAC catalog defines no storage-scoped
// permission code at all, so a requirePermission here would have to borrow a
// wrong-domain code", and gated on a MUTATION_ROLES = [2, 3, 4] constant
// instead. The catalog now has two storage codes (26 codes, per
// Object.keys(PERMISSION_CATALOG).length in rbac-catalog-seed.service.js):
//
//   manageStorageAllocation (StorageAssignment) -- WHERE a specimen sits:
//     POST /allocate, /allocate/auto, /move, DELETE /release/:sampleId.
//     Granted to Tecnico + Coordenador + Administrador, which reproduces the
//     old MUTATION_ROLES [2, 3, 4] exactly, so the swap is behaviour-
//     preserving rather than a re-authorization.
//   manageStorageTopology (StorageContainer) -- WHAT the container tree is:
//     PATCH /freezer/:freezerId/room, and (#1124) POST /topology/containers
//     and /topology/boxes. Granted to Coordenador +
//     Administrador, which is both RF017's stated actor and, conveniently,
//     'createPatient''s existing grant -- so that swap is a runtime no-op
//     and stops recording a Patient-domain authorization for a freezer
//     action.
//
// This deliberately does NOT settle the RF006-vs-RF017 actor disagreement:
// RF006 (custody and movement) names the Tecnico as primary actor, RF017
// (storage topology) names the Coordenador. The technician floor on
// allocation freezes #859's status quo rather than resolving it; that
// question stays open.
//
// The other four files borrowing 'createPatient' (equipment.routes.js,
// facility.routes.js, room.routes.js, routes/eConsent.js) are deliberately
// left alone here -- see #888 for why folding them in would bury the
// catalog change, which is the actually-risky part.

// ==================== ENDPOINTS ====================

/**
 * GET /api/storage/freezers
 * Listar todos os freezers disponíveis (operacionais)
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "_id": "507f...",
 *       "containerID": 1,
 *       "name": "Ultra-Freezer 01",
 *       "temperature": -80,
 *       "temperatureUnit": "CELSIUS",
 *       "status": "OPERATIONAL"
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/freezers', createListFreezersController());

/**
 * GET /api/storage/samples/search?q=termo
 * Buscar amostras disponíveis para alocação
 * 
 * Query params:
 * - q: termo de busca (barcode, patientID, sampleID)
 * 
 * Critérios de filtro:
 * - Apenas amostras com currentStatus = "Available", "Registered", "pending"
 * - Sem storageLocation.boxId (não alocadas ainda)
 * - Com consentimento ativo do paciente (se houver sistema de consentimento)
 * 
 * Response 200:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "_id": "507f...",
 *       "barcode": "BR-2025-001",
 *       "patientID": "10732282",
 *       "sampleType": "Sangue",
 *       "currentStatus": "Available",
 *       "consentValid": true,
 *       "consentMessage": "Consentimento ativo",
 *       "canAllocate": true
 *     }
 *   ]
 * }
 */
router.get('/samples/search', createSearchSamplesController());

/**
 * POST /api/storage/allocate
 * Alocar amostra a uma posição específica
 *
 * Body:
 * {
 *   "sampleId": "507f1f77bcf86cd799439011",
 *   "boxId": "507f1f77bcf86cd799439012",
 *   "position": "A1"
 * }
 *
 * Response 201:
 * {
 *   "success": true,
 *   "data": {
 *     "sampleId": "507f1f77bcf86cd799439011",
 *     "boxId": "507f1f77bcf86cd799439012",
 *     "position": "A1"
 *   },
 *   "message": "Amostra alocada com sucesso em A1"
 * }
 *
 * Response 409 (Colisão):
 * {
 *   "success": false,
 *   "error": "STORAGE_COLLISION",
 *   "message": "Posição 'A1' já está ocupada por amostra 507f...",
 *   "occupiedBySampleId": "507f..."
 * }
 */
router.post('/allocate', requirePermission('manageStorageAllocation'), createAllocateSampleController());

/**
 * POST /api/storage/allocate/auto
 * Alocar amostra automaticamente na próxima posição vazia da caixa
 *
 * Body:
 * {
 *   "sampleId": "507f1f77bcf86cd799439011",
 *   "boxId": "507f1f77bcf86cd799439012"
 * }
 *
 * Response 201:
 * {
 *   "success": true,
 *   "data": {
 *     "specimenId": "507f1f77bcf86cd799439011",
 *     "boxId": "507f1f77bcf86cd799439012",
 *     "position": "A1"
 *   },
 *   "message": "Amostra alocada automaticamente na Posição A1",
 *   "graphPersisted": true
 * }
 *
 * Response 400:
 * {
 *   "success": false,
 *   "error": "INVALID_INPUT",
 *   "message": "sampleId e boxId são obrigatórios"
 * }
 *
 * Response 404:
 * {
 *   "success": false,
 *   "error": "SAMPLE_NOT_FOUND" | "BOX_NOT_FOUND",
 *   "message": "..."
 * }
 *
 * Response 409:
 * {
 *   "success": false,
 *   "error": "ALREADY_ALLOCATED" | "BOX_FULL",
 *   "message": "..."
 * }
 */
router.post('/allocate/auto', requirePermission('manageStorageAllocation'), createAutoAssignSampleController());

/**
 * POST /api/storage/move
 * Mover amostra de uma posição para outra (transação Mongo + auditoria imutável).
 *
 * Body:
 * {
 *   "sampleId": "507f1f77bcf86cd799439011",
 *   "targetBoxId": "507f1f77bcf86cd799439012",
 *   "targetPosition": "A1",
 *   "reason": "Reorganização de layout",
 *   "notes": "Movido durante inventário"
 * }
 */
router.post('/move', requirePermission('manageStorageAllocation'), createMoveSampleController());

/**
 * DELETE /api/storage/release/:sampleId
 * Liberar amostra de uma posição
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": {
 *     "sampleId": "507f1f77bcf86cd799439011",
 *     "boxId": "507f1f77bcf86cd799439012",
 *     "position": "A1"
 *   },
 *   "message": "Amostra liberada de A1"
 * }
 */
router.delete('/release/:sampleId', requirePermission('manageStorageAllocation'), createReleaseSampleController());

/**
 * GET /api/storage/sample/:sampleId
 * Obter localização de uma amostra
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": {
 *     "sampleId": "507f1f77bcf86cd799439011",
 *     "barcode": "BA123456789",
 *     "box": {
 *       "boxId": "507f1f77bcf86cd799439012",
 *       "position": "A1"
 *     },
 *     "path": "Freezer 01/Shelf 1/Rack A/Box 01",
 *     "fullHierarchy": {
 *       "freezerId": "507f...",
 *       "shelfId": "507f...",
 *       "rackId": "507f...",
 *       "boxId": "507f..."
 *     }
 *   }
 * }
 */
router.get('/sample/:sampleId', createGetSampleLocationController());

/**
 * GET /api/storage/box/:boxId/available
 * Listar posições disponíveis em uma caixa
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": {
 *     "boxId": "507f1f77bcf86cd799439012",
 *     "boxName": "Box A1-01",
 *     "dimension": { "rows": 9, "cols": 9 },
 *     "stats": {
 *       "capacity": 81,
 *       "occupied": 5,
 *       "available": 76,
 *       "occupancyPercent": 6
 *     },
 *     "availablePositions": ["A1", "A2", "A3", ..., "I9"],
 *     "occupiedPositions": ["B1", "C2", ...]
 *   }
 * }
 */
router.get('/box/:boxId/available', createGetAvailablePositionsController());

/**
 * GET /api/storage/validate/:boxId/:position
 * Validar disponibilidade de posição (sem alocar)
 *
 * Response 200 (disponível):
 * {
 *   "success": true,
 *   "available": true,
 *   "boxData": {
 *     "boxId": "507f...",
 *     "boxName": "Box A1-01",
 *     "dimension": { "rows": 9, "cols": 9 },
 *     "currentOccupancy": 5,
 *     "capacity": 81,
 *     "availablePositions": 76
 *   }
 * }
 *
 * Response 409 (Colisão):
 * {
 *   "success": false,
 *   "available": false,
 *   "error": "STORAGE_COLLISION",
 *   "message": "Posição 'A1' já está ocupada por amostra 507f...",
 *   "occupiedBySampleId": "507f..."
 * }
 */
router.get('/validate/:boxId/:position', createValidatePositionController());

/**
 * GET /api/storage/freezer/:freezerId/stats
 * Estatísticas de ocupação por Freezer
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": {
 *     "freezerId": "507f...",
 *     "freezerName": "Freezer 01",
 *     "temperature": -80,
 *     "rackStats": [
 *       {
 *         "_id": "507f...",
 *         "rackName": "Rack A",
 *         "totalCapacity": 810,
 *         "totalOccupied": 125
 *       },
 *       ...
 *     ],
 *     "aggregate": {
 *       "totalCapacity": 8100,
 *       "totalOccupied": 642,
 *       "totalAvailable": 7458,
 *       "occupancyPercent": 79
 *     }
 *   }
 * }
 */
router.get('/freezer/:freezerId/stats', createGetFreezerStatsController());

/**
 * GET /api/storage/box/:boxId/integrity
 * Verificar integridade de uma caixa
 * (Auditoria: detecta órfãos e inconsistências)
 *
 * Response 200 (ok):
 * {
 *   "success": true,
 *   "data": {
 *     "valid": true,
 *     "stats": {
 *       "boxId": "507f...",
 *       "dimension": { "rows": 9, "cols": 9 },
 *       "capacity": 81,
 *       "currentOccupancy": 5,
 *       "actualOccupancy": 5
 *     }
 *   }
 * }
 *
 * Response 400 (inconsistência):
 * {
 *   "success": false,
 *   "data": {
 *     "valid": false,
 *     "errors": [
 *       "Orfão: posição A1 referencia amostra inexistente 507f...",
 *       "Inconsistência: currentOccupancy=5, mas ocupação real=3"
 *     ],
 *     "stats": { ... }
 *   }
 * }
 *
 * Response 404 (caixa inexistente) -- #892:
 * {
 *   "success": false,
 *   "error": "BOX_NOT_FOUND",
 *   "data": { "valid": false, "error": "BOX_NOT_FOUND" }
 * }
 *
 * Ate o #892 esta rota devolvia 400 tambem para a caixa inexistente, porque
 * o repositorio relata os dois casos pelo mesmo `valid: false`. Era a unica
 * rota deste router que respondia 400 para entidade ausente, e contrariava a
 * tabela de codigos de `docs/STORAGE_API_EXAMPLES.js`, que lista
 * BOX_NOT_FOUND em "404 - Nao encontrado".
 */
router.get('/box/:boxId/integrity', createCheckBoxIntegrityController());

/**
 * GET /api/storage/freezer/:freezerId/tree
 * Obter árvore hierárquica completa de um Freezer
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": {
 *     "freezerId": "507f...",
 *     "freezerName": "Ultra-Freezer 01",
 *     "temperature": -80,
 *     "temperatureUnit": "CELSIUS",
 *     "status": "OPERATIONAL",
 *     "shelves": [
 *       {
 *         "shelfId": "507f...",
 *         "shelfName": "Prateleira 1",
 *         "racks": [
 *           {
 *             "rackId": "507f...",
 *             "rackName": "Rack A",
 *             "boxes": [
 *               {
 *                 "boxId": "507f...",
 *                 "boxName": "Box A1-01",
 *                 "dimension": { "rows": 9, "cols": 9 },
 *                 "stats": {
 *                   "capacity": 81,
 *                   "occupied": 5,
 *                   "available": 76,
 *                   "occupancyPercent": 6
 *                 },
 *                 "status": "ACTIVE"
 *               },
 *               ...
 *             ],
 *             "stats": {
 *               "boxes": 10,
 *               "totalCapacity": 810,
 *               "totalOccupied": 125
 *             }
 *           },
 *           ...
 *         ],
 *         "stats": {
 *           "racks": 5,
 *           "boxes": 50,
 *           "totalCapacity": 4050,
 *           "totalOccupied": 625
 *         }
 *       },
 *       ...
 *     ],
 *     "aggregateStats": {
 *       "totalShelves": 2,
 *       "totalRacks": 10,
 *       "totalBoxes": 100,
 *       "totalCapacity": 8100,
 *       "totalOccupied": 1250,
 *       "totalAvailable": 6850,
 *       "occupancyPercent": 15
 *     }
 *   }
 * }
 */
router.get('/freezer/:freezerId/tree', createGetFreezerTreeController());

/**
 * PATCH /api/storage/freezer/:freezerId/room
 * Atribuir/alterar a Room (dict-02 StorageAssignment.roomId, ELM-0169) de um
 * FREEZER — closes the assignment-path gap #419 deferred from #418 (models
 * existed, nothing could set them).
 *
 * Body:
 * {
 *   "roomId": "507f1f77bcf86cd799439012"
 * }
 *
 * Response 200:
 * {
 *   "success": true,
 *   "data": { "_id": "...", "roomId": "507f..." }
 * }
 *
 * Response 404:
 * {
 *   "success": false,
 *   "error": "FREEZER_NOT_FOUND" | "ROOM_NOT_FOUND"
 * }
 *
 * Response 400 (container não é FREEZER):
 * {
 *   "success": false,
 *   "error": "NOT_A_FREEZER"
 * }
 */
router.patch('/freezer/:freezerId/room', authenticate, requirePermission('manageStorageTopology'), async (req, res) => {
  try {
    const db = req.app.locals.db;

    if (!ObjectId.isValid(req.params.freezerId)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }
    const freezerObjectId = new ObjectId(req.params.freezerId);

    const freezer = await db.collection('storageContainers').findOne({ _id: freezerObjectId });
    if (!freezer) {
      return res.status(404).json({ success: false, error: 'FREEZER_NOT_FOUND' });
    }
    if (freezer.containerType !== 'FREEZER') {
      return res.status(400).json({
        success: false,
        error: 'NOT_A_FREEZER',
        message: 'roomId só pode ser atribuído a containers do tipo FREEZER'
      });
    }

    const { roomId } = req.body;
    let roomObjectId = null;
    if (roomId) {
      if (!ObjectId.isValid(roomId)) {
        return res.status(400).json({ success: false, error: 'roomId inválido' });
      }
      roomObjectId = new ObjectId(roomId);
      const room = await db.collection('rooms').findOne({ _id: roomObjectId, deletedAt: null });
      if (!room) {
        return res.status(404).json({ success: false, error: 'ROOM_NOT_FOUND' });
      }
    }

    await db.collection('storageContainers').updateOne(
      { _id: freezerObjectId },
      { $set: { roomId: roomObjectId, updatedAt: new Date() } }
    );

    const auditLogger = require('../../utils/auditLogger');
    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'StorageContainer',
      resourceId: req.params.freezerId,
      status: 'success',
      severity: 'info',
      message: 'Room atribuída ao FREEZER',
      payload: { roomId: roomObjectId ? roomObjectId.toString() : null },
      req: req,
      module: 'Armazenamento'
    });

    return res.status(200).json({
      success: true,
      data: { _id: freezerObjectId, roomId: roomObjectId }
    });
  } catch (error) {
    logger.error('[Storage] Erro ao atribuir room ao freezer:', error.message || error);
    // #1022: was 400, the only failure path in this router not using 5xx --
    // it told the caller "you sent something wrong" and "the server broke" in
    // one body. This routes only genuine unhandled exceptions: the expected
    // failures (FREEZER_NOT_FOUND, NOT_A_FREEZER, ROOM_NOT_FOUND) are all
    // handled above. Same class #892 fixed for checkBoxIntegrity here.
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ==================== AUTORIA DE TOPOLOGIA (#1124) ====================
// Until these, no request could create a StorageContainer or a StorageBox:
// the legacy location-storage backfill held the only insertOne calls. Ported
// from Denise's stabilize/v2.0.0-prototype (dd75ae70). They author the
// container tree only; placing a specimen stays on POST /allocate under
// manageStorageAllocation.

function topologyActorId(req) {
  return req.user?.userID || req.user?.userId || req.user?._id || null;
}

function sendTopologyError(res, error) {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) logger.error('[StorageTopology] Erro não tratado:', error);
  return res.status(status).json({
    success: false,
    error: error?.code || 'INTERNAL_ERROR',
    message: error?.message || 'Erro interno'
  });
}

async function auditTopologyCreate(req, resourceType, resourceId, payload) {
  const auditLogger = require('../../utils/auditLogger');
  auditLogger.init(req.app.locals.db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType,
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message: `${resourceType} criado pela superfície de autoria de topologia`,
    payload,
    req,
    module: 'Armazenamento'
  });
}

/**
 * POST /api/storage/topology/containers
 *
 * Body: { name, containerType: FREEZER|SHELF|RACK|DRAWER, parentId?,
 *         equipmentId? (FREEZER), roomId? (FREEZER), temperature? (FREEZER),
 *         temperatureUnit?, capacity?, status?, description? }
 *
 * 201 { success, data }; 400 INVALID_INPUT | INVALID_HIERARCHY | ...;
 * 404 PARENT_NOT_FOUND | EQUIPMENT_NOT_FOUND | ROOM_NOT_FOUND;
 * 409 STORAGE_CONTAINER_CONFLICT (a FREEZER already holds that equipment).
 */
router.post('/topology/containers', requirePermission('manageStorageTopology'), async (req, res) => {
  try {
    const service = new StorageTopologyAuthoringService(req.app.locals.db);
    const created = await service.createContainer(req.body || {}, topologyActorId(req));
    await auditTopologyCreate(req, 'StorageContainerLayout', created._id, {
      containerType: created.containerType,
      parentId: created.parent_id ? String(created.parent_id) : null,
      roomId: created.roomId ? String(created.roomId) : null,
      equipmentId: created.containerID || null
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return sendTopologyError(res, error);
  }
});

/**
 * POST /api/storage/topology/boxes
 *
 * Body: { name, parentId (a RACK or DRAWER), dimension: { rows 1-26, cols 1-100 },
 *         boxID?, status?, description? }
 */
router.post('/topology/boxes', requirePermission('manageStorageTopology'), async (req, res) => {
  try {
    const service = new StorageTopologyAuthoringService(req.app.locals.db);
    const created = await service.createBox(req.body || {}, topologyActorId(req));
    await auditTopologyCreate(req, 'StorageBoxLayout', created._id, {
      parentId: String(created.parent_id),
      dimension: created.dimension,
      capacity: created.capacity
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return sendTopologyError(res, error);
  }
});

// ==================== ERROR HANDLING ====================
router.use((err, req, res, next) => {
  logger.error('[Storage Routes] Erro não tratado:', err);
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: err.message
  });
});

module.exports = router;
