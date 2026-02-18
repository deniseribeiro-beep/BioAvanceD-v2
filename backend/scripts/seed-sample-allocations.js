require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');
const { ObjectId } = require('mongodb');

/**
 * Script para alocar amostras em posições de caixas de armazenagem
 * Útil para testar o visualizador 9x9 e as funcionalidades de localização
 */
async function seedSampleAllocations() {
  try {
    logger.info('Iniciando alocação de amostras em posições de caixas...');

    const db = await connectDB();

    // Buscar caixas
    const boxesCollection = db.collection('storageBoxes');
    const boxes = await boxesCollection.find({}).limit(2).toArray();

    if (boxes.length === 0) {
      logger.warn('❌ Nenhuma caixa encontrada. Execute seed-storage-containers.js primeiro.');
      await closeConnection();
      return;
    }

    logger.info(`📦 Encontradas ${boxes.length} caixas`);

    // Buscar amostras existentes
    const samplesCollection = db.collection('samples');
    const samples = await samplesCollection.find({
      currentStatus: { $ne: 'WITHDRAWN' }
    }).limit(20).toArray();

    if (samples.length === 0) {
      logger.warn('❌ Nenhuma amostra encontrada para alocar.');
      await closeConnection();
      return;
    }

    logger.info(`🧪 Encontradas ${samples.length} amostras disponíveis`);

    // ============================================
    // ALOCAR AMOSTRAS EM POSIÇÕES DAS CAIXAS
    // ============================================

    // Posições possíveis em uma caixa 9x9
    const positions = [];
    for (let r = 0; r < 9; r++) {
      const rowLabel = String.fromCharCode(65 + r); // A..I
      for (let c = 1; c <= 9; c++) {
        positions.push(`${rowLabel}${c}`);
      }
    }

    let allocated = 0;

    // À primeira caixa, alocar várias amostras
    const firstBox = boxes[0];
    logger.info(`\n📍 Alocando amostras na caixa ${firstBox._id}...`);

    for (let i = 0; i < Math.min(samples.length, 10); i++) {
      const sample = samples[i];
      const position = positions[i % positions.length];

      try {
        // Atualizar a amostra com informações de localização
        const updateResult = await samplesCollection.updateOne(
          { _id: sample._id },
          {
            $set: {
              box: firstBox.boxNumber,
              boxId: firstBox._id,
              wellPosition: position,
              eppendorfWell: position,
              locationBox: firstBox.boxNumber,
              storageLocation: {
                boxId: firstBox._id.toString(),
                position: position
              }
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          logger.info(`  ✅ Amostra ${sample.barcode || sample.sampleID}@${position}`);
          allocated++;
        }
      } catch (err) {
        logger.error(`  ❌ Erro ao alocar amostra ${sample.barcode}:`, err.message);
      }
    }

    // À segunda caixa (se existir), alocar mais algumas
    if (boxes.length > 1) {
      const secondBox = boxes[1];
      logger.info(`\n📍 Alocando amostras na caixa ${secondBox._id}...`);

      const startIndex = Math.min(samples.length, 10);
      for (let i = startIndex; i < Math.min(samples.length, startIndex + 8); i++) {
        const sample = samples[i];
        const position = positions[(i - startIndex) % positions.length];

        try {
          const updateResult = await samplesCollection.updateOne(
            { _id: sample._id },
            {
              $set: {
                box: secondBox.boxNumber,
                boxId: secondBox._id,
                wellPosition: position,
                eppendorfWell: position,
                locationBox: secondBox.boxNumber,
                storageLocation: {
                  boxId: secondBox._id.toString(),
                  position: position
                }
              }
            }
          );

          if (updateResult.modifiedCount > 0) {
            logger.info(`  ✅ Amostra ${sample.barcode || sample.sampleID}@${position}`);
            allocated++;
          }
        } catch (err) {
          logger.error(`  ❌ Erro ao alocar amostra ${sample.barcode}:`, err.message);
        }
      }
    }

    logger.info(`\n✅ ALOCAÇÃO COMPLETA - ${allocated} amostras foram alocadas com sucesso!`);

    // Exibir informações das caixas alocadas
    logger.info('\n📊 Resumo das alocações:');
    for (const box of boxes) {
      const allocatedCount = await samplesCollection.countDocuments({
        boxId: box._id
      });
      logger.info(`  Caixa #${box.boxNumber}: ${allocatedCount} amostras alocadas`);
    }

    await closeConnection();
  } catch (error) {
    logger.error('❌ Erro durante alocação de amostras:', error.message);
    logger.error(error);
    process.exit(1);
  }
}

// Executar script
if (require.main === module) {
  seedSampleAllocations();
}

module.exports = { seedSampleAllocations };
