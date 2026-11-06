/**
 * RNF022 AC1 (#1462): "Cada classe possui finalidade, sensibilidade, política,
 * prazo e responsável." The canonical model v2.0.0 has no data-class entity,
 * so the classes are the retention families of retentionPolicy.service.js,
 * the data classes RF026 AC1 binds to a versioned policy. Each record names
 * its purpose and owner role here; its entity types come from the family
 * table, its sensitivity from the catalog's Sensitivity column (the highest
 * among the class's catalog elements), and its policy and period from the
 * family's active RetentionPolicy, resolved per request by the controller.
 * See docs/decisions/2026-11-06-data-class-registry.md.
 */
const { loadCanonicalDictionary } = require('../reference-data/canonical-dictionary/v2');
const { ENTITY_TYPE_FAMILIES } = require('../services/retentionPolicy.service');

// The catalog's Sensitivity values, lowest first. A value may carry a note
// after ';' ("Low/metadata; PII prohibited"), which is dropped.
const SENSITIVITY_ORDER = ['Low/metadata', 'Baixa', 'Moderada', 'Alta', 'Crítica', 'Restricted'];

// purpose: the title of the requirement that governs the class's records.
// ownerRole: a roleName of the RBAC seed.
const DATA_CLASSES = [
  { code: 'auditTrail', purpose: 'Auditoria e integridade criptográfica (RF012)', ownerRole: 'Administrador' },
  { code: 'specimen', purpose: 'Rastreabilidade, quantidade e cadeia de custódia (RF006)', ownerRole: 'Coordenador' },
  { code: 'dataFile', purpose: 'Arquivos científicos e dados brutos (RF007)', ownerRole: 'Coordenador' },
];

function sensitivityOf(entityTypes, elements = loadCanonicalDictionary()) {
  let highest = -1;
  for (const element of elements) {
    if (!entityTypes.includes(element.entity)) continue;
    const rank = SENSITIVITY_ORDER.indexOf(String(element.sensitivity).split(';')[0].trim());
    if (rank < 0) throw new Error(`sensibilidade desconhecida no catálogo: ${element.sensitivity}`);
    if (rank > highest) highest = rank;
  }
  return highest < 0 ? null : SENSITIVITY_ORDER[highest];
}

function listDataClasses() {
  const elements = loadCanonicalDictionary();
  return DATA_CLASSES.map((dataClass) => {
    const entityTypes = [...ENTITY_TYPE_FAMILIES[dataClass.code]];
    return { ...dataClass, entityTypes, sensitivity: sensitivityOf(entityTypes, elements) };
  });
}

module.exports = { DATA_CLASSES, SENSITIVITY_ORDER, sensitivityOf, listDataClasses };
