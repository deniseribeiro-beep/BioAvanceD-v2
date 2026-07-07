const { SampleModel } = require('../models/Sample');
const SampleMovementModel = require('../models/SampleMovement');
const logger = require('../utils/logger');
const { validatePatientID } = require('../utils/patientAnonymization');
const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
const {
  generateBarcodeSymbologies,
  generateIndustrialBarcodeArtifacts,
  parseScannedBarcode
} = require('../utils/barcodeSymbology');
const { generateUniqueSampleID } = require('../utils/sampleIDGenerator');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const fhirSyncService = require('./fhir-sync.service');
const { getCollection } = require('../utils/collectionResolver');

const LOCATION_REQUIRED_MESSAGE = 'Localização física obrigatória para cadastro de amostra';
const CRITICAL_SENSOR_STATUSES = ['maintenance', 'calibration', 'error', 'offline'];

function createSampleValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRequiredLocationID(rawLocationID) {
  if (rawLocationID === undefined || rawLocationID === null) {
    throw createSampleValidationError(LOCATION_REQUIRED_MESSAGE, 400);
  }

  const value = typeof rawLocationID === 'string' ? rawLocationID.trim() : rawLocationID;
  if (value === '') {
    throw createSampleValidationError(LOCATION_REQUIRED_MESSAGE, 400);
  }

  const normalizedLocationID = Number(value);
  if (!Number.isFinite(normalizedLocationID) || normalizedLocationID <= 0) {
    throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: locationID deve ser numérico válido`);
  }

  return normalizedLocationID;
}

function buildIdVariants(...ids) {
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    if (value === undefined || value === null || value === '') return;
    const key = `${typeof value}:${String(value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(value);
    }
  };

  for (const id of ids) {
    if (id === undefined || id === null || id === '') continue;
    add(id);
    add(String(id));

    const numeric = Number(id);
    if (Number.isFinite(numeric)) {
      add(numeric);
    }
  }

  return variants;
}

function isOperationalSensor(sensor) {
  const status = String(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus || '').trim().toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

/**
 * Service de Amostras
 * RF004 - Cadastro de Amostra
 * RF006 - Retirada de Amostra
 * Implementa validação de ID de paciente conforme LGPD
 */
class SampleService {
  async createSample(db, sampleData, options = {}) {
    try {
      const normalizedLocationID = normalizeRequiredLocationID(sampleData.locationID);
      sampleData.locationID = normalizedLocationID;

      // RF004 - Validação completa
      const validation = SampleModel.validate(sampleData);
      if (!validation.isValid) {
        let validationMessage = 'Dados da amostra inválidos conforme modelo MIABIS/BioAvanceD';
        if (Array.isArray(validation.errors) && validation.errors.length > 0) {
          validationMessage = validation.errors.join(', ');
        } else if (typeof validation.errors === 'string' && validation.errors.trim()) {
          validationMessage = validation.errors.trim();
        }

        const validationError = new Error(validationMessage);
        validationError.statusCode = 422;
        throw validationError;
      }
      
      const samplesCollection = await getCollection(db, 'samples');

      // VALIDAÇÃO DE ID DE PACIENTE (LGPD)
      // O ID de paciente é obrigatório e deve existir no banco
      if (!sampleData.patientID) {
        const patientIdError = new Error('ID de paciente é obrigatório para cadastrar amostra');
        patientIdError.statusCode = 400;
        throw patientIdError;
      }

      // Valida formato do patientID (8 dígitos)
      if (typeof sampleData.patientID !== 'string' || sampleData.patientID.length !== 8 || !/^\d{8}$/.test(sampleData.patientID)) {
        const patientIdFormatError = new Error('ID de paciente deve ser um ID anonimizado de 8 dígitos numéricos');
        patientIdFormatError.statusCode = 400;
        throw patientIdFormatError;
      }

      // Valida se o ID de paciente existe (sem expor dados sensíveis)
      const patientExists = await validatePatientID(db, sampleData.patientID);
      if (!patientExists) {
        const notFoundError = new Error(`ID de paciente ${sampleData.patientID} não encontrado. Verifique se o ID está correto.`);
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      // RF004 - Validações MIABIS (já validadas no modelo, mas reforça aqui)
      if (sampleData.sampleType && !SampleModel.validateSampleType(sampleData.sampleType)) {
        throw new Error('Tipo de amostra inválido conforme MIABIS');
      }

      if (sampleData.sampleOrigin && !SampleModel.validateSampleOrigin(sampleData.sampleOrigin)) {
        throw new Error('Origem da amostra inválida conforme MIABIS');
      }

      if (sampleData.extractionProtocol && !SampleModel.validateExtractionType(sampleData.extractionProtocol)) {
        throw new Error('Protocolo de extração inválido conforme MIABIS');
      }

      if (sampleData.currentStatus && !SampleModel.validateSampleStatus(sampleData.currentStatus)) {
        throw new Error('Status da amostra inválido conforme MIABIS');
      }

      // RF004 - Validação de quantidade
      if (sampleData.quantity === undefined || sampleData.quantity === null || typeof sampleData.quantity !== 'number' || sampleData.quantity <= 0) {
        throw new Error('Quantidade deve ser um número maior que zero (µL)');
      }

      const locationsCollection = db.collection('locations');
      const location = await locationsCollection.findOne({
        locationID: { $in: buildIdVariants(sampleData.locationID) }
      });
      if (!location) {
        throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: locationID inválido ou não cadastrado`);
      }

      if (location.equipmentID !== undefined && location.equipmentID !== null && location.equipmentID !== '') {
        const equipmentCollection = db.collection('equipment');
        const equipment = await equipmentCollection.findOne({
          equipmentID: { $in: buildIdVariants(location.equipmentID) }
        });

        if (!equipment) {
          throw createSampleValidationError('Equipamento vinculado à localização física não está cadastrado');
        }
      }

      const locationVariants = buildIdVariants(location.locationID, sampleData.locationID, location._id?.toString());
      const sensorLocationQuery = {
        $or: [
          { locationId: { $in: locationVariants } },
          { locationID: { $in: locationVariants } }
        ]
      };
      const sensorsCollection = db.collection('sensors');
      const operationalSensor = await sensorsCollection.findOne(sensorLocationQuery);

      if (!operationalSensor || !isOperationalSensor(operationalSensor)) {
        const statusValue = String(operationalSensor?.status || operationalSensor?.maintenanceStatus || operationalSensor?.operationalStatus || '').trim();
        const statusMessage = statusValue
          ? ` Sensor atual está em status ${statusValue}.`
          : '';
        throw createSampleValidationError(`Localização física sem sensor operacional associado.${statusMessage}`);
      }

      // Valida conflito físico de localização (freezer/rack/box/position)
      const hasLocationDetails = sampleData.location &&
        sampleData.location.freezer !== undefined &&
        sampleData.location.rack !== undefined &&
        sampleData.location.box !== undefined &&
        sampleData.location.position !== undefined;

      if (hasLocationDetails) {
        const conflict = await samplesCollection.findOne({
          'location.freezer': sampleData.location.freezer,
          'location.rack': sampleData.location.rack,
          'location.box': sampleData.location.box,
          'location.position': sampleData.location.position,
          'location.status': 'Occupied'
        });

        if (conflict) {
          const err = new Error(`Posição [${sampleData.location.position}] já ocupada pela amostra [${conflict.sampleID || conflict._id?.toString()}]`);
          err.status = 409;
          throw err;
        }

        // Marca a nova alocação como ocupada
        sampleData.location.status = 'Occupied';
      }

      // Gera código de barras automaticamente se não fornecido
      if (!sampleData.barcode || (typeof sampleData.barcode === 'string' && sampleData.barcode.trim() === '')) {
        sampleData.barcode = await generateUniqueBarcode(db, 'samples');
        logger.info(`Código de barras gerado automaticamente: ${sampleData.barcode}`);
      } else {
        // Converte para string se necessário
        sampleData.barcode = String(sampleData.barcode).trim();
        
        // RF004 - Verifica duplicidade por barcode (se fornecido)
        const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o código de barras ${sampleData.barcode}`);
        }
      }

      // Gera ID único para a amostra
      if (!sampleData.sampleID) {
        sampleData.sampleID = await generateUniqueSampleID(db, 'samples');
        logger.info(`ID único de amostra gerado automaticamente: ${sampleData.sampleID}`);
      } else {
        // Verifica se o sampleID fornecido já existe
        const existingSample = await samplesCollection.findOne({ sampleID: sampleData.sampleID });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o ID ${sampleData.sampleID}`);
        }
      }

      sampleData.barcodeSymbologies = generateBarcodeSymbologies(sampleData.barcode);
      sampleData.barcodeIndustrial = await generateIndustrialBarcodeArtifacts(sampleData.barcode, {
        includePayload: false
      });

      const sample = SampleModel.create(sampleData);

      const result = await samplesCollection.insertOne(sample);

      const movementsCollection = await getCollection(db, 'sampleMovements');
      const createdQuantity = Number(sample.availableQuantity ?? sample.quantity ?? 0);
      const createMovementID = await SampleMovementModel.generateMovementID(db);

      try {
        await appendMovementWithHashChain(movementsCollection, SampleMovementModel.create({
          movementID: createMovementID,
          sampleID: result.insertedId.toString(),
          barcode: sample.barcode,
          type: 'create',
          quantity: createdQuantity,
          unit: sample.unit || 'µL',
          responsible: options?.auditInfo?.userName || options?.auditInfo?.actorName || 'SYSTEM',
          destination: sample.locationID ? `location:${sample.locationID}` : null,
          purpose: 'sample_birth',
          linkedProject: sample.linkedProject || null,
          observations: options?.auditInfo?.notes || null,
          userId: options?.auditInfo?.userId || null,
          userName: options?.auditInfo?.userName || null,
          userRole: options?.auditInfo?.userRole || null,
          ipAddress: options?.auditInfo?.ipAddress || null,
          userAgent: options?.auditInfo?.userAgent || null,
          previousQuantity: 0,
          newQuantity: createdQuantity
        }));
      } catch (ledgerError) {
        await samplesCollection.deleteOne({ _id: result.insertedId });
        throw new Error(`Falha ao registrar cadeia de custódia no nascimento da amostra: ${ledgerError.message || ledgerError}`);
      }

      // Log sanitizado (apenas ID, sem dados sensíveis)
      logger.info('Amostra criada:', { 
        sampleID: result.insertedId,
        patientID: sample.patientID // Apenas ID, sem dados sensíveis
      });

      await fhirSyncService.upsertSampleFromLegacy(db, {
        _id: result.insertedId,
        ...sample
      });

      return {
        _id: result.insertedId,
        ...sample
      };
    } catch (error) {
      logger.error('Erro ao criar amostra:', error.message);
      throw error;
    }
  }

  async withdrawSample(db, sampleID, withdrawalData, auditInfo = {}) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const movementsCollection = await getCollection(db, 'sampleMovements');
      
      // Busca a amostra (suporta ObjectId ou barcode)
      let sample = await samplesCollection.findOne({ _id: sampleID });
      
      if (!sample) {
        // Tenta buscar por barcode se não encontrou por ID
        if (typeof sampleID === 'string' && !sampleID.match(/^[0-9a-fA-F]{24}$/)) {
          const result = await this.getSampleByBarcode(db, sampleID);
          sample = result.sample;
        }
      }

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      // Validações de status
      const invalidStatuses = ['TotallyWithdrawn', 'Destroyed', 'Unusable', 'Expired'];
      if (invalidStatuses.includes(sample.currentStatus)) {
        throw new Error(`Amostra não está disponível para retirada (Status: ${sample.currentStatus})`);
      }

      // Validações MIABIS
      if (!SampleModel.validateWithdrawalType(withdrawalData.withdrawalType)) {
        throw new Error('Tipo de retirada inválido. Deve ser: Parcial ou Total');
      }

      if (!withdrawalData.withdrawalResponsible || !SampleModel.validateResponsibleName(withdrawalData.withdrawalResponsible)) {
        throw new Error('Nome do responsável deve conter nome e sobrenome');
      }

      if (!withdrawalData.linkedProject || withdrawalData.linkedProject.trim() === '') {
        throw new Error('Projeto vinculado é obrigatório');
      }

      // Calcular quantidade disponível atual
      const availableQty = sample.availableQuantity !== undefined 
        ? sample.availableQuantity 
        : sample.quantity;
      
      // Determinar quantidade a retirar
      let withdrawQty;
      if (withdrawalData.withdrawalType === 'Total') {
        withdrawQty = availableQty;
      } else {
        // Retirada parcial - quantidade obrigatória
        withdrawQty = parseFloat(withdrawalData.withdrawalQuantity || withdrawalData.quantity);
        if (!withdrawQty || withdrawQty <= 0) {
          throw new Error('Quantidade a retirar é obrigatória para retirada parcial');
        }
        if (withdrawQty > availableQty) {
          throw new Error(`Quantidade indisponível. Disponível: ${availableQty} ${sample.unit || 'µL'}`);
        }
      }

      // Calcular novo saldo
      const newAvailableQty = availableQty - withdrawQty;
      const totalWithdrawn = (sample.totalWithdrawn || 0) + withdrawQty;

      const lifecycleStatus = SampleModel.computeStatus(
        sample.originalQuantity || sample.quantity,
        newAvailableQty,
        sample.status
      );
      const legacyStatus = SampleModel.mapLifecycleToLegacy(lifecycleStatus);

      // Registrar movimentação no ledger (imutável)
      const movementID = await SampleMovementModel.generateMovementID(db);
      const movement = SampleMovementModel.create({
        movementID,
        sampleID: sample._id.toString(),
        barcode: sample.barcode,
        type: 'withdraw',
        quantity: withdrawQty,
        unit: sample.unit || 'µL',
        responsible: withdrawalData.withdrawalResponsible,
        destination: withdrawalData.sampleDestination || withdrawalData.withdrawalDestination,
        purpose: withdrawalData.purpose || withdrawalData.justification,
        linkedProject: withdrawalData.linkedProject || sample.linkedProject,
        observations: withdrawalData.observations || withdrawalData.notes,
        userId: auditInfo.userId || null,
        userName: auditInfo.userName || null,
        userRole: auditInfo.userRole || null,
        ipAddress: auditInfo.ipAddress || null,
        userAgent: auditInfo.userAgent || null,
        previousQuantity: availableQty,
        newQuantity: newAvailableQty
      });

      await appendMovementWithHashChain(movementsCollection, movement);

      // Atualizar amostra
      const update = {
        currentStatus: legacyStatus,
        availableQuantity: newAvailableQty,
        totalWithdrawn: totalWithdrawn,
        withdrawalDate: new Date(),
        withdrawalType: withdrawalData.withdrawalType,
        withdrawalResponsible: withdrawalData.withdrawalResponsible,
        sampleDestination: withdrawalData.sampleDestination || withdrawalData.withdrawalDestination,
        linkedProject: withdrawalData.linkedProject || sample.linkedProject,
        lastWithdrawalID: movementID,
        status: lifecycleStatus,
        updatedAt: new Date()
      };

      await samplesCollection.updateOne(
        { _id: sample._id },
        { $set: update }
      );

      logger.info(`Retirada registrada: Sample ${sample.barcode || sample._id}, Qtd: ${withdrawQty}, Novo saldo: ${newAvailableQty}`);

      return { 
        success: true, 
        movementID,
        withdrawnQuantity: withdrawQty,
        remainingQuantity: newAvailableQty,
        newStatus: lifecycleStatus
      };
    } catch (error) {
      logger.error('Erro ao retirar amostra:', error.message);
      throw error;
    }
  }

  async getSample(db, sampleID) {
    try {
      const sampleFromFhir = await fhirSyncService.getSampleFhirFirst(db, sampleID);
      if (sampleFromFhir) {
        return sampleFromFhir;
      }

      const samplesCollection = await getCollection(db, 'samples');
      return await samplesCollection.findOne({ _id: sampleID });
    } catch (error) {
      logger.error('Erro ao buscar amostra:', error.message);
      throw error;
    }
  }

  async listSamples(db, filters = {}) {
    try {
      const listFromFhir = await fhirSyncService.listSamplesFhirFirst(db, filters);
      if (listFromFhir) {
        return listFromFhir;
      }

      const samplesCollection = await getCollection(db, 'samples');
      const query = {};

      if (filters.patientID) {
        query.patientID = filters.patientID;
      }

      if (filters.currentStatus) {
        query.currentStatus = filters.currentStatus;
      }

      if (filters.sampleType) {
        query.sampleType = filters.sampleType;
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const samples = await samplesCollection
        .find(query)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await samplesCollection.countDocuments(query);

      return { samples, total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar amostras:', error.message);
      throw error;
    }
  }

  async updateSample(db, sampleID, updateData) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const existing = await samplesCollection.findOne({ _id: sampleID });
      if (!existing) {
        return null;
      }

      const nextAvailable = updateData.availableQuantity !== undefined
        ? updateData.availableQuantity
        : existing.availableQuantity ?? existing.quantity;
      const nextOriginal = updateData.originalQuantity !== undefined
        ? updateData.originalQuantity
        : existing.originalQuantity ?? existing.quantity;

      const lifecycleStatus = SampleModel.computeStatus(
        nextOriginal,
        nextAvailable,
        updateData.status || existing.status
      );

      const payload = {
        ...updateData,
        status: lifecycleStatus,
        currentStatus: SampleModel.mapLifecycleToLegacy(lifecycleStatus),
        updatedAt: new Date()
      };
      
      const result = await samplesCollection.updateOne(
        { _id: sampleID },
        { $set: payload }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      return await samplesCollection.findOne({ _id: sampleID });
    } catch (error) {
      logger.error('Erro ao atualizar amostra:', error.message);
      throw error;
    }
  }

  async deleteSample(db, sampleID) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const result = await samplesCollection.deleteOne({ _id: sampleID });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar amostra:', error.message);
      throw error;
    }
  }

  async getSampleByBarcode(db, barcode) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const patientsCollection = await getCollection(db, 'patients');
      
      const parsedBarcode = parseScannedBarcode(barcode);
      const barcodeStr = parsedBarcode.normalizedValue;
      logger.info(`Buscando amostra com código de barras: "${barcodeStr}" (simbologia: ${parsedBarcode.scannerSymbology})`);
      
      // Tenta múltiplas estratégias de busca para garantir compatibilidade
      let sample = null;

      sample = await fhirSyncService.getSampleByBarcodeFhirFirst(db, barcodeStr);
      if (sample) {
        logger.info(`Amostra encontrada (FHIR-first): ${sample._id}, barcode: ${sample.barcode}`);
      }
      
      // 1. Busca exata (string)
      if (!sample) {
        sample = await samplesCollection.findOne({ barcode: barcodeStr });
      }
      if (sample) {
        logger.info(`Amostra encontrada (busca exata): ${sample._id}, barcode: ${sample.barcode}`);
      }
      
      // 2. Se não encontrou, tenta case-insensitive (normaliza para uppercase)
      if (!sample) {
        const barcodeUpper = barcodeStr.toUpperCase();
        sample = await samplesCollection.findOne({ 
          $or: [
            { barcode: barcodeUpper },
            { barcode: barcodeStr }
          ]
        });
        if (sample) {
          logger.info(`Amostra encontrada (case-insensitive): ${sample._id}, barcode: ${sample.barcode}`);
        }
      }
      
      // 3. Se não encontrou e é formato numérico, tenta como número (compatibilidade com dados antigos)
      if (!sample && /^\d+$/.test(barcodeStr)) {
        const barcodeNum = parseInt(barcodeStr, 10);
        if (!isNaN(barcodeNum)) {
          sample = await samplesCollection.findOne({ barcode: barcodeNum });
          if (sample) {
            logger.info(`Amostra encontrada (como número): ${sample._id}, barcode: ${sample.barcode}`);
          }
        }
      }
      
      // 4. Última tentativa: busca por regex (case-insensitive) para casos com formatação diferente
      if (!sample) {
        // Escapa caracteres especiais do regex
        const escapedBarcode = barcodeStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = new RegExp(`^${escapedBarcode}$`, 'i');
        sample = await samplesCollection.findOne({ barcode: { $regex: regexPattern } });
        if (sample) {
          logger.info(`Amostra encontrada (regex): ${sample._id}, barcode: ${sample.barcode}`);
        }
      }
      
      if (!sample) {
        // Log de debug: lista alguns códigos de barras existentes para comparação
        const sampleCount = await samplesCollection.countDocuments({});
        const sampleExamples = await samplesCollection.find({ barcode: { $exists: true, $ne: null } })
          .limit(5)
          .project({ barcode: 1, _id: 0 })
          .toArray();
        logger.warn(`Amostra não encontrada com código de barras: "${barcodeStr}". Total de amostras: ${sampleCount}. Exemplos de barcodes: ${JSON.stringify(sampleExamples.map(s => s.barcode))}`);
        return { sample: null, patient: null };
      }
      let patient = null;
      if (sample.patientID) {
        patient = await patientsCollection.findOne({ patientID: sample.patientID });
        if (patient) {
          // LGPD: Anonimizar nome do paciente - mostrar apenas iniciais
          const anonymizeName = (name) => {
            if (!name) return '***';
            const parts = name.trim().split(' ');
            if (parts.length === 1) return parts[0].charAt(0) + '***';
            return parts[0].charAt(0) + '. ' + parts[parts.length - 1].charAt(0) + '.';
          };
          patient = {
            patientID: patient.patientID,
            patientName: anonymizeName(patient.patientName),
            recordNumber: patient.recordNumber
          };
        }
      }

      return { sample, patient };
    } catch (error) {
      logger.error('Erro ao buscar amostra por código de barras:', error.message);
      throw error;
    }
  }

  async getSampleResults(db, sampleID) {
    try {
      const resultsCollection = db.collection('results');
      const sample = await this.getSample(db, sampleID);
      
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const results = await resultsCollection.find({ sampleID: sample.sampleID }).toArray();
      return results;
    } catch (error) {
      logger.error('Erro ao buscar arquivos de analise da amostra:', error.message);
      throw error;
    }
  }

  async getBarcodeIndustrialAssets(barcodeValue, options = {}) {
    const parsedBarcode = parseScannedBarcode(barcodeValue);
    if (!parsedBarcode.isValid) {
      throw new Error('Código de barras inválido para renderização industrial');
    }

    return generateIndustrialBarcodeArtifacts(parsedBarcode.normalizedValue, {
      includePayload: options.includePayload !== false
    });
  }

  async returnSample(db, sampleID, returnData, auditInfo = {}) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const movementsCollection = await getCollection(db, 'sampleMovements');
      
      // Busca a amostra (suporta ObjectId ou barcode)
      let sample = await samplesCollection.findOne({ _id: sampleID });
      
      if (!sample) {
        // Tenta buscar por barcode se não encontrou por ID
        if (typeof sampleID === 'string' && !sampleID.match(/^[0-9a-fA-F]{24}$/)) {
          const result = await this.getSampleByBarcode(db, sampleID);
          sample = result.sample;
        }
      }

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      // Validação: só pode devolver se houver quantidade retirada
      const totalWithdrawn = sample.totalWithdrawn || 0;
      const totalReturned = sample.totalReturned || 0;
      const pendingReturn = totalWithdrawn - totalReturned;

      if (pendingReturn <= 0) {
        throw new Error('Não há quantidade pendente de devolução para esta amostra');
      }

      // Validação do responsável
      if (!returnData.returnResponsible || returnData.returnResponsible.trim().length < 3) {
        throw new Error('Responsável pela devolução é obrigatório');
      }

      // Validação da condição (normaliza aliases PT-BR antes de validar)
      const normalizedCondition = SampleMovementModel.normalizeReturnCondition(returnData.condition);
      const validConditions = Object.values(SampleMovementModel.RETURN_CONDITIONS);
      if (!returnData.condition || !validConditions.includes(normalizedCondition)) {
        throw new Error('Condição da amostra é obrigatória (Íntegra, Parcialmente comprometida ou Inutilizada)');
      }
      returnData.condition = normalizedCondition;

      // Observações obrigatórias se condição não for íntegra
      if (returnData.condition !== SampleMovementModel.RETURN_CONDITIONS.INTACT && (!returnData.observations || returnData.observations.trim() === '')) {
        throw new Error('Observações são obrigatórias quando a condição não é Íntegra');
      }

      // Determinar quantidade a devolver
      let returnQty;
      if (returnData.returnType === 'Total') {
        returnQty = pendingReturn;
      } else {
        returnQty = parseFloat(returnData.returnQuantity || returnData.quantity);
        if (!returnQty || returnQty <= 0) {
          throw new Error('Quantidade a devolver é obrigatória');
        }
        if (returnQty > pendingReturn) {
          throw new Error(`Quantidade excede o pendente de devolução. Pendente: ${pendingReturn} ${sample.unit || 'µL'}`);
        }
      }

      // Calcular novos saldos
      let newAvailableQty = (sample.availableQuantity || 0);
      let newTotalReturned = totalReturned + returnQty;
      
      // Se condição é inutilizada, a quantidade não retorna ao estoque
      if (returnData.condition !== SampleMovementModel.RETURN_CONDITIONS.UNUSABLE) {
        newAvailableQty += returnQty;
      }

      const lifecycleStatus = SampleModel.computeStatus(
        sample.originalQuantity || sample.quantity,
        newAvailableQty,
        sample.status
      );
      const legacyStatus = SampleModel.mapLifecycleToLegacy(lifecycleStatus);

      // Registrar movimentação no ledger (imutável)
      const movementID = await SampleMovementModel.generateMovementID(db);
      const movement = SampleMovementModel.create({
        movementID,
        sampleID: sample._id.toString(),
        barcode: sample.barcode,
        type: 'return',
        quantity: returnQty,
        unit: sample.unit || 'µL',
        responsible: returnData.returnResponsible,
        condition: returnData.condition,
        linkedProject: returnData.linkedProject || sample.linkedProject,
        observations: returnData.observations || returnData.notes,
        relatedWithdrawalID: sample.lastWithdrawalID || null,
        userId: auditInfo.userId || null,
        userName: auditInfo.userName || null,
        userRole: auditInfo.userRole || null,
        ipAddress: auditInfo.ipAddress || null,
        userAgent: auditInfo.userAgent || null,
        previousQuantity: sample.availableQuantity || 0,
        newQuantity: newAvailableQty
      });

      await appendMovementWithHashChain(movementsCollection, movement);

      // Atualizar amostra
      const update = {
        currentStatus: legacyStatus,
        availableQuantity: newAvailableQty,
        totalReturned: newTotalReturned,
        status: lifecycleStatus,
        updatedAt: new Date()
      };

      // Limpar campos de retirada se voltou ao estado disponível
      if (legacyStatus === 'Available') {
        update.withdrawalDate = null;
        update.withdrawalType = null;
        update.withdrawalResponsible = null;
        update.sampleDestination = null;
      }

      await samplesCollection.updateOne(
        { _id: sample._id },
        { $set: update }
      );

      logger.info(`Devolução registrada: Sample ${sample.barcode || sample._id}, Qtd: ${returnQty}, Condição: ${returnData.condition}, Novo saldo: ${newAvailableQty}`);

      return { 
        success: true, 
        movementID,
        returnedQuantity: returnQty,
        condition: returnData.condition,
        newAvailableQuantity: newAvailableQty,
        newStatus: lifecycleStatus
      };
    } catch (error) {
      logger.error('Erro ao retornar amostra:', error.message);
      throw error;
    }
  }

  /**
   * Obtém histórico de movimentações de uma amostra
   */
  async getSampleMovements(db, sampleID) {
    try {
      const movementsCollection = await getCollection(db, 'sampleMovements');
      
      // Suporta busca por ObjectId ou string de ID
      const sampleIDStr = sampleID.toString ? sampleID.toString() : sampleID;
      
      const movements = await movementsCollection
        .find({ 
          $or: [
            { sampleID: sampleIDStr },
            { barcode: sampleIDStr }
          ]
        })
        .sort({ timestamp: -1 })
        .toArray();

      return movements;
    } catch (error) {
      logger.error('Erro ao buscar movimentações:', error.message);
      throw error;
    }
  }

  /**
   * Garante que amostras com status QUARANTINED não sejam retornadas para pesquisadores.
   */
  async findAvailableSamplesForResearch(db, query = {}) {
    const samplesCollection = await getCollection(db, 'samples');
    // Garante que só retorna amostras AVAILABLE
    const finalQuery = { ...query, currentStatus: 'AVAILABLE' };
    return samplesCollection.find(finalQuery).toArray();
  }
}

module.exports = new SampleService();

