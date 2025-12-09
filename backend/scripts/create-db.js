require('dotenv').config();
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para criar o banco de dados novo com TODAS as coleções necessárias
 * Baseado nos models implementados
 */
async function createDatabase() {
  try {
    logger.info('Iniciando criação do banco de dados novo...');

    // Conecta ao banco novo
    const db = await connectNewDB();

    logger.info('Criando todas as coleções...');

    // Lista de todas as coleções necessárias baseadas nos models
    const collections = [
      {
        name: 'users',
        indexes: [
          { email: 1 },
          { username: 1 },
          { createdAt: 1 }
        ],
        description: 'Usuários do sistema (com MFA)'
      },
      {
        name: 'pacientes',
        indexes: [
          { patientID: 1 },
          { patientName: 1 },
          { clinicalUnit: 1 },
          { createdAt: 1 }
        ],
        description: 'Pacientes do biobanco'
      },
      {
        name: 'amostras',
        indexes: [
          { sampleID: 1 },
          { patientID: 1 },
          { barcode: 1 },
          { currentStatus: 1 },
          { locationID: 1 },
          { createdAt: 1 }
        ],
        description: 'Amostras biológicas'
      },
      {
        name: 'logs',
        indexes: [
          { userId: 1 },
          { action: 1 },
          { entity: 1 },
          { dateTime: -1 },
          { timestamp: -1 },
          { severity: 1 },
          { createdAt: 1 }
        ],
        description: 'Logs de auditoria do sistema'
      },
      {
        name: 'temperatures',
        indexes: [
          { sensorId: 1 },
          { timestamp: -1 },
          { dateTime: -1 },
          { readingStatus: 1 },
          { locationId: 1 },
          { createdAt: 1 }
        ],
        description: 'Leituras de temperatura'
      },
      {
        name: 'sensors',
        indexes: [
          { sensorId: 1 },
          { locationId: 1 },
          { policyId: 1 },
          { maintenanceStatus: 1 },
          { createdAt: 1 }
        ],
        description: 'Sensores de temperatura'
      },
      {
        name: 'policies',
        indexes: [
          { policyId: 1 },
          { validFrom: 1 },
          { validTo: 1 },
          { createdAt: 1 }
        ],
        description: 'Políticas de temperatura'
      },
      {
        name: 'locations',
        indexes: [
          { equipmentType: 1 },
          { block: 1 },
          { rack: 1 },
          { drawer: 1 },
          { box: 1 },
          { createdAt: 1 }
        ],
        description: 'Localizações/Freezers'
      },
      {
        name: 'results',
        indexes: [
          { resultID: 1 },
          { sampleID: 1 },
          { fileType: 1 },
          { uploadedAt: -1 },
          { createdAt: 1 }
        ],
        description: 'Resultados de análise'
      },
      {
        name: 'equipment',
        indexes: [
          { equipmentID: 1 },
          { createdAt: 1 }
        ],
        description: 'Equipamentos'
      },
      {
        name: 'alerts',
        indexes: [
          { sensorId: 1 },
          { status: 1 },
          { timestamp: -1 },
          { severity: 1 },
          { createdAt: 1 }
        ],
        description: 'Alertas de temperatura'
      },
      {
        name: 'intelligentAssistant',
        indexes: [
          { assistantID: 1 },
          { contextScope: 1 },
          { lastInteraction: -1 },
          { createdAt: 1 }
        ],
        description: 'Interações do Assistente Inteligente'
      },
      {
        name: 'reports',
        indexes: [
          { reportID: 1 },
          { reportType: 1 },
          { generatedAt: -1 },
          { status: 1 },
          { createdAt: 1 }
        ],
        description: 'Relatórios do sistema'
      },
      {
        name: 'access',
        indexes: [
          { accessID: 1 },
          { reportID: 1 },
          { userId: 1 },
          { accessType: 1 },
          { createdAt: 1 }
        ],
        description: 'Controle de acesso a relatórios'
      },
      {
        name: 'measurementUnits',
        indexes: [
          { unitID: 1 },
          { createdAt: 1 }
        ],
        description: 'Unidades de medida para amostras'
      },
      {
        name: 'qualityDescriptions',
        indexes: [
          { qualityID: 1 },
          { createdAt: 1 }
        ],
        description: 'Descrições de qualidade para amostras'
      },
      {
        name: 'withdrawals',
        indexes: [
          { withdrawalID: 1 },
          { sampleID: 1 },
          { withdrawalDate: -1 },
          { withdrawalType: 1 },
          { createdAt: 1 }
        ],
        description: 'Registros de retirada de amostras'
      }
    ];

    // Cria cada coleção com seus índices
    for (const collectionConfig of collections) {
      try {
        const collection = db.collection(collectionConfig.name);
        
        // Cria índices
        for (const index of collectionConfig.indexes) {
          try {
            await collection.createIndex(index);
          } catch (error) {
            // Índice pode já existir, continua
            if (!error.message.includes('already exists')) {
              logger.warn(`Erro ao criar índice em ${collectionConfig.name}:`, error.message);
            }
          }
        }
        
        logger.info(`✅ Coleção "${collectionConfig.name}" criada/verificada - ${collectionConfig.description}`);
      } catch (error) {
        logger.error(`❌ Erro ao criar coleção ${collectionConfig.name}:`, error.message);
      }
    }

    // Insere documento inicial na coleção logs
    const logsCollection = db.collection('logs');
    const existingLog = await logsCollection.findOne({ 
      action: 'SYSTEM_INIT',
      entity: 'System'
    });

    if (!existingLog) {
      const logInicial = {
        logId: null,
        dateTime: new Date(),
        timestamp: new Date(),
        userId: 'system',
        userName: 'Sistema',
        action: 'SYSTEM_INIT',
        entity: 'System',
        result: 'success',
        severity: 'info',
        source: 'system',
        ipSource: null,
        message: 'Banco de dados criado com sucesso - Todas as coleções inicializadas',
        createdAt: new Date()
      };

      await logsCollection.insertOne(logInicial);
      logger.info('✅ Documento inicial inserido na coleção "logs"');
    }

    logger.info('');
    logger.info('✅ Banco de dados criado com sucesso!');
    logger.info(`   - Total de coleções criadas: ${collections.length}`);
    logger.info('   - Coleções:');
    collections.forEach(col => {
      logger.info(`     • ${col.name} - ${col.description}`);
    });
    logger.info('   - Documento inicial inserido em logs');

    // Fecha a conexão
    await closeConnection();

    process.exit(0);
  } catch (error) {
    logger.error('Erro ao criar banco de dados:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executa o script
createDatabase();
