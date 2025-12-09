require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');
const PolicyModel = require('../src/models/Policy');
const EquipmentModel = require('../src/models/Equipment');
const LocationModel = require('../src/models/Location');
const SensorModel = require('../src/models/Sensor');

/**
 * Script para popular o banco de dados com dados iniciais necessários
 */
async function seedDatabase() {
  try {
    logger.info('Iniciando seed do banco de dados...');

    const db = await connectDB();

    // ============================================
    // 1. POLÍTICAS DE TEMPERATURA
    // ============================================
    logger.info('Criando políticas de temperatura...');
    const policiesCollection = db.collection('policies');

    const policies = [
      {
        policyId: 1,
        minThreshold: -85,
        maxThreshold: -75,
        targetTemperature: -80,
        hysteresis: 1.0,
        alertDelayMin: 5,
        temperatureUnit: '°C',
        validFrom: new Date(),
        validTo: null,
        description: 'Política para Freezer -80°C'
      },
      {
        policyId: 2,
        minThreshold: -25,
        maxThreshold: -15,
        targetTemperature: -20,
        hysteresis: 1.0,
        alertDelayMin: 5,
        temperatureUnit: '°C',
        validFrom: new Date(),
        validTo: null,
        description: 'Política para Freezer -20°C'
      },
      {
        policyId: 3,
        minThreshold: 2,
        maxThreshold: 8,
        targetTemperature: 4,
        hysteresis: 0.5,
        alertDelayMin: 3,
        temperatureUnit: '°C',
        validFrom: new Date(),
        validTo: null,
        description: 'Política para Refrigerador 4°C'
      },
      {
        policyId: 4,
        minThreshold: -196,
        maxThreshold: -190,
        targetTemperature: -193,
        hysteresis: 2.0,
        alertDelayMin: 10,
        temperatureUnit: '°C',
        validFrom: new Date(),
        validTo: null,
        description: 'Política para Nitrogênio Líquido -193°C'
      }
    ];

    for (const policyData of policies) {
      const existing = await policiesCollection.findOne({ policyId: policyData.policyId });
      if (!existing) {
        const policy = PolicyModel.create(policyData);
        await policiesCollection.insertOne(policy);
        logger.info(`✅ Política ${policyData.policyId} criada: ${policyData.description}`);
      } else {
        logger.info(`⚠️  Política ${policyData.policyId} já existe, pulando...`);
      }
    }

    // ============================================
    // 2. EQUIPAMENTOS
    // ============================================
    logger.info('Criando equipamentos...');
    const equipmentCollection = db.collection('equipment');

    const equipments = [
      {
        equipmentID: 1,
        equipmentDescription: 'Freezer Ultra-Baixa Temperatura -80°C (Modelo A)'
      },
      {
        equipmentID: 2,
        equipmentDescription: 'Freezer Ultra-Baixa Temperatura -80°C (Modelo B)'
      },
      {
        equipmentID: 3,
        equipmentDescription: 'Freezer Convencional -20°C (Modelo C)'
      },
      {
        equipmentID: 4,
        equipmentDescription: 'Refrigerador 4°C (Modelo D)'
      },
      {
        equipmentID: 5,
        equipmentDescription: 'Tanque de Nitrogênio Líquido -193°C'
      }
    ];

    for (const equipmentData of equipments) {
      const existing = await equipmentCollection.findOne({ equipmentID: equipmentData.equipmentID });
      if (!existing) {
        const equipment = EquipmentModel.create(equipmentData);
        await equipmentCollection.insertOne(equipment);
        logger.info(`✅ Equipamento ${equipmentData.equipmentID} criado: ${equipmentData.equipmentDescription}`);
      } else {
        logger.info(`⚠️  Equipamento ${equipmentData.equipmentID} já existe, pulando...`);
      }
    }

    // ============================================
    // 3. LOCALIZAÇÕES
    // ============================================
    logger.info('Criando localizações...');
    const locationsCollection = db.collection('locations');

    const locations = [
      // Freezer -80°C #1
      { equipmentType: 1, block: 1, rack: 1, drawer: 1, box: 1, wellPosition: null },
      { equipmentType: 1, block: 1, rack: 1, drawer: 1, box: 2, wellPosition: null },
      { equipmentType: 1, block: 1, rack: 1, drawer: 2, box: 1, wellPosition: null },
      { equipmentType: 1, block: 1, rack: 2, drawer: 1, box: 1, wellPosition: null },
      
      // Freezer -80°C #2
      { equipmentType: 2, block: 1, rack: 1, drawer: 1, box: 1, wellPosition: null },
      { equipmentType: 2, block: 1, rack: 1, drawer: 1, box: 2, wellPosition: null },
      
      // Freezer -20°C
      { equipmentType: 3, block: 1, rack: 1, drawer: 1, box: 1, wellPosition: null },
      { equipmentType: 3, block: 1, rack: 1, drawer: 2, box: 1, wellPosition: null },
      
      // Refrigerador 4°C
      { equipmentType: 4, block: 1, rack: 1, drawer: 1, box: 1, wellPosition: null },
      { equipmentType: 4, block: 1, rack: 1, drawer: 1, box: 2, wellPosition: null },
      
      // Nitrogênio Líquido
      { equipmentType: 5, block: 1, rack: 1, drawer: null, box: null, wellPosition: 'A1' },
      { equipmentType: 5, block: 1, rack: 1, drawer: null, box: null, wellPosition: 'A2' },
      { equipmentType: 5, block: 1, rack: 1, drawer: null, box: null, wellPosition: 'B1' }
    ];

    const locationIds = [];
    for (let i = 0; i < locations.length; i++) {
      const locationData = locations[i];
      const locationId = `LOC-${locationData.equipmentType}-${locationData.block || 0}-${locationData.rack || 0}-${locationData.drawer || 0}-${locationData.box || 0}-${i + 1}`;
      
      const existing = await locationsCollection.findOne({ _id: locationId });
      if (!existing) {
        const location = LocationModel.create(locationData);
        location._id = locationId;
        await locationsCollection.insertOne(location);
        locationIds.push(locationId);
        logger.info(`✅ Localização ${locationId} criada`);
      } else {
        locationIds.push(locationId);
        logger.info(`⚠️  Localização ${locationId} já existe, pulando...`);
      }
    }

    // ============================================
    // 4. SENSORES
    // ============================================
    logger.info('Criando sensores...');
    const sensorsCollection = db.collection('sensors');

    const sensors = [
      // Sensores para Freezer -80°C #1
      {
        sensorId: 'SENSOR-001',
        sensorType: 'Temperature',
        sensorModel: 'DS18B20',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 dias atrás
        nextCalibration: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000), // 365 dias - 30 dias
        calibrationCertificate: 'CAL-2024-001',
        locationId: locationIds[0],
        policyId: 1
      },
      {
        sensorId: 'SENSOR-002',
        sensorType: 'Temperature',
        sensorModel: 'DS18B20',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        nextCalibration: new Date(Date.now() + 305 * 24 * 60 * 60 * 1000),
        calibrationCertificate: 'CAL-2024-002',
        locationId: locationIds[1],
        policyId: 1
      },
      
      // Sensores para Freezer -80°C #2
      {
        sensorId: 'SENSOR-003',
        sensorType: 'Temperature',
        sensorModel: 'PT100',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        nextCalibration: new Date(Date.now() + 320 * 24 * 60 * 60 * 1000),
        calibrationCertificate: 'CAL-2024-003',
        locationId: locationIds[4],
        policyId: 1
      },
      
      // Sensores para Freezer -20°C
      {
        sensorId: 'SENSOR-004',
        sensorType: 'Temperature',
        sensorModel: 'DS18B20',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        nextCalibration: new Date(Date.now() + 345 * 24 * 60 * 60 * 1000),
        calibrationCertificate: 'CAL-2024-004',
        locationId: locationIds[6],
        policyId: 2
      },
      
      // Sensores para Refrigerador 4°C
      {
        sensorId: 'SENSOR-005',
        sensorType: 'Temperature',
        sensorModel: 'DS18B20',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        nextCalibration: new Date(Date.now() + 350 * 24 * 60 * 60 * 1000),
        calibrationCertificate: 'CAL-2024-005',
        locationId: locationIds[9],
        policyId: 3
      },
      
      // Sensores para Nitrogênio Líquido
      {
        sensorId: 'SENSOR-006',
        sensorType: 'Temperature',
        sensorModel: 'PT100',
        maintenanceStatus: 'operational',
        lastCalibration: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        nextCalibration: new Date(Date.now() + 275 * 24 * 60 * 60 * 1000),
        calibrationCertificate: 'CAL-2024-006',
        locationId: locationIds[11],
        policyId: 4
      }
    ];

    for (const sensorData of sensors) {
      const existing = await sensorsCollection.findOne({ sensorId: sensorData.sensorId });
      if (!existing) {
        const sensor = SensorModel.create(sensorData);
        await sensorsCollection.insertOne(sensor);
        logger.info(`✅ Sensor ${sensorData.sensorId} criado`);
      } else {
        logger.info(`⚠️  Sensor ${sensorData.sensorId} já existe, pulando...`);
      }
    }

    // ============================================
    // 5. LOG INICIAL
    // ============================================
    logger.info('Criando log inicial...');
    const logsCollection = db.collection('logs');
    const existingSeedLog = await logsCollection.findOne({ 
      action: 'SEED_DATABASE',
      entity: 'System'
    });

    if (!existingSeedLog) {
      const seedLog = {
        logId: null,
        dateTime: new Date(),
        timestamp: new Date(),
        userId: 'system',
        userName: 'Sistema',
        action: 'SEED_DATABASE',
        entity: 'System',
        result: 'success',
        severity: 'info',
        source: 'system',
        ipSource: null,
        message: 'Banco de dados populado com dados iniciais: políticas, equipamentos, localizações e sensores',
        createdAt: new Date()
      };

      await logsCollection.insertOne(seedLog);
      logger.info('✅ Log de seed criado');
    }

    // ============================================
    // 6. UNIDADES DE MEDIDA
    // ============================================
    logger.info('Criando unidades de medida...');
    const unitsCollection = db.collection('measurementUnits');

    const units = [
      { unitID: 1, description: 'Microlitros (µL)', abbreviation: 'µL' },
      { unitID: 2, description: 'Mililitros (mL)', abbreviation: 'mL' },
      { unitID: 3, description: 'Gramas (g)', abbreviation: 'g' },
      { unitID: 4, description: 'Miligramas (mg)', abbreviation: 'mg' },
      { unitID: 5, description: 'Unidades', abbreviation: 'U' }
    ];

    for (const unitData of units) {
      const existing = await unitsCollection.findOne({ unitID: unitData.unitID });
      if (!existing) {
        const MeasurementUnitModel = require('../src/models/MeasurementUnit');
        const unit = MeasurementUnitModel.create(unitData);
        await unitsCollection.insertOne(unit);
        logger.info(`✅ Unidade de medida ${unitData.unitID} criada: ${unitData.description}`);
      } else {
        logger.info(`⚠️  Unidade de medida ${unitData.unitID} já existe, pulando...`);
      }
    }

    // ============================================
    // 7. DESCRIÇÕES DE QUALIDADE
    // ============================================
    logger.info('Criando descrições de qualidade...');
    const qualityCollection = db.collection('qualityDescriptions');

    const qualities = [
      { qualityID: 1, description: 'Excelente', qualityLevel: 'A' },
      { qualityID: 2, description: 'Boa', qualityLevel: 'B' },
      { qualityID: 3, description: 'Aceitável', qualityLevel: 'C' },
      { qualityID: 4, description: 'Degradada', qualityLevel: 'D' },
      { qualityID: 5, description: 'Inutilizável', qualityLevel: 'E' }
    ];

    for (const qualityData of qualities) {
      const existing = await qualityCollection.findOne({ qualityID: qualityData.qualityID });
      if (!existing) {
        const QualityDescriptionModel = require('../src/models/QualityDescription');
        const quality = QualityDescriptionModel.create(qualityData);
        await qualityCollection.insertOne(quality);
        logger.info(`✅ Descrição de qualidade ${qualityData.qualityID} criada: ${qualityData.description}`);
      } else {
        logger.info(`⚠️  Descrição de qualidade ${qualityData.qualityID} já existe, pulando...`);
      }
    }

    logger.info('');
    logger.info('✅ Seed do banco de dados concluído com sucesso!');
    logger.info('   - Políticas de temperatura: 4');
    logger.info('   - Equipamentos: 5');
    logger.info('   - Localizações: ' + locationIds.length);
    logger.info('   - Sensores: 6');
    logger.info('   - Unidades de medida: 5');
    logger.info('   - Descrições de qualidade: 5');
    logger.info('');
    logger.info('📊 Dados criados:');
    logger.info('   • Políticas: -80°C, -20°C, 4°C, -193°C');
    logger.info('   • Equipamentos: Freezers, Refrigerador, Nitrogênio');
    logger.info('   • Localizações: Múltiplas localizações por equipamento');
    logger.info('   • Sensores: Vinculados às localizações e políticas');
    logger.info('   • Unidades: µL, mL, g, mg, U');
    logger.info('   • Qualidades: A, B, C, D, E');

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao fazer seed do banco de dados:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executa o script
seedDatabase();

