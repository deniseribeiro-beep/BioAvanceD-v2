const { getCollection } = require('../utils/collectionResolver');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const { currentCustody } = require('./custodianship.service');
const { splitPositionId } = require('./legacyPlacementChain.service');
const { sampleOrganizationOf } = require('./sampleTenancy.service');

// #1314, #1316: organization bounds for the physical-chain and custody
// routes. Containers and positions carry no organization, and a rack's is
// its StorageLocation's, so a specimen's tenancy is its custodian at the
// instant (RF021 AC4), never the
// recorded collection site. A specimen with no custody is in no
// organization's scope but a global caller's, with one exception: the first
// custody of a specimen is assigned by the sample's organization (#1192),
// since nothing else names one yet.
//
// A missing scope fails closed (#1081). Out of scope is a 403.

class ScopeError extends Error {
  constructor(message, code = 'OUT_OF_SCOPE', statusCode = 403) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertScopePresent(organizationScope) {
  if (!organizationScope) {
    throw new ScopeError('Escopo organizacional não resolvido', 'ORGANIZATION_SCOPE_REQUIRED');
  }
}

function inScope(organizationScope, organizationId) {
  return organizationScope.scope === 'global'
    || (Boolean(organizationId) && organizationScope.organizationIds.includes(String(organizationId)));
}

// Whether the caller may act on the specimen now: its current custodian is
// one of the caller's organizations.
async function specimenInScope(db, specimenId, organizationScope, at = new Date()) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return true;
  const custody = await currentCustody(db, specimenId, at);
  return Boolean(custody) && inScope(organizationScope, custody.custodianOrganizationId);
}

async function assertSpecimenInScope(db, specimenId, organizationScope, at = new Date()) {
  if (!(await specimenInScope(db, specimenId, organizationScope, at))) {
    throw new ScopeError(`Espécime ${specimenId} fora do escopo organizacional (custódia de outra organização ou nenhuma)`, 'SPECIMEN_OUT_OF_SCOPE');
  }
}

// RF021 AC4: a custody may be assigned by the holder of the specimen's
// current custody, or, for its first one, by the sample's organization
// (#1192), and only to one of the caller's own organizations.
async function assertCustodyAssignable(db, { specimenId, custodianOrganizationId }, organizationScope, at = new Date()) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return;
  if (!inScope(organizationScope, custodianOrganizationId)) {
    throw new ScopeError(`Organização custodiante ${custodianOrganizationId} fora do escopo do solicitante`, 'CUSTODIAN_OUT_OF_SCOPE');
  }
  const sample = await findSampleByAnyId(await getCollection(db, 'samples'), specimenId);
  if (!sample) return; // the service answers its own 404
  const custody = await currentCustody(db, sample.specimenId, at);
  const holder = custody ? custody.custodianOrganizationId : sampleOrganizationOf(sample);
  if (!inScope(organizationScope, holder)) {
    throw new ScopeError(`Espécime ${specimenId} sob custódia ou coleta de outra organização`, 'SPECIMEN_OUT_OF_SCOPE');
  }
}

// A custody may be ended by its custodian.
function assertCustodianInScope(assignment, organizationScope) {
  assertScopePresent(organizationScope);
  if (!inScope(organizationScope, assignment.custodianOrganizationId)) {
    throw new ScopeError(`Atribuição ${assignment.custodianshipAssignmentId} pertence a outra organização`, 'CUSTODIAN_OUT_OF_SCOPE');
  }
}

const OPEN = { assignmentStatus: 'active' };

// The organization of the location a position's rack is open at: the rack
// is the position id before its last ':', and the location's organization
// is 1..1 (P1X-0103). Null when the rack is located nowhere.
async function positionOrganizationId(db, storagePositionId) {
  const { storageRackId } = splitPositionId(storagePositionId ?? '');
  if (!storageRackId) return null;
  const rack = await (await getCollection(db, 'rackLocationAssignments')).findOne({ storageRackId, ...OPEN });
  if (!rack) return null;
  const location = await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(rack.storageLocationId) });
  return location?.organizationId ?? null;
}

// Whether the caller holds the location the position's rack is at.
async function positionInScope(db, storagePositionId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return true;
  return inScope(organizationScope, await positionOrganizationId(db, storagePositionId));
}

// A container is in scope through the specimen it holds. An empty one
// carries no organization (V2E-0646..0654), so it is in scope through the
// location its position's rack is at; an empty, unplaced one is a global
// caller's only.
async function assertContainerInScope(db, containerId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return;
  const open = await (await getCollection(db, 'specimenContainerAssignments')).findOne({ containerId: String(containerId), ...OPEN });
  if (open) {
    await assertSpecimenInScope(db, open.specimenId, organizationScope);
    return;
  }
  const placed = await (await getCollection(db, 'containerPositionAssignments')).findOne({ containerId: String(containerId), ...OPEN });
  if (!placed || !(await positionInScope(db, placed.storagePositionId, organizationScope))) {
    throw new ScopeError(`Recipiente ${containerId} vazio e fora de local da organização do solicitante`, 'CONTAINER_OUT_OF_SCOPE');
  }
}

// A StorageLocation is created under one of the caller's organizations.
function assertOrganizationInScope(organizationScope, organizationId) {
  assertScopePresent(organizationScope);
  if (!inScope(organizationScope, organizationId)) {
    throw new ScopeError(`Organização ${organizationId} fora do escopo do solicitante`, 'LOCATION_OUT_OF_SCOPE');
  }
}

// A rack is in scope through the StorageLocation it is placed at, whose
// organization is 1..1 (P1X-0103). An unknown location is the service's
// 404, answered here for a global caller too.
async function assertLocationInScope(db, storageLocationId, organizationScope) {
  assertScopePresent(organizationScope);
  const location = await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(storageLocationId) });
  if (!location) {
    throw new ScopeError(`Local ${storageLocationId} não encontrado`, 'LOCATION_NOT_FOUND', 404);
  }
  if (!inScope(organizationScope, location.organizationId)) {
    throw new ScopeError(`Local ${storageLocationId} pertence a outra organização`, 'LOCATION_OUT_OF_SCOPE');
  }
  return location;
}

// #1513 (RF016 AC2): a rack's grid is in scope through the location the rack
// is open at, or else the location its StorageRack row names. A rack
// located nowhere is a global caller's only, as an empty, unplaced
// container is.
async function assertRackInScope(db, storageRackId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return;
  const id = String(storageRackId);
  const open = await (await getCollection(db, 'rackLocationAssignments')).findOne({ storageRackId: id, ...OPEN });
  const rack = open ? null : await (await getCollection(db, 'storageRacks')).findOne({ storageRackId: id });
  const storageLocationId = open?.storageLocationId ?? rack?.storageLocationId ?? null;
  const location = storageLocationId
    ? await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(storageLocationId) })
    : null;
  const rackOrganizationId = location?.organizationId ?? null;
  if (!inScope(organizationScope, rackOrganizationId)) {
    throw new ScopeError(`Rack ${storageRackId} fora de local da organização do solicitante`, 'RACK_OUT_OF_SCOPE');
  }
}

module.exports = {
  ScopeError,
  specimenInScope,
  assertSpecimenInScope,
  assertCustodyAssignable,
  assertCustodianInScope,
  assertContainerInScope,
  positionInScope,
  assertOrganizationInScope,
  assertLocationInScope,
  assertRackInScope,
};
