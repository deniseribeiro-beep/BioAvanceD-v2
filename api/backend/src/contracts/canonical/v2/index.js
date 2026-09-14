const ExcelJS = require('exceljs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const canonicalDictionary = require('../../../reference-data/canonical-dictionary');

const CONTRACT_VERSION = '2.0.0';
const ENUM_SHEET = 'ENUMS';
const CONDITIONAL_RULE_SHEET = 'REGRAS_CONDICIONAIS';
const RELATIONSHIP_SHEET = 'RELACIONAMENTOS';

let registryPromise = null;

function normalizeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return normalizeCellValue(value.result);
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return String(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  }
  return value;
}

function worksheetObjects(worksheet) {
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = normalizeCellValue(cell.value);
  });

  const result = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!normalizeCellValue(row.getCell(1).value)) continue;
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = normalizeCellValue(row.getCell(index + 1).value);
    });
    result.push(record);
  }
  return result;
}

function cardinalityBounds(cardinality) {
  const match = String(cardinality || '').match(/^(\d+)\.\.(\d+|\*)$/);
  if (!match) return { min: 0, max: null };
  return { min: Number(match[1]), max: match[2] === '*' ? null : Number(match[2]) };
}

function isArrayElement(element) {
  const { max } = cardinalityBounds(element.cardinality);
  const dataType = String(element.dataType || '');
  return max === null || max > 1 || /\[\]$/.test(dataType) || /^array</i.test(dataType);
}

function primitiveSchema(dataType) {
  const raw = String(dataType || '').trim();
  const normalized = raw.replace(/\[\]$/, '').replace(/^array<(.+)>$/i, '$1').trim();
  const lower = normalized.toLowerCase();

  if (lower === 'boolean') return { type: 'boolean' };
  if (lower === 'integer' || lower === 'integer64' || lower === 'integer code' || lower === 'integer duration') return { type: 'integer' };
  if (lower === 'integer >=0') return { type: 'integer', minimum: 0 };
  if (lower === 'decimal') return { type: 'number' };
  if (lower === 'string/email') return { type: 'string', format: 'email' };
  if (lower === 'uri') return { type: 'string', format: 'uri-reference' };
  if (lower === 'uuid') return { type: 'string', format: 'uuid' };
  if (['string', 'code', 'markdown', 'datetime', 'date', 'expression', 'hash', 'secret/hash', 'secret/encrypted', 'encrypted string', 'string pseudonym', 'string/i18n', 'string/ip', 'string/e.164', 'derived code', 'constant'].includes(lower)) {
    return { type: 'string' };
  }
  if (lower.startsWith('reference')) return { anyOf: [{ type: 'string', minLength: 1 }, { type: 'object' }] };
  if (lower.includes('/')) {
    const parts = lower.split('/').map((part) => primitiveSchema(part));
    return { anyOf: parts };
  }
  if (['object', 'backboneelement', 'codeableconcept', 'coding', 'identifier', 'period', 'quantity', 'contactinformation', 'timing', 'duration', 'choice', 'disease', 'artifactreference', 'governanceinvariant'].includes(lower)) {
    return { type: 'object' };
  }
  return {};
}

function schemaForElement(element, enumValues) {
  const scalar = primitiveSchema(element.dataType);
  const values = enumValues.get(`${element.entity}.${element.canonicalField}`) || [];
  if (values.length && scalar.type === 'string') scalar.enum = values;

  const schema = isArrayElement(element)
    ? (() => {
        const { min, max } = cardinalityBounds(element.cardinality);
        const arraySchema = { type: 'array', items: scalar };
        if (min > 0) arraySchema.minItems = min;
        if (max !== null) arraySchema.maxItems = max;
        return arraySchema;
      })()
    : scalar;

  // Deprecated dictionary elements remain represented so historical reads
  // and migration tooling can understand them, but they are not part of the
  // active write contract. This is especially important for
  // TelemetryExposureSummary.storageAssignmentId: the approved dictionary
  // explicitly says it was replaced by the normalized temporal assignment
  // chain and that new writes must be rejected after migration.
  if (/^deprecated$/i.test(String(element.changeStatus || '').trim())) {
    schema.deprecated = true;
    schema.readOnly = true;
  }

  return schema;
}

