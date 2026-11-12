const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const logger = require('../utils/logger');
const { escapeRegex } = require('../utils/escapeRegex');
const ContainerModel = require('../models/Container');
const SpecimenContainerAssignmentModel = require('../models/SpecimenContainerAssignment');
const ContainerPositionAssignmentModel = require('../models/ContainerPositionAssignment');
const RackLocationAssignmentModel = require('../models/RackLocationAssignment');
const {
  ensureContainerIndexes,
  ensureSpecimenContainerAssignmentIndexes,
  ensureContainerPositionAssignmentIndexes,
  ensureRackLocationAssignmentIndexes,
} = require('../utils/physicalChainIndexes');

// #1314 (RF016 AC1/AC3, RF017 AC3/AC4): the normalized physical chain,
// specimen -> container -> storage position, and rack -> location. Each link
// is an append-only assignment over a half-open interval. A new one is
// checked against every stored assignment sharing its key, the history
// included, so a back-dated load cannot overlap a closed interval either.
// The check and the write share a transaction wherever one runs; the
// partial unique indexes (utils/physicalChainIndexes.js) refuse two OPEN
// assignments on one key even where none runs.
//
// Each write takes an optional `{ session }` last. Given one, the body runs
// in the caller's transaction: it opens none of its own and builds no index,
// since an index build or a session-less write next to an open transaction
// is a write conflict. That caller builds the indexes before it opens one.

class PhysicalChainError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'PhysicalChainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const OPEN = { assignmentStatus: 'active' };
const ensuredDbs = new WeakSet();

// Latched before the await, like the outbox's index build: a persistent
// failure is logged once, and the overlap check still runs without it.
async function ensurePhysicalChainIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await ensureContainerIndexes(await getCollection(db, 'containers'));
    await ensureSpecimenContainerAssignmentIndexes(await getCollection(db, 'specimenContainerAssignments'));
    await ensureContainerPositionAssignmentIndexes(await getCollection(db, 'containerPositionAssignments'));
    await ensureRackLocationAssignmentIndexes(await getCollection(db, 'rackLocationAssignments'));
  } catch (error) {
    logger.warn(`[PHYSICAL_CHAIN] Falha ao criar índices: ${error.message}`);
  }
}

