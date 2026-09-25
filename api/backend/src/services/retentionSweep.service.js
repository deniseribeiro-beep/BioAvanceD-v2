/**
 * Sweep de retenção (RF014 #441 / #667/#793/#812): aplica a RetentionPolicy
 * ativa a `audit_events`/`logs` e, quando a política lista, a quarentena de
 * import e aos logs de compliance de notificação.
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
 *
 * #793 ImportStagingRecord: destroy after P90D (fixed window), including
 * retained sourceFile.storedPath on disk.
 * #812 NotificationComplianceLog: destroy after P30D (fixed window).
 */
const fs = require('fs');
const retentionPolicyService = require('./retentionPolicy.service');
const auditLogger = require('./../utils/auditLogger');
const logger = require('../utils/logger');
const { iso8601DurationToMs } = require('../utils/iso8601Duration');

const AUDIT_EVENTS_COLLECTION = 'audit_events';
const AUDIT_EVENTS_ARCHIVE_COLLECTION = 'audit_events_archive';
const LOGS_COLLECTION = 'logs';
const IMPORT_BATCHES_COLLECTION = 'import_batches';
const IMPORT_STAGING_RECORDS_COLLECTION = 'import_staging_records';
const NOTIFICATION_COMPLIANCE_LOGS_COLLECTION = 'notification_compliance_logs';

const IMPORT_STAGING_RETENTION = 'P90D';
const NOTIFICATION_COMPLIANCE_RETENTION = 'P30D';

class RetentionSweepService {
  async sweepLogs(db, cutoff) {
    const result = await db.collection(LOGS_COLLECTION).deleteMany({ createdAt: { $lt: cutoff } });
    return { deleted: result.deletedCount || 0 };
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

  // #793: quarantine batches + staging rows + optional retained source files.
  async sweepImportStaging(db, cutoff) {
    const batches = db.collection(IMPORT_BATCHES_COLLECTION);
    const staging = db.collection(IMPORT_STAGING_RECORDS_COLLECTION);
    const expired = await batches.find({ createdAt: { $lt: cutoff } }).toArray();
    if (!expired.length) {
      return { batchesDeleted: 0, stagingDeleted: 0, filesRemoved: 0 };
    }

    let filesRemoved = 0;
    for (const batch of expired) {
      const storedPath = batch?.sourceFile?.storedPath;
      if (!storedPath || typeof storedPath !== 'string') continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.rm(storedPath, { force: true });
        filesRemoved += 1;
      } catch (error) {
        logger.error(`Erro ao remover sourceFile de quarentena ${storedPath}:`, error?.message || String(error));
      }
    }

    const batchIds = expired.map((doc) => doc._id);
    const stagingResult = await staging.deleteMany({ batchId: { $in: batchIds } });
    const batchResult = await batches.deleteMany({ _id: { $in: batchIds } });

    return {
      batchesDeleted: batchResult.deletedCount || 0,
      stagingDeleted: stagingResult.deletedCount || 0,
      filesRemoved,
    };
  }

  // #812: compliance rows carrying participant emails.
  async sweepNotificationComplianceLogs(db, cutoff) {
    const result = await db.collection(NOTIFICATION_COMPLIANCE_LOGS_COLLECTION).deleteMany({
      createdAt: { $lt: cutoff },
    });
    return { deleted: result.deletedCount || 0 };
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
      result.logs = await this.sweepLogs(db, cutoff);
    }
    if (policy.applicableEntityTypes.includes('AuditEvent')) {
      result.auditEvents = await this.sweepAuditEvents(db, policy, cutoff);
    }
    if (policy.applicableEntityTypes.includes('ImportStagingRecord')) {
      const importCutoff = new Date(Date.now() - iso8601DurationToMs(IMPORT_STAGING_RETENTION));
      result.importStaging = await this.sweepImportStaging(db, importCutoff);
      result.importStagingCutoff = importCutoff.toISOString();
    }
    if (policy.applicableEntityTypes.includes('NotificationComplianceLog')) {
      const notifyCutoff = new Date(Date.now() - iso8601DurationToMs(NOTIFICATION_COMPLIANCE_RETENTION));
      result.notificationComplianceLogs = await this.sweepNotificationComplianceLogs(db, notifyCutoff);
      result.notificationComplianceCutoff = notifyCutoff.toISOString();
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
module.exports.IMPORT_BATCHES_COLLECTION = IMPORT_BATCHES_COLLECTION;
module.exports.IMPORT_STAGING_RECORDS_COLLECTION = IMPORT_STAGING_RECORDS_COLLECTION;
module.exports.NOTIFICATION_COMPLIANCE_LOGS_COLLECTION = NOTIFICATION_COMPLIANCE_LOGS_COLLECTION;
module.exports.IMPORT_STAGING_RETENTION = IMPORT_STAGING_RETENTION;
module.exports.NOTIFICATION_COMPLIANCE_RETENTION = NOTIFICATION_COMPLIANCE_RETENTION;
