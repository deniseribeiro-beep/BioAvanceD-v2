const { ObjectId } = require('mongodb');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const physicalChain = require('./physicalChain.service');
const { StorageLocationError, createLocation, findOrCreateLocationByCode } = require('./storageLocation.service');
const { ROOM_LOCATION_TYPE, findLegacyLocation } = require('./facilityRoomLocation.service');

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

// The business specimenId; a legacy sample that has none is keyed by its
// _id, as the custody ledger keys it (#1374).
function specimenIdOf(sample) {
  const specimenId = sample?.specimenId || sample?._id;
  if (!specimenId) throw new Error('specimenId é obrigatório para a cadeia física');
  return String(specimenId);
}

// The keys a specimen's legacy storageAssignments rows may carry: the
// canonical specimenId (#1220) first, then String(_id), as the old writers
// keyed them (#1374).
function legacyRowKeys(sample) {
  return [...new Set([sample?.specimenId, sample?._id]
    .filter((key) => key !== null && key !== undefined && key !== '')
    .map(String))];
}

// The same placement recorded under both keys is one placement: a later row
// with an earlier row's position and placedAt instant is dropped, so it is
// not placed twice over itself. The rows come earliest first.
function dropDuplicatePlacements(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${storagePositionIdFor(row.boxId, row.positionCode)}@${new Date(row.placedAt).getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

// V2E-0683 and V2E-0690 are 1..1: a legacy write (`allocate`,
// `auto-assign`, `move`) names its own event, by the sample and the instant.
function legacyWriteEventId(operation, sample, at) {
  return `legacy-storage-${operation}:${String(sample._id)}:${new Date(at).toISOString()}`;
}

// #1374: primaryContainer reaches V2E-0647 only as a plain, non-blank code.
function containerTypeOf(sample) {
  const code = sample?.primaryContainer;
  return typeof code === 'string' && code.trim() ? code.trim() : UNIDENTIFIED_CONTAINER_TYPE;
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

function freezerLocationCode(freezer) {
  return `${LOCATION_CODE_PREFIX}${String(freezer._id)}`;
}

function freezerLocationData(freezer, organizationId, parentLocationId) {
  const code = freezerLocationCode(freezer);
  return { code, name: freezer.name || code, locationType: 'freezer', parentLocationId, organizationId };
}

// #1379: a freezer's location is found by its code alone, whatever its
// parent, since it may sit under its room's location
// (docs/decisions/2026-10-14-facility-room-locations.md).
async function findFreezerLocation(db, freezer, session) {
  return (await getCollection(db, 'storageLocations')).findOne({ code: freezerLocationCode(freezer) }, sessionOptions(session));
}

// The root FREEZER's location (organizationIdFor resolves only a FREEZER);
// created under its room's location when the room is
// mirrored in the same organization, else at the root.
async function ensureFreezerLocated(db, freezer, organizationId, session) {
  const existing = await findFreezerLocation(db, freezer, session);
  if (existing) return existing;
  const room = freezer.roomId ? await findLegacyLocation(db, ROOM_LOCATION_TYPE, freezer.roomId, session) : null;
  const parentLocationId = room && String(room.organizationId) === organizationId ? room.storageLocationId : null;
  return createLocation(db, freezerLocationData(freezer, organizationId, parentLocationId), { session });
}

// #1379: the one writer of a freezer location's parent. roomLocationRef is a
// room location's storageLocationId, an old Room _id (resolved through its
// `legacy-room:` code), or null to unassign. storageContainers and rooms are
// not written.
async function assignFreezerRoom(db, freezer, roomLocationRef, { session } = {}) {
  const organizationId = await organizationIdFor(db, freezer, session);
  if (!organizationId) {
    throw new StorageLocationError('FREEZER sem organização resolvida', 'FREEZER_ORGANIZATION_UNRESOLVED', 422);
  }
  let roomLocation = null;
  if (roomLocationRef !== null && roomLocationRef !== undefined && roomLocationRef !== '') {
    roomLocation = await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(roomLocationRef) }, sessionOptions(session))
      || await findLegacyLocation(db, ROOM_LOCATION_TYPE, roomLocationRef, session);
    if (!roomLocation || roomLocation.locationType !== ROOM_LOCATION_TYPE) {
      throw new StorageLocationError(`Sala ${roomLocationRef} não encontrada`, 'ROOM_NOT_FOUND', 404);
    }
    if (String(roomLocation.organizationId) !== organizationId) {
      throw new StorageLocationError(`Sala ${roomLocationRef} pertence a outra organização`, 'ROOM_OUT_OF_ORGANIZATION', 422);
    }
  }
  const parentLocationId = roomLocation ? roomLocation.storageLocationId : null;
  const existing = await findFreezerLocation(db, freezer, session);
  if (!existing) {
    const freezerLocation = await createLocation(db, freezerLocationData(freezer, organizationId, parentLocationId), { session });
    return { freezerLocation, roomLocation };
  }
  await (await getCollection(db, 'storageLocations')).updateOne(
    { storageLocationId: existing.storageLocationId },
    { $set: { parentLocationId } },
    sessionOptions(session),
  );
  return { freezerLocation: { ...existing, parentLocationId }, roomLocation };
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

  let parent = await ensureFreezerLocated(db, ancestors[0], organizationId, session);
  for (const container of ancestors.slice(1)) {
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
    containerType: containerTypeOf(sample),
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

// #1374: a specimen placed only through the legacy path is adopted first,
// so a move or release acts on the chain its open legacy row describes.
async function loadedOrAdopted(db, sample, session) {
  const specimenId = specimenIdOf(sample);
  const loaded = await physicalChain.openSpecimenAssignment(db, specimenId, session);
  if (loaded) return loaded;
  const adopted = await adoptLegacyPlacement(db, sample, session);
  return adopted.containerId ? physicalChain.openSpecimenAssignment(db, specimenId, session) : null;
}

// #1378: the specimen's one container, the one its label is issued on: its
// open load, else its adopted legacy placement, else a container created and
// loaded as its first placement would be. Returns the open
// SpecimenContainerAssignment.
async function ensureSpecimenContainer(db, sample, { at, sourceEventId }, session) {
  const loaded = await loadedOrAdopted(db, sample, session);
  if (loaded) return loaded;
  return ensureLoaded(db, sample, { at, sourceEventId }, session);
}

async function moveSpecimen(db, { sample, toBox, toPosition, at, sourceEventId }, session) {
  const movedAt = at || new Date();
  const loaded = await loadedOrAdopted(db, sample, session);
  if (loaded) {
    const current = await physicalChain.openPositionAssignment(db, loaded.containerId, session);
    if (current) await physicalChain.removeContainer(db, current.containerPositionAssignmentId, movedAt, { session });
  }
  return placeSpecimen(db, { sample, box: toBox, position: toPosition, at: movedAt, sourceEventId }, session);
}

// The container leaves its position; the specimen stays in it.
async function releaseSpecimen(db, { sample, at }, session) {
  const loaded = await loadedOrAdopted(db, sample, session);
  if (!loaded) return null;
  const current = await physicalChain.openPositionAssignment(db, loaded.containerId, session);
  if (!current) return null;
  return physicalChain.removeContainer(db, current.containerPositionAssignmentId, at || new Date(), { session });
}

// The chain first; the open legacy StorageAssignment row is a historical
// fallback, read by the canonical specimenId (#1220) first, then by the
// sample's _id, as the old writers keyed it; a canonical row wins where
// both are open. Once the
// specimen is loaded the chain is authoritative: loaded and not placed is
// released, whatever a stale legacy row still says (#1374).
async function currentPlacement(db, sample, session) {
  if (sample?.specimenId || sample?._id) {
    const loaded = await physicalChain.openSpecimenAssignment(db, specimenIdOf(sample), session);
    const placed = loaded && await physicalChain.openPositionAssignment(db, loaded.containerId, session);
    if (loaded && !placed) return null;
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
  const storageAssignments = db.collection('storageAssignments');
  const legacy = (sample?.specimenId
    && await storageAssignments.findOne({ specimenId: String(sample.specimenId), removedAt: null }, sessionOptions(session)))
    || (sample?._id
    && await storageAssignments.findOne({ specimenId: String(sample._id), removedAt: null }, sessionOptions(session)));
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
// The rows are read under both keys (legacyRowKeys), and a placement
// recorded under both is placed once.
async function adoptLegacyPlacement(db, sample, session) {
  const specimenId = specimenIdOf(sample);
  const rows = dropDuplicatePlacements((await db.collection('storageAssignments').find({ specimenId: { $in: legacyRowKeys(sample) } }, sessionOptions(session)).toArray())
    .filter((row) => row.boxId && row.positionCode && row.placedAt)
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt)));
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
  LOCATION_CODE_PREFIX,
  rackIdForBox,
  chainPositionCode,
  legacyPositionCode,
  storagePositionIdFor,
  splitPositionId,
  legacyWriteEventId,
  legacyRowKeys,
  dropDuplicatePlacements,
  organizationIdFor,
  ensureRackLocated,
  assignFreezerRoom,
  placeSpecimen,
  moveSpecimen,
  releaseSpecimen,
  currentPlacement,
  adoptLegacyPlacement,
  ensureSpecimenContainer,
};
