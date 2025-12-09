require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para popular os dicionários de tipos de amostra, origens e protocolos
 * com valores padrão caso não existam
 */
async function seedSampleDictionaries() {
  try {
    logger.info('Iniciando seed dos dicionários de amostra...');
    const db = await connectDB();

    // Tipos de Amostra
    const sampleTypesCollection = db.collection('sampleTypes');
    const existingSampleTypes = await sampleTypesCollection.countDocuments();
    
    if (existingSampleTypes === 0) {
      const defaultSampleTypes = [
        { sampleTypeID: 1, description: 'Sangue', code: 'BLOOD' },
        { sampleTypeID: 2, description: 'Urina', code: 'URINE' },
        { sampleTypeID: 3, description: 'Saliva', code: 'SALIVA' },
        { sampleTypeID: 4, description: 'Tecido', code: 'TISSUE' },
        { sampleTypeID: 5, description: 'DNA', code: 'DNA' },
        { sampleTypeID: 6, description: 'RNA', code: 'RNA' },
        { sampleTypeID: 7, description: 'Plasma', code: 'PLASMA' },
        { sampleTypeID: 8, description: 'Soro', code: 'SERUM' },
        { sampleTypeID: 9, description: 'Líquido Cefalorraquidiano', code: 'CSF' }
      ];
      
      for (const type of defaultSampleTypes) {
        await sampleTypesCollection.insertOne({
          ...type,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      logger.info(`✅ ${defaultSampleTypes.length} tipos de amostra inseridos`);
    } else {
      logger.info(`⚠️  Já existem ${existingSampleTypes} tipos de amostra cadastrados`);
    }

    // Origens de Amostra
    const sampleOriginsCollection = db.collection('sampleOrigins');
    const existingOrigins = await sampleOriginsCollection.countDocuments();
    
    if (existingOrigins === 0) {
      const defaultOrigins = [
        { originID: 1, description: 'Coleta', code: 'COLLECTION' },
        { originID: 2, description: 'Transferência', code: 'TRANSFER' },
        { originID: 3, description: 'Doação', code: 'DONATION' },
        { originID: 4, description: 'Pesquisa', code: 'RESEARCH' }
      ];
      
      for (const origin of defaultOrigins) {
        await sampleOriginsCollection.insertOne({
          ...origin,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      logger.info(`✅ ${defaultOrigins.length} origens de amostra inseridas`);
    } else {
      logger.info(`⚠️  Já existem ${existingOrigins} origens de amostra cadastradas`);
    }

    // Protocolos de Extração
    const extractionProtocolsCollection = db.collection('extractionProtocols');
    const existingProtocols = await extractionProtocolsCollection.countDocuments();
    
    if (existingProtocols === 0) {
      const defaultProtocols = [
        { protocolID: 1, description: 'Protocolo A', code: 'PROTO_A' },
        { protocolID: 2, description: 'Protocolo B', code: 'PROTO_B' },
        { protocolID: 3, description: 'Protocolo C', code: 'PROTO_C' },
        { protocolID: 4, description: 'QIAGEN', code: 'QIAGEN' },
        { protocolID: 5, description: 'Phenol-Chloroform', code: 'PHENOL_CHLORO' },
        { protocolID: 6, description: 'Automated', code: 'AUTOMATED' }
      ];
      
      for (const protocol of defaultProtocols) {
        await extractionProtocolsCollection.insertOne({
          ...protocol,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      logger.info(`✅ ${defaultProtocols.length} protocolos de extração inseridos`);
    } else {
      logger.info(`⚠️  Já existem ${existingProtocols} protocolos de extração cadastrados`);
    }

    logger.info('✅ Seed dos dicionários concluído!');
  } catch (error) {
    logger.error('Erro ao fazer seed dos dicionários:', error);
    throw error;
  } finally {
    await closeConnection();
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  seedSampleDictionaries()
    .then(() => {
      logger.info('Script concluído com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Erro ao executar script:', error);
      process.exit(1);
    });
}

module.exports = { seedSampleDictionaries };

