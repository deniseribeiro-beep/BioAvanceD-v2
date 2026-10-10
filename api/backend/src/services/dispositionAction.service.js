const { randomUUID } = require('crypto');
const { ObjectId } = require('mongodb');
const DispositionActionModel = require('../models/DispositionAction');
const { TRANSITIONS } = require('../models/DispositionAction');
const legalHoldService = require('./legalHold.service');
const { getCollection } = require('../utils/collectionResolver');
const notificationDispatchService = require('./notificationDispatch.service');
const logger = require('../utils/logger');

// AC#6 ("Impedir destruição quando houver bloqueio ético ou legal") only
// names destruição -- transfer/return/anonymize/preserve aren't framed as
// destructive by the requirement text, so only 'destroy' is blocked by an
// active hold. legalHold is still recorded truthfully on every action type
// (see recordDisposition below), not just the blocked one.
const BLOCKED_WHEN_HELD = ['destroy'];

class DispositionActionService {
  /** AC#1 (vincula a uma RetentionPolicy real, não apenas por formato), AC#3/#4. */
  async recordDisposition(db, payload) {
    const validation = DispositionActionModel.validate(payload);
    if (!validation.isValid) {
      // RNF018 (#1300): a validation failure answers 422; the caller's catch
      // keeps every other error on its own status.
      const validationError = new Error(validation.errors.join(', '));
      validationError.statusCode = 422;

      validationError.details = validation.errors;
      throw validationError;
    }

    const policy = await this.policyOf(db, payload.retentionPolicyId);
    if (!policy) {
      throw new Error('retentionPolicyId não corresponde a uma política de retenção existente');
    }

    // AC#2/#6: bloqueia a destruição enquanto houver bloqueio legal/ético ativo,
    // e cada ação que a legalHoldRules da própria política bloqueia (#1315,
    // RF026 AC2). A policy stored before those rules were required has none.
    const activeHold = await legalHoldService.hasActiveHold(db, payload.entityType, payload.affectedRecordIds);
    if (activeHold && this.blockedActions(policy).includes(payload.dispositionAction)) {
      throw new Error('Destinação bloqueada: bloqueio legal ou ético ativo sobre um ou mais itens afetados');
    }

    const collection = await getCollection(db, 'dispositionActions');
    const document = DispositionActionModel.create({ ...payload, legalHold: activeHold });
    await collection.insertOne(document);

    // #650 (RF015, governança domain) - fire-and-forget, same shape as
    // iot.controller.js's environmental_excursion call: a missing/
    // misconfigured NotificationRule must never block or delay the
    // disposition record itself. Unlike the segurança/consentimento call
    // sites (which only fire on a rare branch), this one fires on every
    // successful recordDisposition -- an explicit .catch() keeps a
    // notification-engine failure from surfacing as an unhandled
    // rejection on the common path.
    void notificationDispatchService.dispatchNotification(db, {
      eventType: 'disposition_action_recorded',
      sourceEventType: 'DispositionAction',
      sourceEventId: document.dispositionActionId,
      payload: {
        entityType: document.entityType,
        dispositionAction: document.dispositionAction,
        retentionPolicyId: document.retentionPolicyId
      }
    }).catch((error) => {
      logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de disposition action:', error.message || error);
    });

    return document;
  }

  /** AC#5: a própria evidência/certificado -- ver DispositionActionModel.create. */
  // #1315 (RF026 AC4/AC5): the lifecycle after recording. Each transition
  // reads the action, refuses a status it does not start from (409), and
  // writes conditioned on the status it read, so two racing transitions
  // cannot both land.
  async loadForTransition(db, dispositionActionId) {
    const collection = await getCollection(db, 'dispositionActions');
    const action = await collection.findOne({ dispositionActionId });
    if (!action) {
      const error = new Error('Ação de destinação não encontrada');
      error.statusCode = 404;
      throw error;
    }
    return { collection, action };
  }

  refuseTransition(action, verb, allowed) {
    const status = action.actionStatus || 'executed';
    if (!allowed.includes(status)) {
      const error = new Error(`Ação de destinação em ${status} não admite ${verb} (permitido a partir de: ${allowed.join(', ')})`);
      error.statusCode = 409;
      throw error;
    }
    return status;
  }

  async writeTransition(collection, action, fromStatus, set) {
    const result = await collection.updateOne(
      { dispositionActionId: action.dispositionActionId, actionStatus: fromStatus },
      { $set: { ...set, updatedAt: new Date() } }
    );
    if (!result || result.matchedCount === 0) {
      const error = new Error('Ação de destinação alterada concorrentemente; leia-a de novo');
      error.statusCode = 409;
      throw error;
    }
    return collection.findOne({ dispositionActionId: action.dispositionActionId });
  }

  /** AC#5: a autorização, registrada com quem autorizou e quando. */
  async approve(db, dispositionActionId, { authorizedBy } = {}) {
    if (!authorizedBy) throw Object.assign(new Error('authorizedBy é obrigatório'), { statusCode: 422 });
    const { collection, action } = await this.loadForTransition(db, dispositionActionId);
    const from = this.refuseTransition(action, 'aprovação', TRANSITIONS.approve);
    return this.writeTransition(collection, action, from, {
      actionStatus: 'approved',
      authorizationId: randomUUID(),
      authorizedBy: String(authorizedBy),
      authorizedAt: new Date(),
    });
  }

