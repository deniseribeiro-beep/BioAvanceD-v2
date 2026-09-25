const { ObjectId } = require('mongodb');
const { getCollection } = require('../utils/collectionResolver');
const { isRecordInOrganizationScope } = require('./rbac-assignment.service');
const { StorageTopologyAuthoringService, topologyError } = require('./storage-topology-authoring.service');

/**
 * #1211: organization bounds for the storage routes that act on an existing
 * specimen, box or container.
 *
 * A specimen is scoped by collectionSite, the same key every sample route
 * filters on. That field is also the recorded collection site, and #1192
 * tracks separating the two; until then it is the only tenancy key a sample
 * has. A box or container has no organizationId of its own, so its scope is
 * its root freezer's Equipment's, exactly as the topology creates check it
 * (#1210).
 *
 * Each check looks the record up the way the storage repository does (by
 * _id, through toObjectId's fallback) and returns quietly when it is absent,
 * so the controller still answers its own 404 or 400. Out of scope throws a
 * 403-coded error. A missing scope fails closed, never open (#1081).
 */

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
  return id;
}

function assertScopePresent(organizationScope) {
  if (!organizationScope) {
    throw topologyError('ORGANIZATION_SCOPE_REQUIRED', 'Escopo organizacional não resolvido', 403);
  }
}

async function assertSampleInScope(db, sampleId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global' || sampleId === undefined || sampleId === null) return;
  const samples = await getCollection(db, 'samples');
  const sample = await samples.findOne({ _id: toObjectId(sampleId) });
  if (!sample) return;
  if (!isRecordInOrganizationScope(sample, organizationScope, 'collectionSite')) {
    throw topologyError('SAMPLE_OUT_OF_SCOPE', 'A amostra pertence a outra organização', 403);
  }
}

async function assertBoxInScope(db, boxId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global' || boxId === undefined || boxId === null) return;
  const box = await db.collection('storageBoxes').findOne({ _id: toObjectId(boxId) });
  if (!box) return;
  await new StorageTopologyAuthoringService(db).assertTreeInScope(box, organizationScope);
}

async function assertContainerInScope(db, containerId, organizationScope) {
  assertScopePresent(organizationScope);
  if (organizationScope.scope === 'global' || containerId === undefined || containerId === null) return;
  const container = await db.collection('storageContainers').findOne({ _id: toObjectId(containerId) });
  if (!container) return;
  await new StorageTopologyAuthoringService(db).assertTreeInScope(container, organizationScope);
}

module.exports = {
  assertSampleInScope,
  assertBoxInScope,
  assertContainerInScope,
};
