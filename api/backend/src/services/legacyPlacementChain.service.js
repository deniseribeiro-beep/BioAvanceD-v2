const { ObjectId } = require('mongodb');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const physicalChain = require('./physicalChain.service');
const { findOrCreateLocationByCode } = require('./storageLocation.service');

// #1314: the bridge from a legacy box placement (storageBoxes, a position
// code such as `A1`) to the normalized physical chain: specimen ->
// Container -> StoragePosition -> StorageRack -> StorageLocation. The
// StorageAssignment family (ELM-0167..0178) is kept for historical reads
// only; a placement is written here instead. The decisions are recorded in
// docs/decisions/2026-10-11-legacy-placement-chain.md.
//
// Every write takes the caller's session and runs in its transaction: no
// index build, no counter, no read or write outside it. The caller builds
// the chain's indexes (utils/physicalChainIndexes.js) before it opens one.

// V2E-0647 is 1..1. A specimen with no primaryContainer (ELM-0136, 0..1)
// still sits in something; this code says it was not identified.
const UNIDENTIFIED_CONTAINER_TYPE = 'unidentified_container';
const LOCATION_CODE_PREFIX = 'legacy-storage-container:';
const LEGACY_ASSIGNMENT_EVENT_PREFIX = 'legacy-storage-assignment:';
const LEGACY_BOX_EVENT_PREFIX = 'legacy-storage-box:';
// FREEZER -> SHELF -> RACK -> DRAWER -> box; a longer walk is a cycle.
const MAX_ANCESTORS = 8;

function sessionOptions(session) {
  return session ? { session } : undefined;
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(String(id)) && String(id).length === 24 ? new ObjectId(String(id)) : id;
}

function specimenIdOf(sample) {
  const specimenId = sample?.specimenId;
  if (!specimenId) throw new Error('specimenId é obrigatório para a cadeia física');
  return String(specimenId);
}

function rackIdForBox(box) {
  return String(box?._id ?? box);
}

// `A1` -> `A01`, the StoragePosition form of the approved example.
function chainPositionCode(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  const match = raw.match(/^([A-Z]+)0*(\d+)$/);
  return match ? `${match[1]}${match[2].padStart(2, '0')}` : raw;
}

// `A01` -> `A1`, the form the legacy API accepts and echoes.
function legacyPositionCode(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  const match = raw.match(/^([A-Z]+)0*(\d+)$/);
  return match ? `${match[1]}${Number(match[2])}` : raw;
}

function storagePositionIdFor(box, position) {
  return `${rackIdForBox(box)}:${chainPositionCode(position)}`;
}

function splitPositionId(storagePositionId) {
  const separator = String(storagePositionId).lastIndexOf(':');
  if (separator <= 0) return { storageRackId: null, code: null };
  return { storageRackId: storagePositionId.slice(0, separator), code: storagePositionId.slice(separator + 1) };
}

function sameInstant(a, b) {
  return new Date(a).getTime() === new Date(b).getTime();
}

// The box's ancestors, root (the FREEZER) first.
async function ancestorsOf(db, box, session) {
  const storageContainers = db.collection('storageContainers');
  const chain = [];
  let parentId = box?.parent_id || null;
  while (parentId && chain.length < MAX_ANCESTORS) {
    const container = await storageContainers.findOne({ _id: parentId }, sessionOptions(session));
    if (!container) break;
    chain.unshift(container);
    parentId = container.parent_id || null;
  }
  return chain;
}

function idVariants(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? [raw, numeric] : [raw];
}

// P1X-0103 is 1..1: the root freezer's Equipment names the organization, as
// StorageTopologyAuthoringService.assertTreeInScope resolves it, and it must
// be a stored organizationId.
async function organizationIdFor(db, root, session) {
  if (root?.containerType !== 'FREEZER') return null;
  const variants = idVariants(root.containerID);
  if (!variants.length) return null;
  const equipment = await db.collection('equipment').findOne({ equipmentID: { $in: variants }, deletedAt: null }, sessionOptions(session));
  if (!equipment?.organizationId) return null;
  const organizationId = String(equipment.organizationId);
  const organization = await (await getCollection(db, 'organizations')).findOne({ organizationId }, sessionOptions(session));
  return organization ? organizationId : null;
}

