const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const env = require('../config/env');

// #728 (RF013 AC#5/AC#6): a single admin-editable BackupPolicy document,
// same singleton-config shape as security.service.js's security_config
// (`_id: 'main'`, get-or-seed-defaults, audited update) -- the closest
// existing precedent for "one global admin-editable settings object with
// audit-log wiring" in this codebase. Defaults mirror the previous
// env-var-only behavior (BACKUP_CRON/BACKUP_RETENTION_DAYS,
// backup.service.js) plus RNF010's quantitative targets (RPO<=24h,
// RTO<=12h, retention>=30 days, encrypted copies) for the fields that had
// no prior runtime equivalent at all.
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CRON = '0 3 * * *';
const CRON_FIELD_PATTERN = /^(\S+\s+){4}\S+$/;

class BackupPolicyService {
  getDefaultPolicy() {
    return {
      cronExpression: env.BACKUP_CRON || DEFAULT_CRON,
      retentionDays: Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS),
      // #728: no encryption-at-rest mechanism exists in backup.service.js
      // yet (mongodump/JSON-fallback write plaintext) -- this records the
      // RNF010 target/compliance expectation, it does not gate any
      // enforcement in this slice. See BioAvanceD-v2#734.
      encryptionEnabled: true,
      rpoHours: 24,
      rtoHours: 12,
      updatedBy: null,
      updatedAt: null,
    };
  }

  async getPolicy(db) {
    try {
      const collection = db.collection('backup_policy');
      const policy = await collection.findOne({ _id: 'main' });

      if (!policy) {
        const defaultPolicy = this.getDefaultPolicy();
        await collection.insertOne({ _id: 'main', ...defaultPolicy, createdAt: new Date() });
        return defaultPolicy;
      }

      const { _id, createdAt, ...policyData } = policy;
      return policyData;
    } catch (error) {
      logger.error('Erro ao buscar política de backup:', error.message);
      throw error;
    }
  }

  validatePolicy(policy) {
    const errors = [];

    if (policy.cronExpression !== undefined && !CRON_FIELD_PATTERN.test(String(policy.cronExpression || ''))) {
      errors.push('cronExpression deve ser uma expressão cron de 5 campos');
    }

    if (policy.retentionDays !== undefined) {
      const retentionDays = Number(policy.retentionDays);
      if (!Number.isFinite(retentionDays) || retentionDays < 30) {
        errors.push('retentionDays deve ser um número >= 30 (RNF010 AC#4)');
      }
    }

    if (policy.rpoHours !== undefined) {
      const rpoHours = Number(policy.rpoHours);
      if (!Number.isFinite(rpoHours) || rpoHours <= 0 || rpoHours > 24) {
        errors.push('rpoHours deve ser um número entre 1 e 24 (RNF010 AC#2)');
      }
    }

    if (policy.rtoHours !== undefined) {
      const rtoHours = Number(policy.rtoHours);
      if (!Number.isFinite(rtoHours) || rtoHours <= 0 || rtoHours > 12) {
        errors.push('rtoHours deve ser um número entre 1 e 12 (RNF010 AC#3)');
      }
    }

    if (policy.encryptionEnabled !== undefined && typeof policy.encryptionEnabled !== 'boolean') {
      errors.push('encryptionEnabled deve ser booleano');
    }

    if (errors.length > 0) {
      const error = new Error(errors.join('; '));
      error.validationErrors = errors;
      throw error;
    }
  }

  detectChanges(oldPolicy, newPolicy) {
    const changes = [];
    const fields = ['cronExpression', 'retentionDays', 'encryptionEnabled', 'rpoHours', 'rtoHours'];

    for (const field of fields) {
      if (newPolicy[field] === undefined) continue;
      if (oldPolicy[field] !== newPolicy[field]) {
        changes.push({ field, oldValue: oldPolicy[field], newValue: newPolicy[field] });
      }
    }

    return changes;
  }

  async updatePolicy(db, newPolicy, currentPolicy, req) {
    try {
      this.validatePolicy(newPolicy);
      const changes = this.detectChanges(currentPolicy, newPolicy);

      const merged = {
        ...currentPolicy,
        cronExpression: newPolicy.cronExpression !== undefined ? newPolicy.cronExpression : currentPolicy.cronExpression,
        retentionDays: newPolicy.retentionDays !== undefined ? Number(newPolicy.retentionDays) : currentPolicy.retentionDays,
        encryptionEnabled: newPolicy.encryptionEnabled !== undefined ? newPolicy.encryptionEnabled : currentPolicy.encryptionEnabled,
        rpoHours: newPolicy.rpoHours !== undefined ? Number(newPolicy.rpoHours) : currentPolicy.rpoHours,
        rtoHours: newPolicy.rtoHours !== undefined ? Number(newPolicy.rtoHours) : currentPolicy.rtoHours,
        updatedBy: req.user?.userID || req.user?._id || 'SYSTEM',
        updatedAt: new Date(),
      };

      const collection = db.collection('backup_policy');
      await collection.updateOne({ _id: 'main' }, { $set: merged }, { upsert: true });

      if (changes.length > 0) {
        auditLogger.init(db);
        for (const change of changes) {
          await auditLogger.log({
            action: 'UPDATE',
            resourceType: 'BackupPolicy',
            resourceId: 'main',
            status: 'success',
            severity: 'critical',
            message: `Política de backup alterada: ${change.field}`,
            payload: { field: change.field, oldValue: change.oldValue, newValue: change.newValue },
            req,
            module: 'Backup',
          });
        }
      }

      return { merged, changed: changes.map((change) => change.field) };
    } catch (error) {
      logger.error('Erro ao atualizar política de backup:', error.message);
      throw error;
    }
  }
}

module.exports = new BackupPolicyService();
module.exports.BackupPolicyService = BackupPolicyService;
