const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DICTIONARY_VERSION = '2.0.0';
const EXPECTED_TOTAL_ELEMENTS = 1644;
const EXPECTED_HISTORICAL_ELEMENTS = 929;
const EXPECTED_NEW_ELEMENTS = 715;
const EXPECTED_ENTITY_TOTAL = 146;
const SOURCE_FILENAME = 'BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx';
const SOURCE_SHEET = 'DICIONARIO_V2';

const SOURCE_HEADERS = [
  'Element ID',
  'Domain',
  'Entity',
  'Canonical field',
  'Display name PT',
  'Definition',
  'Data type',
  'Cardinality',
  'Requirement',
  'Applicability condition',
  'Vocabulary or enum',
  'Synthetic example',
  'Sensitivity',
  'Criticality',
  'Documentary or normative origin',
  'FHIR/MIABIS mapping',
  'Authoritative persistence',
  'Permitted projection',
  'Uniqueness rule',
  'Preparation phase',
  'Population phase',
  'Change status',
  'Related previous element',
  'Justification',
  'Migration notes',
];

const SOURCE_TO_RUNTIME = {
  'Element ID': 'elementId',
  Domain: 'domain',
  Entity: 'entity',
  'Canonical field': 'canonicalField',
  'Display name PT': 'displayNamePt',
  Definition: 'definition',
  'Data type': 'dataType',
  Cardinality: 'cardinality',
  Requirement: 'requirement',
  'Applicability condition': 'applicabilityCondition',
  'Vocabulary or enum': 'vocabularyOrEnum',
  'Synthetic example': 'syntheticExample',
  Sensitivity: 'sensitivity',
  Criticality: 'criticality',
  'Documentary or normative origin': 'documentaryOrNormativeOrigin',
  'FHIR/MIABIS mapping': 'interoperabilityMapping',
  'Authoritative persistence': 'authoritativePersistence',
  'Permitted projection': 'permittedProjection',
  'Uniqueness rule': 'uniquenessRule',
  'Preparation phase': 'preparationPhase',
  'Population phase': 'populationPhase',
  'Change status': 'changeStatus',
  'Related previous element': 'relatedPreviousElement',
  Justification: 'justification',
  'Migration notes': 'migrationNotes',
};

const REQUIRED_RUNTIME_FIELDS = [
  'elementId',
  'entity',
  'canonicalField',
  'dataType',
  'cardinality',
  'requirement',
  'authoritativePersistence',
  'preparationPhase',
  'populationPhase',
  'changeStatus',
];

let catalogPromise = null;
let sourcePathCache = null;

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

function resolveDictionaryPath() {
  if (sourcePathCache) return sourcePathCache;

  const candidates = [
    process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH,
    path.resolve(process.cwd(), 'canonical', SOURCE_FILENAME),
    path.resolve(process.cwd(), 'docs', SOURCE_FILENAME),
    path.resolve(process.cwd(), '../../docs', SOURCE_FILENAME),
    path.resolve(__dirname, '../../../../../docs', SOURCE_FILENAME),
  ].filter(Boolean);

  sourcePathCache = candidates.find((candidate) => fs.existsSync(candidate)) || null;
  if (!sourcePathCache) {
    throw new Error(
      `Canonical dictionary v${DICTIONARY_VERSION} not found. Checked: ${candidates.join(', ')}`,
    );
  }
  return sourcePathCache;
}

function assertHeaders(worksheet) {
  const observed = SOURCE_HEADERS.map((_, index) => normalizeCellValue(worksheet.getRow(1).getCell(index + 1).value));
  const mismatches = SOURCE_HEADERS
    .map((expected, index) => ({ expected, observed: observed[index], index }))
    .filter(({ expected, observed: actual }) => expected !== actual);

  if (mismatches.length > 0) {
    throw new Error(`DICIONARIO_V2 header drift: ${JSON.stringify(mismatches)}`);
  }
}