// RULE-035: the box, as a StorageRack, is located at its immediate parent,
// mirrored with every ancestor as a StorageLocation. With no organization
// the chain ends at the rack: no location and no assignment are written.
async function ensureRackLocated(db, box, session, { at, sourceEventId } = {}) {
  const storageRackId = rackIdForBox(box);
  const assignments = await getCollection(db, 'rackLocationAssignments');
  const open = await assignments.findOne({ storageRackId, assignmentStatus: 'active' }, sessionOptions(session));
  if (open) return open;

  const ancestors = await ancestorsOf(db, box, session);
  const organizationId = ancestors.length ? await organizationIdFor(db, ancestors[0], session) : null;
  if (!organizationId) {
    logger.warn(`[LEGACY_PLACEMENT] Rack ${storageRackId} sem organização resolvida; a cadeia termina no rack`);
    return null;
  }

  let parent = null;
  for (const container of ancestors) {
    const code = `${LOCATION_CODE_PREFIX}${String(container._id)}`;
    parent = await findOrCreateLocationByCode(db, {
      code,
      name: container.name || code,
      locationType: String(container.containerType || 'unknown').toLowerCase(),
      parentLocationId: parent ? parent.storageLocationId : null,
      organizationId,
    }, session);
  }
  return physicalChain.locateRack(db, {
    storageRackId,
    storageLocationId: parent.storageLocationId,
    sourceEventId: sourceEventId || `${LEGACY_BOX_EVENT_PREFIX}${storageRackId}`,
    placedAt: at,
  }, { session });
}

// One container per specimen, created and loaded at its first placement
// and kept loaded through release.
async function ensureLoaded(db, sample, { at, sourceEventId }, session) {
  const specimenId = specimenIdOf(sample);
  const open = await physicalChain.openSpecimenAssignment(db, specimenId, session);
  if (open) return open;
  const container = await physicalChain.createContainer(db, {
    containerType: sample.primaryContainer || UNIDENTIFIED_CONTAINER_TYPE,
  }, { session });
  return physicalChain.loadSpecimen(db, {
    specimenId, containerId: container.containerId, sourceEventId, loadedAt: at,
  }, { session });
}

async function placeSpecimen(db, { sample, box, position, at, sourceEventId }, session) {
  const placedAt = at || new Date();
  const loaded = await ensureLoaded(db, sample, { at: placedAt, sourceEventId }, session);
  const placed = await physicalChain.placeContainer(db, {
    containerId: loaded.containerId, storagePositionId: storagePositionIdFor(box, position), placedAt,
  }, { session });
  const rackLocation = await ensureRackLocated(db, box, session, { at: placedAt, sourceEventId });
  return { specimenContainerAssignment: loaded, containerPositionAssignment: placed, rackLocationAssignment: rackLocation };
}

async function moveSpecimen(db, { sample, toBox, toPosition, at, sourceEventId }, session) {
  const movedAt = at || new Date();
  const loaded = await physicalChain.openSpecimenAssignment(db, specimenIdOf(sample), session);
  if (loaded) {
    const current = await physicalChain.openPositionAssignment(db, loaded.containerId, session);
    if (current) await physicalChain.removeContainer(db, current.containerPositionAssignmentId, movedAt, { session });
  }
  return placeSpecimen(db, { sample, box: toBox, position: toPosition, at: movedAt, sourceEventId }, session);
}

// The container leaves its position; the specimen stays in it.
async function releaseSpecimen(db, { sample, at }, session) {
  const loaded = await physicalChain.openSpecimenAssignment(db, specimenIdOf(sample), session);
  if (!loaded) return null;
  const current = await physicalChain.openPositionAssignment(db, loaded.containerId, session);
  if (!current) return null;
  return physicalChain.removeContainer(db, current.containerPositionAssignmentId, at || new Date(), { session });
}

