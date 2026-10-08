const CollectionGovernanceApprovalModel = require('../models/CollectionGovernanceApproval');
const { isInForce, periodHolds } = require('../models/CollectionGovernanceApproval');
const CollectionGovernanceContextModel = require('../models/CollectionGovernanceContext');
const CollectionGovernanceEventModel = require('../models/CollectionGovernanceEvent');
const { GOVERNANCE_REGIMES } = require('../models/Collection');
const { getCollection } = require('../utils/collectionResolver');

function httpError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details || [message];
  return error;
}

/**
 * A collection's governance (RF004 AC3-AC5/AC7, RF020 AC2-AC4, RF021 AC2/AC3/
 * AC6): its approvals, its one context matching the regime (RULE-001/002),
 * and the append-only events that set or convert them. The context and the
 * regime are written only by recordEvent, so neither changes without an event,
 * a justification and an approval in force.
 */
class CollectionGovernanceService {
  async findCollection(db, collectionId) {
    const collection = await db.collection('collections').findOne({ collectionId: String(collectionId) });
    if (!collection) throw httpError(`collectionId ${collectionId} não encontrado`, 404);
    return collection;
  }

  async assertOrganization(db, organizationId, field) {
    const organizations = await getCollection(db, 'organizations');
    if (!(await organizations.findOne({ organizationId }))) {
      throw httpError(`${field}: organização ${organizationId} não encontrada`, 422);
    }
  }

  async createApproval(db, collectionId, payload, createdBy) {
    await this.findCollection(db, collectionId);
    const { approvalId, statusHistory, ...fields } = payload || {};
    const data = { ...fields, collectionId: String(collectionId) };
    const validation = CollectionGovernanceApprovalModel.validate(data);
    if (!validation.isValid) throw httpError(validation.errors.join(', '), 422, validation.errors);
    // REL-0034: the responsible organization must exist.
    await this.assertOrganization(db, data.responsibleOrganizationId, 'responsibleOrganizationId');
    const approval = CollectionGovernanceApprovalModel.create({ ...data, createdBy });
    await (await getCollection(db, 'collectionGovernanceApprovals')).insertOne(approval);
    return approval;
  }

  async listApprovals(db, collectionId) {
    const approvals = await getCollection(db, 'collectionGovernanceApprovals');
    return approvals.find({ collectionId: String(collectionId) }).sort({ createdAt: -1 }).toArray();
  }

  async setApprovalStatus(db, collectionId, approvalId, payload, changedBy) {
    const approvals = await getCollection(db, 'collectionGovernanceApprovals');
    const approval = await approvals.findOne({ collectionId: String(collectionId), approvalId });
    if (!approval) throw httpError('Aprovação não encontrada', 404);
    const status = payload?.status;
    if (!CollectionGovernanceApprovalModel.canTransition(approval.status, status)) {
      throw httpError(`Transição de status inválida: ${approval.status} -> ${status}`, 422);
    }
    const now = new Date();
    const entry = { from: approval.status, to: status, reason: payload?.reason || null, changedBy: changedBy ?? null, changedAt: now };
    const result = await approvals.findOneAndUpdate(
      { approvalId, status: approval.status },
      { $set: { status, updatedAt: now }, $push: { statusHistory: entry } },
      { returnDocument: 'after' }
    );
    const updated = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
    if (!updated) throw httpError('A aprovação mudou de estado durante a operação; tente novamente', 409);
    return updated;
  }

  async listEvents(db, collectionId) {
    const events = await getCollection(db, 'collectionGovernanceEvents');
    return events.find({ collectionId: String(collectionId) }).sort({ occurredAt: 1 }).toArray();
  }

  async getGovernance(db, collectionId) {
    const collection = await this.findCollection(db, collectionId);
    return {
      collectionId: collection.collectionId,
      governanceRegime: collection.governanceRegime ?? null,
      governanceContext: collection.governanceContext ?? null,
      approvals: await this.listApprovals(db, collectionId),
      events: await this.listEvents(db, collectionId),
    };
  }

  /** The references a context names must resolve (REL-0035..0043). */
  async assertContextReferences(db, regime, ctx, approvalsById) {
    if (regime === 'biorepository') {
      if (!(await db.collection('studies').findOne({ studyId: ctx.studyId }))) {
        throw httpError(`studyId ${ctx.studyId} não encontrado`, 422);
      }
      const protocol = await db.collection('protocols').findOne({ protocolId: ctx.protocolId });
      if (!protocol) throw httpError(`protocolId ${ctx.protocolId} não encontrado`, 422);
      if (protocol.protocolVersion && protocol.protocolVersion !== ctx.protocolVersion) {
        throw httpError(`protocolVersion ${ctx.protocolVersion} difere da versão registrada do protocolo (${protocol.protocolVersion})`, 422);
      }
      await this.assertOrganization(db, ctx.responsibleOrganizationId, 'responsibleOrganizationId');
      if (!approvalsById.has(ctx.ethicsApprovalId)) {
        throw httpError(`ethicsApprovalId ${ctx.ethicsApprovalId} não é uma aprovação desta coleção`, 422);
      }
    } else {
      const policies = await getCollection(db, 'accessPolicies');
      if (!(await policies.findOne({ accessPolicyId: ctx.governancePolicyId }))) {
        throw httpError(`governancePolicyId ${ctx.governancePolicyId} não encontrado`, 422);
      }
      await this.assertOrganization(db, ctx.institutionalCustodianId, 'institutionalCustodianId');
    }
  }

