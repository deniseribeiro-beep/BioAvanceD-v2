#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const neo4j = require('neo4j-driver');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const REQUIRED_ENV_VARS = ['MONGO_URI', 'NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'];

function logInfo(message, meta) {
  if (meta) {
    console.log(`[INFO] ${message}`, meta);
    return;
  }
  console.log(`[INFO] ${message}`);
}

function logError(message, err) {
  if (err) {
    console.error(`[ERROR] ${message}`);
    console.error(err);
    return;
  }
  console.error(`[ERROR] ${message}`);
}

function assertEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name] || String(process.env[name]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`Variaveis obrigatorias ausentes no .env: ${missing.join(', ')}`);
  }
}

function readDumpFile() {
  const dumpPath = path.resolve(__dirname, '..', 'data-dump.json');
  logInfo(`Lendo arquivo de dados: ${dumpPath}`);

  if (!fs.existsSync(dumpPath)) {
    throw new Error(`Arquivo nao encontrado: ${dumpPath}`);
  }

  const raw = fs.readFileSync(dumpPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON invalido em data-dump.json: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('O arquivo data-dump.json deve conter um array de amostras');
  }

  if (parsed.length === 0) {
    throw new Error('O arquivo data-dump.json esta vazio');
  }

  const sanitized = parsed.map((item, index) => {
    const codigo = String(item.codigo || '').trim();
    const tipoAmostra = String(item.tipoAmostra || '').trim();
    const temperaturaIdeal = Number(item.temperaturaIdeal);

    if (!codigo) {
      throw new Error(`Item ${index} sem campo obrigatorio: codigo`);
    }
    if (!tipoAmostra) {
      throw new Error(`Item ${index} sem campo obrigatorio: tipoAmostra`);
    }
    if (!Number.isFinite(temperaturaIdeal)) {
      throw new Error(`Item ${index} com temperaturaIdeal invalida`);
    }

    return {
      codigo,
      tipoAmostra,
      temperaturaIdeal,
      origem: item.origem ? String(item.origem).trim() : null,
      updatedAt: new Date()
    };
  });

  logInfo(`Arquivo carregado com sucesso. Total de amostras: ${sanitized.length}`);
  return sanitized;
}

async function seedMongo(samples) {
  const mongoUri = process.env.MONGO_URI;
  const client = new MongoClient(mongoUri);

  logInfo('Conectando ao MongoDB Atlas...');
  await client.connect();
  logInfo('Conexao com MongoDB Atlas estabelecida.');

  try {
    const db = client.db();
    const collection = db.collection('amostras');

    logInfo(`Limpando colecao MongoDB: ${db.databaseName}.amostras`);
    const deleteResult = await collection.deleteMany({});
    logInfo(`Documentos removidos da colecao amostras: ${deleteResult.deletedCount}`);

    logInfo('Inserindo novos documentos no MongoDB...');
    const insertResult = await collection.insertMany(samples, { ordered: true });
    logInfo(`Insercao concluida no MongoDB. Documentos inseridos: ${insertResult.insertedCount}`);
  } finally {
    await client.close();
    logInfo('Conexao MongoDB encerrada.');
  }
}

async function seedNeo4j(samples) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
  );

  logInfo('Conectando ao Neo4j Aura...');
  await driver.verifyConnectivity();
  logInfo('Conexao com Neo4j Aura estabelecida.');

  const session = driver.session();
  try {
    logInfo('Criando/atualizando nos :Amostra no Neo4j com MERGE...');

    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      logInfo(`Neo4j progresso ${i + 1}/${samples.length} - codigo=${sample.codigo}`);

      await session.run(
        `
          MERGE (a:Amostra {codigo: $codigo})
          SET a.tipoAmostra = $tipoAmostra,
              a.temperaturaIdeal = $temperaturaIdeal,
              a.origem = $origem,
              a.updatedAt = datetime()
        `,
        {
          codigo: sample.codigo,
          tipoAmostra: sample.tipoAmostra,
          temperaturaIdeal: sample.temperaturaIdeal,
          origem: sample.origem
        }
      );
    }

    logInfo(`Neo4j concluido. Total processado: ${samples.length}`);
  } finally {
    await session.close();
    await driver.close();
    logInfo('Conexao Neo4j encerrada.');
  }
}

async function main() {
  const startedAt = new Date();
  console.log('------------------------------------------------------------');
  logInfo('Inicio do seeding BioAvanceD (MongoDB + Neo4j)');
  logInfo(`Timestamp de inicio: ${startedAt.toISOString()}`);

  try {
    assertEnv();
    const samples = readDumpFile();

    await seedMongo(samples);
    await seedNeo4j(samples);

    const finishedAt = new Date();
    logInfo(`Seeding finalizado com sucesso em ${((finishedAt - startedAt) / 1000).toFixed(2)}s`);
    console.log('------------------------------------------------------------');
    process.exit(0);
  } catch (error) {
    logError('Falha durante o seeding.', error.message || error);
    console.log('------------------------------------------------------------');
    process.exit(1);
  }
}

main();
