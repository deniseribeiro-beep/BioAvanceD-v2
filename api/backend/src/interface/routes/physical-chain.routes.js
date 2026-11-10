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
const telemetryExposure = require('../../services/telemetryExposure.service');
const storageLocations = require('../../services/storageLocation.service');
const storageRacks = require('../../services/storageRack.service');
const legalHolds = require('../../services/legalHold.service');
const { findSampleByAnyId } = require('../../utils/sampleLookup');
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
 * manageStorageAllocation; creating containers, locations and labels and
 * locating racks shape the topology, manageStorageTopology; the reads take
 * viewStorageTopology.
 *
 * Tenancy is the specimen's custodian at the instant, never its collection
 * site, and a rack's is its StorageLocation's organization
 * (physicalChainScope.service.js).
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

// ==================== LOCATIONS (RF017 AC1/AC3/AC8) ====================

/**
 * POST /api/physical-chain/locations
 * Body: StorageLocation fields (P1X-0098..0104): { locationType, name, code,
 *       organizationId, parentLocationId?, locationStatus? }
 * 201; 403 LOCATION_OUT_OF_SCOPE; 404 ORGANIZATION_NOT_FOUND |
 * LOCATION_NOT_FOUND (the parent); 409 LOCATION_EXISTS; 422 VALIDATION_ERROR,
 * a parent of another organization included.
 */
router.post('/locations', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const body = req.body || {};
    scope.assertOrganizationInScope(req.organizationScope, body.organizationId);
    const location = await storageLocations.createLocation(req.app.locals.db, body);
    await audit(req, 'StorageLocation', location.storageLocationId, {
      organizationId: location.organizationId, parentLocationId: location.parentLocationId, locationStatus: location.locationStatus,
    });
    return res.status(201).json({ success: true, data: location });
  } catch (error) {
    return sendError(res, error);
  }
});

