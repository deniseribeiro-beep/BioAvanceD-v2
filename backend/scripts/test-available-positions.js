/**
 * Teste do endpoint de posições disponíveis
 * Verifica o que está sendo retornado pela API
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bioavanced';

async function testAvailablePositions() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado ao MongoDB');

    const db = client.db('bioavanced');
    const storageBoxesCollection = db.collection('storageBoxes');

    // Pegar a primeira caixa como exemplo
    const box = await storageBoxesCollection.findOne({});

    if (!box) {
      console.error('❌ Nenhuma caixa encontrada');
      return;
    }

    console.log('\n📦 Testando caixa:');
    console.log(`  ID: ${box._id}`);
    console.log(`  Nome: ${box.name}`);
    console.log(`  Dimensão: ${box.dimension.rows}x${box.dimension.cols}`);

    // Gerar todas as posições
    function getAllValidPositions(dimension) {
      const positions = [];
      const { rows, cols } = dimension;

      for (let r = 0; r < rows; r++) {
        const letter = String.fromCharCode(65 + r); // A, B, C...
        for (let c = 1; c <= cols; c++) {
          positions.push(`${letter}${c}`);
        }
      }

      return positions;
    }

    const allPositions = getAllValidPositions(box.dimension);
    const occupancyGrid = box.occupancyGrid || {};

    console.log(`\n📊 Análise de ocupação:`);
    console.log(`  Total de posições possíveis: ${allPositions.length}`);
    console.log(`  Chaves no occupancyGrid: ${Object.keys(occupancyGrid).length}`);

    // Posição está disponível se não existir no grid OU se o valor for null
    const availablePositions = allPositions.filter(
      pos => !occupancyGrid[pos] || occupancyGrid[pos] === null
    );

    const occupiedPositions = allPositions.filter(
      pos => occupancyGrid[pos] && occupancyGrid[pos] !== null
    );

    console.log(`  Posições disponíveis: ${availablePositions.length}`);
    console.log(`  Posições ocupadas: ${occupiedPositions.length}`);
    console.log(`  currentOccupancy (DB): ${box.currentOccupancy || 0}`);

    console.log(`\n✅ Primeiras 10 posições disponíveis:`);
    console.log(`  ${availablePositions.slice(0, 10).join(', ')}`);

    if (occupiedPositions.length > 0) {
      console.log(`\n🔴 Primeiras 10 posições ocupadas:`);
      console.log(`  ${occupiedPositions.slice(0, 10).join(', ')}`);
    }

    // Simular retorno da API
    const apiResponse = {
      success: true,
      data: {
        boxId: box._id,
        boxName: box.name,
        dimension: box.dimension,
        stats: {
          capacity: box.dimension.rows * box.dimension.cols,
          occupied: box.currentOccupancy || 0,
          available: availablePositions.length,
          occupancyPercent: Math.round(
            ((box.currentOccupancy || 0) / (box.dimension.rows * box.dimension.cols)) * 100
          )
        },
        availablePositions,
        occupiedPositions: occupiedPositions.slice(0, 10)
      }
    };

    console.log('\n📤 Resposta da API (simulada):');
    console.log(JSON.stringify(apiResponse, null, 2));

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await client.close();
    console.log('\n✅ Conexão fechada');
  }
}

testAvailablePositions();