  /**
   * RF020 AC4: the one writer of a collection's regime and context. The first
   * context is a `created` event; a different regime is a `regime_change`,
   * with the new regime's context. Either names its justification and at
   * least one approval of this collection in force.
   */
  async recordEvent(db, collectionId, payload, recordedBy, now = new Date()) {
    const collection = await this.findCollection(db, collectionId);
    const previousRegime = GOVERNANCE_REGIMES.includes(collection.governanceRegime) ? collection.governanceRegime : null;
    const newRegime = payload?.newRegime ?? previousRegime;
    if (!GOVERNANCE_REGIMES.includes(newRegime)) {
      throw httpError(`newRegime deve ser um de: ${GOVERNANCE_REGIMES.join(', ')}`, 422);
    }
    const decisionType = previousRegime && newRegime !== previousRegime ? 'regime_change' : 'created';
    if (decisionType === 'created' && collection.governanceContext) {
      throw httpError('A coleção já tem contexto de governança; só uma mudança de regime registra outro (RF020 AC4)', 422);
    }

    const ctx = payload?.governanceContext;
    const validation = CollectionGovernanceContextModel.validate(newRegime, ctx);
    if (!validation.isValid) throw httpError(validation.errors.join(', '), 422, validation.errors);

    const approvals = await this.listApprovals(db, collectionId);
    const approvalsById = new Map(approvals.map((a) => [a.approvalId, a]));
    await this.assertContextReferences(db, newRegime, ctx, approvalsById);

    // The biorepository's ethics approval is one the decision rests on.
    const approvalIds = [...new Set([
      ...(Array.isArray(payload?.approvalIds) ? payload.approvalIds : []),
      ...(newRegime === 'biorepository' ? [ctx.ethicsApprovalId] : []),
    ])];
    // previousRegime (V2E-0099, 0..1) names what a conversion left; a first
    // context replaces no regime.
    const eventData = { collectionId: collection.collectionId, previousRegime: decisionType === 'regime_change' ? previousRegime : null, newRegime, decisionType, approvalIds, justification: payload?.justification, recordedBy };
    const eventValidation = CollectionGovernanceEventModel.validate(eventData);
    if (!eventValidation.isValid) {
      throw httpError(eventValidation.errors.join(', '), 422, eventValidation.errors);
    }
    // RF004 AC3, RF021 AC6: every approval named must be this collection's
    // and in force.
    const refused = approvalIds.filter((id) => !isInForce(approvalsById.get(id), now));
    if (refused.length > 0) {
      throw httpError(`Aprovações ausentes ou não vigentes para esta coleção: ${refused.join(', ')}`, 422);
    }

    const governanceContext = CollectionGovernanceContextModel.create(newRegime, collection.collectionId, ctx);
    const event = CollectionGovernanceEventModel.create(eventData);

    // Guarded on the state read above, so two concurrent decisions cannot both
    // land. No multi-document transaction (the standalone stacks have none):
    // the event is appended after the collection changes, and a failed append
    // restores the collection.
    const collections = db.collection('collections');
    const prior = {
      governanceRegime: collection.governanceRegime ?? null,
      governanceContext: collection.governanceContext ?? null,
      updatedAt: collection.updatedAt ?? now,
    };
    const guard = { _id: collection._id, governanceRegime: prior.governanceRegime, governanceContext: prior.governanceContext };
    const update = await collections.updateOne(guard, { $set: { governanceRegime: newRegime, governanceContext, updatedAt: now } });
    if (!update || update.matchedCount === 0) {
      throw httpError('A governança da coleção mudou durante a operação; tente novamente', 409);
    }
    try {
      await (await getCollection(db, 'collectionGovernanceEvents')).insertOne(event);
    } catch (error) {
      await collections.updateOne({ _id: collection._id }, { $set: prior });
      throw error;
    }
    return { event, governanceRegime: newRegime, governanceContext };
  }

  /**
   * RF004 AC3/AC7, RF021 AC6: may a specimen be registered into this
   * collection now? Returns the refusal reason, or null.
   */
  async registrationRefusal(db, collection, now = new Date()) {
    const regime = collection.governanceRegime;
    if (!GOVERNANCE_REGIMES.includes(regime)) {
      return `Coleção ${collection.collectionId} sem regime de governança (biobank ou biorepository)`;
    }
    const ctx = collection.governanceContext;
    if (!CollectionGovernanceContextModel.matchesRegime(regime, ctx)) {
      return `Coleção ${collection.collectionId} sem contexto de governança compatível com o regime ${regime} (RULE-001/002)`;
    }
    if (regime === 'biorepository' && !periodHolds(ctx.validityPeriod, now)) {
      return `Contexto de biorrepositório da coleção ${collection.collectionId} fora da vigência`;
    }
    const approvals = await this.listApprovals(db, collection.collectionId);
    const applicable = regime === 'biorepository'
      ? approvals.filter((a) => a.approvalId === ctx.ethicsApprovalId)
      : approvals;
    if (!applicable.some((a) => isInForce(a, now))) {
      return `Coleção ${collection.collectionId} sem aprovação de governança vigente`;
    }
    return null;
  }
}

module.exports = new CollectionGovernanceService();
module.exports.CollectionGovernanceService = CollectionGovernanceService;
