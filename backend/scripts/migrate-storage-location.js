require('dotenv').config();
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para migrar documentos de amostras
 * Adiciona o campo storageLocation a todos os documentos existentes
 * Data: Feb 12, 2026 (Semana 2 - Núcleo de Armazenamento Físico)
 */
async function migrateStorageLocation() {
  let connection;
  try {
    logger.info('Iniciando migração: Adicionar storageLocation a amostras...');

    connection = await connectNewDB();
    const db = connection;

    const samplesCollection = db.collection('amostras');

    // Contar documentos que já têm storageLocation
    const withStorageLocation = await samplesCollection.countDocuments({
      'storageLocation': { $exists: true }
    });

    // Contar todos os documentos
    const totalDocuments = await samplesCollection.countDocuments({});

    logger.info(`Total de amostras: ${totalDocuments}`);
    logger.info(`Amostras com storageLocation: ${withStorageLocation}`);

    // Atualizar documentos que NÃO têm storageLocation
    const documentsToUpdate = totalDocuments - withStorageLocation;

    if (documentsToUpdate > 0) {
      const result = await samplesCollection.updateMany(
        { 'storageLocation': { $exists: false } },
        {
          $set: {
            'storageLocation': {
              boxId: null,
              position: null
            },
            'updatedAt': new Date()
          }
        }
      );

      logger.info(`✅ Migração concluída!`);
      logger.info(`   - Documentos modificados: ${result.modifiedCount}`);
      logger.info(`   - Documentos correspondidos: ${result.matchedCount}`);
      logger.info(`   - Documentos já com storageLocation: ${withStorageLocation}`);
    } else {
      logger.info('✅ Todos os documentos já têm storageLocation. Nada a atualizar.');
    }

    // Criar índices para a nova coluna
    logger.info('Criando/verificando índices para storageLocation...');
    await samplesCollection.createIndex({ 'storageLocation.boxId': 1 });
    logger.info('   ✅ Índice "storageLocation.boxId" criado');

    await samplesCollection.createIndex({ 'storageLocation.position': 1 });
    logger.info('   ✅ Índice "storageLocation.position" criado');

    logger.info('🎉 Migração finalizada com sucesso!');

  } catch (error) {
    logger.error('❌ Erro durante migração:', error.message);
    throw error;
  } finally {
    if (connection) {
      await closeConnection();
    }
  }
}

// Executar se for chamado diretamente
if (require.main === module) {
  migrateStorageLocation()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = migrateStorageLocation;
