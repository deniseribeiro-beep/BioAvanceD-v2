const LegalHoldModel = require('../models/LegalHold');
const { getCollection } = require('../utils/collectionResolver');

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
