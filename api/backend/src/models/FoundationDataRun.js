/**
 * Modelo de validação e estrutura para FoundationDataRun (RF022, #370).
 * Identificador imutável de uma execução completa do Foundation Data
 * Pipeline (dict-02_DICIONARIO.md P1X-0395..P1X-0413) — substitui o
 * reaproveitamento de `referenceSeedRuns` (#366) por uma entidade técnica
 * dedicada.
 */
const crypto = require('crypto');

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];
const RUN_STATUSES = ['planned', 'running', 'completed', 'completed_with_warnings', 'failed', 'rolled_back'];
const EXECUTION_MODES = ['validate', 'dry_run', 'apply', 'repair', 'rollback'];

class FoundationDataRunModel {
  static validate(data = {}) {
    const errors = [];

    for (const field of ['pipelineVersion', 'schemaVersion', 'dictionaryVersion', 'deploymentId', 'configurationChecksum', 'dictionaryChecksum', 'initiatedBy']) {
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
    if (data.steps !== undefined && !Array.isArray(data.steps)) {
      errors.push('steps deve ser um array');
    }
    if (data.validationSummary !== undefined && (typeof data.validationSummary !== 'object' || data.validationSummary === null || Array.isArray(data.validationSummary))) {
      errors.push('validationSummary deve ser um objeto');
    }
    if (data.errorSummary !== undefined && data.errorSummary !== null && (typeof data.errorSummary !== 'object' || Array.isArray(data.errorSummary))) {
      errors.push('errorSummary deve ser um objeto');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
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
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = FoundationDataRunModel;
module.exports.ENVIRONMENTS = ENVIRONMENTS;
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.EXECUTION_MODES = EXECUTION_MODES;
