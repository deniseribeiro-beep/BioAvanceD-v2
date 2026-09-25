const { ObjectId } = require('mongodb');
const { findSampleByAnyId } = require('../utils/sampleLookup');

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
 * (dict-02 types operatorId as Practitioner/uuid, laboratoryId as
 * Organization/uuid) -- AssayModel.validate() only checked they're
 * well-formed strings, never that they resolve to a real record. Mirrors
 * sample.service.js's own studyId/protocolId/collectionId checks
 * (existence only, no status gate -- #664 doesn't ask for one) and
 * equipment.routes.js's assertOrganizationIdResolves.
 * @param {import('mongodb').Db} db
 * @param {object} payload
 */
async function validateAssayReferences(db, payload) {
  // #1219: a specimen is referenced by its canonical specimenId or its _id,
  // and the assay stores the canonical one, so its specimenIds mean what
  // the field name says whichever form the caller held.
  const samplesCollection = db.collection('samples');
  if (Array.isArray(payload.specimenIds)) {
    const canonical = [];
    for (const specimenId of payload.specimenIds) {
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      if (!sample) {
        throw createReferenceError(`specimenIds: ${specimenId} não encontrado`);
      }
      canonical.push(String(sample.specimenId || sample._id));
    }
    payload.specimenIds = canonical;
  }

  if (payload.protocolId) {
    const protocol = await db.collection('protocols').findOne({ protocolId: String(payload.protocolId) });
    if (!protocol) {
      throw createReferenceError(`protocolId ${payload.protocolId} não encontrado`);
    }
  }

  if (payload.operatorId) {
    const operator = await db.collection('users').findOne({ _id: toObjectId(payload.operatorId) });
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
