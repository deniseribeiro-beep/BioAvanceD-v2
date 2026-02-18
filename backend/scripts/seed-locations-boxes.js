require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');
const LocationModel = require('../src/models/Location');

/**
 * Script para criar/atualizar localizações com dados de box para teste do visualizador
 */
async function seedLocationsWithBoxes() {
  try {
    logger.info('Criando/atualizando localizações com dados de box...');

    const db = await connectDB();
    const locationsCollection = db.collection('locations');
    const equipmentCollection = db.collection('equipment');

    // Buscar equipamento disponível
    const equipment = await equipmentCollection.findOne({});
    if (!equipment) {
      logger.warn('❌ Nenhum equipamento encontrado. Execute seed-database.js primeiro.');
      await closeConnection();
      return;
    }

    const equipmentID = equipment.equipmentID;
    logger.info(`📦 Usando equipamento ID: ${equipmentID}`);

    // Criar localizações com dados de box
    const locations = [
      { 
        equipmentType: 1, 
        equipmentID: equipmentID,
        block: 1, 
        rack: 1, 
        drawer: 1, 
        box: 1, 
        wellPosition: null,
        description: 'Caixa 1 - Freezer Bloco 1 Prateleira 1 Gaveta 1'
      },
      { 
        equipmentType: 1, 
        equipmentID: equipmentID,
        block: 1, 
        rack: 1, 
        drawer: 1, 
        box: 2, 
        wellPosition: null,
        description: 'Caixa 2 - Freezer Bloco 1 Prateleira 1 Gaveta 1'
      },
      { 
        equipmentType: 1, 
        equipmentID: equipmentID,
        block: 1, 
        rack: 1, 
        drawer: 2, 
        box: 1, 
        wellPosition: null,
        description: 'Caixa 1 - Freezer Bloco 1 Prateleira 1 Gaveta 2'
      },
      { 
        equipmentType: 1, 
        equipmentID: equipmentID,
        block: 1, 
        rack: 1, 
        drawer: 2, 
        box: 2, 
        wellPosition: null,
        description: 'Caixa 2 - Freezer Bloco 1 Prateleira 1 Gaveta 2'
      },
      { 
        equipmentType: 1, 
        equipmentID: equipmentID,
        block: 1, 
        rack: 2, 
        drawer: 1, 
        box: 1, 
        wellPosition: null,
        description: 'Caixa 1 - Freezer Bloco 1 Prateleira 2 Gaveta 1'
      },
    ];

    let created = 0;
    let updated = 0;

    for (let i = 0; i < locations.length; i++) {
      const locationData = locations[i];
      const locationId = `LOC-${locationData.equipmentType}-${locationData.block}-${locationData.rack}-${locationData.drawer}-${locationData.box}-${i + 1}`;
      
      try {
        const existing = await locationsCollection.findOne({ _id: locationId });
        
        if (!existing) {
          // Criar nova localização
          const location = LocationModel.create(locationData);
          location._id = locationId;
          await locationsCollection.insertOne(location);
          logger.info(`✅ Localização criada: ${locationId}`);
          created++;
        } else {
          // Atualizar existing com dados de box se não tiver
          if (!existing.box || existing.box === 0 || existing.box === null) {
            await locationsCollection.updateOne(
              { _id: locationId },
              {
                $set: {
                  equipmentID: equipmentID,
                  block: locationData.block,
                  rack: locationData.rack,
                  drawer: locationData.drawer,
                  box: locationData.box,
                  description: locationData.description,
                  updatedAt: new Date()
                }
              }
            );
            logger.info(`🔄 Localização atualizada: ${locationId}`);
            updated++;
          } else {
            logger.info(`⏭️  Localização já existe e tem dados de box: ${locationId}`);
          }
        }
      } catch (err) {
        logger.error(`  ❌ Erro ao processar localização ${locationId}:`, err.message);
      }
    }

    logger.info(`\n✅ CONCLUÍDO - ${created} localizações criadas, ${updated} atualizadas`);

    // Exibir todas as localizações
    logger.info('\n📊 Localizações no banco:');
    const allLocations = await locationsCollection.find({}).toArray();
    allLocations.forEach(loc => {
      logger.info(`  - Box #${loc.box ?? 'N/A'}: Bloco${loc.block} Pratele${loc.rack} Gaveta${loc.drawer}`);
    });

    await closeConnection();
  } catch (error) {
    logger.error('❌ Erro ao seed localizações:', error.message);
    logger.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedLocationsWithBoxes();
}

module.exports = { seedLocationsWithBoxes };
