/**
 * RF029 canonical ingestion validation.
 *
 * The executable contract is generated from the approved BioAvanceD
 * Canonical Data Model v2.0.0 workbook. Payload validation rejects aliases,
 * unknown fields, invalid cardinalities and values that violate executable
 * entity contracts prepared in Foundation. Reference existence is checked
 * separately because it requires a persistence handle.
 */
const { validateEntity } = require('../contracts/canonical/v2');

function collectAliasViolations(payload, aliasMap = {}) {
  const hits = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return hits;

  for (const aliases of Object.values(aliasMap)) {
    const aliasList = Array.isArray(aliases) ? aliases : [];
    for (const alias of aliasList) {
      if (Object.prototype.hasOwnProperty.call(payload, alias)) hits.push(alias);
    }
  }

  return [...new Set(hits)];
}

function extractContractField(issue) {
  const path = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.');
  return path || issue.params?.missingProperty || issue.params?.additionalProperty || null;
}

async function validateIngestionPayload({ entityType, payload, aliasMap = {} }) {
  if (!entityType) throw new Error('validateIngestionPayload: entityType é obrigatório');
  const violations = [];

  for (const alias of collectAliasViolations(payload, aliasMap)) {
    violations.push({
      code: 'NON_CANONICAL_FIELD',
      field: alias,
      message: `Campo não canônico (use o nome canônico, não o alias): ${alias}`,
    });
  }

  const result = await validateEntity(entityType, payload);
  if (!result.valid) {
    for (const issue of result.errors || []) {
      violations.push({
        code: 'CONTRACT_VIOLATION',
        field: extractContractField(issue),
        message: issue.message || 'Violação de contrato canônico v2.0.0',
        contractVersion: '2.0.0',
        ajvKeyword: issue.keyword || null,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

async function assertReferencesExist(db, references = []) {
  const violations = [];

  for (const reference of references) {
    const { collection, field, value, label } = reference || {};
    if (value === undefined || value === null || value === '') continue;
    if (!collection || !field) {
      throw new Error('assertReferencesExist: cada referência precisa de collection e field');
    }

    const found = await db.collection(collection).findOne({ [field]: value });
    if (!found) {
      violations.push({
        code: 'REFERENCE_NOT_FOUND',
        field: label || field,
        message: `Referência inexistente: ${label || field}="${value}" não encontrado em ${collection}`,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = {
  collectAliasViolations,
  validateIngestionPayload,
  assertReferencesExist,
};
