#!/usr/bin/env node
// Build-time reconciliation; the approved workbook remains the source of truth.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { ENTITY_LOCATIONS } = require('../src/config/canonicalEntityCollections.v2');

const workbookPath = path.resolve(__dirname, '../../../docs/BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx');
const outputPath = path.resolve(__dirname, '../src/foundation/canonical-index-manifest.v2.json');

const VERSION_SCOPES = Object.freeze({
  CanonicalModelRelease: ['semanticVersion'],
  GovernanceInvariantCatalog: ['canonicalModelReleaseId', 'semanticVersion'],
  ConfigurationRelease: ['profileId', 'semanticVersion'],
  IdentificationPolicy: ['configurationReleaseId', 'semanticVersion'],
  UnifiedIdentifierResolverContract: ['semanticVersion'],
  SPRECMappingRelease: ['sprecVersion', 'mappingVersion'],
  InteroperabilityMappingRelease: ['standard', 'profile', 'mappingVersion'],
  FeatureDefinition: ['featureName', 'semanticVersion'],
  RCSRulePackage: ['sprecMappingReleaseId', 'semanticVersion'],
  ConsentTemplate: ['versionGroupId', 'semanticVersion'],
  ModelArtifact: ['semanticVersion'],
});

function makeConstraint(entity, fields, evidence, deferred = false) {
  const location = ENTITY_LOCATIONS[entity];
  if (!location || location.storageMode !== 'COLLECTION') throw new Error(`No collection mapping for ${entity}`);
  return {
    constraintId: `canonical-index:${entity}:${fields.join('+')}`,
    entity,
    canonicalFields: fields,
    collection: location.collection,
    physicalKeys: Object.fromEntries(fields.map((field) => [field, 1])),
    indexType: fields.length === 1 ? 'SINGLE_UNIQUE' : 'COMPOUND_UNIQUE',
    options: { unique: true },
    canonicalEvidence: evidence,
    applyNow: !deferred,
    requiredForReadiness: !deferred,
    ...(deferred ? { deferredReason: 'conditional future project' } : {}),
    currentState: 'TO_DISCOVER',
  };
}

async function build() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const dictionary = workbook.getWorksheet('DICIONARIO');
  const headings = dictionary.getRow(1).values;
  const column = (name) => headings.indexOf(name);
  const fields = new Map();
  dictionary.eachRow((row, number) => {
    if (number === 1) return;
    const entity = String(row.getCell(column('Entity')).value);
    const field = String(row.getCell(column('Canonical field')).value);
    fields.set(`${entity}.${field}`, {
      elementId: String(row.getCell(column('Element ID')).value),
      rule: String(row.getCell(column('Uniqueness rule')).value || ''),
      persistence: String(row.getCell(column('Authoritative persistence')).value || ''),
    });
  });

  const constraints = [];
  for (const [entity, location] of Object.entries(ENTITY_LOCATIONS)) {
    const id = fields.get(`${entity}.${location.primaryIdentifier}`);
    if (id?.rule !== 'Globally unique' || !id.persistence.includes('MongoDB')) continue;
    // An invariant is a value embedded in versioned catalogues. A MongoDB
    // unique multikey index would not enforce uniqueness inside one catalogue.
    if (entity === 'GovernanceInvariant') continue;
    const deferred = location.populationPhase.includes('conditional future project');
    constraints.push(makeConstraint(entity, [location.primaryIdentifier], [id.elementId], deferred));
  }

  // Approved v2 account identity decision: MongoDB _id is physical only.
  // The workbook defines the UUID field; the human decision requires a
  // materialized UNIQUE(userAccountId) before account APIs are ready.
  const accountId = fields.get('UserAccount.userAccountId');
  if (accountId?.persistence !== 'MongoDB') throw new Error('UserAccount authority changed');
  constraints.push(makeConstraint('UserAccount', ['userAccountId'],
    [accountId.elementId, 'STAGE-2E-USERACCOUNT-IDENTITY-DECISION']));

  for (const [entity, scope] of Object.entries(VERSION_SCOPES)) {
    for (const field of scope) {
      if (!fields.has(`${entity}.${field}`)) throw new Error(`Undocumented scope field ${entity}.${field}`);
    }
    const versionField = entity === 'SPRECMappingRelease' || entity === 'InteroperabilityMappingRelease'
      ? 'mappingVersion' : 'semanticVersion';
    const version = fields.get(`${entity}.${versionField}`);
    if (version.rule !== 'Unique per semantic version and scope') throw new Error(`Unexpected version rule for ${entity}`);
    constraints.push(makeConstraint(entity, scope, [version.elementId], entity === 'ModelArtifact'));
  }

  const position = fields.get('StoragePosition.positionCode');
  if (position.rule !== 'Unique per rack for positionCode') throw new Error('StoragePosition scope changed');
  constraints.push(makeConstraint('StoragePosition', ['storageRackId', 'positionCode'], [position.elementId]));
  constraints.sort((a, b) => a.constraintId.localeCompare(b.constraintId));

  const active = constraints.filter((constraint) => constraint.applyNow);
  const deferred = constraints.filter((constraint) => !constraint.applyNow);
  if (constraints.length !== 80 || active.length !== 74 || deferred.length !== 6
    || new Set(constraints.map((constraint) => constraint.constraintId)).size !== constraints.length) {
    throw new Error(`Manifest reconciliation changed: total=${constraints.length}, active=${active.length}, deferred=${deferred.length}`);
  }
  return `${JSON.stringify({
    canonicalRelease: '2.0.0',
    canonicalSource: 'docs/BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx',
    constraints,
    nonIndexInvariants: [{ entity: 'GovernanceInvariant', field: 'invariantId', evidence: ['V2E-0026'], reason: 'Embedded in versioned GovernanceInvariantCatalog; unique multikey index does not enforce intra-document uniqueness.' }],
    excluded: ['LabelTemplate.semanticVersion', 'LabelDefinition.semanticVersion', 'RCSGovernanceEvidenceSnapshot.terminologyValid', 'TelemetryExposureSummary.storageAssignmentId'],
  }, null, 2)}\n`;
}

build().then((contents) => {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(outputPath, contents);
    return;
  }
  if (fs.readFileSync(outputPath, 'utf8') !== contents) throw new Error('Foundation index manifest differs from the approved workbook.');
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
