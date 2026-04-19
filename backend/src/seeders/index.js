const fs = require('fs');
const path = require('path');

const { connectDB, closeConnection } = require('../database/mongo');

const DATA_DIR = path.join(__dirname, 'data');

function log(message) {
  console.log(`[SEED] ${message}`);
}

function readJsonFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
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
    fonte: String(doc.fonte || 'seed-manual').trim(),
  };
}

function buildSprecTerminologies(sprecData) {
  const sistema = 'OUTRO';
  const fonte = sprecData?.fonte || 'seed-sprec-v1';
  const axes = Array.isArray(sprecData?.axes) ? sprecData.axes : [];

  return axes.map((axisEntry) => {
    const axis = String(axisEntry.axis || 'AXIS').trim().toUpperCase();
    const code = String(axisEntry.code || '').trim().toUpperCase();
    const label = String(axisEntry.label || '').trim();
    const descricao = String(axisEntry.descricao || label || `${axis} ${code}`).trim();

    return normalizeTerminologyDocument({
      codigo: `SPREC:${axis}:${code}`,
      sistema,
      descricao,
      label,
      sinonimos: [],
      aliases: [axis],
      relacoes: {},
      ativo: true,
      fonte,
    });
  });
}

function buildHpoTerminologies(hpoData) {
  const fonte = hpoData?.fonte || 'seed-hpo-v1';
  const terms = Array.isArray(hpoData?.terms) ? hpoData.terms : [];

  return terms.map((term) =>
    normalizeTerminologyDocument({
      codigo: term.codigo,
      sistema: 'HPO',
      descricao: term.descricao || term.label,
      label: term.label || term.descricao,
      sinonimos: Array.isArray(term.sinonimos) ? term.sinonimos : [],
      aliases: Array.isArray(term.aliases) ? term.aliases : [],
      relacoes: term.relacoes || {},
      ativo: true,
      fonte,
    })
  );
}

async function upsertCollection(collection, uniqueKeys, docs) {
  const now = new Date();
  const validDocs = (Array.isArray(docs) ? docs : []).filter((doc) => {
    return uniqueKeys.every((key) => doc[key] !== undefined && doc[key] !== null && String(doc[key]).trim() !== '');
  });

  if (validDocs.length === 0) {
    return 0;
  }

  const operations = validDocs.map((doc) => {
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
  });

  await collection.bulkWrite(operations, { ordered: false });
  return operations.length;
}

async function seedTerminologies(db) {
  const sprecData = readJsonFile('sprec.json');
  const hpoData = readJsonFile('hpo.json');

  const terminologiesCollection = db.collection('terminologies');
  const sprecDocs = buildSprecTerminologies(sprecData);
  const hpoDocs = buildHpoTerminologies(hpoData);

  const total = await upsertCollection(terminologiesCollection, ['sistema', 'codigo'], [...sprecDocs, ...hpoDocs]);
  log(`Terminologias (SPREC/HPO) sincronizadas com sucesso. Registros processados: ${total}`);
}

async function seedMiabis(db) {
  const miabisData = readJsonFile('miabis.json');

  const sampleTypes = (miabisData.sampleTypes || []).map((item) => ({
    id: item.id,
    description: item.description,
    code: item.code || null,
  }));

  const sampleOrigins = (miabisData.sampleOrigins || []).map((item) => ({
    id: item.id,
    description: item.description,
    code: item.code || null,
  }));

  const extractionProtocols = (miabisData.extractionProtocols || []).map((item) => ({
    id: item.id,
    description: item.description,
    code: item.code || null,
  }));

  const qualityDescriptions = (miabisData.qualityDescriptions || []).map((item) => ({
    id: item.id,
    description: item.description,
    qualityLevel: item.qualityLevel || null,
  }));

  const countSampleTypes = await upsertCollection(db.collection('sampleTypes'), ['id'], sampleTypes);
  const countSampleOrigins = await upsertCollection(db.collection('sampleOrigins'), ['id'], sampleOrigins);
  const countExtractionProtocols = await upsertCollection(db.collection('extractionProtocols'), ['id'], extractionProtocols);
  const countQuality = await upsertCollection(db.collection('qualityDescriptions'), ['id'], qualityDescriptions);

  log(`MIABIS sampleTypes populado com sucesso. Registros processados: ${countSampleTypes}`);
  log(`MIABIS sampleOrigins populado com sucesso. Registros processados: ${countSampleOrigins}`);
  log(`MIABIS extractionProtocols populado com sucesso. Registros processados: ${countExtractionProtocols}`);
  log(`MIABIS qualityDescriptions populado com sucesso. Registros processados: ${countQuality}`);
}

async function seedRoles(db) {
  const rolesData = readJsonFile('roles.json');
  const roles = (rolesData.roles || []).map((role) => ({
    accessType: Number(role.accessType),
    roleName: role.roleName,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    active: role.active !== false,
  }));

  const processed = await upsertCollection(db.collection('roles'), ['accessType'], roles);
  log(`Roles e permissoes populados com sucesso. Registros processados: ${processed}`);
}

async function runSeed() {
  log('Iniciando processo de seeding de reference data...');
  const db = await connectDB();

  try {
    await seedTerminologies(db);
    await seedMiabis(db);
    await seedRoles(db);

    log('Seeding concluido com sucesso.');
  } finally {
    await closeConnection();
    log('Conexao encerrada.');
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[SEED] Erro durante o seeding:', error?.message || error);
    process.exit(1);
  });
