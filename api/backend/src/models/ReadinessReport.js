/**
 * ReadinessReport (RF022 AC9, RNF014 C7, RNF031 C5/C6; dict v2.0.0
 * V2E-0418..0426): the Foundation Data Pipeline's promotion decision. One
 * report per apply or verify run, append-only; the API and workers start
 * only when the newest report for their environment is `ready`.
 */
const crypto = require('crypto');

// V2E-0424: the extraction keeps `blocked` as the vocabulary and `ready` as
// the example; the plan's gate is "Promoção somente status=ready" (plano §4,
// F1.11), so the set is the two.
const STATUSES = ['ready', 'blocked'];
const GATE_RESULTS = ['pass', 'fail', 'warn', 'not_evaluated'];

function reportChecksum(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

class ReadinessReportModel {
  static validate(data = {}) {
    const errors = [];

    for (const field of ['readinessReportId', 'foundationDataRunId', 'canonicalModelReleaseId', 'reportUri']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${STATUSES.join('|')}`);
    }
    if (typeof data.p0Coverage !== 'number' || data.p0Coverage < 0 || data.p0Coverage > 1) {
      errors.push('p0Coverage deve ser um número entre 0 e 1');
    }
    // V2E-0422: gateResults is 1..*.
    if (!Array.isArray(data.gateResults) || data.gateResults.length === 0) {
      errors.push('gateResults deve ser um array não vazio');
    } else {
      for (const gate of data.gateResults) {
        if (!gate || typeof gate.gate !== 'string' || !GATE_RESULTS.includes(gate.result)) {
          errors.push(`cada gateResult precisa de gate e result em ${GATE_RESULTS.join('|')}`);
          break;
        }
      }
    }
    if (data.blockers !== undefined && !Array.isArray(data.blockers)) {
      errors.push('blockers deve ser um array');
    }
    // A ready report with a blocker, or a blocked one without, says two things.
    if (data.status === 'ready' && Array.isArray(data.blockers) && data.blockers.length > 0) {
      errors.push('um relatório ready não pode ter blockers');
    }
    if (data.status === 'blocked' && (!Array.isArray(data.blockers) || data.blockers.length === 0)) {
      errors.push('um relatório blocked precisa nomear ao menos um blocker');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Builds the report and derives what the gates decide: a P0 gate that
   * failed is a blocker, and so is any extra blocker the caller names (a
   * rollback, a fatal error). `p0Coverage` is the share of P0 gates that
   * passed, counting the ones this release does not evaluate yet, so a
   * partial Foundation shows below 1.0 instead of claiming full coverage.
   */
  static create({ readinessReportId, foundationDataRunId, canonicalModelReleaseId, environment, gateResults = [], extraBlockers = [], generatedAt } = {}) {
    const p0Gates = gateResults.filter((gate) => gate.p0);
    const p0Passed = p0Gates.filter((gate) => gate.result === 'pass').length;
    const blockers = [
      ...gateResults.filter((gate) => gate.p0 && gate.result === 'fail').map((gate) => `gate:${gate.gate}`),
      ...extraBlockers,
    ];
    const id = readinessReportId || crypto.randomUUID();
    const content = {
      readinessReportId: id,
      foundationDataRunId,
      canonicalModelReleaseId,
      // Not a dictionary field: the run it evaluates carries the environment
      // (P1X-0399), and the API's start check filters on it without a join.
      environment,
      p0Coverage: p0Gates.length === 0 ? 0 : p0Passed / p0Gates.length,
      gateResults,
      blockers,
      status: blockers.length === 0 ? 'ready' : 'blocked',
      generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
    };
    // V2E-0425 "Evidência imutável": the report lives in MongoDB until
    // object storage exists (W10), so the URI names it by id and pins its
    // content hash; a changed document no longer matches its own URI.
    return { ...content, reportUri: `urn:bioavanced:readiness-report:${id}#sha256=${reportChecksum(content)}` };
  }
}

module.exports = ReadinessReportModel;
module.exports.STATUSES = STATUSES;
module.exports.GATE_RESULTS = GATE_RESULTS;
module.exports.reportChecksum = reportChecksum;
