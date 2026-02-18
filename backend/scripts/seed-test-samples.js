require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para criar amostras de teste no banco de dados
 */
async function seedTestSamples() {
  try {
    logger.info('Criando amostras de teste...');

    const db = await connectDB();
    const samplesCollection = db.collection('samples');

    // Verificar se já existem amostras
    const existingCount = await samplesCollection.countDocuments({});
    if (existingCount > 0) {
      logger.info(`⚠️  Já existem ${existingCount} amostras no banco. Pulando seed.`);
      await closeConnection();
      return;
    }

    const samples = [];

    // Criar 25 amostras de teste
    for (let i = 1; i <= 25; i++) {
      const patientID = String(Math.floor(10000000 + Math.random() * 90000000));
      const barcode = `SM-${2024}-${String(i).padStart(6, '0')}`;

      samples.push({
        patientID: patientID,
        barcode: barcode,
        sampleID: i,
        sampleType: ['Sangue', 'Soro', 'Plasma', 'Urina', 'Tecido'][i % 5],
        sampleOrigin: ['Coletado', 'Armazenado', 'Processado'][i % 3],
        extractionProtocol: 'Protocolo Padrão',
        registerDate: new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000),
        quantity: Math.floor(Math.random() * 100) + 10,
        unit: 'mL',
        currentStatus: i % 10 === 0 ? 'WITHDRAWN' : 'AVAILABLE',
        volume: Math.floor(Math.random() * 100) + 10,
        concentration: Math.random() * 1000,
        comments: `Amostra de teste #${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          source: 'test-seed',
          version: 1
        }
      });
    }

    // Inserir amostras
    const result = await samplesCollection.insertMany(samples);
    logger.info(`✅ ${result.insertedIds.length} amostras criadas com sucesso!`);

    // Exibir resumo
    logger.info('\n📊 Amostras criadas:');
    logger.info(`  Total: ${samples.length}`);
    logger.info(`  AVAILABLE: ${samples.filter(s => s.currentStatus === 'AVAILABLE').length}`);
    logger.info(`  WITHDRAWN: ${samples.filter(s => s.currentStatus === 'WITHDRAWN').length}`);

    await closeConnection();
  } catch (error) {
    logger.error('Erro ao criar amostras:', error.message);
    logger.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedTestSamples();
}

module.exports = { seedTestSamples };
