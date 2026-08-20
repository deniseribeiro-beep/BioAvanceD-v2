/**
 * RF029 AC 1/2 ("Validar todo payload contra os contratos canônicos... /
 * Rejeitar aliases, campos desconhecidos, referências inexistentes e
 * cardinalidades inválidas", #669): a reusable gateway-level validator entity
 * slices (#670-673) call, instead of each reimplementing
 * routes/intakeWizard.js's own local `collectCanonicalViolations` alias
 * check. intakeWizard.js itself is left untouched — its inline copy predates
 * this module and isn't in this slice's scope to migrate.
 *
 * "Unknown fields" and "cardinalidades inválidas" are enforced by
 * contracts/canonical/v1's Ajv schemas whenever they're declared
 * `additionalProperties: false` with correct `type`/`minItems`/`maxItems` —
 * validateIngestionPayload folds that Ajv pass in alongside the alias check
 * rather than reimplementing it. "Referências inexistentes" is handled
 * separately by assertReferencesExist, since it needs a `db` handle and is
 * specific to which foreign-key-shaped fields a given entity actually has.
 */
const { validate: validateContract } = require('../contracts/canonical/v1');

function collectAliasViolations(payload, aliasMap = {}) {
  const hits = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return hits;

  for (const aliases of Object.values(aliasMap)) {
    const aliasList = Array.isArray(aliases) ? aliases : [];
    for (const alias of aliasList) {
      if (Object.prototype.hasOwnProperty.call(payload, alias)) {
        hits.push(alias);
      }
    }
  }

  return [...new Set(hits)];
}

function extractAjvField(issue) {
  const path = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.');
  return path || issue.params?.missingProperty || issue.params?.additionalProperty || null;
}

/**
 * Combines alias rejection (AC 2) with the existing Ajv canonical-contract
 * pass (AC 1) into one violation list. `schemaId` is optional — a slice with
 * no registered contracts/canonical/v1 schema yet can still get alias
 * rejection alone.
 */
function validateIngestionPayload({ schemaId = null, payload, aliasMap = {} }) {
  const violations = [];

  for (const alias of collectAliasViolations(payload, aliasMap)) {
    violations.push({
      code: 'NON_CANONICAL_FIELD',
      field: alias,
      message: `Campo não canônico (use o nome canônico, não o alias): ${alias}`,
    });
  }

  if (schemaId) {
    const result = validateContract(schemaId, payload);
    if (!result.valid) {
      for (const issue of result.errors || []) {
        violations.push({
          code: 'CONTRACT_VIOLATION',
          field: extractAjvField(issue),
          message: issue.message || 'Violação de contrato canônico',
          ajvKeyword: issue.keyword || null,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * AC 2's "referências inexistentes": generic FK-style existence check. Each
 * entry only produces a violation when `value` is present but doesn't
 * resolve — an absent/empty value is a presence concern for the contract
 * schema's own `required`, not this function's job.
 */
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
