const NonconformanceModel = require('../models/Nonconformance');
const { getCollection } = require('../utils/collectionResolver');
const notificationDispatchService = require('./notificationDispatch.service');
const logger = require('../utils/logger');

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

    // #650 (RF015, qualidade domain) - fire-and-forget, same shape as
    // dispositionAction.service.js's governança call: a missing/
    // misconfigured NotificationRule must never block or delay opening the
    // nonconformance itself. Fires on every successful open (no rare-branch
    // gate here, unlike segurança/consentimento) -- an explicit .catch()
    // keeps a notification-engine failure from surfacing as an unhandled
    // rejection on the common path.
    void notificationDispatchService.dispatchNotification(db, {
      eventType: 'nonconformance_opened',
      sourceEventType: 'Nonconformance',
      sourceEventId: document.nonconformanceId,
      payload: {
        nonconformanceType: document.nonconformanceType,
        affectedEntityIds: document.affectedEntityIds
      }
    }).catch((error) => {
      logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de nonconformance:', error.message || error);
    });

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
