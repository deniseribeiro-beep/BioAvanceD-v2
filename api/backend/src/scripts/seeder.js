const { connectDB, closeConnection } = require('../database/mongo');

const OFFLINE_ATC_BOOTSTRAP = [
  {
    name: 'Agalsidase beta',
    code: 'ATC:A16AB04',
    atc_code: 'A16AB04',
    atc_level_1: 'A',
    atc_classifications: ['A16AB04'],
    synonyms: ['Fabrazyme'],
    drug_class: 'enzyme_replacement_therapy',
    disease_categories: ['Erros Inatos do Metabolismo'],
    source: 'BOOTSTRAP_OFFLINE',
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
    source: 'BOOTSTRAP_OFFLINE',
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
    source: 'BOOTSTRAP_OFFLINE',
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
    source: 'BOOTSTRAP_OFFLINE',
  },
  {
    name: 'Atalureno',
    code: 'ATC:M09AX03',
    atc_code: 'M09AX03',
    atc_level_1: 'M',
    atc_classifications: ['M09AX03'],
    synonyms: ['Translarna'],
    drug_class: 'exon_skipping_therapy',
    disease_categories: ['Doencas Neurologicas'],
    source: 'BOOTSTRAP_OFFLINE',
  },
];

async function run() {
  const db = await connectDB();
  const collection = db.collection('medication_dictionary');
  const now = new Date();

  const operations = OFFLINE_ATC_BOOTSTRAP.map((item) => ({
    updateOne: {
      filter: {
        name: item.name,
        atc_code: item.atc_code,
      },
      upsert: true,
      update: {
        $set: {
          ...item,
          active: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
    },
  }));

  if (operations.length > 0) {
    await collection.bulkWrite(operations, { ordered: false });
  }

  await collection.createIndex({ atc_code: 1 }, { name: 'atc_code_idx' });
  await collection.createIndex({ name: 1 }, { name: 'drug_name_idx' });
  await collection.createIndex({ disease_categories: 1 }, { name: 'drug_disease_categories_idx' });

  console.log(`ATC bootstrap completed with ${operations.length} medications.`);
}

run()
  .catch((error) => {
    console.error('Erro ao executar bootstrap ATC:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
