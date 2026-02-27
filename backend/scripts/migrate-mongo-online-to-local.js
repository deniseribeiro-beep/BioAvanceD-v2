#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();

const { MongoClient } = require('mongodb');

function parseArgs(argv) {
  const args = {
    dropTarget: false,
    includeCollections: null,
    batchSize: Number(process.env.MONGO_MIGRATE_BATCH_SIZE || 1000),
  };

  for (const token of argv.slice(2)) {
    if (token === '--drop-target') {
      args.dropTarget = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token.startsWith('--collections=')) {
      const raw = token.slice('--collections='.length).trim();
      args.includeCollections = raw
        ? raw.split(',').map((name) => name.trim()).filter(Boolean)
        : null;
      continue;
    }

    if (token.startsWith('--batch-size=')) {
      const value = Number(token.slice('--batch-size='.length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Valor inválido para --batch-size. Use inteiro > 0.');
      }
      args.batchSize = Math.floor(value);
    }
  }

  return args;
}

function printHelp() {
  console.log(`\nMigração MongoDB Online -> Local\n\nUso:\n  node backend/scripts/migrate-mongo-online-to-local.js [opções]\n\nOpções:\n  --drop-target                 Apaga cada coleção local antes de importar\n  --collections=col1,col2       Migra somente coleções específicas\n  --batch-size=1000             Tamanho do lote de escrita (padrão: 1000)\n  -h, --help                    Exibe esta ajuda\n\nVariáveis de ambiente (obrigatórias):\n  MONGO_SOURCE_URI              URI do MongoDB online (Atlas/SRV ou padrão)\n  MONGO_SOURCE_DB               Nome do database de origem\n\nVariáveis de ambiente (opcionais):\n  MONGO_TARGET_URI              URI do Mongo local (default: mongodb://root:root@localhost:27017/?authSource=admin)\n  MONGO_TARGET_DB               Nome do database local (default: MONGO_DB ou MONGO_SOURCE_DB)\n  MONGO_MIGRATE_BATCH_SIZE      Batch padrão\n`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }
  return value;
}

async function copyCollection({ sourceDb, targetDb, collectionName, batchSize, dropTarget }) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);

  if (dropTarget) {
    const exists = await targetDb.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
    if (exists) {
      await targetCollection.drop();
    }
  }

  const total = await sourceCollection.countDocuments({});
  console.log(`\n📦 Coleção: ${collectionName} (${total} docs)`);

  let migrated = 0;
  const cursor = sourceCollection.find({}, { noCursorTimeout: true }).batchSize(batchSize);
  let buffer = [];

  for await (const doc of cursor) {
    buffer.push(doc);

    if (buffer.length >= batchSize) {
      await targetCollection.insertMany(buffer, { ordered: false });
      migrated += buffer.length;
      buffer = [];
      console.log(`   ↳ ${migrated}/${total} migrados`);
    }
  }

  if (buffer.length > 0) {
    await targetCollection.insertMany(buffer, { ordered: false });
    migrated += buffer.length;
  }

  const indexes = await sourceCollection.indexes();
  const transferableIndexes = indexes
    .filter((index) => index.name !== '_id_')
    .map(({ key, name, unique, sparse, expireAfterSeconds, partialFilterExpression, collation }) => ({
      key,
      name,
      unique,
      sparse,
      expireAfterSeconds,
      partialFilterExpression,
      collation,
    }));

  if (transferableIndexes.length > 0) {
    await targetCollection.createIndexes(transferableIndexes);
  }

  const targetCount = await targetCollection.countDocuments({});
  console.log(`   ✅ Finalizado: ${migrated} docs inseridos | total local: ${targetCount}`);

  return { collectionName, total, migrated, targetCount, indexes: transferableIndexes.length };
}

async function run() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const sourceUri = requiredEnv('MONGO_SOURCE_URI');
  const sourceDbName = requiredEnv('MONGO_SOURCE_DB');
  const targetUri = process.env.MONGO_TARGET_URI || 'mongodb://root:root@localhost:27017/?authSource=admin';
  const targetDbName = process.env.MONGO_TARGET_DB || process.env.MONGO_DB || sourceDbName;

  console.log('🚀 Iniciando migração MongoDB online -> local');
  console.log(`   Origem: ${sourceDbName}`);
  console.log(`   Destino: ${targetDbName}`);
  console.log(`   Drop target: ${args.dropTarget ? 'sim' : 'não'}`);
  console.log(`   Batch size: ${args.batchSize}`);

  const sourceClient = new MongoClient(sourceUri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 60000,
  });

  const targetClient = new MongoClient(targetUri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 60000,
  });

  try {
    await sourceClient.connect();
    await targetClient.connect();

    const sourceDb = sourceClient.db(sourceDbName);
    const targetDb = targetClient.db(targetDbName);

    const allCollections = (await sourceDb.listCollections({}, { nameOnly: true }).toArray())
      .map((item) => item.name)
      .filter((name) => !name.startsWith('system.'));

    const collections = args.includeCollections && args.includeCollections.length > 0
      ? allCollections.filter((name) => args.includeCollections.includes(name))
      : allCollections;

    if (collections.length === 0) {
      throw new Error('Nenhuma coleção encontrada para migrar.');
    }

    const startedAt = Date.now();
    const summary = [];

    for (const collectionName of collections) {
      const result = await copyCollection({
        sourceDb,
        targetDb,
        collectionName,
        batchSize: args.batchSize,
        dropTarget: args.dropTarget,
      });

      summary.push(result);
    }

    const elapsedMs = Date.now() - startedAt;
    const totalDocs = summary.reduce((acc, item) => acc + item.migrated, 0);

    console.log('\n🎉 Migração concluída com sucesso');
    console.log(`   Coleções migradas: ${summary.length}`);
    console.log(`   Documentos migrados: ${totalDocs}`);
    console.log(`   Tempo total: ${(elapsedMs / 1000).toFixed(2)}s`);
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

run().catch((error) => {
  console.error('\n❌ Falha na migração:', error.message);
  process.exit(1);
});
