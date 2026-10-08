/**
 * ConfigurationValidationRun (RF014 AC3/AC4, RNF018 C3, RNF028 C4, CFG-005,
 * RULE-015; dict v2.0.0 V2E-0042..0051): the gates a candidate
 * ConfigurationRelease passes or fails before it may be activated. An
 * append-only record: a failed run keeps its candidate a draft, and the
 * report names the rule each failure broke.
 */
const crypto = require('crypto');
const { canonicalJson } = require('./ConfigurationRelease');

// V2E-0044..0047 list only `pass`; a gate either passes or does not.
const GATE_RESULTS = ['pass', 'fail'];
// V2E-0049 lists only `planned`, the state before execution. A run is
// recorded once executed, so it ends `passed` or `failed` (plano §9,
// "ConfigurationValidationRun aprovado"). Inference from the plan's gate.
const RUN_STATUSES = ['planned', 'passed', 'failed'];
const GATES = ['structuralResult', 'semanticResult', 'dependencyResult', 'securityResult'];

class ConfigurationValidationRunModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      configurationValidationRunId: data.configurationValidationRunId,
      releaseId: data.releaseId,
      structuralResult: data.structuralResult,
      semanticResult: data.semanticResult,
      dependencyResult: data.dependencyResult,
      securityResult: data.securityResult,
      invariantResults: data.invariantResults,
      status: data.status,
      reportUri: data.reportUri,
      executedAt: data.executedAt,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['configurationValidationRunId', 'releaseId', 'reportUri']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    for (const gate of GATES) {
      if (!GATE_RESULTS.includes(data[gate])) errors.push(`${gate} deve ser um de: ${GATE_RESULTS.join('|')}`);
    }
    if (!Array.isArray(data.invariantResults) || data.invariantResults.length === 0) {
      errors.push('invariantResults deve listar ao menos um invariante');
    } else if (data.invariantResults.some((entry) => !entry.invariantId || !GATE_RESULTS.includes(entry.result))) {
      errors.push('cada invariantResult precisa de invariantId e result pass|fail');
    }
    if (!RUN_STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${RUN_STATUSES.join('|')}`);
    } else if (data.status !== 'planned') {
      const failed = GATES.some((gate) => data[gate] === 'fail')
        || (data.invariantResults || []).some((entry) => entry.result === 'fail');
      if ((data.status === 'passed') === failed) errors.push(`status ${data.status} contradiz os resultados`);
    }
    if (!(data.executedAt instanceof Date)) errors.push('executedAt é obrigatório');
    return { isValid: errors.length === 0, errors };
  }

  /**
   * Records an executed run. `findings` maps each gate to its failure
   * messages; `invariantResults` is one `{ invariantId, result, paths }`
   * per catalogued invariant. The reportUri names the run by id and content
   * hash, as the Foundation runs do, until object storage exists (W10).
   */
  static createExecuted({ releaseId, findings, invariantResults, now = new Date() } = {}) {
    const configurationValidationRunId = crypto.randomUUID();
    const result = (messages) => (messages && messages.length ? 'fail' : 'pass');
    const content = {
      releaseId,
      structuralResult: result(findings.structural),
      semanticResult: result(findings.semantic),
      dependencyResult: result(findings.dependency),
      securityResult: result(findings.security),
      invariantResults,
      findings,
      executedAt: now,
    };
    const failed = GATES.some((gate) => content[gate] === 'fail') || invariantResults.some((entry) => entry.result === 'fail');
    const run = {
      configurationValidationRunId,
      ...content,
      status: failed ? 'failed' : 'passed',
      reportUri: `urn:bioavanced:configuration-validation-run:${configurationValidationRunId}#sha256=${crypto.createHash('sha256').update(canonicalJson(content)).digest('hex')}`,
    };
    const { isValid, errors } = ConfigurationValidationRunModel.validate(run);
    if (!isValid) throw new Error(`ConfigurationValidationRun inválida: ${errors.join('; ')}`);
    return run;
  }
}

module.exports = ConfigurationValidationRunModel;
module.exports.GATE_RESULTS = GATE_RESULTS;
module.exports.RUN_STATUSES = RUN_STATUSES;
