const { connectDB, closeConnection } = require('../database/mongo');
const { connectNeo4j, closeNeo4jConnection } = require('../infrastructure/database/neo4j/connection');
const Redis = require('ioredis');
const { runSeed } = require('./seedEssential');
const { createFirstAdmin } = require('./createFirstAdmin');

const MARKER = 'BIOAVANCED_SYNTHETIC_TEST_V1';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function seedSyntheticData() {
  await runSeed();
  await createFirstAdmin({
    env: {
      ...process.env,
      BOOTSTRAP_ADMIN_NAME: required('TEST_ADMIN_NAME'),
      BOOTSTRAP_ADMIN_EMAIL: required('TEST_ADMIN_EMAIL'),
      BOOTSTRAP_ADMIN_USERNAME: required('TEST_ADMIN_USERNAME'),
      BOOTSTRAP_ADMIN_TEMP_PASSWORD: required('TEST_ADMIN_PASSWORD'),
    },
  });

  const db = await connectDB();
  try {
    const now = new Date();
    const documents = {
      consentTemplates: [{ syntheticKey: `${MARKER}:TCLE`, title: 'TCLE sintetico de validacao', version: 'TEST-1', content: 'Conteudo sintetico para validacao automatizada.', active: true, synthetic: true, source: MARKER, updatedAt: now }],
      patients: [{ syntheticKey: `${MARKER}:PATIENT`, patientID: 'TEST-PATIENT-001', patientName: 'Paciente Sintetico', birthDate: '1990-01-01', documentType: 'PASSPORT', documentNumber: 'TESTPASS001', synthetic: true, source: MARKER, updatedAt: now }],
      samples: [{ syntheticKey: `${MARKER}:SAMPLE`, sampleID: 'TEST-SAMPLE-001', barcode: 'TEST-BARCODE-001', patientID: 'TEST-PATIENT-001', sampleType: 'PLASMA', status: 'AVAILABLE', synthetic: true, source: MARKER, updatedAt: now }],
      equipments: [{ syntheticKey: `${MARKER}:EQUIPMENT`, equipmentID: 'TEST-EQUIPMENT-001', name: 'Freezer sintetico', status: 'active', synthetic: true, source: MARKER, updatedAt: now }],
      locations: [{ syntheticKey: `${MARKER}:LOCATION`, locationID: 'TEST-LOCATION-001', name: 'Local sintetico', synthetic: true, source: MARKER, updatedAt: now }],
      sensors: [{ syntheticKey: `${MARKER}:SENSOR`, sensorID: 'TEST-SENSOR-001', equipmentID: 'TEST-EQUIPMENT-001', status: 'active', synthetic: true, source: MARKER, updatedAt: now }],
      researchProjects: [{ syntheticKey: `${MARKER}:PROJECT`, projectID: 'TEST-PROJECT-001', title: 'Projeto sintetico', status: 'active', synthetic: true, source: MARKER, updatedAt: now }],
    };
    for (const [collectionName, entries] of Object.entries(documents)) {
      for (const document of entries) {
        await db.collection(collectionName).updateOne({ syntheticKey: document.syntheticKey }, { $set: document, $setOnInsert: { createdAt: now } }, { upsert: true });
      }
    }
  } finally {
    await closeConnection();
  }

  const driver = await connectNeo4j();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    await session.run(
      'MERGE (d:Doenca_ORPHA {code: $code}) SET d.nome = $name, d.synthetic = true, d.source = $source',
      { code: 'ORPHA:324', name: 'Doenca de Fabry', source: MARKER }
    );
  } finally {
    await session.close();
    await closeNeo4jConnection();
  }
}

async function cleanupSyntheticData() {
  const db = await connectDB();
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      await db.collection(name).deleteMany({ $or: [{ source: MARKER }, { synthetic: true }] });
    }
  } finally {
    await closeConnection();
  }

  const driver = await connectNeo4j();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    await session.run('MATCH (n {source: $source}) DETACH DELETE n', { source: MARKER });
  } finally {
    await session.close();
    await closeNeo4jConnection();
  }
}

async function resetTestEnvironment() {
  const db = await connectDB();
  try {
    await db.dropDatabase();
  } finally {
    await closeConnection();
  }

  const driver = await connectNeo4j();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
    await closeNeo4jConnection();
  }

  const influxUrl = new URL('/api/v2/delete', required('INFLUXDB_URL'));
  influxUrl.searchParams.set('org', required('INFLUXDB_ORG'));
  influxUrl.searchParams.set('bucket', required('INFLUXDB_BUCKET'));
  const influxResponse = await fetch(influxUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${required('INFLUXDB_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ start: '1970-01-01T00:00:00Z', stop: '2100-01-01T00:00:00Z' }),
  });
  if (!influxResponse.ok) {
    throw new Error(`InfluxDB reset failed: ${influxResponse.status} ${await influxResponse.text()}`);
  }

  const redis = new Redis(required('REDIS_URL'));
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

async function main() {
  const action = process.argv[2];
  if (action === 'reset') return resetTestEnvironment();
  if (action === 'seed') return seedSyntheticData();
  if (action === 'cleanup') return cleanupSyntheticData();
  throw new Error('Use: testEnvironment.js reset|seed|cleanup');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(`[TEST_ENV] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = { MARKER, resetTestEnvironment, seedSyntheticData, cleanupSyntheticData };
