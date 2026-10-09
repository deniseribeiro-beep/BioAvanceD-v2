const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const physicalChain = require('../../services/physicalChain.service');
const custodianship = require('../../services/custodianship.service');
const labelResolver = require('../../services/labelResolver.service');
const scope = require('../../services/physicalChainScope.service');
const { deviceUsabilityRefusal } = require('../../services/deviceLifecycle.service');

/**
 * Physical chain and custody routes (#1314, #1316; RF016 AC3/AC6, RF017
 * AC3/AC4, RF021 AC4-AC6). Base: /api/physical-chain
 *
 * Each link (specimen -> container -> position, rack -> location) and each
 * custody is an append-only assignment over [start, end): a POST creates
 * one, and a POST to .../unload, .../remove or .../end closes it. Nothing
 * here edits or deletes an assignment.
 *
 * Gates: custody is the Coordenador's (RF021), manageCustody; loading,
 * unloading, placing a container and scanning are the Tecnico's,
 * manageStorageAllocation; creating containers and locating racks shape
 * the topology, manageStorageTopology; the reads take viewStorageTopology.
 *
 * Tenancy is the specimen's custodian at the instant, never its collection
 * site (physicalChainScope.service.js).
 */

router.use(authenticate);

function sendError(res, error) {
  if (error?.statusCode && error?.code) {
    // RNF018: a 422 carries its failures as a `details` list too.
    const details = error.statusCode === 422 ? { details: [error.message] } : {};
    return res.status(error.statusCode).json({ success: false, error: error.code, message: error.message, ...details });
  }
  logger.error('[PhysicalChain] Erro não tratado:', error);
  return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error?.message });
}

function actorId(req) {
  return req.user?.userID || req.user?.userId || req.user?._id || null;
}

// Every write is audited; its sourceEventId (V2E-0683, V2E-0690) is the id
// the audit entry carries, given by the caller or minted here.
function sourceEventIdOf(req) {
  return req.body?.sourceEventId ? String(req.body.sourceEventId) : crypto.randomUUID();
}

async function audit(req, resourceType, resourceId, payload) {
  const auditLogger = require('../../utils/auditLogger');
  auditLogger.init(req.app.locals.db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType,
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message: `${resourceType} registrado na cadeia física`,
    payload: { ...payload, actorId: actorId(req) },
    req,
    module: 'Armazenamento',
  });
}

function instantOf(req) {
  if (!req.query?.at) return new Date();
  const at = new Date(req.query.at);
  if (Number.isNaN(at.getTime())) {
    throw Object.assign(new Error('at deve ser uma data ISO 8601'), { code: 'INVALID_INPUT', statusCode: 400 });
  }
  return at;
}

async function findOr404(db, collectionName, filter, label) {
  const doc = await (await getCollection(db, collectionName)).findOne(filter);
  if (!doc) {
    throw Object.assign(new Error(`${label} não encontrada`), { code: 'ASSIGNMENT_NOT_FOUND', statusCode: 404 });
  }
  return doc;
}

// ==================== CUSTODY (RF021 AC4-AC6) ====================

/**
 * POST /api/physical-chain/custody
 * Body: { specimenId, custodianOrganizationId, authorizationId,
 *         responsibleInvestigatorId?, locationId?, effectivePeriod: { start?, end? },
 *         assignmentStatus? (planned | active) }
 * 201 { success, data }; 403 *_OUT_OF_SCOPE; 404 SPECIMEN_NOT_FOUND |
 * ORGANIZATION_NOT_FOUND | APPROVAL_NOT_FOUND; 409 ASSIGNMENT_OVERLAP;
 * 422 VALIDATION_ERROR | APPROVAL_INCOMPATIBLE.
 */
