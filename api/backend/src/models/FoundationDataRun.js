/**
 * Modelo de validação e estrutura para FoundationDataRun (RF022, #370).
 * Identificador imutável de uma execução completa do Foundation Data
 * Pipeline (dict-02_DICIONARIO.md P1X-0395..P1X-0413, mais V2E-0459..0466
 * da release v2.0.0, RF022 AC5) — substitui o
 * reaproveitamento de `referenceSeedRuns` (#366) por uma entidade técnica
 * dedicada.
 */
const crypto = require('crypto');

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];
const RUN_STATUSES = ['planned', 'running', 'completed', 'completed_with_warnings', 'failed', 'rolled_back'];
const EXECUTION_MODES = ['validate', 'dry_run', 'apply', 'repair', 'rollback'];
// V2E-0462..0465 (dict v2.0.0): the release's extraction keeps one code per
// result (`pass`, and `not_required` for rollback) and drops the rest of the
// set. `fail` is the counterpart every gate in the Foundation plan needs, and
// `not_run` marks a stage the mode skips, so a run says which stages ran
// rather than leaving a result out. Inference from the plan's "resultados
// explícitos conforme o modo" (plano §8), not a value the dictionary lists.
const STAGE_RESULTS = ['pass', 'fail', 'not_run'];
const ROLLBACK_RESULTS = ['pass', 'fail', 'not_required'];

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
    for (const field of ['canonicalModelReleaseId', 'migrationPlanId', 'reportUri']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!data.contractChecksums || typeof data.contractChecksums !== 'object' || Array.isArray(data.contractChecksums)) {
      errors.push('contractChecksums deve ser um objeto');
    }
    if (!STAGE_RESULTS.includes(data.dryRunResult)) {
      errors.push(`dryRunResult deve ser um de: ${STAGE_RESULTS.join('|')}`);
    }
    for (const field of ['applyResult', 'verifyResult']) {
      if (data[field] !== undefined && data[field] !== null && !STAGE_RESULTS.includes(data[field])) {
        errors.push(`${field} deve ser um de: ${STAGE_RESULTS.join('|')}`);
      }
    }
    // V2E-0464: verifyResult "Obrigatório após apply".
    if (data.applyResult === 'pass' && !data.verifyResult) {
      errors.push('verifyResult é obrigatório após apply');
    }
    if (data.rollbackResult !== undefined && data.rollbackResult !== null && !ROLLBACK_RESULTS.includes(data.rollbackResult)) {
      errors.push(`rollbackResult deve ser um de: ${ROLLBACK_RESULTS.join('|')}`);
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
      // V2E-0459..0466: the v2.0.0 additions.
      canonicalModelReleaseId: data.canonicalModelReleaseId,
      contractChecksums: data.contractChecksums || {},
      migrationPlanId: data.migrationPlanId,
      dryRunResult: data.dryRunResult || 'not_run',
      applyResult: data.applyResult || null,
      verifyResult: data.verifyResult || null,
      rollbackResult: data.rollbackResult || null,
      reportUri: data.reportUri,
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = FoundationDataRunModel;
module.exports.ENVIRONMENTS = ENVIRONMENTS;
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.EXECUTION_MODES = EXECUTION_MODES;
module.exports.STAGE_RESULTS = STAGE_RESULTS;
module.exports.ROLLBACK_RESULTS = ROLLBACK_RESULTS;
