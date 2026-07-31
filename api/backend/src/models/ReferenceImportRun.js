/**
 * Modelo de validação e estrutura para ReferenceImportRun (RF028).
 * Uma tentativa de importação de uma ReferenceDatasetRelease
 * (dict-02_DICIONARIO.md P1X-0435..P1X-0457). AC 5 exige um registro por
 * tentativa, com contagens e resumo de validação.
 */
const crypto = require('crypto');

const IMPORT_MODES = ['full', 'incremental', 'validation_only', 'dry_run', 'reprocess', 'rollback'];
const RUN_STATUSES = [
  'planned',
  'running',
  'validated',
  'staged',
  'approved',
  'completed',
  'failed',
  'cancelled',
  'rolled_back',
];

class ReferenceImportRunModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.referenceDatasetReleaseId || typeof data.referenceDatasetReleaseId !== 'string') {
      errors.push('referenceDatasetReleaseId é obrigatório e deve ser string');
    }
    if (!data.datasetCode || typeof data.datasetCode !== 'string') {
      errors.push('datasetCode é obrigatório e deve ser string');
    }
    if (data.importMode && !IMPORT_MODES.includes(data.importMode)) {
      errors.push(`importMode deve ser um de: ${IMPORT_MODES.join('|')}`);
    }
    if (!data.idempotencyKey || typeof data.idempotencyKey !== 'string') {
      errors.push('idempotencyKey é obrigatório e deve ser string');
    }
    if (data.runStatus && !RUN_STATUSES.includes(data.runStatus)) {
      errors.push(`runStatus deve ser um de: ${RUN_STATUSES.join('|')}`);
    }
    if (!data.inputChecksum || typeof data.inputChecksum !== 'string') {
      errors.push('inputChecksum é obrigatório e deve ser string (SHA-256)');
    }
    if (!data.initiatedBy || typeof data.initiatedBy !== 'string') {
      errors.push('initiatedBy é obrigatório e deve ser string');
    }
    for (const field of ['recordsRead', 'recordsValidated', 'recordsInserted', 'recordsUpdated', 'recordsSkipped', 'recordsRejected']) {
      if (data[field] !== undefined && typeof data[field] !== 'number') {
        errors.push(`${field} deve ser numérico`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      referenceImportRunId: data.referenceImportRunId || crypto.randomUUID(),
      referenceDatasetReleaseId: data.referenceDatasetReleaseId,
      foundationDataRunId: data.foundationDataRunId || null,
      datasetCode: data.datasetCode,
      importMode: data.importMode || 'full',
      idempotencyKey: data.idempotencyKey,
      startedAt: data.startedAt ? new Date(data.startedAt) : now,
      completedAt: data.completedAt ? new Date(data.completedAt) : null,
      runStatus: data.runStatus || 'planned',
      checkpoint: data.checkpoint || null,
      batchSize: typeof data.batchSize === 'number' ? data.batchSize : 500,
      recordsRead: data.recordsRead || 0,
      recordsValidated: data.recordsValidated || 0,
      recordsInserted: data.recordsInserted || 0,
      recordsUpdated: data.recordsUpdated || 0,
      recordsSkipped: data.recordsSkipped || 0,
      recordsRejected: data.recordsRejected || 0,
      inputChecksum: data.inputChecksum,
      validationSummary: data.validationSummary || {},
      errorReportUri: data.errorReportUri || null,
      initiatedBy: data.initiatedBy,
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = ReferenceImportRunModel;
module.exports.IMPORT_MODES = IMPORT_MODES;
module.exports.RUN_STATUSES = RUN_STATUSES;