router.post('/custody', requirePermission('manageCustody'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const body = req.body || {};
    await scope.assertCustodyAssignable(db, body, req.organizationScope);
    const custody = await custodianship.assignCustody(db, body);
    await audit(req, 'CustodianshipAssignment', custody.custodianshipAssignmentId, {
      specimenId: custody.specimenId, custodianOrganizationId: custody.custodianOrganizationId, authorizationId: custody.authorizationId,
    });
    return res.status(201).json({ success: true, data: custody });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/custody/:custodianshipAssignmentId/end  Body: { endAt? } */
router.post('/custody/:custodianshipAssignmentId/end', requirePermission('manageCustody'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = String(req.params.custodianshipAssignmentId);
    const current = await findOr404(db, 'custodianshipAssignments', { custodianshipAssignmentId: id }, `Atribuição ${id}`);
    scope.assertCustodianInScope(current, req.organizationScope);
    const closed = await custodianship.endCustody(db, id, req.body?.endAt);
    await audit(req, 'CustodianshipAssignment', id, { ended: closed.effectivePeriod.end });
    return res.json({ success: true, data: closed });
  } catch (error) {
    return sendError(res, error);
  }
});

/** GET /api/physical-chain/specimens/:specimenId/custody?at=  200 { data: assignment | null } */
router.get('/specimens/:specimenId/custody', requirePermission('viewStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const at = instantOf(req);
    await scope.assertSpecimenInScope(db, req.params.specimenId, req.organizationScope, at);
    return res.json({ success: true, data: await custodianship.currentCustody(db, req.params.specimenId, at) });
  } catch (error) {
    return sendError(res, error);
  }
});

// ==================== CHAIN (RF016 AC3, RF017 AC3/AC4) ====================

