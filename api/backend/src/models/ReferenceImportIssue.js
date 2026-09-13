/**
 * Modelo de validação e estrutura para ReferenceImportIssue (RF028).
 * Uma rejeição/inconsistência detectada durante uma ReferenceImportRun
 * (dict-02_DICIONARIO.md P1X-0458..P1X-0474). AC 5 exige um registro por
 * rejeição; erros vão para quarentena, nunca são descartados silenciosamente.
 */
const crypto = require('crypto');

const SEVERITIES = ['warning', 'error', 'fatal'];
const RESOLUTION_STATUSES = ['open', 'accepted', 'corrected', 'ignored_with_justification', 'reprocessed', 'closed'];

class ReferenceImportIssueModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.referenceImportRunId || typeof data.referenceImportRunId !== 'string') {
      errors.push('referenceImportRunId é obrigatório e deve ser string');
    }
    if (!data.referenceDatasetReleaseId || typeof data.referenceDatasetReleaseId !== 'string') {
      errors.push('referenceDatasetReleaseId é obrigatório e deve ser string');
    }
    if (!data.entityType || typeof data.entityType !== 'string') {
      errors.push('entityType é obrigatório e deve ser string');
    }
    if (!data.errorCode || typeof data.errorCode !== 'string') {
      errors.push('errorCode é obrigatório e deve ser string');
    }
    if (!data.errorMessage || typeof data.errorMessage !== 'string') {
      errors.push('errorMessage é obrigatório e deve ser string');
    }
    if (data.severity && !SEVERITIES.includes(data.severity)) {
      errors.push(`severity deve ser um de: ${SEVERITIES.join('|')}`);
    }
    if (data.resolutionStatus && !RESOLUTION_STATUSES.includes(data.resolutionStatus)) {
      errors.push(`resolutionStatus deve ser um de: ${RESOLUTION_STATUSES.join('|')}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      referenceImportIssueId: data.referenceImportIssueId || crypto.randomUUID(),
      referenceImportRunId: data.referenceImportRunId,
      referenceDatasetReleaseId: data.referenceDatasetReleaseId,
      sourceRecordId: data.sourceRecordId || null,
      rowNumber: typeof data.rowNumber === 'number' ? data.rowNumber : null,
      entityType: data.entityType,
      fieldPath: data.fieldPath || null,
      rawValue: data.rawValue !== undefined ? data.rawValue : null,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      severity: data.severity || 'error',
      resolutionStatus: data.resolutionStatus || 'open',
      quarantinePayloadUri: data.quarantinePayloadUri || null,
      detectedAt: data.detectedAt ? new Date(data.detectedAt) : now,
      resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
      resolvedBy: data.resolvedBy || null,
      resolutionNotes: data.resolutionNotes || null,
    };
  }
}

module.exports = ReferenceImportIssueModel;
module.exports.SEVERITIES = SEVERITIES;
module.exports.RESOLUTION_STATUSES = RESOLUTION_STATUSES;
