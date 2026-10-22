/**
 * Modelo de validação e estrutura para ReferenceDatasetRelease (RF028).
 * Uma release versionada de um dataset/ontologia/terminologia externo
 * (dict-02_DICIONARIO.md P1X-0414..P1X-0434). Cada importador da Fase 2
 * registra uma release aqui antes de qualquer TerminologyConcept/
 * TerminologyRelation ser promovido.
 */
const crypto = require('crypto');

const ACCESS_METHODS = ['download', 'api', 'repository', 'manual_upload'];
const RELEASE_STATUSES = [
  'planned',
  'downloaded',
  'validated',
  'staged',
  'approved',
  'active',
  'superseded',
  'rejected',
  'rolled_back',
];

class ReferenceDatasetReleaseModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.sourceId || typeof data.sourceId !== 'string') {
      errors.push('sourceId é obrigatório e deve ser string');
    }
    if (!data.datasetCode || typeof data.datasetCode !== 'string') {
      errors.push('datasetCode é obrigatório e deve ser string');
    }
    if (!data.datasetName || typeof data.datasetName !== 'string') {
      errors.push('datasetName é obrigatório e deve ser string');
    }
    if (!data.systemUri || typeof data.systemUri !== 'string') {
      errors.push('systemUri é obrigatório e deve ser string');
    }
    if (!data.datasetVersion || typeof data.datasetVersion !== 'string') {
      errors.push('datasetVersion é obrigatório e deve ser string');
    }
    if (!data.retrievalUri || typeof data.retrievalUri !== 'string') {
      errors.push('retrievalUri é obrigatório e deve ser string');
    }
    if (data.accessMethod && !ACCESS_METHODS.includes(data.accessMethod)) {
      errors.push(`accessMethod deve ser um de: ${ACCESS_METHODS.join('|')}`);
    }
    if (data.sourceFormat !== undefined && !Array.isArray(data.sourceFormat)) {
      errors.push('sourceFormat deve ser um array');
    }
    if (!data.license || typeof data.license !== 'string') {
      errors.push('license é obrigatório e deve ser string');
    }
    if (!data.sourceChecksum || typeof data.sourceChecksum !== 'string') {
      errors.push('sourceChecksum é obrigatório e deve ser string (SHA-256)');
    }
    if (!data.parserVersion || typeof data.parserVersion !== 'string') {
      errors.push('parserVersion é obrigatório e deve ser string (SemVer)');
    }
    if (!data.mappingVersion || typeof data.mappingVersion !== 'string') {
      errors.push('mappingVersion é obrigatório e deve ser string (SemVer)');
    }
    if (data.releaseStatus && !RELEASE_STATUSES.includes(data.releaseStatus)) {
      errors.push(`releaseStatus deve ser um de: ${RELEASE_STATUSES.join('|')}`);
    }
    // V2E-0490: obrigatório quando active.
    if (data.releaseStatus === 'active' && (typeof data.promotionApprovedBy !== 'string' || data.promotionApprovedBy.trim() === '')) {
      errors.push('promotionApprovedBy é obrigatório quando releaseStatus é active');
    }
    // V2E-0491: release anterior para rollback.
    if (data.rollbackTargetId !== undefined && data.rollbackTargetId !== null && typeof data.rollbackTargetId !== 'string') {
      errors.push('rollbackTargetId deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      referenceDatasetReleaseId: data.referenceDatasetReleaseId || crypto.randomUUID(),
      sourceId: data.sourceId,
      datasetCode: data.datasetCode,
      datasetName: data.datasetName,
      systemUri: data.systemUri,
      datasetVersion: data.datasetVersion,
      releaseDate: data.releaseDate ? new Date(data.releaseDate) : null,
      retrievalUri: data.retrievalUri,
      retrievedAt: data.retrievedAt ? new Date(data.retrievedAt) : now,
      accessMethod: data.accessMethod || 'manual_upload',
      sourceFormat: Array.isArray(data.sourceFormat) ? data.sourceFormat : [],
      license: data.license,
      licenseUri: data.licenseUri || null,
      sourceChecksum: data.sourceChecksum,
      fileSize: typeof data.fileSize === 'number' ? data.fileSize : null,
      parserVersion: data.parserVersion,
      mappingVersion: data.mappingVersion,
      releaseStatus: data.releaseStatus || 'planned',
      previousReleaseId: data.previousReleaseId || null,
      promotionApprovedBy: data.promotionApprovedBy || null,
      rollbackTargetId: data.rollbackTargetId || null,
      promotionClaimedAt: data.promotionClaimedAt ? new Date(data.promotionClaimedAt) : null,
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = ReferenceDatasetReleaseModel;
module.exports.ACCESS_METHODS = ACCESS_METHODS;
module.exports.RELEASE_STATUSES = RELEASE_STATUSES;
