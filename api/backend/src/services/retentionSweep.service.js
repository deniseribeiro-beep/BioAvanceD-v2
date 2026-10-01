/**
 * Sweep de retenção (RF014 #441): aplica a RetentionPolicy ativa
 * (retentionPolicy.service.js, #440) a `audit_events`/`logs`.
 *
 * `audit_events` (audit-v2.service.js) é encadeado por hash por logId
 * (sequenceNumber + previousEventHash) e ancorado por snapshots imutáveis
 * em `audit_tree_heads` -- apagar um evento expirado quebraria as provas
 * de inclusão de todo evento posterior na mesma cadeia. Por isso, apenas
 * postRetentionAction 'archive' é suportado para AuditEvent: o evento é
 * movido para `audit_events_archive` (mesmo documento, nunca mutado) em
 * vez de removido, então a cadeia permanece totalmente verificável --
 * `audit_tree_heads` nunca é tocado, e qualquer evento arquivado ainda
 * pode ser recuperado para validar seu eventHash/canonicalLeaf/inclusionProof
 * contra a raiz registrada no seu treeSize. Qualquer outra ação
 * (especialmente 'destroy') é recusada para AuditEvent em vez de rebaixada
 * silenciosamente para archive.
 *
 * `logs` (Log.js) não tem essa restrição -- exclusão por timestamp é
 * segura para qualquer postRetentionAction que implique remoção.
 */
const retentionPolicyService = require('./retentionPolicy.service');
const auditLogger = require('./../utils/auditLogger');
const logger = require('../utils/logger');
const { iso8601DurationToMs } = require('../utils/iso8601Duration');

const AUDIT_EVENTS_COLLECTION = 'audit_events';
const AUDIT_EVENTS_ARCHIVE_COLLECTION = 'audit_events_archive';
const LOGS_COLLECTION = 'logs';
const LOGS_ARCHIVE_COLLECTION = 'logs_archive';

class RetentionSweepService {
  // #1259: this deleted on every postRetentionAction, so an 'archive',
  // 'review' or 'anonymize' policy destroyed log rows it was meant to keep.
  // It now follows the action, as sweepAuditEvents does: 'destroy' deletes,
  // 'archive' moves the row unchanged to logs_archive, and the two actions no
  // code implements for logs remove nothing.
  async sweepLogs(db, policy, cutoff) {
    const logs = db.collection(LOGS_COLLECTION);
    if (policy.postRetentionAction === 'destroy') {
      const result = await logs.deleteMany({ createdAt: { $lt: cutoff } });
      return { deleted: result.deletedCount || 0 };
    }
    if (policy.postRetentionAction === 'archive') {
      const expired = await logs.find({ createdAt: { $lt: cutoff } }).toArray();
      if (!expired.length) return { archived: 0, skipped: false };
      await db.collection(LOGS_ARCHIVE_COLLECTION).insertMany(expired.map((doc) => ({ ...doc, archivedAt: new Date() })));
      await logs.deleteMany({ _id: { $in: expired.map((doc) => doc._id) } });
      return { archived: expired.length, skipped: false };
    }
    logger.warn(
      `Sweep de retenção: postRetentionAction "${policy.postRetentionAction}" não é implementado para Log -- nenhum log removido.`
    );
    return { deleted: 0, skipped: true, reason: `unsupported_post_retention_action:${policy.postRetentionAction}` };
  }

  async sweepAuditEvents(db, policy, cutoff) {
    if (policy.postRetentionAction !== 'archive') {
      logger.warn(
        `Sweep de retenção: postRetentionAction "${policy.postRetentionAction}" não é suportado para AuditEvent ` +
        `(apenas "archive" preserva a cadeia de hash) -- nenhum evento removido.`
      );
      return { archived: 0, skipped: true, reason: `unsupported_post_retention_action:${policy.postRetentionAction}` };
    }

    const events = db.collection(AUDIT_EVENTS_COLLECTION);
    const archive = db.collection(AUDIT_EVENTS_ARCHIVE_COLLECTION);

    const expired = await events.find({ recordedAt: { $lt: cutoff.toISOString() } }).toArray();
    if (!expired.length) return { archived: 0, skipped: false };

    await archive.insertMany(expired.map((doc) => ({ ...doc, archivedAt: new Date().toISOString() })));
    await events.deleteMany({ _id: { $in: expired.map((doc) => doc._id) } });

    return { archived: expired.length, skipped: false };
  }

  async runSweep(db) {
    const policy = await retentionPolicyService.getActivePolicy(db);
    if (!policy) {
      logger.info('Sweep de retenção: nenhuma política ativa, nada a fazer.');
      return { ranAt: new Date().toISOString(), skipped: true, reason: 'no_active_policy' };
    }

    const cutoff = new Date(Date.now() - iso8601DurationToMs(policy.retentionPeriod));
    const result = {
      ranAt: new Date().toISOString(),
      policyId: String(policy._id),
      policyVersion: policy.version,
      cutoff: cutoff.toISOString(),
    };

    if (policy.applicableEntityTypes.includes('Log')) {
      result.logs = await this.sweepLogs(db, policy, cutoff);
    }
    if (policy.applicableEntityTypes.includes('AuditEvent')) {
      result.auditEvents = await this.sweepAuditEvents(db, policy, cutoff);
    }

    try {
      auditLogger.init(db);
      await auditLogger.log({
        action: 'RETENTION_SWEEP',
        resourceType: 'RetentionPolicy',
        resourceId: result.policyId,
        status: 'success',
        severity: 'critical',
        message: `Sweep de retenção executado (política ${policy.version})`,
        payload: result,
        module: 'Segurança',
        // #1105: runSweep is invoked from scheduler.service.js:202's
        // cron.schedule, never from a request, so dict-02 P1X-0331's
        // 'scheduler' is the correct origin -- not the 'api' it landed on via
        // Log.js:124's default.
        source: 'scheduler',
      });
    } catch (error) {
      logger.error('Erro ao registrar AuditEvent do sweep de retenção:', error.message);
    }

    return result;
  }
}

module.exports = new RetentionSweepService();
module.exports.AUDIT_EVENTS_COLLECTION = AUDIT_EVENTS_COLLECTION;
module.exports.AUDIT_EVENTS_ARCHIVE_COLLECTION = AUDIT_EVENTS_ARCHIVE_COLLECTION;
module.exports.LOGS_COLLECTION = LOGS_COLLECTION;
module.exports.LOGS_ARCHIVE_COLLECTION = LOGS_ARCHIVE_COLLECTION;
