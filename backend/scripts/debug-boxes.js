require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para debugar o estado das caixas e ver o occupancyGrid
 */
async function debugBoxes() {
  try {
    logger.info('🔍 Debugando estado das caixas...');

    const db = await connectDB();
    const boxesCollection = db.collection('storageBoxes');

    // Buscar todas as caixas
    const boxes = await boxesCollection.find({}).toArray();
    
    logger.info(`\n📦 Encontradas ${boxes.length} caixas:\n`);

    for (const box of boxes) {
      logger.info(`\n═══════════════════════════════════════`);
      logger.info(`Caixa: ${box.name || box._id}`);
      logger.info(`ID: ${box._id}`);
      logger.info(`Dimensão: ${box.dimension?.rows || 0}x${box.dimension?.cols || 0}`);
      logger.info(`Capacidade: ${box.capacity || 0}`);
      logger.info(`Ocupação atual: ${box.currentOccupancy || 0}`);
      
      const occupancyGrid = box.occupancyGrid || {};
      const keys = Object.keys(occupancyGrid);
      
      logger.info(`\n📊 OccupancyGrid:`);
      logger.info(`  - Total de chaves: ${keys.length}`);
      logger.info(`  - Tipo: ${typeof occupancyGrid}`);
      
      if (keys.length > 0) {
        logger.info(`  - Primeiras 10 chaves: ${keys.slice(0, 10).join(', ')}`);
        
        // Contar posições ocupadas vs vazias
        let nullCount = 0;
        let nonNullCount = 0;
        const nonNullPositions = [];
        
        for (const key of keys) {
          if (occupancyGrid[key] === null) {
            nullCount++;
          } else {
            nonNullCount++;
            if (nonNullPositions.length < 5) {
              nonNullPositions.push(`${key}=${occupancyGrid[key]}`);
            }
          }
        }
        
        logger.info(`  - Posições null (vazias): ${nullCount}`);
        logger.info(`  - Posições não-null (ocupadas): ${nonNullCount}`);
        
        if (nonNullPositions.length > 0) {
          logger.info(`  - Exemplos de posições ocupadas: ${nonNullPositions.join(', ')}`);
        }
      } else {
        logger.warn(`  ⚠️ OccupancyGrid está vazio!`);
      }
    }

    logger.info(`\n═══════════════════════════════════════\n`);

    await closeConnection();
  } catch (error) {
    logger.error('❌ Erro ao debugar caixas:', error.message);
    logger.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  debugBoxes();
}

module.exports = { debugBoxes };