// A historical interval recorded with its end is closed from the start. As
// `active` it would count as open for the partial unique index, and block
// the key's real open assignment.
function closedIfEnded(assignment, endField) {
  return assignment[endField] ? { ...assignment, assignmentStatus: 'ended' } : assignment;
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

// The caller's session, or a transaction of our own wherever one runs.
function inSession(db, session, body) {
  return session ? body(session) : withTransactionWhereSupported(db, body);
}

// A model's assertNoOverlap throws a plain Error; the caller sees a 409.
function assertNoOverlap(Model, candidate, existing) {
  try {
    Model.assertNoOverlap(candidate, existing);
  } catch (error) {
    throw new PhysicalChainError(error.message, 'ASSIGNMENT_OVERLAP', 409);
  }
}

function toValidationError(error) {
  return error instanceof PhysicalChainError ? error : new PhysicalChainError(error.message, 'VALIDATION_ERROR', 422);
}

// A duplicate key on a partial unique index is the same overlap, met by a
// concurrent writer the check could not see.
function toWriteError(error) {
  if (error?.code === 11000) {
    return new PhysicalChainError('Atribuição aberta concorrente para a mesma chave', 'ASSIGNMENT_OVERLAP', 409);
  }
  return error;
}

async function findContainer(db, containerId, session) {
  const container = await (await getCollection(db, 'containers')).findOne({ containerId: String(containerId) }, sessionOptions(session));
  if (!container) {
    throw new PhysicalChainError(`Recipiente ${containerId} não encontrado`, 'CONTAINER_NOT_FOUND', 404);
  }
  return container;
}

async function setContainerContent(db, containerId, session) {
  const assignments = await getCollection(db, 'specimenContainerAssignments');
  const open = await assignments.findOne({ containerId, ...OPEN }, sessionOptions(session));
  const { emptyStatus } = ContainerModel.withContent({}, Boolean(open));
  await (await getCollection(db, 'containers')).updateOne({ containerId }, { $set: { emptyStatus } }, sessionOptions(session));
}

async function createContainer(db, data, { session } = {}) {
  if (!session) await ensurePhysicalChainIndexes(db);
  let container;
  try {
    container = ContainerModel.create({ ...data, emptyStatus: 'empty' });
  } catch (error) {
    throw toValidationError(error);
  }
  try {
    await (await getCollection(db, 'containers')).insertOne(container, sessionOptions(session));
  } catch (error) {
    if (error?.code === 11000) throw new PhysicalChainError(`Recipiente ${container.containerId} já existe`, 'CONTAINER_EXISTS', 409);
    throw error;
  }
  return container;
}

// RF017 AC3/AC4: a specimen enters a container. The container becomes
// occupied (RULE-031/RULE-032).
async function loadSpecimen(db, data, { session: callerSession } = {}) {
  if (!callerSession) await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(SpecimenContainerAssignmentModel.create(data), 'unloadedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return inSession(db, callerSession, async (session) => {
    await findContainer(db, candidate.containerId, session);
    const assignments = await getCollection(db, 'specimenContainerAssignments');
    const existing = await assignments.find({ specimenId: candidate.specimenId }, sessionOptions(session)).toArray();
    assertNoOverlap(SpecimenContainerAssignmentModel, candidate, existing);
    try {
      await assignments.insertOne(candidate, sessionOptions(session));
    } catch (error) {
      throw toWriteError(error);
    }
    await setContainerContent(db, candidate.containerId, session);
    return candidate;
  });
}

// `filter` names the assignment by its own id field, a literal key.
async function closeAssignment(db, { collectionName, filter, id, Model, close, endField, end }, { session: callerSession } = {}) {
  return inSession(db, callerSession, async (session) => {
    const collection = await getCollection(db, collectionName);
    const current = await collection.findOne(filter, sessionOptions(session));
    if (!current) {
      throw new PhysicalChainError(`Atribuição ${id} não encontrada`, 'ASSIGNMENT_NOT_FOUND', 404);
    }
    if (current.assignmentStatus !== 'active') {
      throw new PhysicalChainError(`Atribuição ${id} já foi encerrada`, 'ASSIGNMENT_ENDED', 409);
    }
    let closed;
    try {
      closed = Model[close](current, end || new Date());
    } catch (error) {
      throw toValidationError(error);
    }
    await collection.updateOne(
      { ...filter, assignmentStatus: 'active' },
      { $set: { [endField]: closed[endField], assignmentStatus: closed.assignmentStatus } },
      sessionOptions(session)
    );
    if (collectionName === 'specimenContainerAssignments') {
      await setContainerContent(db, current.containerId, session);
    }
    return closed;
  });
}

async function unloadSpecimen(db, specimenContainerAssignmentId, unloadedAt, { session } = {}) {
  return closeAssignment(db, {
    collectionName: 'specimenContainerAssignments', filter: { specimenContainerAssignmentId: String(specimenContainerAssignmentId) }, id: specimenContainerAssignmentId,
    Model: SpecimenContainerAssignmentModel, close: 'unload', endField: 'unloadedAt', end: unloadedAt,
  }, { session });
}

// A position is one of its rack's prepared grid rows (POST /racks writes
// them), matched by its exact id: `A1` and `a01` are not `A01`.
async function assertPreparedPosition(db, storagePositionId, session) {
  const row = await (await getCollection(db, 'storagePositions')).findOne({ storagePositionId }, sessionOptions(session));
  if (!row) {
    throw new PhysicalChainError(`Posição ${storagePositionId} não pertence à grade preparada do seu rack`, 'POSITION_NOT_IN_GRID', 422);
  }
}