async function parseApprovedDictionary() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolveDictionaryPath());
  const worksheet = workbook.getWorksheet(SOURCE_SHEET);
  if (!worksheet) throw new Error(`Worksheet ${SOURCE_SHEET} not found in ${SOURCE_FILENAME}`);

  assertHeaders(worksheet);

  const result = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const elementId = normalizeCellValue(row.getCell(1).value);
    if (!elementId) continue;

    const element = {};
    SOURCE_HEADERS.forEach((header, index) => {
      element[SOURCE_TO_RUNTIME[header]] = normalizeCellValue(row.getCell(index + 1).value);
    });
    result.push(Object.freeze(element));
  }

  return Object.freeze(result);
}

async function loadCanonicalDictionary() {
  if (!catalogPromise) catalogPromise = parseApprovedDictionary();
  const catalog = await catalogPromise;
  return catalog.map((element) => ({ ...element }));
}

async function getElementById(elementId) {
  const catalog = await loadCanonicalDictionary();
  return catalog.find((element) => element.elementId === elementId) || null;
}

async function listByEntity(entity) {
  const catalog = await loadCanonicalDictionary();
  return catalog.filter((element) => element.entity === entity);
}

async function listByPersistenceAuthority(authority) {
  const catalog = await loadCanonicalDictionary();
  return catalog.filter((element) => element.authoritativePersistence === authority);
}

async function dictionaryChecksum() {
  const catalog = await loadCanonicalDictionary();
  return crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
}

async function checkCompleteness() {
  const catalog = await loadCanonicalDictionary();
  const ids = catalog.map((element) => element.elementId);
  const uniqueIds = new Set(ids);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingRequiredFieldIds = catalog
    .filter((element) => REQUIRED_RUNTIME_FIELDS.some((field) => element[field] === null || element[field] === undefined || element[field] === ''))
    .map((element) => element.elementId);
  const historicalTotal = ids.filter((id) => /^ELM-|^P1X-/.test(id)).length;
  const newTotal = ids.filter((id) => /^V2E-/.test(id)).length;
  const entityTotal = new Set(catalog.map((element) => element.entity)).size;
  const nonPhaseOneIds = catalog.filter((element) => element.preparationPhase !== 'Phase 1').map((element) => element.elementId);

  return {
    dictionaryVersion: DICTIONARY_VERSION,
    sourcePath: resolveDictionaryPath(),
    sourceSheet: SOURCE_SHEET,
    expectedTotal: EXPECTED_TOTAL_ELEMENTS,
    loadedTotal: catalog.length,
    uniqueTotal: uniqueIds.size,
    expectedHistoricalTotal: EXPECTED_HISTORICAL_ELEMENTS,
    historicalTotal,
    expectedNewTotal: EXPECTED_NEW_ELEMENTS,
    newTotal,
    expectedEntityTotal: EXPECTED_ENTITY_TOTAL,
    entityTotal,
    duplicateIds,
    missingRequiredFieldIds,
    nonPhaseOneIds,
    verified: catalog.length === EXPECTED_TOTAL_ELEMENTS
      && uniqueIds.size === EXPECTED_TOTAL_ELEMENTS
      && historicalTotal === EXPECTED_HISTORICAL_ELEMENTS
      && newTotal === EXPECTED_NEW_ELEMENTS
      && entityTotal === EXPECTED_ENTITY_TOTAL
      && duplicateIds.length === 0
      && missingRequiredFieldIds.length === 0
      && nonPhaseOneIds.length === 0,
  };
}

function resetCacheForTests() {
  catalogPromise = null;
  sourcePathCache = null;
}

module.exports = {
  DICTIONARY_VERSION,
  EXPECTED_TOTAL_ELEMENTS,
  EXPECTED_HISTORICAL_ELEMENTS,
  EXPECTED_NEW_ELEMENTS,
  EXPECTED_ENTITY_TOTAL,
  SOURCE_FILENAME,
  SOURCE_SHEET,
  SOURCE_HEADERS,
  loadCanonicalDictionary,
  getElementById,
  listByEntity,
  listByPersistenceAuthority,
  dictionaryChecksum,
  checkCompleteness,
  resolveDictionaryPath,
  resetCacheForTests,
};