  /**
   * AC#5/#6: execução com responsável, instante e evidência. Exige a
   * autorização, salvo quando a política declara reviewRequired false; um
   * bloqueio legal ativo sobre o que a política bloqueia a recusa e deixa a
   * ação em blocked.
   */
  async execute(db, dispositionActionId, { executedBy, evidenceIds } = {}) {
    if (!executedBy) throw Object.assign(new Error('executedBy é obrigatório'), { statusCode: 422 });
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0
      || evidenceIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
      throw Object.assign(new Error('evidenceIds é obrigatório para executar: um array não vazio de referências'), { statusCode: 422 });
    }
    const { collection, action } = await this.loadForTransition(db, dispositionActionId);
    const policy = await this.policyOf(db, action.retentionPolicyId);
    // A policy stored before reviewRequired existed requires the review.
    const allowed = policy?.reviewRequired === false ? ['planned', ...TRANSITIONS.execute] : TRANSITIONS.execute;
    const from = this.refuseTransition(action, 'execução', allowed);

    const activeHold = await legalHoldService.hasActiveHold(db, action.entityType, action.affectedRecordIds);
    if (activeHold && this.blockedActions(policy).includes(action.dispositionAction)) {
      await this.writeTransition(collection, action, from, { actionStatus: 'blocked', legalHold: true });
      throw new Error('Destinação bloqueada: bloqueio legal ou ético ativo sobre um ou mais itens afetados');
    }

    const now = new Date();
    return this.writeTransition(collection, action, from, {
      actionStatus: 'executed',
      executedBy: String(executedBy),
      executedAt: now,
      dispositionDateTime: now,
      evidenceIds: evidenceIds.map((value) => value.trim()),
      legalHold: activeHold,
    });
  }

  async cancel(db, dispositionActionId, { cancelledBy, reason } = {}) {
    if (!cancelledBy) throw Object.assign(new Error('cancelledBy é obrigatório'), { statusCode: 422 });
    if (!reason || !String(reason).trim()) throw Object.assign(new Error('reason é obrigatório para cancelar'), { statusCode: 422 });
    const { collection, action } = await this.loadForTransition(db, dispositionActionId);
    const from = this.refuseTransition(action, 'cancelamento', TRANSITIONS.cancel);
    return this.writeTransition(collection, action, from, {
      actionStatus: 'cancelled',
      cancelledBy: String(cancelledBy),
      cancelledAt: new Date(),
      cancellationReason: String(reason).trim(),
    });
  }

  async policyOf(db, retentionPolicyId) {
    const retentionPolicies = await getCollection(db, 'retentionPolicies');
    try {
      return await retentionPolicies.findOne({ _id: new ObjectId(String(retentionPolicyId)) });
    } catch {
      return null;
    }
  }

  // The standing destroy block plus each action the policy's own
  // legalHoldRules name (RF026 AC2).
  blockedActions(policy) {
    const byPolicy = (Array.isArray(policy?.legalHoldRules) ? policy.legalHoldRules : [])
      .filter((rule) => rule?.when === 'legalHold=true')
      .map((rule) => rule.block);
    return [...BLOCKED_WHEN_HELD, ...byPolicy];
  }

  /** AC#5: a evidência de uma destinação executada; antes disso não há certificado. */
  async getCertificate(db, dispositionActionId) {
    const action = await this.getById(db, dispositionActionId);
    if (!action) return null;
    if (action.actionStatus && action.actionStatus !== 'executed') {
      const error = new Error(`Ação de destinação em ${action.actionStatus}: o certificado existe só após a execução`);
      error.statusCode = 409;
      throw error;
    }
    return {
      actionStatus: action.actionStatus || 'executed',
      authorizationId: action.authorizationId || null,
      authorizedBy: action.authorizedBy || null,
      executedBy: action.executedBy || null,
      executedAt: action.executedAt || null,
      evidenceIds: action.evidenceIds || [],
      dispositionActionId: action.dispositionActionId,
      retentionPolicyId: action.retentionPolicyId,
      entityType: action.entityType,
      affectedRecordIds: action.affectedRecordIds,
      dispositionAction: action.dispositionAction,
      dispositionMethod: action.dispositionMethod,
      performedBy: action.performedBy,
      dispositionDateTime: action.dispositionDateTime,
      legalHold: action.legalHold,
      generatedAt: new Date(),
    };
  }

  async getById(db, dispositionActionId) {
    const collection = await getCollection(db, 'dispositionActions');
    return collection.findOne({ dispositionActionId });
  }

  async getAll(db) {
    const collection = await getCollection(db, 'dispositionActions');
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }
}

const dispositionActionService = new DispositionActionService();
module.exports = dispositionActionService;
module.exports.BLOCKED_WHEN_HELD = BLOCKED_WHEN_HELD;
