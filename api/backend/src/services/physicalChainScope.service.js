const { getCollection } = require('../utils/collectionResolver');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const { currentCustody } = require('./custodianship.service');

// #1314, #1316: organization bounds for the physical-chain and custody
// routes. Containers, positions and racks carry no organization, so a
// specimen's tenancy is its custodian at the instant (RF021 AC4), never the
// recorded collection site. A specimen with no custody is in no
// organization's scope but a global caller's, with one exception: the first
// custody of a specimen is assigned by its collection site's organization,
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
// current custody, or, for its first one, by its collection site's
// organization, and only to one of the caller's own organizations.
async function assertCustodyAssignable(db, { specimenId, custodianOrganizationId }, organizationScope, at = new Date()) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return;
  if (!inScope(organizationScope, custodianOrganizationId)) {
    throw new ScopeError(`Organização custodiante ${custodianOrganizationId} fora do escopo do solicitante`, 'CUSTODIAN_OUT_OF_SCOPE');
  }
  const sample = await findSampleByAnyId(await getCollection(db, 'samples'), specimenId);
  if (!sample) return; // the service answers its own 404
  const custody = await currentCustody(db, sample.specimenId, at);
  const holder = custody ? custody.custodianOrganizationId : sample.collectionSite;
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

// A container is in scope through the specimen it holds. An empty one
// belongs to no organization, so only a global caller may move it.
async function assertContainerInScope(db, containerId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global') return;
  const open = await (await getCollection(db, 'specimenContainerAssignments')).findOne({ containerId: String(containerId), assignmentStatus: 'active' });
  if (!open) {
    throw new ScopeError(`Recipiente ${containerId} vazio: sem organização que o delimite`, 'CONTAINER_OUT_OF_SCOPE');
  }
  await assertSpecimenInScope(db, open.specimenId, organizationScope);
}

// No StorageLocation record carries an organization yet, so a rack's
// location is moved by a global caller only.
function assertGlobalScope(organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope !== 'global') {
    throw new ScopeError('Localização de rack sem organização registrada: apenas escopo global', 'GLOBAL_SCOPE_REQUIRED');
  }
}

module.exports = {
  ScopeError,
  specimenInScope,
  assertSpecimenInScope,
  assertCustodyAssignable,
  assertCustodianInScope,
  assertContainerInScope,
  assertGlobalScope,
};
