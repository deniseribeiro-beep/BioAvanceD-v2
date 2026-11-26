const crypto = require('crypto');

// RNF008 AC3 (#1496): ResearchResourceCollection (P1X-0142..0146) and
// ResearchResourceBiobank (P1X-0147..0151) share one shape, a link from a
// ResearchResource to one target with an optional role and effectivePeriod
// (a Period, stored as { start, end } as AccessPolicy stores its own). A link
// counts only while in force, over the half-open interval [start, end).

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;
const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());

function associationFieldsOf(data = {}, targetField) {
  return {
    associationId: data.associationId || crypto.randomUUID(),
    researchResourceId: data.researchResourceId ?? null,
    [targetField]: data[targetField] ?? null,
    associationRole: data.associationRole ?? null,
    effectivePeriod: data.effectivePeriod ?? null,
  };
}

function validateAssociation(data = {}, targetField, entity) {
  const errors = [];
  for (const field of ['researchResourceId', targetField]) {
    if (!isNonEmptyString(data[field])) errors.push(`${field} é obrigatório para ${entity} (1..1)`);
  }
  if (isPresent(data.associationRole) && !isNonEmptyString(data.associationRole)) {
    errors.push('associationRole deve ser um código não vazio');
  }
  const period = data.effectivePeriod;
  if (isPresent(period)) {
    if (typeof period !== 'object' || Array.isArray(period)) {
      errors.push('effectivePeriod deve ser um período { start, end }');
    } else {
      const startValid = !isPresent(period.start) || isValidDate(period.start);
      const endValid = !isPresent(period.end) || isValidDate(period.end);
      if (!startValid) errors.push('effectivePeriod.start deve ser uma data válida');
      if (!endValid) errors.push('effectivePeriod.end deve ser uma data válida');
      if (startValid && endValid && isPresent(period.start) && isPresent(period.end)
        && new Date(period.end) <= new Date(period.start)) {
        errors.push('effectivePeriod.end deve ser posterior a effectivePeriod.start ([início, fim))');
      }
    }
  }
  return { isValid: errors.length === 0, errors };
}

function associationInForce(association, now = new Date()) {
  const period = association && association.effectivePeriod;
  if (!period) return true;
  if (isPresent(period.start) && new Date(period.start) > now) return false;
  if (isPresent(period.end) && new Date(period.end) <= now) return false;
  return true;
}

module.exports = { associationFieldsOf, validateAssociation, associationInForce };
