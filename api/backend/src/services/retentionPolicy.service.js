const { ObjectId } = require('mongodb');
const RetentionPolicyModel = require('../models/RetentionPolicy');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

// A policy may name only entity types something acts on, so none is accepted
// and silently ignored (#1273). Two families do:
//  - the audit trail (#440): the sweep (#441) archives or purges AuditEvent
//    and Log;
//  - specimens (RF026 AC1, #1365): a Specimen, or the legacy Sample, is
//    destroyed or transferred through a DispositionAction bound to the
//    policy, executed by a person (RF026 AC4-AC6), never by the sweep.
// Each family keeps its own active policy: activating one deactivates the
// active policies of the families it names, so a specimen policy never
// switches off the audit trail's retention.
const ENTITY_TYPE_FAMILIES = {
  auditTrail: ['AuditEvent', 'Log'],
  specimen: ['Specimen', 'Sample'],
};
const ALLOWED_ENTITY_TYPES = Object.values(ENTITY_TYPE_FAMILIES).flat();

function familyTypesOf(applicableEntityTypes) {
  return Object.values(ENTITY_TYPE_FAMILIES)
    .filter((types) => types.some((type) => (applicableEntityTypes || []).includes(type)))
    .flat();
}

class RetentionPolicyService {
  parseVersionNumber(version) {
    const value = String(version || '').trim().toLowerCase();
    const match = value.match(/^v?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async generateNextVersion(db) {
    const collection = await getCollection(db, 'retentionPolicies');
    const policies = await collection
      .find({}, { projection: { version: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();

    const maxVersion = policies.reduce((max, item) => {
      const current = this.parseVersionNumber(item?.version);
      return current > max ? current : max;
    }, 0);

    return `v${maxVersion + 1}`;
  }

  validateEntityTypes(applicableEntityTypes) {
    const invalid = (applicableEntityTypes || []).filter((type) => !ALLOWED_ENTITY_TYPES.includes(type));
    if (invalid.length > 0) {
      throw new Error(`applicableEntityTypes contém valores não suportados: ${invalid.join(', ')}. Permitidos: ${ALLOWED_ENTITY_TYPES.join(', ')}`);
    }
  }

  // #443: destroy (or any non-archive action) would break audit_events' hash
  // chain, so the sweep (#441) already refuses to apply it -- but silently,
  // which lets a policy look active/effective when it never runs. Reject the
  // unsafe combination at creation time instead.
  validateAuditEventRetentionAction(applicableEntityTypes, postRetentionAction) {
    if ((applicableEntityTypes || []).includes('AuditEvent') && postRetentionAction !== 'archive') {
      throw new Error(
        `postRetentionAction "${postRetentionAction}" não é suportado para AuditEvent: apenas "archive" preserva a cadeia de hash.`
      );
    }
  }

  async createPolicy(db, payload, options = {}) {
    try {
      const previousPolicyId = options?.previousPolicyId ? String(options.previousPolicyId).trim() : '';
      const version = await this.generateNextVersion(db);

      const normalizedPayload = {
        ...payload,
        version,
        effectivePeriod: {
          start: payload.effectivePeriod?.start || new Date().toISOString(),
          end: payload.effectivePeriod?.end || null
        }
      };

      this.validateEntityTypes(normalizedPayload.applicableEntityTypes);
      this.validateAuditEventRetentionAction(normalizedPayload.applicableEntityTypes, normalizedPayload.postRetentionAction);

      const validation = RetentionPolicyModel.validate(normalizedPayload);
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      const collection = await getCollection(db, 'retentionPolicies');

      if (previousPolicyId) {
        let previousObjectId;
        try {
          previousObjectId = new ObjectId(previousPolicyId);
        } catch {
          throw new Error('ID da política de retenção anterior é inválido');
        }
        const previousPolicy = await collection.findOne({ _id: previousObjectId });
        if (!previousPolicy) {
          throw new Error('Política de retenção anterior não encontrada');
        }
      }

      if (normalizedPayload.active === undefined || normalizedPayload.active === true) {
        await collection.updateMany(
          { active: true, applicableEntityTypes: { $in: familyTypesOf(normalizedPayload.applicableEntityTypes) } },
          { $set: { active: false, updatedAt: new Date() } }
        );
      }

      const policy = RetentionPolicyModel.create(normalizedPayload);
      const document = {
        ...policy,
        previousPolicyId: previousPolicyId || null
      };

      const result = await collection.insertOne(document);
      return {
        _id: result.insertedId,
        ...document
      };
    } catch (error) {
      logger.error('Erro ao criar política de retenção:', error.message);
      throw error;
    }
  }

  async updatePolicy(db, policyId, payload) {
    return this.createPolicy(db, payload, { previousPolicyId: policyId });
  }

  // The active policy of one family, the audit trail's unless another is named:
  // the sweep, the security settings and GET /active all read that one.
  async getActivePolicy(db, family = 'auditTrail') {
    const collection = await getCollection(db, 'retentionPolicies');
    const policies = await collection
      .find({ active: true, applicableEntityTypes: { $in: ENTITY_TYPE_FAMILIES[family] } })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    return policies[0] || null;
  }

  async getPolicyById(db, policyId) {
    const collection = await getCollection(db, 'retentionPolicies');
    let objectId;
    try {
      objectId = new ObjectId(String(policyId || '').trim());
    } catch {
      throw new Error('ID da política de retenção inválido');
    }
    return collection.findOne({ _id: objectId });
  }

  async getAllPolicies(db) {
    const collection = await getCollection(db, 'retentionPolicies');
    return collection
      .find({})
      .sort({ active: -1, createdAt: -1, _id: -1 })
      .toArray();
  }
}

module.exports = new RetentionPolicyService();
module.exports.ALLOWED_ENTITY_TYPES = ALLOWED_ENTITY_TYPES;
module.exports.ENTITY_TYPE_FAMILIES = ENTITY_TYPE_FAMILIES;
