const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const logger = require('../utils/logger');
const ContainerModel = require('../models/Container');
const SpecimenContainerAssignmentModel = require('../models/SpecimenContainerAssignment');
const ContainerPositionAssignmentModel = require('../models/ContainerPositionAssignment');
const RackLocationAssignmentModel = require('../models/RackLocationAssignment');

// #1314 (RF016 AC1/AC3, RF017 AC3/AC4): the normalized physical chain,
// specimen -> container -> storage position, and rack -> location. Each link
// is an append-only assignment over a half-open interval. A new one is
// checked against every stored assignment sharing its key, the history
// included, so a back-dated load cannot overlap a closed interval either.
// The check and the write share a transaction wherever one runs; the
// partial unique indexes below refuse two OPEN assignments on one key even
// where none runs.

class PhysicalChainError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'PhysicalChainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const OPEN = { assignmentStatus: 'active' };
const INDEXES = [
  ['specimenContainerAssignments', { specimenId: 1 }, 'uniq_open_specimen'],
  ['specimenContainerAssignments', { containerId: 1 }, null],
  ['containerPositionAssignments', { containerId: 1 }, 'uniq_open_container'],
  ['containerPositionAssignments', { storagePositionId: 1 }, 'uniq_open_position'],
  ['rackLocationAssignments', { storageRackId: 1 }, 'uniq_open_rack'],
];
const ensuredDbs = new WeakSet();

// Latched before the await, like the outbox's index build: a persistent
// failure is logged once, and the overlap check still runs without it.
async function ensurePhysicalChainIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await (await getCollection(db, 'containers')).createIndex({ containerId: 1 }, { unique: true, name: 'uniq_containerId' });
    for (const [name, keys, uniqueName] of INDEXES) {
      const collection = await getCollection(db, name);
      if (uniqueName) {
        await collection.createIndex(keys, { unique: true, name: uniqueName, partialFilterExpression: OPEN });
      } else {
        await collection.createIndex(keys);
      }
    }
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

async function createContainer(db, data) {
  await ensurePhysicalChainIndexes(db);
  let container;
  try {
    container = ContainerModel.create({ ...data, emptyStatus: 'empty' });
  } catch (error) {
    throw toValidationError(error);
  }
  try {
    await (await getCollection(db, 'containers')).insertOne(container);
  } catch (error) {
    if (error?.code === 11000) throw new PhysicalChainError(`Recipiente ${container.containerId} já existe`, 'CONTAINER_EXISTS', 409);
    throw error;
  }
  return container;
}

// RF017 AC3/AC4: a specimen enters a container. The container becomes
// occupied (RULE-031/RULE-032).
async function loadSpecimen(db, data) {
  await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(SpecimenContainerAssignmentModel.create(data), 'unloadedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return withTransactionWhereSupported(db, async (session) => {
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
async function closeAssignment(db, { collectionName, filter, id, Model, close, endField, end }) {
  return withTransactionWhereSupported(db, async (session) => {
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

async function unloadSpecimen(db, specimenContainerAssignmentId, unloadedAt) {
  return closeAssignment(db, {
    collectionName: 'specimenContainerAssignments', filter: { specimenContainerAssignmentId: String(specimenContainerAssignmentId) }, id: specimenContainerAssignmentId,
    Model: SpecimenContainerAssignmentModel, close: 'unload', endField: 'unloadedAt', end: unloadedAt,
  });
}

// RF017 AC2, RULE-030: a container takes a position; neither may hold
// another over the same interval.
async function placeContainer(db, data) {
  await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(ContainerPositionAssignmentModel.create(data), 'removedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return withTransactionWhereSupported(db, async (session) => {
    await findContainer(db, candidate.containerId, session);
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

async function removeContainer(db, containerPositionAssignmentId, removedAt) {
  return closeAssignment(db, {
    collectionName: 'containerPositionAssignments', filter: { containerPositionAssignmentId: String(containerPositionAssignmentId) }, id: containerPositionAssignmentId,
    Model: ContainerPositionAssignmentModel, close: 'remove', endField: 'removedAt', end: removedAt,
  });
}

// RULE-035: a rack is in one location at a time.
async function locateRack(db, data) {
  await ensurePhysicalChainIndexes(db);
  let candidate;
  try {
    candidate = closedIfEnded(RackLocationAssignmentModel.create(data), 'removedAt');
  } catch (error) {
    throw toValidationError(error);
  }
  return withTransactionWhereSupported(db, async (session) => {
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

async function removeRack(db, rackLocationAssignmentId, removedAt) {
  return closeAssignment(db, {
    collectionName: 'rackLocationAssignments', filter: { rackLocationAssignmentId: String(rackLocationAssignmentId) }, id: rackLocationAssignmentId,
    Model: RackLocationAssignmentModel, close: 'remove', endField: 'removedAt', end: removedAt,
  });
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
  resolveSpecimenLocation,
};