// RF017 AC2, RULE-030: a container takes a position; neither may hold
// another over the same interval. requirePreparedPosition refuses a position
// that is not one of its rack's StoragePosition rows (RF016 AC2, #1532); the
// legacy box bridge does not pass it, since a box has no such rows.
async function placeContainer(db, data, { session: callerSession, requirePreparedPosition = false } = {}) {
  if (!callerSession) await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(ContainerPositionAssignmentModel.create(data), 'removedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return inSession(db, callerSession, async (session) => {
    await findContainer(db, candidate.containerId, session);
    if (requirePreparedPosition) await assertPreparedPosition(db, candidate.storagePositionId, session);
    const assignments = await getCollection(db, 'containerPositionAssignments');
    const existing = await assignments.find({
      $or: [{ containerId: candidate.containerId }, { storagePositionId: candidate.storagePositionId }],
    }, sessionOptions(session)).toArray();
    assertNoOverlap(ContainerPositionAssignmentModel, candidate, existing);
    try {
      await assignments.insertOne(candidate, sessionOptions(session));
    } catch (error) {
      throw toWriteError(error);
    }
    return candidate;
  });
}

async function removeContainer(db, containerPositionAssignmentId, removedAt, { session } = {}) {
  return closeAssignment(db, {
    collectionName: 'containerPositionAssignments', filter: { containerPositionAssignmentId: String(containerPositionAssignmentId) }, id: containerPositionAssignmentId,
    Model: ContainerPositionAssignmentModel, close: 'remove', endField: 'removedAt', end: removedAt,
  }, { session });
}

// RULE-035: a rack is in one location at a time.
async function locateRack(db, data, { session: callerSession } = {}) {
  if (!callerSession) await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(RackLocationAssignmentModel.create(data), 'removedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return inSession(db, callerSession, async (session) => {
    const assignments = await getCollection(db, 'rackLocationAssignments');
    const existing = await assignments.find({ storageRackId: candidate.storageRackId }, sessionOptions(session)).toArray();
    assertNoOverlap(RackLocationAssignmentModel, candidate, existing);
    try {
      await assignments.insertOne(candidate, sessionOptions(session));
    } catch (error) {
      throw toWriteError(error);
    }
    return candidate;
  });
}

async function removeRack(db, rackLocationAssignmentId, removedAt, { session } = {}) {
  return closeAssignment(db, {
    collectionName: 'rackLocationAssignments', filter: { rackLocationAssignmentId: String(rackLocationAssignmentId) }, id: rackLocationAssignmentId,
    Model: RackLocationAssignmentModel, close: 'remove', endField: 'removedAt', end: removedAt,
  }, { session });
}

// The specimen's open container assignment, or null.
async function openSpecimenAssignment(db, specimenId, session) {
  return (await getCollection(db, 'specimenContainerAssignments')).findOne({ specimenId: String(specimenId), ...OPEN }, sessionOptions(session));
}

// The container's open position assignment, or null.
async function openPositionAssignment(db, containerId, session) {
  return (await getCollection(db, 'containerPositionAssignments')).findOne({ containerId: String(containerId), ...OPEN }, sessionOptions(session));
}

function heldAt(assignment, from, to, at) {
  const t = at.getTime();
  return new Date(assignment[from]).getTime() <= t && (!assignment[to] || t < new Date(assignment[to]).getTime());
}

