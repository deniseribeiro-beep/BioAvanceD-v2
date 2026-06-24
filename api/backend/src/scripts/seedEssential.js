const fs = require('fs');
const path = require('path');
const { connectDB, closeConnection } = require('../database/mongo');
const { CANONICAL_COLLECTIONS } = require('../config/collections');

const DATA_DIR = path.resolve(__dirname, '../seeders/data');

const DEFAULT_DISEASE_RULES = {
  miabis: {
    requireTreatmentStatus: true,
  },
  biomarkers: {
    required: [],
    recommended: [],
  },
  pharmacology: {
    required: ['treatment_status'],
    recommended: ['medication_name', 'last_dose_date'],
    treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
  },
};

const ESSENTIAL_DISEASE_RULES = [
  {
    orpha_code: '324',
    name: 'Doenca de Fabry',
    disease_category: 'Erros Inatos do Metabolismo',
    drug_classes: ['enzyme_replacement_therapy', 'pharmacological_chaperone'],
    validation_requirements: {
      ...DEFAULT_DISEASE_RULES,
      biomarkers: {
        required: ['LYSO_GB3', 'ALPHA_GALACTOSIDASE_A'],
        recommended: ['ALBUMINURIA'],
      },
    },
  },
  {
    orpha_code: '79258',
    name: 'Doenca de Gaucher',
    disease_category: 'Erros Inatos do Metabolismo',
    drug_classes: ['enzyme_replacement_therapy', 'substrate_reduction_therapy'],
    validation_requirements: {
      ...DEFAULT_DISEASE_RULES,
      biomarkers: {
        required: ['GLUCOSYLCERAMIDE'],
        recommended: ['CHITOTRIOSIDASE', 'LYSO_GB1'],
      },
    },
  },
  {
    orpha_code: '58',
    name: 'Distrofia Muscular de Duchenne',
    disease_category: 'Doencas Neurologicas',
    drug_classes: ['corticosteroid', 'exon_skipping_therapy'],
    validation_requirements: {
      ...DEFAULT_DISEASE_RULES,
      biomarkers: {
        required: ['CK_TOTAL'],
        recommended: ['DYSTROPHIN_EXPRESSION'],
      },
    },
  },
];

const ESSENTIAL_ATC_BOOTSTRAP = [
  {
    name: 'Agalsidase beta',
    code: 'ATC:A16AB04',
    atc_code: 'A16AB04',
    atc_level_1: 'A',
    atc_classifications: ['A16AB04'],
    synonyms: ['Fabrazyme'],
    drug_class: 'enzyme_replacement_therapy',
    disease_categories: ['Erros Inatos do Metabolismo'],
    source: 'ESSENTIAL_BOOTSTRAP',
  },
  {
    name: 'Agalsidase alfa',
    code: 'ATC:A16AB03',
    atc_code: 'A16AB03',
    atc_level_1: 'A',
    atc_classifications: ['A16AB03'],
    synonyms: ['Replagal'],
    drug_class: 'enzyme_replacement_therapy',
    disease_categories: ['Erros Inatos do Metabolismo'],
    source: 'ESSENTIAL_BOOTSTRAP',
  },
  {
    name: 'Migalastat',
    code: 'ATC:A16AX14',
    atc_code: 'A16AX14',
    atc_level_1: 'A',
    atc_classifications: ['A16AX14'],
    synonyms: ['Galafold'],
    drug_class: 'pharmacological_chaperone',
    disease_categories: ['Erros Inatos do Metabolismo'],
    source: 'ESSENTIAL_BOOTSTRAP',
  },
  {
    name: 'Deflazacorte',
    code: 'ATC:H02AB02',
    atc_code: 'H02AB02',
    atc_level_1: 'H',
    atc_classifications: ['H02AB02'],
    synonyms: ['Deflazacort'],
    drug_class: 'corticosteroid',
    disease_categories: ['Doencas Neurologicas'],
    source: 'ESSENTIAL_BOOTSTRAP',
  },
];

function log(message) {
  console.log(`[SEED:ESSENTIAL] ${message}`);
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8'));
}

function normalizeTerminologyDocument(doc) {
  return {
    codigo: String(doc.codigo || '').trim(),
    sistema: String(doc.sistema || '').trim(),
    descricao: String(doc.descricao || '').trim(),
    label: String(doc.label || doc.descricao || '').trim(),
    sinonimos: Array.isArray(doc.sinonimos) ? doc.sinonimos.filter(Boolean) : [],
    aliases: Array.isArray(doc.aliases) ? doc.aliases.filter(Boolean) : [],
    relacoes: {
      cid: String(doc.relacoes?.cid || '').trim(),
      hpo: String(doc.relacoes?.hpo || '').trim(),
      omim: String(doc.relacoes?.omim || '').trim(),
      orpha: String(doc.relacoes?.orpha || '').trim(),
    },
    ativo: doc.ativo !== false,
    sincronizadoEm: new Date(),
    fonte: String(doc.fonte || 'seed-essential').trim(),
  };
}

