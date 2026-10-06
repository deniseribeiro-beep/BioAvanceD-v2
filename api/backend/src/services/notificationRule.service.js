const { ObjectId } = require('mongodb');
const NotificationRuleModel = require('../models/NotificationRule');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');

// Mirrors retentionPolicy.service.js's (RF014, #440) versioning shape: every
// update creates a new document instead of mutating the current one, and at
// most one rule per eventType is active at a time.
class NotificationRuleService {
  parseVersionNumber(version) {
    const value = String(version || '').trim().toLowerCase();
    const match = value.match(/^v?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async generateNextVersion(db, eventType) {
    const collection = await getCollection(db, 'notificationRules');
    const rules = await collection
      .find({ eventType }, { projection: { version: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();

    const maxVersion = rules.reduce((max, item) => {
      const current = this.parseVersionNumber(item?.version);
      return current > max ? current : max;
    }, 0);

    return `v${maxVersion + 1}`;
  }

  async createRule(db, payload, options = {}) {
    try {
      const previousRuleId = options?.previousRuleId ? String(options.previousRuleId).trim() : '';
      const version = await this.generateNextVersion(db, payload.eventType);

      const normalizedPayload = { ...payload, version };

      const validation = NotificationRuleModel.validate(normalizedPayload);
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }

      const collection = await getCollection(db, 'notificationRules');

      if (previousRuleId) {
        let previousObjectId;
        try {
          previousObjectId = new ObjectId(previousRuleId);
        } catch {
          throw new Error('ID da regra de notificação anterior é inválido');
        }
        const previousRule = await collection.findOne({ _id: previousObjectId });
        if (!previousRule) {
          throw new Error('Regra de notificação anterior não encontrada');
        }
      }

      if (normalizedPayload.active === undefined || normalizedPayload.active === true) {
        // Only one active rule per eventType -- mirrors retentionPolicy.
        // service.js's global single-active-policy behavior, scoped by
        // eventType since NotificationRule isn't a single global singleton.
        await collection.updateMany(
          { eventType: normalizedPayload.eventType, active: true },
          { $set: { active: false, updatedAt: new Date() } }
        );
      }

      const rule = NotificationRuleModel.create(normalizedPayload);
      const document = {
        ...rule,
        previousRuleId: previousRuleId || null
      };

      const result = await collection.insertOne(document);
      return { _id: result.insertedId, ...document };
    } catch (error) {
      logger.error('Erro ao criar regra de notificação:', error.message);
      throw error;
    }
  }

  async updateRule(db, ruleId, payload) {
    const collection = await getCollection(db, 'notificationRules');
    let objectId;
    try {
      objectId = new ObjectId(String(ruleId || '').trim());
    } catch {
      throw new Error('ID da regra de notificação inválido');
    }
    const existing = await collection.findOne({ _id: objectId });
    if (!existing) {
      throw new Error('Regra de notificação não encontrada');
    }
    // eventType is fixed per rule lineage -- an update carries the parent's
    // eventType forward regardless of what the caller sends, so a version
    // chain can't accidentally jump to a different event.
    return this.createRule(db, { ...payload, eventType: existing.eventType }, { previousRuleId: ruleId });
  }

  async getActiveRuleForEventType(db, eventType) {
    const collection = await getCollection(db, 'notificationRules');
    const rules = await collection
      .find({ eventType, active: true })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    return rules[0] || null;
  }

  async getRuleById(db, ruleId) {
    const collection = await getCollection(db, 'notificationRules');
    let objectId;
    try {
      objectId = new ObjectId(String(ruleId || '').trim());
    } catch {
      throw new Error('ID da regra de notificação inválido');
    }
    return collection.findOne({ _id: objectId });
  }

  async getAllRules(db, filters = {}) {
    const collection = await getCollection(db, 'notificationRules');
    const query = {};
    if (filters.eventType) {
      query.eventType = filters.eventType;
    }
    return collection
      .find(query)
      .sort({ active: -1, createdAt: -1, _id: -1 })
      .toArray();
  }
}

module.exports = new NotificationRuleService();
module.exports.ALLOWED_CHANNELS = NotificationRuleModel.ALLOWED_CHANNELS;