/** GET /api/physical-chain/specimens/:specimenId/location?at=  200 { data: { containerId, storagePositionId, storageRackId, storageLocationId } } */
router.get('/specimens/:specimenId/location', requirePermission('viewStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const at = instantOf(req);
    await scope.assertSpecimenInScope(db, req.params.specimenId, req.organizationScope, at);
    return res.json({ success: true, data: await physicalChain.resolveSpecimenLocation(db, req.params.specimenId, at) });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/containers  Body: Container fields (V2E-0646..0654). 201; 409 CONTAINER_EXISTS; 422. */
router.post('/containers', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const container = await physicalChain.createContainer(req.app.locals.db, req.body || {});
    await audit(req, 'Container', container.containerId, { containerType: container.containerType });
    return res.status(201).json({ success: true, data: container });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/physical-chain/containers/:containerId/specimens
 * Body: { specimenId, loadedAt?, unloadedAt?, sourceEventId? }
 * The specimen must be in the caller's custody, under an approval in force
 * (RF021 AC6): 422 CUSTODY_INACTIVE otherwise.
 */
router.post('/containers/:containerId/specimens', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const body = req.body || {};
    const at = body.loadedAt ? new Date(body.loadedAt) : new Date();
    await scope.assertSpecimenInScope(db, body.specimenId, req.organizationScope, at);
    const refusal = await custodianship.operabilityRefusal(db, body.specimenId, at);
    if (refusal) {
      return res.status(422).json({ success: false, error: 'CUSTODY_INACTIVE', message: refusal, details: [refusal] });
    }
    const sourceEventId = sourceEventIdOf(req);
    const assignment = await physicalChain.loadSpecimen(db, { ...body, containerId: req.params.containerId, sourceEventId });
    await audit(req, 'SpecimenContainerAssignment', assignment.specimenContainerAssignmentId, { sourceEventId, specimenId: assignment.specimenId, containerId: assignment.containerId });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/specimen-assignments/:id/unload  Body: { unloadedAt? } */
router.post('/specimen-assignments/:specimenContainerAssignmentId/unload', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = String(req.params.specimenContainerAssignmentId);
    const current = await findOr404(db, 'specimenContainerAssignments', { specimenContainerAssignmentId: id }, `Atribuição ${id}`);
    await scope.assertSpecimenInScope(db, current.specimenId, req.organizationScope);
    const closed = await physicalChain.unloadSpecimen(db, id, req.body?.unloadedAt);
    await audit(req, 'SpecimenContainerAssignment', id, { unloadedAt: closed.unloadedAt });
    return res.json({ success: true, data: closed });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/physical-chain/containers/:containerId/position
 * Body: { storagePositionId, placedAt?, removedAt?, sourceEventId? }
 * The container is in scope through the specimen it holds (RULE-030).
 */
router.post('/containers/:containerId/position', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await scope.assertContainerInScope(db, req.params.containerId, req.organizationScope);
    const sourceEventId = sourceEventIdOf(req);
    const assignment = await physicalChain.placeContainer(db, { ...(req.body || {}), containerId: req.params.containerId, sourceEventId });
    await audit(req, 'ContainerPositionAssignment', assignment.containerPositionAssignmentId, { sourceEventId, containerId: assignment.containerId, storagePositionId: assignment.storagePositionId });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/position-assignments/:id/remove  Body: { removedAt? } */
router.post('/position-assignments/:containerPositionAssignmentId/remove', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = String(req.params.containerPositionAssignmentId);
    const current = await findOr404(db, 'containerPositionAssignments', { containerPositionAssignmentId: id }, `Atribuição ${id}`);
    await scope.assertContainerInScope(db, current.containerId, req.organizationScope);
    const closed = await physicalChain.removeContainer(db, id, req.body?.removedAt);
    await audit(req, 'ContainerPositionAssignment', id, { removedAt: closed.removedAt });
    return res.json({ success: true, data: closed });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/racks/:storageRackId/location  Body: { storageLocationId, placedAt?, removedAt?, sourceEventId? }  Global scope only (RULE-035). */
router.post('/racks/:storageRackId/location', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    scope.assertGlobalScope(req.organizationScope);
    const sourceEventId = sourceEventIdOf(req);
    const assignment = await physicalChain.locateRack(req.app.locals.db, { ...(req.body || {}), storageRackId: req.params.storageRackId, sourceEventId });
    await audit(req, 'RackLocationAssignment', assignment.rackLocationAssignmentId, { sourceEventId, storageRackId: assignment.storageRackId, storageLocationId: assignment.storageLocationId });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    return sendError(res, error);
  }
});

/** POST /api/physical-chain/rack-assignments/:id/remove  Body: { removedAt? }  Global scope only. */
router.post('/rack-assignments/:rackLocationAssignmentId/remove', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    scope.assertGlobalScope(req.organizationScope);
    const id = String(req.params.rackLocationAssignmentId);
    const closed = await physicalChain.removeRack(req.app.locals.db, id, req.body?.removedAt);
    await audit(req, 'RackLocationAssignment', id, { removedAt: closed.removedAt });
    return res.json({ success: true, data: closed });
  } catch (error) {
    return sendError(res, error);
  }
});

// ==================== SCAN (RF016 AC6) ====================

/**
 * POST /api/physical-chain/scan
 * Body: { rawValue, symbology, deviceId, locationId?, correlationId? }
 * 200 { data: { resolved, reason?, containerId?, specimenId?, scanEvent? } };
 * 403 SPECIMEN_OUT_OF_SCOPE when the tube holds another organization's
 * specimen, with no ScanEvent written; 422 DEVICE_UNUSABLE when the scanner
 * is not a registered, homologated, unretired device (RF017 AC8).
 */
router.post('/scan', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const body = req.body || {};
    const missing = ['rawValue', 'symbology', 'deviceId'].filter((field) => !body[field]);
    if (missing.length) {
      return res.status(400).json({ success: false, error: 'INVALID_INPUT', message: `Obrigatório: ${missing.join(', ')}` });
    }
    // RF017 AC8: an unregistered, unhomologated or retired scanner is refused.
    const deviceRefusal = await deviceUsabilityRefusal(db, body.deviceId);
    if (deviceRefusal) {
      return res.status(422).json({ success: false, error: 'DEVICE_UNUSABLE', message: deviceRefusal, details: [deviceRefusal] });
    }
    const scan = { ...body, actorId: actorId(req) ? String(actorId(req)) : null, correlationId: body.correlationId ? String(body.correlationId) : crypto.randomUUID() };
    const result = await labelResolver.resolveScan(db, scan, {
      inScope: (specimenId) => scope.specimenInScope(db, specimenId, req.organizationScope),
    });
    if (result.reason === 'OUT_OF_SCOPE') {
      return res.status(403).json({ success: false, error: 'SPECIMEN_OUT_OF_SCOPE', message: 'O recipiente contém espécime de outra organização' });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