function buildSprecTerminologies(sprecData) {
  return (sprecData.axes || []).map((axisEntry) => {
    const axis = String(axisEntry.axis || 'AXIS').trim().toUpperCase();
    const code = String(axisEntry.code || '').trim().toUpperCase();
    const label = String(axisEntry.label || '').trim();
    return normalizeTerminologyDocument({
      codigo: `SPREC:${axis}:${code}`,
      sistema: 'OUTRO',
      descricao: String(axisEntry.descricao || label || `${axis} ${code}`).trim(),
      label,
      aliases: [axis],
      fonte: sprecData.fonte || 'seed-essential-sprec',
    });
  });
}

function buildHpoTerminologies(hpoData) {
  return (hpoData.terms || []).map((term) => normalizeTerminologyDocument({
    codigo: term.codigo,
    sistema: 'HPO',
    descricao: term.descricao || term.label,
    label: term.label || term.descricao,
    sinonimos: term.sinonimos || [],
    aliases: term.aliases || [],
    relacoes: term.relacoes || {},
    fonte: hpoData.fonte || 'seed-essential-hpo',
  }));
}

function buildRcsCatalogDocuments(seed) {
  return (seed.catalog || []).map((item) => ({
    model_code: seed.model_code,
    sprec_version: seed.sprec_version,
    matrix_type: seed.matrix_type,
    axis_code: item.axis_code,
    sprec_code: item.sprec_code,
    description: item.description,
  }));
}