// RF016 AC3: where a specimen was at an instant, walked link by link. A
// position id is the rack's `<storageRackId>:<position>` (StorageRack.js),
// so the rack's own location is read from it. A missing link ends the walk.
async function resolveSpecimenLocation(db, specimenId, at = new Date()) {
  const instant = new Date(at);
  const pick = async (name, filter, from, to) => {
    const rows = await (await getCollection(db, name)).find(filter).toArray();
    return rows.find((row) => heldAt(row, from, to, instant)) || null;
  };

  const specimenAssignment = await pick('specimenContainerAssignments', { specimenId: String(specimenId) }, 'loadedAt', 'unloadedAt');
  const result = { specimenId: String(specimenId), at: instant, containerId: null, storagePositionId: null, storageRackId: null, storageLocationId: null };
  if (!specimenAssignment) return result;
  result.containerId = specimenAssignment.containerId;

  const positionAssignment = await pick('containerPositionAssignments', { containerId: result.containerId }, 'placedAt', 'removedAt');
  if (!positionAssignment) return result;
  result.storagePositionId = positionAssignment.storagePositionId;

  const separator = result.storagePositionId.lastIndexOf(':');
  if (separator <= 0) return result;
  result.storageRackId = result.storagePositionId.slice(0, separator);
  const rackAssignment = await pick('rackLocationAssignments', { storageRackId: result.storageRackId }, 'placedAt', 'removedAt');
  if (rackAssignment) result.storageLocationId = rackAssignment.storageLocationId;
  return result;
}

function validTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function endTime(value) {
  return validTime(value) ?? Infinity;
}

// #1392 (RF009 AC5): the specimens whose chain puts them at a location at
// some instant of the closed window [from, to], read backward from the
// location through its racks, their positions and the containers there.
async function specimenIdsAtLocation(db, storageLocationId, { from, to } = {}) {
  const locationId = storageLocationId === undefined || storageLocationId === null ? '' : String(storageLocationId);
  let fromTime = validTime(from);
  const toTime = validTime(to);
  if (!locationId || fromTime === null || toTime === null) return [];
  if (fromTime > toTime) fromTime = toTime;

  const rlas = (await (await getCollection(db, 'rackLocationAssignments')).find({ storageLocationId: locationId }).toArray())
    .filter((rla) => rla && String(rla.storageLocationId) === locationId);
  const rlasByRack = new Map();
  for (const rla of rlas) {
    const rackId = String(rla.storageRackId || '');
    if (!rackId) continue;
    if (!rlasByRack.has(rackId)) rlasByRack.set(rackId, []);
    rlasByRack.get(rackId).push(rla);
  }

  const cpaCollection = await getCollection(db, 'containerPositionAssignments');
  const scaCollection = await getCollection(db, 'specimenContainerAssignments');
  const scasByContainer = new Map();
  const specimenIds = new Set();
  for (const [rackId, rackRlas] of rlasByRack) {
    // A position id is `<storageRackId>:<position>`, read as resolveSpecimenLocation reads it.
    const cpas = (await cpaCollection.find({ storagePositionId: { $regex: '^' + escapeRegex(rackId) + ':[^:]+$' } }).toArray())
      .filter((cpa) => {
        const positionId = String(cpa?.storagePositionId || '');
        const separator = positionId.lastIndexOf(':');
        return separator > 0 && positionId.slice(0, separator) === rackId;
      });
    for (const cpa of cpas) {
      const containerId = cpa.containerId;
      if (!scasByContainer.has(containerId)) {
        scasByContainer.set(containerId, (await scaCollection.find({ containerId }).toArray())
          .filter((sca) => sca && sca.containerId === containerId));
      }
      for (const sca of scasByContainer.get(containerId)) {
        for (const rla of rackRlas) {
          const start = Math.max(validTime(sca.loadedAt) ?? -Infinity, validTime(cpa.placedAt) ?? -Infinity, validTime(rla.placedAt) ?? -Infinity);
          const end = Math.min(endTime(sca.unloadedAt), endTime(cpa.removedAt), endTime(rla.removedAt));
          if (start < end && start <= toTime && fromTime < end && sca.specimenId) specimenIds.add(String(sca.specimenId));
        }
      }
    }
  }
  return [...specimenIds].sort();
}

module.exports = {
  PhysicalChainError,
  ensurePhysicalChainIndexes,
  createContainer,
  loadSpecimen,
  unloadSpecimen,
  placeContainer,
  removeContainer,
  locateRack,
  removeRack,
  openSpecimenAssignment,
  openPositionAssignment,
  resolveSpecimenLocation,
  specimenIdsAtLocation,
};
