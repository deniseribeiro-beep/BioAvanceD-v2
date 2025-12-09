require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para sincronizar todas as coleções do banco principal
 * Garante que todas as 17 coleções existam
 */
async function syncCollections() {
  try {
    logger.info('Sincronizando coleções do banco principal...');

    const db = await connectDB();

    // Lista de todas as coleções necessárias
    const requiredCollections = [
      'users',
      'pacientes',
      'amostras',
      'logs',
      'temperatures',
      'sensors',
      'policies',
      'locations',
      'results',
      'equipment',
      'alerts',
      'intelligentAssistant',
      'reports',
      'access',
      'measurementUnits',
      'qualityDescriptions',
      'withdrawals'
    ];

    const existingCollections = await db.listCollections().toArray();
    const existingNames = existingCollections.map(c => c.name);

    logger.info(`Coleções existentes: ${existingNames.length}`);
    logger.info(`Coleções necessárias: ${requiredCollections.length}`);

    for (const collectionName of requiredCollections) {
      if (!existingNames.includes(collectionName)) {
        // Cria a coleção (MongoDB cria automaticamente ao inserir)
        const collection = db.collection(collectionName);
        // Insere um documento vazio e remove para garantir criação
        await collection.insertOne({ _temp: true });
        await collection.deleteOne({ _temp: true });
        logger.info(`✅ Coleção "${collectionName}" criada`);
      } else {
        logger.info(`⚠️  Coleção "${collectionName}" já existe`);
      }
    }

    // Verifica coleções finais
    const finalCollections = await db.listCollections().toArray();
    const finalNames = finalCollections.map(c => c.name).sort();

    logger.info('');
    logger.info('✅ Sincronização concluída!');
    logger.info(`   Total de coleções: ${finalNames.length}`);
    logger.info('   Coleções:');
    finalNames.forEach(name => {
      logger.info(`     • ${name}`);
    });

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao sincronizar coleções:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executa o script
syncCollections();

