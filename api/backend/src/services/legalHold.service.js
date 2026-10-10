const LegalHoldModel = require('../models/LegalHold');
const { getCollection } = require('../utils/collectionResolver');

const SPECIMEN_TARGET_TYPES = ['Specimen', 'Sample'];

class LegalHoldService {
  /** AC#2: aplica o bloqueio legal/ético. */
  async imposeHold(db, payload) {
    const validation = LegalHoldModel.validate(payload);
    if (!validation.isValid) {
      // RNF018 (#1300): a validation failure answers 422; the caller's catch
      // keeps every other error on its own status.
      const validationError = new Error(validation.errors.join(', '));
      validationError.statusCode = 422;

      validationError.details = validation.errors;
      throw validationError;
    }

    const collection = await getCollection(db, 'legalHolds');
    const document = LegalHoldModel.create(payload);
    await collection.insertOne(document);
    return document;
  }

  async releaseHold(db, legalHoldId, releasedBy, releaseReason) {
    if (!releaseReason || !String(releaseReason).trim()) {
      throw new Error('releaseReason é obrigatório para liberar o bloqueio legal');
    }

    const collection = await getCollection(db, 'legalHolds');
    const hold = await collection.findOne({ legalHoldId });
    if (!hold) {
      throw new Error('Bloqueio legal não encontrado');
    }
    if (hold.status !== 'active') {
      throw new Error('Somente um bloqueio legal ativo pode ser liberado');
    }

    await collection.updateOne(
      { legalHoldId },
      {
        $set: {
          status: 'released',
          releasedBy: releasedBy || null,
          releasedAt: new Date(),
          releaseReason: String(releaseReason).trim(),
          updatedAt: new Date(),
        },
      }
    );

    return collection.findOne({ legalHoldId });
  }

  /** AC#2/#6: existe algum bloqueio ATIVO cobrindo qualquer um dos itens informados? */
  async hasActiveHold(db, entityType, entityIds) {
    const collection = await getCollection(db, 'legalHolds');
    const holds = await collection.find({ targetEntityType: entityType, status: 'active' }).toArray();
    return holds.some((hold) => hold.targetEntityIds.some((id) => entityIds.includes(id)));
  }

  /**
   * RF006 AC6 (#1315): why a specimen may not move, or null. A hold names a
   * specimen as `Specimen`, the canonical entity, or `Sample`, the name the
   * hold records were first written with, and by its specimenId or its
   * stored _id. Withdrawal, allocation, movement and loading all ask here;
   * destruction keeps its own check in dispositionAction.service.js.
   */
  async specimenHoldRefusal(db, sample) {
    if (!sample) return null;
    const ids = [sample.specimenId, sample._id].filter(Boolean).map(String);
    const collection = await getCollection(db, 'legalHolds');
    const holds = await collection.find({ status: 'active' }).toArray();
    const hold = holds.find((candidate) => SPECIMEN_TARGET_TYPES.includes(candidate.targetEntityType)
      && (candidate.targetEntityIds || []).some((id) => ids.includes(String(id))));
    return hold ? `Espécime ${sample.specimenId || sample._id} sob bloqueio legal ativo (${hold.legalHoldId})` : null;
  }

  async getById(db, legalHoldId) {
    const collection = await getCollection(db, 'legalHolds');
    return collection.findOne({ legalHoldId });
  }

  async getAll(db) {
    const collection = await getCollection(db, 'legalHolds');
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }
}

const legalHoldService = new LegalHoldService();
module.exports = legalHoldService;