/** GET /api/physical-chain/locations  200 { data: [location] }, the caller's organizations' only. */
router.get('/locations', requirePermission('viewStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    return res.json({ success: true, data: await storageLocations.listLocations(req.app.locals.db, req.organizationScope) });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/physical-chain/locations/:storageLocationId/status
 * Body: { locationStatus (active | unavailable | interdicted), reason? }
 * RF017 AC8: the record stays; each change is audited with the status it
 * left. A rack is located only at an active location under active ancestors.
 */
router.post('/locations/:storageLocationId/status', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await scope.assertLocationInScope(db, req.params.storageLocationId, req.organizationScope);
    const updated = await storageLocations.setLocationStatus(db, req.params.storageLocationId, req.body?.locationStatus);
    await audit(req, 'StorageLocation', updated.storageLocationId, {
      locationStatus: updated.locationStatus, previousStatus: updated.previousStatus, reason: req.body?.reason ? String(req.body.reason) : null,
    });
    return res.json({ success: true, data: updated });
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

/**
 * POST /api/physical-chain/specimens/:specimenId/telemetry-exposure-summaries  Body: { windowStart?, windowEnd? }
 * 201 { data: [TelemetryExposureSummary] }; 400; 422 EXPOSURE_PATH_EMPTY, EXPOSURE_NOT_REPRODUCIBLE (RF009 AC5/AC6, #1392).
 * A read of the chain and its readings, so READ under viewStorageTopology (#631's explicit action for a POST).
 */
router.post('/specimens/:specimenId/telemetry-exposure-summaries', requirePermission('viewStorageTopology', 'READ'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const specimenId = String(req.params.specimenId);
    await scope.assertSpecimenInScope(db, specimenId, req.organizationScope);
    const { windowStart, windowEnd } = req.body || {};
    const summaries = await telemetryExposure.summarizeExposure(db, { specimenId, windowStart, windowEnd });
    for (const summary of summaries) {
      await audit(req, 'TelemetryExposureSummary', summary.telemetryExposureSummaryId, { specimenId, exposurePathHash: summary.exposurePathHash });
    }
    return res.status(201).json({ success: true, data: summaries });
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
    // The chain is keyed by the business specimenId, whichever id the caller holds.
    const sample = await findSampleByAnyId(await getCollection(db, 'samples'), body.specimenId);
    if (!sample) {
      return res.status(404).json({ success: false, error: 'SPECIMEN_NOT_FOUND', message: `Espécime ${body.specimenId} não encontrado` });
    }
    const specimenId = String(sample.specimenId);
    await scope.assertSpecimenInScope(db, specimenId, req.organizationScope, at);
    const refusal = await custodianship.operabilityRefusal(db, specimenId, at);
    if (refusal) {
      return res.status(422).json({ success: false, error: 'CUSTODY_INACTIVE', message: refusal, details: [refusal] });
    }
    // RF006 AC6: a specimen under an active legal hold is not loaded.
    const holdRefusal = await legalHolds.specimenHoldRefusal(db, sample);
    if (holdRefusal) {
      return res.status(409).json({ success: false, error: 'LEGAL_HOLD_ACTIVE', message: holdRefusal });
    }
    const sourceEventId = sourceEventIdOf(req);
    const assignment = await physicalChain.loadSpecimen(db, { ...body, specimenId, containerId: req.params.containerId, sourceEventId });
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
 * The container is in scope through the specimen it holds (RULE-030). An
 * empty, unplaced one is placed by the holder of the target position's rack
 * location.
 */
router.post('/containers/:containerId/position', requirePermission('manageStorageAllocation'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const containerId = String(req.params.containerId);
    const open = { containerId, assignmentStatus: 'active' };
    const emptyAndUnplaced = !(await (await getCollection(db, 'specimenContainerAssignments')).findOne(open))
      && !(await (await getCollection(db, 'containerPositionAssignments')).findOne(open));
    if (!emptyAndUnplaced || !(await scope.positionInScope(db, req.body?.storagePositionId, req.organizationScope))) {
      await scope.assertContainerInScope(db, containerId, req.organizationScope);
    }
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

/**
 * POST /api/physical-chain/racks/:storageRackId/location
 * Body: { storageLocationId, placedAt?, removedAt?, sourceEventId? }
 * The rack is in scope through the location (RULE-035): 403
 * LOCATION_OUT_OF_SCOPE, 404 LOCATION_NOT_FOUND, and 422 LOCATION_UNUSABLE
 * when the location or an ancestor is not active (RF017 AC8). A caller of
 * organization scope must also hold the location the rack's own record
 * names, if any (403 LOCATION_OUT_OF_SCOPE, #1513).
 */
router.post('/racks/:storageRackId/location', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const body = req.body || {};
    // #1513: a rack whose record names a location is that location's
    // organization's; another organization must not place it elsewhere and
    // take its grid.
    if (req.organizationScope?.scope !== 'global') {
      const prepared = await (await getCollection(db, 'storageRacks')).findOne({ storageRackId: String(req.params.storageRackId) });
      if (prepared?.storageLocationId) await scope.assertLocationInScope(db, prepared.storageLocationId, req.organizationScope);
    }
    if (body.storageLocationId) {
      await scope.assertLocationInScope(db, body.storageLocationId, req.organizationScope);
      const refusal = await storageLocations.locationUsabilityRefusal(db, body.storageLocationId);
      if (refusal) {
        return res.status(422).json({ success: false, error: 'LOCATION_UNUSABLE', message: refusal, details: [refusal] });
      }
    }
    const sourceEventId = sourceEventIdOf(req);
    const assignment = await physicalChain.locateRack(db, { ...body, storageRackId: req.params.storageRackId, sourceEventId });
    await audit(req, 'RackLocationAssignment', assignment.rackLocationAssignmentId, { sourceEventId, storageRackId: assignment.storageRackId, storageLocationId: assignment.storageLocationId });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/physical-chain/rack-assignments/:id/remove  Body: { removedAt? }
 * For the holder of the rack's location. A global caller may also close an
 * assignment whose location no record names.
 */
router.post('/rack-assignments/:rackLocationAssignmentId/remove', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = String(req.params.rackLocationAssignmentId);
    const current = await findOr404(db, 'rackLocationAssignments', { rackLocationAssignmentId: id }, `Atribuição ${id}`);
    if (req.organizationScope?.scope !== 'global') {
      await scope.assertLocationInScope(db, current.storageLocationId, req.organizationScope);
    }
    const closed = await physicalChain.removeRack(db, id, req.body?.removedAt);
    await audit(req, 'RackLocationAssignment', id, { removedAt: closed.removedAt });
    return res.json({ success: true, data: closed });
  } catch (error) {
    return sendError(res, error);
  }
});

// ==================== RACK GRID (RF016 AC2) ====================

/**
 * POST /api/physical-chain/racks
 * Body: { storageRackId?, rackType?, rowCount?, columnCount?,
 *         coordinateScheme?, orientationRule?, storageLocationId?,
 *         catalogReference?, status?, sourceEventId? }
 * Creates the rack and one StoragePosition per cell of its grid (#1513).
 * An omitted grid field takes the approved fixture: cryogenic_rack, 8x12,
 * alpha_numeric, top_left_origin, so 96 positions. A named location must be
 * the caller's (404 LOCATION_NOT_FOUND, 403 LOCATION_OUT_OF_SCOPE) and
 * usable (422 LOCATION_UNUSABLE, RF017 AC8), and the caller must hold the
 * location the rack is already open at. 409 RACK_EXISTS; 422
 * VALIDATION_ERROR, a storageRackId that is not a non-empty string included.
 */
router.post('/racks', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const body = req.body || {};
    if (body.storageLocationId) {
      await scope.assertLocationInScope(db, body.storageLocationId, req.organizationScope);
      // RF017 AC8: a rack is not prepared at a location that is not usable.
      const refusal = await storageLocations.locationUsabilityRefusal(db, body.storageLocationId);
      if (refusal) {
        return res.status(422).json({ success: false, error: 'LOCATION_UNUSABLE', message: refusal, details: [refusal] });
      }
    }
    // Another organization must not pre-empt the grid of a rack located in
    // yours.
    if (body.storageRackId && req.organizationScope?.scope !== 'global') {
      const located = await (await getCollection(db, 'rackLocationAssignments')).findOne({ storageRackId: String(body.storageRackId), assignmentStatus: 'active' });
      if (located) await scope.assertLocationInScope(db, located.storageLocationId, req.organizationScope);
    }
    const sourceEventId = sourceEventIdOf(req);
    const rack = await storageRacks.createRack(db, body);
    await audit(req, 'StorageRack', rack.storageRackId, {
      sourceEventId,
      rackType: rack.rackType,
      rowCount: rack.rowCount,
      columnCount: rack.columnCount,
      positionCount: rack.positionCount,
      storageLocationId: rack.storageLocationId,
    });
    return res.status(201).json({ success: true, data: rack });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * GET /api/physical-chain/racks/:storageRackId/positions
 * The rack's StoragePosition rows in top_left_origin order (#1513). 404
 * RACK_NOT_FOUND; 403 RACK_OUT_OF_SCOPE unless the rack's location is the
 * caller's, and a rack located nowhere is a global caller's only.
 */
router.get('/racks/:storageRackId/positions', requirePermission('viewStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const rack = await storageRacks.findRack(db, req.params.storageRackId);
    await scope.assertRackInScope(db, rack.storageRackId, req.organizationScope);
    return res.json({ success: true, data: await storageRacks.listRackPositions(db, rack.storageRackId) });
  } catch (error) {
    return sendError(res, error);
  }
});

// ==================== LABELS (RF016 AC4/AC5) ====================

/**
 * POST /api/physical-chain/containers/:containerId/labels
 * Body: { encodedValue, symbology, identifierOrigin, namespaceRegistryId,
 *         carrierPlacement, immutableAtSource, templateVersionId?, printBatchId? }
 * Issues the container's identifier. The target is the container, and an
 * institutional one is issued now by the caller (RF016 AC4). The container
 * is in scope through the specimen it holds or, empty, through its rack's
 * location, as for placing it.
 * 201; 403 CONTAINER_OUT_OF_SCOPE; 404 CONTAINER_NOT_FOUND; 409 LABEL_EXISTS;
 * 422 VALIDATION_ERROR (a CPF, an e-mail or free text in the value, RULE-012).
 */
router.post('/containers/:containerId/labels', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const containerId = String(req.params.containerId);
    if (!(await (await getCollection(db, 'containers')).findOne({ containerId }))) {
      return res.status(404).json({ success: false, error: 'CONTAINER_NOT_FOUND', message: `Recipiente ${containerId} não encontrado` });
    }
    await scope.assertContainerInScope(db, containerId, req.organizationScope);
    const body = req.body || {};
    const actor = actorId(req);
    const label = await labelResolver.registerLabel(db, {
      ...body,
      targetType: 'container',
      targetId: containerId,
      status: 'active',
      issuedAt: new Date(),
      issuedBy: actor ? String(actor) : null,
    });
    await audit(req, 'LabelIdentifier', label.labelIdentifierId, { containerId, symbology: label.symbology, identifierOrigin: label.identifierOrigin });
    return res.status(201).json({ success: true, data: label });
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
