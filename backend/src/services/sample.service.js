const SampleModel = require('../models/Sample');
const SampleMovementModel = require('../models/SampleMovement');
const logger = require('../utils/logger');
const { validatePatientID } = require('../utils/patientAnonymization');
const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
const { generateUniqueSampleID } = require('../utils/sampleIDGenerator');

/**
 * Service de Amostras
 * RF004 - Cadastro de Amostra
 * RF006 - Retirada de Amostra
 * Implementa validação de ID de paciente conforme LGPD
 */
class SampleService {
  async createSample(db, sampleData, options = {}) {
    try {
      // RF004 - Validação completa
      const validation = SampleModel.validate(sampleData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }
      
      // Se for import, permite locationID null (será atribuído depois)
      const isImport = options.isImport === true;
      const samplesCollection = db.collection('amostras');

      // VALIDAÇÃO DE ID DE PACIENTE (LGPD)
      // O ID de paciente é obrigatório e deve existir no banco
      if (!sampleData.patientID) {
        throw new Error('ID de paciente é obrigatório para cadastrar amostra');
      }

      // Valida formato do patientID (8 dígitos)
      if (typeof sampleData.patientID !== 'string' || sampleData.patientID.length !== 8 || !/^\d{8}$/.test(sampleData.patientID)) {
        throw new Error('ID de paciente deve ser um ID anonimizado de 8 dígitos numéricos');
      }

      // Valida se o ID de paciente existe (sem expor dados sensíveis)
      const patientExists = await validatePatientID(db, sampleData.patientID, 'pacientes');
      if (!patientExists) {
        throw new Error(`ID de paciente ${sampleData.patientID} não encontrado. Verifique se o ID está correto.`);
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

      // Valida locationID: obrigatório para criação manual, opcional para import
      if (!isImport && (!sampleData.locationID || sampleData.locationID === null)) {
        throw new Error('locationID é obrigatório. A amostra deve estar vinculada a uma localização.');
      }
      
      // Se locationID foi fornecido, valida se existe
      if (sampleData.locationID !== undefined && sampleData.locationID !== null) {
        const locationsCollection = db.collection('locations');
        const location = await locationsCollection.findOne({ locationID: sampleData.locationID });
        if (!location) {
          throw new Error(`Localização ${sampleData.locationID} não encontrada. Verifique se a localização está cadastrada.`);
        }
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
        sampleData.barcode = await generateUniqueBarcode(db, 'amostras');
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
        sampleData.sampleID = await generateUniqueSampleID(db, 'amostras');
        logger.info(`ID único de amostra gerado automaticamente: ${sampleData.sampleID}`);
      } else {
        // Verifica se o sampleID fornecido já existe
        const existingSample = await samplesCollection.findOne({ sampleID: sampleData.sampleID });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o ID ${sampleData.sampleID}`);
        }
      }
      const sample = SampleModel.create(sampleData);

      const result = await samplesCollection.insertOne(sample);

      // Log sanitizado (apenas ID, sem dados sensíveis)
      logger.info('Amostra criada:', { 
        sampleID: result.insertedId,
        patientID: sample.patientID // Apenas ID, sem dados sensíveis
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
      const samplesCollection = db.collection('amostras');
      const movementsCollection = db.collection('sample_movements');
      
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

      await movementsCollection.insertOne(movement);

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
      const samplesCollection = db.collection('amostras');
      return await samplesCollection.findOne({ _id: sampleID });
    } catch (error) {
      logger.error('Erro ao buscar amostra:', error.message);
      throw error;
    }
  }

  async listSamples(db, filters = {}) {
    try {
      const samplesCollection = db.collection('amostras');
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
      const samplesCollection = db.collection('amostras');
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
      const samplesCollection = db.collection('amostras');
      const result = await samplesCollection.deleteOne({ _id: sampleID });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar amostra:', error.message);
      throw error;
    }
  }

  async getSampleByBarcode(db, barcode) {
    try {
      const samplesCollection = db.collection('amostras');
      const patientsCollection = db.collection('pacientes');
      
      // Garante que barcode seja string e normaliza (trim, uppercase para consistência)
      const barcodeStr = String(barcode).trim();
      logger.info(`Buscando amostra com código de barras: "${barcodeStr}" (tipo: ${typeof barcodeStr})`);
      
      // Tenta múltiplas estratégias de busca para garantir compatibilidade
      let sample = null;
      
      // 1. Busca exata (string)
      sample = await samplesCollection.findOne({ barcode: barcodeStr });
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

  async returnSample(db, sampleID, returnData, auditInfo = {}) {
    try {
      const samplesCollection = db.collection('amostras');
      const movementsCollection = db.collection('sample_movements');
      
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

      // Validação da condição
      const validConditions = Object.values(SampleMovementModel.RETURN_CONDITIONS);
      if (!returnData.condition || !validConditions.includes(returnData.condition)) {
        throw new Error('Condição da amostra é obrigatória (Íntegra, Parcialmente comprometida ou Inutilizada)');
      }

      // Observações obrigatórias se condição não for íntegra
      if (returnData.condition !== 'Íntegra' && (!returnData.observations || returnData.observations.trim() === '')) {
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
      if (returnData.condition !== 'Inutilizada') {
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

      await movementsCollection.insertOne(movement);

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
      const movementsCollection = db.collection('sample_movements');
      
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
}

module.exports = new SampleService();

