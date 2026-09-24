#!/usr/bin/env node
// Build-time derivation from the approved v2 workbook. Runtime never pluralizes.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const workbookPath = path.resolve(__dirname, '../../../docs/BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx');
const outputPath = path.resolve(__dirname, '../src/config/canonicalEntityCollections.v2.js');

function collectionName(entity) {
  if (entity === 'SpecimenPreanalytics') return 'specimenPreanalytics';
  const initialism = entity.match(/^[A-Z]+(?=[A-Z][a-z]|$)/);
  const prefixLength = initialism ? initialism[0].length : 1;
  const stem = entity.slice(0, prefixLength).toLowerCase() + entity.slice(prefixLength);
  if (/[^aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
  if (/(?:ss|ch|sh|x)$/i.test(stem)) return `${stem}es`;
  return `${stem}s`;
}

async function build() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet('ENTIDADES');
  const dictionary = workbook.getWorksheet('DICIONARIO');
  const fieldTypes = new Map();
  dictionary.eachRow((row, number) => {
    if (number > 1) fieldTypes.set(`${row.getCell(3).value}.${row.getCell(4).value}`, String(row.getCell(7).value || ''));
  });
  const headings = sheet.getRow(1).values;
  const column = (name) => headings.indexOf(name);
  const entries = [];
  sheet.eachRow((row, number) => {
    if (number === 1 || !String(row.getCell(column('Authoritative persistence')).value || '').includes('MongoDB')) return;
    const entity = String(row.getCell(column('Entity')).value);
    const primaryIdentifier = String(row.getCell(column('Primary identifier')).value);
    const status = String(row.getCell(column('Status')).value);
    const populationPhase = String(row.getCell(column('Population phase')).value);
    entries.push({ entity, collection: collectionName(entity), primaryIdentifier,
      primaryType: fieldTypes.get(`${entity}.${primaryIdentifier}`) || 'inherited BaseRecord.recordId', status, populationPhase });
  });
  if (entries.length !== 140 || new Set(entries.map((entry) => entry.entity)).size !== 140) {
    throw new Error(`Expected 140 distinct MongoDB entities, found ${entries.length}`);
  }
  const body = entries.map(({ entity, collection, primaryIdentifier, primaryType, status, populationPhase }) => {
    const base = { collection, storageMode: 'COLLECTION', primaryIdentifier, primaryType, status, populationPhase };
    if (entity === 'BaseRecord') return `  ${entity}: ${JSON.stringify({ storageMode: 'SHARED', ownerEntities: 'ALL_CONCRETE_ENTITIES', fieldPrefix: '', primaryIdentifier, primaryType, status, populationPhase })},`;
    if (entity === 'ContactInformation') return `  ${entity}: ${JSON.stringify({ storageMode: 'EMBEDDED', ownerEntities: ['Network', 'ResearchResource', 'Biobank', 'Collection'], fieldPrefix: 'contactInformation', primaryIdentifier, primaryType, status, populationPhase })},`;
    if (entity === 'GovernanceInvariant') return `  ${entity}: ${JSON.stringify({ storageMode: 'EMBEDDED', ownerEntity: 'GovernanceInvariantCatalog', fieldPrefix: 'invariants', primaryIdentifier, primaryType, status, populationPhase })},`;
    if (entity === 'StorageAssignment') return `  ${entity}: ${JSON.stringify({ storageMode: 'RETIRED', replacedBy: ['SpecimenContainerAssignment', 'ContainerPositionAssignment', 'RackLocationAssignment'], primaryIdentifier, primaryType, status, populationPhase })},`;
    return `  ${entity}: ${JSON.stringify(base)},`;
  }).join('\n');
  return `// Derived from docs/BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx.\n// Run scripts/generate-canonical-entity-collections-v2.js --check after workbook changes.\nconst CANONICAL_RELEASE = '2.0.0';\nconst CANONICAL_SOURCE = 'docs/BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx';\nconst ENTITY_LOCATIONS = Object.freeze({\n${body}\n});\n\nfunction getCanonicalLocation(entity) {\n  const location = ENTITY_LOCATIONS[entity];\n  if (!location) throw new Error(\`Unknown canonical MongoDB entity: \${entity}\`);\n  return location;\n}\n\nfunction getCanonicalCollectionName(entity) {\n  const location = getCanonicalLocation(entity);\n  if (location.storageMode !== 'COLLECTION') throw new Error(\`Canonical entity has no dedicated collection: \${entity}\`);\n  return location.collection;\n}\n\nfunction getCanonicalCollection(db, entity) {\n  return db.collection(getCanonicalCollectionName(entity));\n}\n\nmodule.exports = { CANONICAL_RELEASE, CANONICAL_SOURCE, ENTITY_LOCATIONS, getCanonicalLocation, getCanonicalCollectionName, getCanonicalCollection };\n`;
}

build().then((contents) => {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(outputPath, contents);
    return;
  }
  if (fs.readFileSync(outputPath, 'utf8') !== contents) throw new Error('Canonical entity collection registry differs from the approved workbook.');
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
