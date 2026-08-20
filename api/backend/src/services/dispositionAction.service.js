const { ObjectId } = require('mongodb');
const DispositionActionModel = require('../models/DispositionAction');
const legalHoldService = require('./legalHold.service');
const { getCollection } = require('../utils/collectionResolver');

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
      throw new Error(validation.errors.join(', '));
    }

    const retentionPolicies = await getCollection(db, 'retentionPolicies');
    let policy = null;
    try {
      policy = await retentionPolicies.findOne({ _id: new ObjectId(String(payload.retentionPolicyId)) });
    } catch {
      policy = null;
    }
    if (!policy) {
      throw new Error('retentionPolicyId não corresponde a uma política de retenção existente');
    }

    // AC#2/#6: bloqueia a destruição enquanto houver bloqueio legal/ético ativo.
    const activeHold = await legalHoldService.hasActiveHold(db, payload.entityType, payload.affectedRecordIds);
    if (activeHold && BLOCKED_WHEN_HELD.includes(payload.dispositionAction)) {
      throw new Error('Destinação bloqueada: bloqueio legal ou ético ativo sobre um ou mais itens afetados');
    }

    const collection = await getCollection(db, 'dispositionActions');
    const document = DispositionActionModel.create({ ...payload, legalHold: activeHold });
    await collection.insertOne(document);
    return document;
  }

  /** AC#5: a própria evidência/certificado -- ver DispositionActionModel.create. */
  async getCertificate(db, dispositionActionId) {
    const action = await this.getById(db, dispositionActionId);
    if (!action) return null;
    return {
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
