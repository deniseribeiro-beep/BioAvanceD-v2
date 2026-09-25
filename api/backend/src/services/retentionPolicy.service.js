const { ObjectId } = require('mongodb');
const RetentionPolicyModel = require('../models/RetentionPolicy');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

// #440 / #667: RF014 allow-list. Audit trail stays archive-only in the sweep;
// ImportStagingRecord (#793) and NotificationComplianceLog (#812) are destroy-
// only personal-data stores that the same cron can now target.
const ALLOWED_ENTITY_TYPES = [
  'AuditEvent',
  'Log',
  'ImportStagingRecord',
  'NotificationComplianceLog',
];

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
        throw new Error(validation.errors.join(', '));
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
        await collection.updateMany({ active: true }, { $set: { active: false, updatedAt: new Date() } });
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

  async getActivePolicy(db) {
    const collection = await getCollection(db, 'retentionPolicies');
    const policies = await collection
      .find({ active: true })
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
