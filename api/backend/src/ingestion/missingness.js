/**
 * RF029 AC7, RNF011 C4/C5 (#1318): missingness on the production ingestion
 * path. An absent field of an accepted record gets a MissingDataReason row
 * (V2E-0280..0286) naming why it is absent, and an absence is never written
 * as 0: 0 is a value, never an absence.
 *
 * INFERENCE, not a citation: the client declares a reason as a top-level
 * body field `missingDataReasons: [{ fieldPath, reasonCode }]` beside
 * `payload`, because the canonical contracts are `additionalProperties:
 * false` and would reject it inside the payload (read off
 * contracts/canonical/v1/index.js datasetSchema/workflowSchema).
 *
 * INFERENCE, not a citation: an absent field with no declaration is recorded
 * with reasonCode `unknown`, the vocabulary column of V2E-0284 and the only
 * code that claims nothing.
 *
 * INFERENCE, not a citation: a field in the schema's `required` is not a
 * missingness field, so its absence stays a quarantine (RNF011 C6, no silent
 * correction). Missingness applies to the fields the model stores as null or
 * [] when absent: ingestionTargets.js's `missingnessFields`.
 */
const { randomUUID } = require('crypto');

// RNF011 C4, in its order.
const MISSING_DATA_REASON_CODES = Object.freeze(['unknown', 'not_collected', 'not_applicable', 'withheld', 'error']);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** True only for undefined, null, '' and an empty array: 0, false and {} are values. */
function isAbsent(value) {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isWellFormed(entry) {
  if (!isPlainObject(entry)) return false;
  const keys = Object.keys(entry);
  return keys.length === 2
    && hasOwn(entry, 'fieldPath') && hasOwn(entry, 'reasonCode')
    && typeof entry.fieldPath === 'string' && typeof entry.reasonCode === 'string';
}

/** Gateway-shaped violations ({ code, field, message }) for a declaration; [] when it is valid. */
function validateMissingDataReasons(target, payload, declared) {
  const entries = declared === undefined || declared === null ? [] : declared;
  if (!Array.isArray(entries)) {
    return [{ code: 'MISSING_REASON_INVALID', field: 'missingDataReasons', message: 'missingDataReasons deve ser um array' }];
  }
  const data = payload && typeof payload === 'object' ? payload : {};
  const violations = [];
  const seen = new Set();
  entries.forEach((entry, index) => {
    const field = `missingDataReasons[${index}]`;
    if (!isWellFormed(entry)) {
      violations.push({ code: 'MISSING_REASON_INVALID', field, message: `${field} deve ter exatamente fieldPath e reasonCode, ambos texto` });
      return;
    }
    const { fieldPath, reasonCode } = entry;
    if (!target.missingnessFields.includes(fieldPath)) {
      violations.push({ code: 'MISSING_REASON_FIELD_NOT_APPLICABLE', field, message: `${fieldPath} não aceita MissingDataReason` });
    }
    if (!MISSING_DATA_REASON_CODES.includes(reasonCode)) {
      violations.push({ code: 'MISSING_REASON_CODE_INVALID', field, message: `reasonCode inválido: ${reasonCode}` });
    }
    if (seen.has(fieldPath)) {
      violations.push({ code: 'MISSING_REASON_DUPLICATE', field, message: `${fieldPath} declarado mais de uma vez` });
    }
    seen.add(fieldPath);
    if (target.missingnessFields.includes(fieldPath) && !isAbsent(hasOwn(data, fieldPath) ? data[fieldPath] : undefined)) {
      violations.push({ code: 'MISSING_REASON_FIELD_PRESENT', field, message: `${fieldPath} tem valor e não pode ter MissingDataReason` });
    }
  });
  return violations;
}

/**
 * One MissingDataReason row per missingness field absent on the created
 * document, in the target's field order. Called only after validation
 * passed, so every declared field is absent.
 */
function buildMissingDataReasons({ target, entityType, entityId, doc, declared, releases, recordedAt }) {
  const reasons = new Map((declared || []).map(({ fieldPath, reasonCode }) => [fieldPath, reasonCode]));
  return target.missingnessFields
    .filter((fieldPath) => isAbsent(doc[fieldPath]))
    .map((fieldPath) => ({
      missingDataReasonId: randomUUID(),
      entityType,
      entityId,
      fieldPath,
      reasonCode: reasons.get(fieldPath) || 'unknown',
      recordedAt,
      canonicalModelReleaseId: releases.canonicalModelReleaseId,
      configurationReleaseId: releases.configurationReleaseId,
    }));
}

module.exports = {
  MISSING_DATA_REASON_CODES,
  isAbsent,
  validateMissingDataReasons,
  buildMissingDataReasons,
};