async function upsertCollection(collection, uniqueKeys, docs) {
  const now = new Date();
  const validDocs = (Array.isArray(docs) ? docs : []).filter((doc) =>
    uniqueKeys.every((key) => doc[key] !== undefined && doc[key] !== null && String(doc[key]).trim() !== '')
  );

  if (validDocs.length === 0) return 0;

  await collection.bulkWrite(validDocs.map((doc) => {
    const filter = {};
    uniqueKeys.forEach((key) => {
      filter[key] = doc[key];
    });
    return {
      updateOne: {
        filter,
        update: {
          $set: {
            ...doc,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    };
  }), { ordered: false });

  return validDocs.length;
}

async function ensureIndexes(db) {
  const indexSpecs = {
    [CANONICAL_COLLECTIONS.patients]: [{ patientID: 1 }, { createdAt: 1 }],
    [CANONICAL_COLLECTIONS.samples]: [{ sampleID: 1 }, { patientID: 1 }, { barcode: 1 }, { locationID: 1 }],
    [CANONICAL_COLLECTIONS.consents]: [{ patientId: 1, status: 1 }],
    [CANONICAL_COLLECTIONS.consentTemplates]: [{ active: 1 }, { version: 1 }],
    [CANONICAL_COLLECTIONS.sampleMovements]: [{ sampleID: 1, timestamp: -1 }, { barcode: 1, timestamp: -1 }],
    [CANONICAL_COLLECTIONS.biomarkerObservations]: [{ patientID: 1, biomarkerType: 1, collectedAt: -1 }, { idempotencyKey: 1 }],
    [CANONICAL_COLLECTIONS.cids]: [{ code: 1 }, { codigo: 1 }],
    [CANONICAL_COLLECTIONS.clinicalUnits]: [{ unitID: 1 }, { name: 1 }],
    [CANONICAL_COLLECTIONS.diseaseDictionary]: [{ orpha_code: 1 }, { disease_category: 1 }, { active: 1 }],
    [CANONICAL_COLLECTIONS.medicationDictionary]: [{ atc_code: 1 }, { name: 1 }, { disease_categories: 1 }],
    roles: [{ accessType: 1 }],
    terminologies: [{ sistema: 1, codigo: 1 }],
    sampleTypes: [{ id: 1 }],
    sampleOrigins: [{ id: 1 }],
    extractionProtocols: [{ id: 1 }],
    qualityDescriptions: [{ id: 1 }],
    rcs_model_versions: [{ model_code: 1 }],
    rcs_sprec_catalog: [{ model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1, sprec_code: 1 }],
    rcs_severity_mappings: [{ model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1 }],
    rcs_axis_weights: [{ model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1 }],
    rcs_grade_thresholds: [{ model_code: 1, sprec_version: 1, grade: 1 }],
    rcs_governance_rules: [{ model_code: 1, sprec_version: 1, rule_code: 1 }],
  };

  for (const [collectionName, indexes] of Object.entries(indexSpecs)) {
    const collection = db.collection(collectionName);
    for (const keys of indexes) {
      await collection.createIndex(keys);
    }
  }
}

async function seedTerminologies(db) {
  const docs = [
    ...buildSprecTerminologies(readJson('sprec.min.json')),
    ...buildHpoTerminologies(readJson('hpo.min.json')),
  ];
  return upsertCollection(db.collection('terminologies'), ['sistema', 'codigo'], docs);
}

async function seedMiabis(db) {
  const miabis = readJson('miabis.min.json');
  const counts = [];
  counts.push(await upsertCollection(db.collection('sampleTypes'), ['id'], miabis.sampleTypes || []));
  counts.push(await upsertCollection(db.collection('sampleOrigins'), ['id'], miabis.sampleOrigins || []));
  counts.push(await upsertCollection(db.collection('extractionProtocols'), ['id'], miabis.extractionProtocols || []));
  counts.push(await upsertCollection(db.collection('qualityDescriptions'), ['id'], miabis.qualityDescriptions || []));
  return counts.reduce((sum, value) => sum + value, 0);
}

async function seedRoles(db) {
  const roles = (readJson('roles.min.json').roles || []).map((role) => ({
    accessType: Number(role.accessType),
    roleName: role.roleName,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    active: role.active !== false,
  }));
  return upsertCollection(db.collection('roles'), ['accessType'], roles);
}

async function seedRcsGovernanceModel(db) {
  const fluidCatalog = readJson('rcs-sprec-fluid-catalog.RCS-GOV-1.0.json');
  const solidCatalog = readJson('rcs-sprec-solid-catalog.RCS-GOV-1.0.json');
  const severity = readJson('rcs-severity-mapping.RCS-GOV-1.0.json');
  const weights = readJson('rcs-axis-weights.RCS-GOV-1.0.json');
  const thresholds = readJson('rcs-grade-thresholds.RCS-GOV-1.0.json');
  const governance = readJson('rcs-governance-rules.RCS-GOV-1.0.json');

  const counts = [];
  counts.push(await upsertCollection(db.collection('rcs_model_versions'), ['model_code'], [{
    model_code: 'RCS-GOV-1.0',
    sprec_version: 'SPREC-2.0',
    active: true,
    description: 'Governance-aware Ribeiro Classification Score certification model',
  }]));
  counts.push(await upsertCollection(db.collection('rcs_sprec_catalog'), ['model_code', 'sprec_version', 'matrix_type', 'axis_code', 'sprec_code'], [
    ...buildRcsCatalogDocuments(fluidCatalog),
    ...buildRcsCatalogDocuments(solidCatalog),
  ]));
  counts.push(await upsertCollection(db.collection('rcs_severity_mappings'), ['model_code', 'sprec_version', 'matrix_type', 'axis_code', 'sprec_codes', 'condition_description'], (severity.mappings || []).map((item) => ({ model_code: severity.model_code, sprec_version: severity.sprec_version, ...item }))));
  counts.push(await upsertCollection(db.collection('rcs_axis_weights'), ['model_code', 'sprec_version', 'matrix_type', 'axis_code'], (weights.weights || []).map((item) => ({ model_code: weights.model_code, sprec_version: weights.sprec_version, ...item }))));
  counts.push(await upsertCollection(db.collection('rcs_grade_thresholds'), ['model_code', 'sprec_version', 'grade'], (thresholds.thresholds || []).map((item) => ({ model_code: thresholds.model_code, sprec_version: thresholds.sprec_version, ...item }))));
  counts.push(await upsertCollection(db.collection('rcs_governance_rules'), ['model_code', 'sprec_version', 'rule_code'], (governance.rules || []).map((item) => ({ model_code: governance.model_code, sprec_version: governance.sprec_version, ...item }))));
  return counts.reduce((sum, value) => sum + value, 0);
}

async function seedDiseaseRules(db) {
  return upsertCollection(
    db.collection(CANONICAL_COLLECTIONS.diseaseDictionary),
    ['orpha_code'],
    ESSENTIAL_DISEASE_RULES.map((rule) => ({ ...rule, active: true }))
  );
}

async function seedAtcBootstrap(db) {
  return upsertCollection(
    db.collection(CANONICAL_COLLECTIONS.medicationDictionary),
    ['name', 'atc_code'],
    ESSENTIAL_ATC_BOOTSTRAP.map((entry) => ({ ...entry, active: true }))
  );
}

async function runSeed() {
  log('Iniciando seed essencial seguro.');
  const db = await connectDB();

  try {
    await ensureIndexes(db);
    log('Colecoes canonicas e indices minimos verificados.');

    const results = {
      roles: await seedRoles(db),
      terminologies: await seedTerminologies(db),
      miabis: await seedMiabis(db),
      rcs: await seedRcsGovernanceModel(db),
      diseaseRules: await seedDiseaseRules(db),
      atc: await seedAtcBootstrap(db),
    };

    Object.entries(results).forEach(([key, value]) => {
      log(`${key}: ${value} registros processados.`);
    });
    log('Seed essencial concluido sem pacientes, amostras, consentimentos, resultados, logs ou usuario admin.');
    return results;
  } finally {
    await closeConnection();
  }
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[SEED:ESSENTIAL] Erro durante o seed essencial:', error?.message || error);
      process.exit(1);
    });
}

module.exports = {
  runSeed,
  upsertCollection,
  buildRcsCatalogDocuments,
  seedRoles,
  seedTerminologies,
  seedMiabis,
  seedRcsGovernanceModel,
  seedDiseaseRules,
  seedAtcBootstrap,
};