function shouldRequire(element) {
  // A deprecated element may have historical cardinality 1..1, but that does
  // not make it mandatory for new v2 writes. Keeping it in `required` would
  // force the runtime to recreate exactly the legacy shortcut the migration
  // notes say must no longer be written (#967).
  if (/^deprecated$/i.test(String(element.changeStatus || '').trim())) return false;

  const { min } = cardinalityBounds(element.cardinality);
  if (min < 1) return false;
  return !/^conditional$/i.test(String(element.requirement || '').trim());
}

async function buildRegistry() {
  const [elements, completeness] = await Promise.all([
    canonicalDictionary.loadCanonicalDictionary(),
    canonicalDictionary.checkCompleteness(),
  ]);
  if (!completeness.verified) throw new Error('Canonical v2 dictionary completeness gate failed; contracts cannot be built.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(canonicalDictionary.resolveDictionaryPath());
  const enumWorksheet = workbook.getWorksheet(ENUM_SHEET);
  const ruleWorksheet = workbook.getWorksheet(CONDITIONAL_RULE_SHEET);
  const relationshipWorksheet = workbook.getWorksheet(RELATIONSHIP_SHEET);
  if (!enumWorksheet || !ruleWorksheet || !relationshipWorksheet) {
    throw new Error('Approved v2 workbook is missing ENUMS, REGRAS_CONDICIONAIS or RELACIONAMENTOS.');
  }

  const enumRows = worksheetObjects(enumWorksheet);
  const conditionalRules = worksheetObjects(ruleWorksheet);
  const relationships = worksheetObjects(relationshipWorksheet);
  const enumValues = new Map();
  for (const row of enumRows) {
    if (String(row.Status || '').toLowerCase() !== 'active') continue;
    const key = `${row.Entity}.${row.Field}`;
    if (!enumValues.has(key)) enumValues.set(key, []);
    enumValues.get(key).push(row.Value);
  }

  const byEntity = new Map();
  for (const element of elements) {
    if (!byEntity.has(element.entity)) byEntity.set(element.entity, []);
    byEntity.get(element.entity).push(element);
  }

  const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });
  addFormats(ajv);
  const schemas = new Map();

  for (const [entity, entityElements] of byEntity.entries()) {
    const properties = {};
    const required = [];
    for (const element of entityElements) {
      properties[element.canonicalField] = schemaForElement(element, enumValues);
      if (shouldRequire(element)) required.push(element.canonicalField);
    }

    const schema = {
      $id: `canonical.v2.${entity}`,
      type: 'object',
      additionalProperties: false,
      properties,
      ...(required.length ? { required: [...new Set(required)] } : {}),
    };
    ajv.addSchema(schema);
    schemas.set(entity, schema);
  }

  return Object.freeze({
    version: CONTRACT_VERSION,
    ajv,
    schemas,
    elements,
    enumRows,
    conditionalRules,
    relationships,
    completeness,
  });
}

async function getRegistry() {
  if (!registryPromise) registryPromise = buildRegistry();
  return registryPromise;
}

async function validateEntity(entity, payload) {
  const registry = await getRegistry();
  const schemaId = `canonical.v2.${entity}`;
  const validator = registry.ajv.getSchema(schemaId);
  if (!validator) throw new Error(`Canonical v2 entity not registered: ${entity}`);
  const valid = validator(payload);
  return { valid, errors: validator.errors || [], schemaId };
}

async function getSchema(entity) {
  const registry = await getRegistry();
  return registry.schemas.get(entity) || null;
}

async function listConditionalRules(entityOrDomain = null) {
  const registry = await getRegistry();
  if (!entityOrDomain) return registry.conditionalRules.map((row) => ({ ...row }));
  return registry.conditionalRules
    .filter((row) => row['Entity/domain'] === entityOrDomain)
    .map((row) => ({ ...row }));
}

async function listRelationships(sourceEntity = null) {
  const registry = await getRegistry();
  if (!sourceEntity) return registry.relationships.map((row) => ({ ...row }));
  return registry.relationships
    .filter((row) => row['Source entity'] === sourceEntity)
    .map((row) => ({ ...row }));
}

function resetCacheForTests() {
  registryPromise = null;
}

module.exports = {
  CONTRACT_VERSION,
  getRegistry,
  getSchema,
  validateEntity,
  listConditionalRules,
  listRelationships,
  cardinalityBounds,
  isArrayElement,
  primitiveSchema,
  resetCacheForTests,
};
