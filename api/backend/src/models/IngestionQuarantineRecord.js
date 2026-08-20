/**
 * Modelo de validação e estrutura para IngestionQuarantineRecord (RF029 AC 6,
 * #669). Um registro rejeitado pelo ingestionGateway (contrato canônico,
 * referência inexistente, código inativo ou provenance ausente) — "erros vão
 * para quarentena, sem correção silenciosa". Modelado sobre a forma de
 * ReferenceImportIssue (RF028), mas com seu próprio vocabulário: este
 * registro não pertence a uma ReferenceImportRun/ReferenceDatasetRelease,
 * pertence a uma ingestão de entidade operacional/científica (Fase 3)
 * qualquer — ver `bioavanced-v2-conventions`' local-env sobre a decisão de
 * não reaproveitar ReferenceImportIssue nem StagingImport (FHIR) diretamente.
 */
const crypto = require('crypto');

const SEVERITIES = ['warning', 'error', 'fatal'];
const RESOLUTION_STATUSES = ['open', 'accepted', 'corrected', 'ignored_with_justification', 'reprocessed', 'closed'];

class IngestionQuarantineRecordModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.entityType || typeof data.entityType !== 'string') {
      errors.push('entityType é obrigatório e deve ser string');
    }
    if (!Array.isArray(data.violations) || data.violations.length === 0) {
      errors.push('violations é obrigatório e deve ser um array não vazio');
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
      ingestionQuarantineRecordId: data.ingestionQuarantineRecordId || crypto.randomUUID(),
      entityType: data.entityType,
      sourceRecordId: data.sourceRecordId || null,
      idempotencyKey: data.idempotencyKey || null,
      payload: data.payload !== undefined ? data.payload : null,
      violations: Array.isArray(data.violations) ? data.violations : [],
      severity: data.severity || 'error',
      provenance: data.provenance || null,
      resolutionStatus: data.resolutionStatus || 'open',
      detectedAt: data.detectedAt ? new Date(data.detectedAt) : now,
      resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
      resolvedBy: data.resolvedBy || null,
      resolutionNotes: data.resolutionNotes || null,
    };
  }
}

module.exports = IngestionQuarantineRecordModel;
module.exports.SEVERITIES = SEVERITIES;
module.exports.RESOLUTION_STATUSES = RESOLUTION_STATUSES;
