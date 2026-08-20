const NonconformanceModel = require('../models/Nonconformance');
const { getCollection } = require('../utils/collectionResolver');

class NonconformanceService {
  /** AC#5: abre a não conformidade. */
  async open(db, payload) {
    const validation = NonconformanceModel.validate(payload);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const collection = await getCollection(db, 'nonconformances');
    const document = NonconformanceModel.create(payload);
    await collection.insertOne(document);
    return document;
  }

  /** AC#5/#6: registra a ação corretiva e o responsável. */
  async recordCorrectiveAction(db, nonconformanceId, payload) {
    const validation = NonconformanceModel.validateCorrectiveAction(payload);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const collection = await getCollection(db, 'nonconformances');
    const nonconformance = await collection.findOne({ nonconformanceId });
    if (!nonconformance) {
      throw new Error('Não conformidade não encontrada');
    }

    const correctiveAction = {
      description: payload.description.trim(),
      responsible: payload.responsible.trim(),
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      recordedAt: new Date(),
    };

    await collection.updateOne(
      { nonconformanceId },
      { $set: { correctiveAction, status: 'corrective_action_recorded', updatedAt: new Date() } }
    );

    return collection.findOne({ nonconformanceId });
  }

  /** AC#6: preserva a verificação de eficácia; fecha quando efetiva. */
  async verifyEffectiveness(db, nonconformanceId, payload) {
    const validation = NonconformanceModel.validateEffectivenessVerification(payload);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const collection = await getCollection(db, 'nonconformances');
    const nonconformance = await collection.findOne({ nonconformanceId });
    if (!nonconformance) {
      throw new Error('Não conformidade não encontrada');
    }
    if (!nonconformance.correctiveAction) {
      throw new Error('A ação corretiva deve ser registrada antes da verificação de eficácia');
    }

    const effectivenessVerification = {
      verifiedBy: payload.verifiedBy,
      verifiedAt: new Date(),
      outcome: payload.outcome,
      notes: payload.notes || null,
    };

    const isEffective = payload.outcome === 'effective';
    const update = {
      effectivenessVerification,
      status: isEffective ? 'closed' : 'corrective_action_recorded',
      closureDate: isEffective ? new Date() : null,
      updatedAt: new Date(),
    };

    await collection.updateOne({ nonconformanceId }, { $set: update });
    return collection.findOne({ nonconformanceId });
  }

  async getById(db, nonconformanceId) {
    const collection = await getCollection(db, 'nonconformances');
    return collection.findOne({ nonconformanceId });
  }

  async getAll(db) {
    const collection = await getCollection(db, 'nonconformances');
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }
}

const nonconformanceService = new NonconformanceService();
module.exports = nonconformanceService;
