const { getCollection } = require('../utils/collectionResolver');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const logger = require('../utils/logger');
const CustodianshipAssignmentModel = require('../models/CustodianshipAssignment');
const { isInForce } = require('../models/CollectionGovernanceApproval');

// #1316 (RF021 AC4/AC5/AC6, checklist BIO-006): custody as its own temporal
// assignment, apart from the collection site. A new assignment is checked
// against every stored one of its specimen, closed history included, inside
// one transaction where one runs; a partial unique index refuses two open
// (active) assignments on one specimen where none runs.

class CustodianshipError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'CustodianshipError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const COLLECTION = 'custodianshipAssignments';
const ensuredDbs = new WeakSet();

// Latched before the await, like the physical chain's: a persistent failure
// is logged once, and the overlap check still runs without it.
async function ensureCustodianshipIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    const collection = await getCollection(db, COLLECTION);
    await collection.createIndex({ custodianshipAssignmentId: 1 }, { unique: true, name: 'uniq_custodianshipAssignmentId' });
    await collection.createIndex({ specimenId: 1 }, { unique: true, name: 'uniq_open_custody', partialFilterExpression: { assignmentStatus: 'active' } });
  } catch (error) {
    logger.warn(`[CUSTODIANSHIP] Falha ao criar índices: ${error.message}`);
  }
}

function sessionOptions(session) {
  return session ? { session } : undefined;
}

async function findSpecimen(db, specimenId) {
  const sample = await findSampleByAnyId(await getCollection(db, 'samples'), specimenId);
  if (!sample) {
    throw new CustodianshipError(`Espécime ${specimenId} não encontrado`, 'SPECIMEN_NOT_FOUND', 404);
  }
  return sample;
}

async function findApproval(db, approvalId) {
  const approval = await (await getCollection(db, 'collectionGovernanceApprovals')).findOne({ approvalId: String(approvalId) });
  if (!approval) {
    throw new CustodianshipError(`Aprovação ${approvalId} não encontrada`, 'APPROVAL_NOT_FOUND', 404);
  }
  return approval;
}

// RF021 AC6 at the assignment: the authorization must be one of the
// specimen's collection, the biorepository's own ethics approval where the
// regime names one, and in force when an active custody starts.
function approvalRefusal(approval, collection, candidate) {
  if (collection && approval.collectionId !== collection.collectionId) {
    return `Aprovação ${approval.approvalId} não pertence à coleção ${collection.collectionId} do espécime`;
  }
  const ethicsApprovalId = collection?.governanceRegime === 'biorepository' ? collection.governanceContext?.ethicsApprovalId : null;
  if (ethicsApprovalId && approval.approvalId !== ethicsApprovalId) {
    return `Aprovação ${approval.approvalId} não é a aprovação ética do biorrepositório (${ethicsApprovalId})`;
  }
  if (approval.status === 'revoked') {
    return `Aprovação ${approval.approvalId} revogada`;
  }
  if (candidate.assignmentStatus !== 'planned' && !isInForce(approval, candidate.effectivePeriod.start)) {
    return `Aprovação ${approval.approvalId} não está vigente no início da custódia`;
  }
  return null;
}

async function assignCustody(db, data = {}) {
  await ensureCustodianshipIndexes(db);
  const sample = await findSpecimen(db, data.specimenId);
  const collection = sample.collectionId
    ? await db.collection('collections').findOne({ collectionId: String(sample.collectionId) })
    : null;

  let candidate;
  try {
    candidate = CustodianshipAssignmentModel.create(
      { ...data, specimenId: sample.specimenId },
      { governanceRegime: collection?.governanceRegime }
    );
  } catch (error) {
    throw new CustodianshipError(error.message, 'VALIDATION_ERROR', 422);
  }

  const organization = await (await getCollection(db, 'organizations')).findOne({ organizationId: candidate.custodianOrganizationId });
  if (!organization) {
    throw new CustodianshipError(`Organização ${candidate.custodianOrganizationId} não encontrada`, 'ORGANIZATION_NOT_FOUND', 404);
  }
  const refusal = approvalRefusal(await findApproval(db, candidate.authorizationId), collection, candidate);
  if (refusal) {
    throw new CustodianshipError(refusal, 'APPROVAL_INCOMPATIBLE', 422);
  }

  return withTransactionWhereSupported(db, async (session) => {
    const assignments = await getCollection(db, COLLECTION);
    const existing = await assignments.find({ specimenId: candidate.specimenId }, sessionOptions(session)).toArray();
    try {
      CustodianshipAssignmentModel.assertNoOverlap(candidate, existing);
    } catch (error) {
      throw new CustodianshipError(error.message, 'ASSIGNMENT_OVERLAP', 409);
    }
    try {
      await assignments.insertOne(candidate, sessionOptions(session));
    } catch (error) {
      if (error?.code === 11000) {
        throw new CustodianshipError('Custódia aberta concorrente para o mesmo espécime', 'ASSIGNMENT_OVERLAP', 409);
      }
      throw error;
    }
    return candidate;
  });
}

async function endCustody(db, custodianshipAssignmentId, endAt) {
  const filter = { custodianshipAssignmentId: String(custodianshipAssignmentId) };
  return withTransactionWhereSupported(db, async (session) => {
    const assignments = await getCollection(db, COLLECTION);
    const current = await assignments.findOne(filter, sessionOptions(session));
    if (!current) {
      throw new CustodianshipError(`Atribuição ${custodianshipAssignmentId} não encontrada`, 'ASSIGNMENT_NOT_FOUND', 404);
    }
    if (current.assignmentStatus === 'ended') {
      throw new CustodianshipError(`Atribuição ${custodianshipAssignmentId} já foi encerrada`, 'ASSIGNMENT_ENDED', 409);
    }
    let closed;
    try {
      closed = CustodianshipAssignmentModel.end(current, endAt || new Date());
    } catch (error) {
      throw new CustodianshipError(error.message, 'VALIDATION_ERROR', 422);
    }
    await assignments.updateOne(
      { ...filter, assignmentStatus: current.assignmentStatus },
      { $set: { 'effectivePeriod.end': closed.effectivePeriod.end, assignmentStatus: 'ended' } },
      sessionOptions(session)
    );
    return closed;
  });
}

// The assignment holding the specimen at an instant, or null.
async function currentCustody(db, specimenId, at = new Date()) {
  const rows = await (await getCollection(db, COLLECTION)).find({ specimenId: String(specimenId) }).toArray();
  return rows.find((row) => CustodianshipAssignmentModel.holdsAt(row, at)) || null;
}

// RF021 AC6: may the specimen be operated on now? Returns the refusal reason,
// or null. Custody must hold at the instant, and its approval be in force.
async function operabilityRefusal(db, specimenId, at = new Date()) {
  const custody = await currentCustody(db, specimenId, at);
  if (!custody) {
    return `Espécime ${specimenId} sem custódia vigente`;
  }
  const approval = await (await getCollection(db, 'collectionGovernanceApprovals')).findOne({ approvalId: custody.authorizationId });
  if (!isInForce(approval, new Date(at))) {
    return `Aprovação ${custody.authorizationId} da custódia de ${specimenId} não está vigente`;
  }
  return null;
}

module.exports = {
  CustodianshipError,
  ensureCustodianshipIndexes,
  assignCustody,
  endCustody,
  currentCustody,
  operabilityRefusal,
};
