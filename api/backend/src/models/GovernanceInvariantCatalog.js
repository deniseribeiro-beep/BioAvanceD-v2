/**
 * GovernanceInvariantCatalog and GovernanceInvariant (RF014 AC6, RNF028
 * C3/C5, CFG-003; dict v2.0.0 V2E-0020..0031): the published list of rules
 * no configuration may override. Each invariant names where it is enforced,
 * the tests that verify it and what a violation does. The Foundation job
 * registers the catalog against its CanonicalModelRelease (plano §4 F1.2);
 * a registered catalog's invariants and checksum are never rewritten.
 */
const crypto = require('crypto');
const { canonicalJson, STATUSES } = require('./ConfigurationRelease');

// V2E-0025's extraction keeps only `draft`. The set used is the release
// lifecycle the same governance block spells out in full (V2E-0003), as for
// ConfigurationRelease.status. Inference from that sibling.
const CATALOG_STATUSES = STATUSES;

// V2E-0030 "Consequência obrigatória da violação": `block` is the only
// value the dictionary lists, and CFG-003 makes every invariant blocking.
const VIOLATION_OUTCOMES = ['block'];

function invariantsChecksum(invariants) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(invariants)).digest('hex')}`;
}

function invariantFieldsOf(data = {}) {
  return {
    invariantId: data.invariantId,
    statement: data.statement,
    enforcementPoint: data.enforcementPoint,
    testId: data.testId,
    violationOutcome: data.violationOutcome,
    changeProcedure: data.changeProcedure,
  };
}

function validateInvariant(data = {}) {
  const errors = [];
  for (const field of ['invariantId', 'statement', 'changeProcedure']) {
    if (!data[field] || typeof data[field] !== 'string') {
      errors.push(`${data.invariantId || '?'}.${field} é obrigatório e deve ser string`);
    }
  }
  for (const field of ['enforcementPoint', 'testId']) {
    if (!Array.isArray(data[field]) || data[field].length === 0) {
      errors.push(`${data.invariantId || '?'}.${field} deve listar ao menos um item`);
    }
  }
  if (!VIOLATION_OUTCOMES.includes(data.violationOutcome)) {
    errors.push(`${data.invariantId || '?'}.violationOutcome deve ser um de: ${VIOLATION_OUTCOMES.join('|')}`);
  }
  return errors;
}

class GovernanceInvariantCatalogModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      catalogId: data.catalogId,
      semanticVersion: data.semanticVersion,
      canonicalModelReleaseId: data.canonicalModelReleaseId,
      invariants: data.invariants,
      checksum: data.checksum,
      status: data.status,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['catalogId', 'semanticVersion', 'canonicalModelReleaseId', 'checksum']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!CATALOG_STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${CATALOG_STATUSES.join('|')}`);
    }
    if (!Array.isArray(data.invariants) || data.invariants.length === 0) {
      errors.push('invariants deve listar ao menos um invariante');
    } else {
      const ids = data.invariants.map((invariant) => invariant.invariantId);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (duplicates.length) errors.push(`invariantId duplicado: ${[...new Set(duplicates)].join(', ')}`);
      for (const invariant of data.invariants) errors.push(...validateInvariant(invariant));
      if (data.checksum && data.checksum !== invariantsChecksum(data.invariants)) {
        errors.push('checksum não corresponde a invariants');
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  static createActive({ semanticVersion, canonicalModelReleaseId, invariants, now = new Date() } = {}) {
    const stored = invariants.map(invariantFieldsOf);
    const catalog = {
      catalogId: crypto.randomUUID(),
      semanticVersion,
      canonicalModelReleaseId,
      invariants: stored,
      checksum: invariantsChecksum(stored),
      status: 'active',
      createdAt: now,
    };
    const { isValid, errors } = GovernanceInvariantCatalogModel.validate(catalog);
    if (!isValid) throw new Error(`GovernanceInvariantCatalog inválido: ${errors.join('; ')}`);
    return catalog;
  }
}

module.exports = GovernanceInvariantCatalogModel;
module.exports.CATALOG_STATUSES = CATALOG_STATUSES;
module.exports.VIOLATION_OUTCOMES = VIOLATION_OUTCOMES;
module.exports.invariantsChecksum = invariantsChecksum;
module.exports.invariantFieldsOf = invariantFieldsOf;
