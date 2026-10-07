// disease_dictionary is a legacy store: neither the v2.0.0 data dictionary
// nor the v4.0.0 requirements declare it, and v2.0.0 models
// biomarker-condition knowledge as BiomarkerAssociation instead. This seed
// is therefore manual only (npm run seed:disease-validation-rules), never
// on the boot path (#1200). Running it switches on enforcement: a required
// biomarker with no value makes SampleGraphValidator block the sample.
const { connectDB, closeConnection } = require('../database/mongo');

const DEFAULT_RULES = {
  miabis: {
    requireTreatmentStatus: true,
  },
  biomarkers: {
    required: [],
    recommended: [],
  },
  pharmacology: {
    required: ['treatmentStatus'],
    recommended: ['medicationName', 'lastDoseDate'],
    treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
  },
};

const DISEASE_RULES = {
  '324': {
    name: 'Doenca lisossomica',
    disease_category: 'Erros Inatos do Metabolismo',
    drug_classes: ['enzyme_replacement_therapy', 'pharmacological_chaperone'],
    validation_requirements: {
      ...DEFAULT_RULES,
      biomarkers: {
        required: ['LYSO_GB3', 'ALPHA_GALACTOSIDASE_A'],
        recommended: ['ALBUMINURIA'],
      },
    },
  },
  '355': {
    name: 'Doenca de Gaucher',
    disease_category: 'Erros Inatos do Metabolismo',
    drug_classes: ['enzyme_replacement_therapy', 'substrate_reduction_therapy'],
    validation_requirements: {
      ...DEFAULT_RULES,
      biomarkers: {
        required: ['GLUCOSYLCERAMIDE'],
        recommended: ['CHITOTRIOSIDASE', 'LYSO_GB1'],
      },
    },
  },
  '98896': {
    name: 'Distrofia Muscular de Duchenne',
    disease_category: 'Doencas Neurologicas',
    drug_classes: ['corticosteroid', 'exon_skipping_therapy'],
    validation_requirements: {
      ...DEFAULT_RULES,
      biomarkers: {
        required: ['CK_TOTAL'],
        recommended: ['DYSTROPHIN_EXPRESSION'],
      },
    },
  },
};

function normalizeOrpha(value) {
  return String(value || '').trim().replace(/^ORPHA:/i, '').trim();
}

function categoryFromRecord(record = {}) {
  const candidates = [
    record.category,
    record.classification,
    record.group,
    record.chapter,
    record.Capitulo,
    record.DisorderType,
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  if (candidates.length > 0) {
    return candidates[0];
  }

  const text = [record.name, record.nome, record.description, record.Descricao]
    .map((entry) => String(entry || '').toLowerCase())
    .join(' ');

  if (/metab|metabolic|enzim|lisossom|mitocondr/.test(text)) {
    return 'Erros Inatos do Metabolismo';
  }

  if (/neuro|epilep|atrof|distrof|muscular|neuron/.test(text)) {
    return 'Doencas Neurologicas';
  }

  if (/hemat|coagul|anemi|sang/.test(text)) {
    return 'Doencas Hematologicas';
  }

  return 'Outras Doencas Raras';
}

async function run() {
  const db = await connectDB();
  const diseaseCollection = db.collection('disease_dictionary');
  const orphanetCollection = db.collection('orphanet_diseases');

  const orphanetRows = await orphanetCollection.find({}, {
    projection: {
      code: 1,
      orphaCode: 1,
      ORPHA: 1,
      name: 1,
      nome: 1,
      description: 1,
      Descricao: 1,
      category: 1,
      classification: 1,
      group: 1,
      chapter: 1,
      Capitulo: 1,
    },
  }).toArray();

  const now = new Date();
  const operations = [];

  for (const row of orphanetRows) {
    const orpha = normalizeOrpha(row.code || row.orphaCode || row.ORPHA);
    if (!orpha) {
      continue;
    }

    const explicit = DISEASE_RULES[orpha];
    const name = String(
      explicit?.name
      || row.name
      || row.nome
      || row.description
      || row.Descricao
      || `ORPHA:${orpha}`
    ).trim();

    const disease_category = String(explicit?.disease_category || categoryFromRecord(row)).trim();

    operations.push({
      updateOne: {
        filter: { orpha_code: orpha },
        upsert: true,
        update: {
          $set: {
            orpha_code: orpha,
            name,
            disease_category,
            validation_requirements: explicit?.validation_requirements || DEFAULT_RULES,
            drug_classes: Array.isArray(explicit?.drug_classes) ? explicit.drug_classes : [],
            active: true,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
      },
    });
  }

  Object.entries(DISEASE_RULES).forEach(([orpha, payload]) => {
    operations.push({
      updateOne: {
        filter: { orpha_code: orpha },
        upsert: true,
        update: {
          $set: {
            orpha_code: orpha,
            name: payload.name,
            disease_category: payload.disease_category,
            validation_requirements: payload.validation_requirements,
            drug_classes: payload.drug_classes,
            active: true,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
      },
    });
  });

  if (operations.length > 0) {
    await diseaseCollection.bulkWrite(operations, { ordered: false });
  }

  await diseaseCollection.createIndex({ orpha_code: 1 }, { unique: true, name: 'orpha_code_unique' });
  await diseaseCollection.createIndex({ disease_category: 1 }, { name: 'disease_category_idx' });
  await diseaseCollection.createIndex({ active: 1 }, { name: 'disease_active_idx' });

  console.log(`DiseaseDictionary seeded: ${operations.length} operations`);
}

run()
  .catch((error) => {
    console.error('Erro ao semear regras de validacao clinica:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