// The chain first; the open legacy StorageAssignment row is a historical
// fallback, keyed as its writer keyed it, by the sample's _id.
async function currentPlacement(db, sample, session) {
  if (sample?.specimenId) {
    const loaded = await physicalChain.openSpecimenAssignment(db, sample.specimenId, session);
    const placed = loaded && await physicalChain.openPositionAssignment(db, loaded.containerId, session);
    if (placed) {
      const { storageRackId, code } = splitPositionId(placed.storagePositionId);
      const rackLocation = storageRackId
        ? await (await getCollection(db, 'rackLocationAssignments')).findOne({ storageRackId, assignmentStatus: 'active' }, sessionOptions(session))
        : null;
      const embedded = sample.storageLocation?.position;
      return {
        boxId: storageRackId,
        positionCode: embedded && chainPositionCode(embedded) === code ? embedded : legacyPositionCode(code),
        containerId: loaded.containerId,
        storagePositionId: placed.storagePositionId,
        storageRackId,
        storageLocationId: rackLocation ? rackLocation.storageLocationId : null,
        placedAt: placed.placedAt,
        source: 'physical_chain',
      };
    }
  }
  if (!sample?._id) return null;
  const legacy = await db.collection('storageAssignments').findOne({ specimenId: String(sample._id), removedAt: null }, sessionOptions(session));
  if (!legacy) return null;
  return {
    boxId: legacy.boxId,
    positionCode: legacy.positionCode,
    containerId: null,
    storagePositionId: null,
    storageRackId: null,
    storageLocationId: null,
    placedAt: legacy.placedAt,
    source: 'legacy_storage_assignment',
  };
}

// The specimen's StorageAssignment rows, decomposed into the chain: one
// container loaded from the earliest placement, one position assignment per
// row over [placedAt, removedAt), and each box located. A second run finds
// what the first wrote and writes nothing. storageAssignments is only read.
async function adoptLegacyPlacement(db, sample, session) {
  const specimenId = specimenIdOf(sample);
  const rows = (await db.collection('storageAssignments').find({ specimenId: String(sample._id) }, sessionOptions(session)).toArray())
    .filter((row) => row.boxId && row.positionCode && row.placedAt)
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
  const result = { containerId: null, positionAssignments: 0, rackLocations: 0 };
  if (!rows.length) return result;

  const eventFor = (row) => `${LEGACY_ASSIGNMENT_EVENT_PREFIX}${row.storageAssignmentId}`;
  const loads = await getCollection(db, 'specimenContainerAssignments');
  const adopted = await loads.findOne({ specimenId, sourceEventId: eventFor(rows[0]) }, sessionOptions(session));
  const loaded = adopted || await ensureLoaded(db, sample, { at: rows[0].placedAt, sourceEventId: eventFor(rows[0]) }, session);
  result.containerId = loaded.containerId;

  // ContainerPositionAssignment has no sourceEventId (V2E-0670..0676), so a
  // row is recognised by its container, position and start.
  const placements = await getCollection(db, 'containerPositionAssignments');
  const existing = await placements.find({ containerId: loaded.containerId }, sessionOptions(session)).toArray();
  const boxes = new Map();
  for (const row of rows) {
    const storagePositionId = storagePositionIdFor(row.boxId, row.positionCode);
    if (!boxes.has(String(row.boxId))) boxes.set(String(row.boxId), row);
    if (existing.some((cpa) => cpa.storagePositionId === storagePositionId && sameInstant(cpa.placedAt, row.placedAt))) continue;
    await physicalChain.placeContainer(db, {
      containerId: loaded.containerId, storagePositionId, placedAt: row.placedAt, removedAt: row.removedAt || null,
    }, { session });
    result.positionAssignments += 1;
  }

  for (const [boxId, row] of boxes) {
    const box = await db.collection('storageBoxes').findOne({ _id: toObjectId(boxId) }, sessionOptions(session));
    if (!box) continue;
    const before = await (await getCollection(db, 'rackLocationAssignments')).findOne({ storageRackId: boxId, assignmentStatus: 'active' }, sessionOptions(session));
    if (before) continue;
    if (await ensureRackLocated(db, box, session, { at: row.placedAt, sourceEventId: eventFor(row) })) result.rackLocations += 1;
  }
  return result;
}

module.exports = {
  UNIDENTIFIED_CONTAINER_TYPE,
  rackIdForBox,
  chainPositionCode,
  legacyPositionCode,
  storagePositionIdFor,
  ensureRackLocated,
  placeSpecimen,
  moveSpecimen,
  releaseSpecimen,
  currentPlacement,
  adoptLegacyPlacement,
};
