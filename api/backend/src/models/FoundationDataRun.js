/**
 * FoundationDataRun — contrato técnico RF022 / Modelo Canônico v2.0.0.
 *
 * Preserva os campos históricos P1X-0395..0413 e incorpora os campos v2
 * V2E-0459..0466 exigidos pela documentação aprovada.
 */
const crypto = require('crypto');

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];
const RUN_STATUSES = ['planned', 'running', 'completed', 'completed_with_warnings', 'failed', 'rolled_back'];
const EXECUTION_MODES = ['validate', 'dry_run', 'apply', 'repair', 'rollback'];
const RESULT_CODES = ['pass', 'fail', 'not_required'];

class FoundationDataRunModel {
  static validate(data = {}) {
    const errors = [];

    for (const field of [
      'pipelineVersion',
      'schemaVersion',
      'dictionaryVersion',
      'deploymentId',
      'configurationChecksum',
      'dictionaryChecksum',
      'initiatedBy',
      'canonicalModelReleaseId',
      'migrationPlanId',
      'reportUri',
    ]) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }

    if (!data.environment || !ENVIRONMENTS.includes(data.environment)) {
      errors.push(`environment deve ser um de: ${ENVIRONMENTS.join('|')}`);
    }
    if (!data.executionMode || !EXECUTION_MODES.includes(data.executionMode)) {
      errors.push(`executionMode deve ser um de: ${EXECUTION_MODES.join('|')}`);
    }
    if (data.runStatus && !RUN_STATUSES.includes(data.runStatus)) {
      errors.push(`runStatus deve ser um de: ${RUN_STATUSES.join('|')}`);
    }
    if (data.steps !== undefined && (!Array.isArray(data.steps) || data.steps.length === 0)) {
      errors.push('steps deve ser um array não vazio');
    }
    if (data.checkpoints !== undefined && !Array.isArray(data.checkpoints)) {
      errors.push('checkpoints deve ser um array');
    }
    if (data.contractChecksums !== undefined && (typeof data.contractChecksums !== 'object' || data.contractChecksums === null || Array.isArray(data.contractChecksums))) {
      errors.push('contractChecksums deve ser um objeto');
    }
    if (data.validationSummary !== undefined && (typeof data.validationSummary !== 'object' || data.validationSummary === null || Array.isArray(data.validationSummary))) {
      errors.push('validationSummary deve ser um objeto');
    }
    if (data.errorSummary !== undefined && data.errorSummary !== null && (typeof data.errorSummary !== 'object' || Array.isArray(data.errorSummary))) {
      errors.push('errorSummary deve ser um objeto');
    }
    if (data.postCondition !== undefined && (typeof data.postCondition !== 'object' || data.postCondition === null || Array.isArray(data.postCondition))) {
      errors.push('postCondition deve ser um objeto');
    }

    for (const field of ['dryRunResult', 'applyResult', 'verifyResult', 'rollbackResult']) {
      if (data[field] !== undefined && data[field] !== null && !RESULT_CODES.includes(data[field])) {
        errors.push(`${field} deve ser um de: ${RESULT_CODES.join('|')}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const validation = this.validate(data);
    if (!validation.isValid) {
      const error = new Error(`FoundationDataRun inválido: ${validation.errors.join('; ')}`);
      error.code = 'FOUNDATION_DATA_RUN_INVALID';
      throw error;
    }

    const now = new Date();
    return {
      foundationDataRunId: data.foundationDataRunId || crypto.randomUUID(),
      pipelineVersion: data.pipelineVersion,
      schemaVersion: data.schemaVersion,
      dictionaryVersion: data.dictionaryVersion,
      environment: data.environment,
      deploymentId: data.deploymentId,
      startedAt: data.startedAt ? new Date(data.startedAt) : now,
      completedAt: data.completedAt ? new Date(data.completedAt) : null,
      runStatus: data.runStatus || 'planned',
      executionMode: data.executionMode,
      configurationChecksum: data.configurationChecksum,
      dictionaryChecksum: data.dictionaryChecksum,
      steps: data.steps || [],
      validationSummary: data.validationSummary || {},
      errorSummary: data.errorSummary || null,
      initiatedBy: data.initiatedBy,
      previousRunId: data.previousRunId || null,
      canonicalModelReleaseId: data.canonicalModelReleaseId,
      contractChecksums: data.contractChecksums || {},
      migrationPlanId: data.migrationPlanId,
      dryRunResult: data.dryRunResult,
      applyResult: data.applyResult ?? null,
      verifyResult: data.verifyResult ?? null,
      rollbackResult: data.rollbackResult ?? null,
      reportUri: data.reportUri,
      checkpoints: data.checkpoints || [],
      postCondition: data.postCondition || {},
      createdAt: data.createdAt ? new Date(data.createdAt) : now,
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : now,
    };
  }
}

module.exports = FoundationDataRunModel;
module.exports.ENVIRONMENTS = ENVIRONMENTS;
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.EXECUTION_MODES = EXECUTION_MODES;
module.exports.RESULT_CODES = RESULT_CODES;
