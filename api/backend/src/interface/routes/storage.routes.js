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
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const auditLogger = require('../../utils/auditLogger');
const { StorageTopologyAuthoringService } = require('../../services/storage-topology-authoring.service');

/**
 * Storage Routes - Gerenciamento de Armazenagem Física (ISO 20387)
 * Base: /api/storage
 *
 * Canonical v2 boundary:
 * - StorageContainer/StorageBox are governed layout/configuration inputs.
 * - Operational custody authority is exclusively the normalized v2 chain
 *   SpecimenContainerAssignment -> ContainerPositionAssignment ->
 *   StoragePosition -> StorageRack -> RackLocationAssignment.
 * - No route in this file writes legacy StorageAssignment or authoritative
 *   Sample.storageLocation.
 */

router.use(authenticate);
router.use((req, _res, next) => {
  logger.debug(`[Storage] ${req.method} ${req.path}`);
  next();
});

function actorId(req) {
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
  const db = req.app.locals.db;
  auditLogger.init(db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType,
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message: `${resourceType} criado pela superfície governada de topologia`,
    payload,
    req,
    module: 'Armazenamento'
  });
}

// ==================== CONSULTA ====================
router.get('/freezers', createListFreezersController());
router.get('/samples/search', createSearchSamplesController());
router.get('/specimen/:specimenId', createGetSampleLocationController());
router.get('/box/:boxId/available', createGetAvailablePositionsController());
router.get('/validate/:boxId/:position', createValidatePositionController());
router.get('/freezer/:freezerId/stats', createGetFreezerStatsController());
router.get('/box/:boxId/integrity', createCheckBoxIntegrityController());
router.get('/freezer/:freezerId/tree', createGetFreezerTreeController());

// ==================== AUTORIA GOVERNADA DE LAYOUT (#1124) ====================
// These endpoints deliberately author configuration only. The normalized
// physical-storage repository materializes canonical operational placement
// when a specimen is allocated/moved; this API does not create custody rows.
router.post('/topology/containers', requirePermission('manageStorageTopology'), async (req, res) => {
  try {
    const service = new StorageTopologyAuthoringService(req.app.locals.db);
    const created = await service.createContainer(req.body || {}, actorId(req));
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

router.post('/topology/boxes', requirePermission('manageStorageTopology'), async (req, res) => {
  try {
    const service = new StorageTopologyAuthoringService(req.app.locals.db);
    const created = await service.createBox(req.body || {}, actorId(req));
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

// ==================== CUSTÓDIA / ALOCAÇÃO ====================
// manageStorageAllocation is the specimen-custody permission; topology
// authoring above is intentionally separated under manageStorageTopology.
router.post('/allocate', requirePermission('manageStorageAllocation'), createAllocateSampleController());
router.post('/allocate/auto', requirePermission('manageStorageAllocation'), createAutoAssignSampleController());
router.post('/move', requirePermission('manageStorageAllocation'), createMoveSampleController());
router.delete('/release/:specimenId', requirePermission('manageStorageAllocation'), createReleaseSampleController());

// ==================== ASSOCIAÇÃO FREEZER -> ROOM ====================
router.patch('/freezer/:freezerId/room', requirePermission('manageStorageTopology'), async (req, res) => {
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

    auditLogger.init(db);
    await auditLogger.log({
      action: 'UPDATE',
      resourceType: 'StorageContainer',
      resourceId: req.params.freezerId,
      status: 'success',
      severity: 'info',
      message: 'Room atribuída ao FREEZER',
      payload: { roomId: roomObjectId ? roomObjectId.toString() : null },
      req,
      module: 'Armazenamento'
    });

    return res.status(200).json({
      success: true,
      data: { _id: freezerObjectId, roomId: roomObjectId }
    });
  } catch (error) {
    logger.error('[Storage] Erro ao atribuir room ao freezer:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

router.use((err, _req, res, _next) => {
  logger.error('[Storage Routes] Erro não tratado:', err);
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: err.message
  });
});

module.exports = router;
