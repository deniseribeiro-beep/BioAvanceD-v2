const { ObjectId } = require('mongodb');
const { isUuid } = require('../foundation/userAccountIdentityMigrationV2');

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  try {
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  } catch (err) {
    return value;
  }
  return value;
}

function createReferenceError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

/**
 * RF025 AC#1 (#664, dict-02 ELM-0286..0297): Assay's specimen/protocol/
 * operator/laboratory/reagentLot/equipment links are Reference fields
 * (operatorId resolves Actor.actorId internally; Practitioner is only an
 * interoperability representation, laboratoryId as
 * Organization/uuid) -- AssayModel.validate() only checked they're
 * well-formed strings, never that they resolve to a real record. Mirrors
 * sample.service.js's own studyId/protocolId/collectionId checks
 * (existence only, no status gate -- #664 doesn't ask for one) and
 * equipment.routes.js's assertOrganizationIdResolves.
 * @param {import('mongodb').Db} db
 * @param {object} payload
 */
async function validateAssayReferences(db, payload) {
  const samplesCollection = db.collection('specimens');
  for (const specimenId of payload.specimenIds || []) {
    const sample = await samplesCollection.findOne({ _id: toObjectId(specimenId) });
    if (!sample) {
      throw createReferenceError(`specimenIds: ${specimenId} não encontrado`);
    }
  }

  if (payload.protocolId) {
    const protocol = await db.collection('protocols').findOne({ protocolId: String(payload.protocolId) });
    if (!protocol) {
      throw createReferenceError(`protocolId ${payload.protocolId} não encontrado`);
    }
  }

  if (payload.operatorId) {
    if (!isUuid(payload.operatorId)) {
      throw createReferenceError(`operatorId ${payload.operatorId} não é Actor.actorId canônico`);
    }
    const operator = await db.collection('actors').findOne({ actorId: String(payload.operatorId) });
    if (!operator) {
      throw createReferenceError(`operatorId ${payload.operatorId} não encontrado`);
    }
  }

  if (payload.laboratoryId) {
    const organization = await db.collection('organizations').findOne({ organizationId: String(payload.laboratoryId) });
    if (!organization) {
      throw createReferenceError(`laboratoryId ${payload.laboratoryId} não encontrado`);
    }
  }

  const reagentLotsCollection = db.collection('reagentLots');
  for (const reagentLotId of payload.reagentLotIds || []) {
    const reagentLot = await reagentLotsCollection.findOne({ reagentId: String(reagentLotId) });
    if (!reagentLot) {
      throw createReferenceError(`reagentLotIds: ${reagentLotId} não encontrado`);
    }
  }

  const equipmentCollection = db.collection('equipment');
  for (const equipmentId of payload.equipmentIds || []) {
    const numericId = Number(equipmentId);
    const equipment = await equipmentCollection.findOne({
      equipmentID: Number.isFinite(numericId) ? { $in: [equipmentId, numericId] } : equipmentId
    });
    if (!equipment) {
      throw createReferenceError(`equipmentIds: ${equipmentId} não encontrado`);
    }
  }
}

module.exports = { validateAssayReferences };
