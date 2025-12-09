const SampleModel = require('../models/Sample');
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

      // Gera código de barras automaticamente se não fornecido
      if (!sampleData.barcode || (typeof sampleData.barcode === 'string' && sampleData.barcode.trim() === '')) {
        sampleData.barcode = await generateUniqueBarcode(db, 'amostras');
        logger.info(`Código de barras gerado automaticamente: ${sampleData.barcode}`);
      } else {
        // Converte para string se necessário
        sampleData.barcode = String(sampleData.barcode).trim();
        
        // RF004 - Verifica duplicidade por barcode (se fornecido)
        const samplesCollection = db.collection('amostras');
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
        const samplesCollection = db.collection('amostras');
        const existingSample = await samplesCollection.findOne({ sampleID: sampleData.sampleID });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o ID ${sampleData.sampleID}`);
        }
      }

      const samplesCollection = db.collection('amostras');
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

  async withdrawSample(db, sampleID, withdrawalData) {
    try {
      const samplesCollection = db.collection('amostras');
      const sample = await samplesCollection.findOne({ _id: sampleID });

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      if (sample.currentStatus !== 'Available') {
        throw new Error('Amostra não está disponível para retirada');
      }

      // Validações MIABIS
      if (!SampleModel.validateWithdrawalType(withdrawalData.withdrawalType)) {
        throw new Error('Tipo de retirada inválido conforme MIABIS');
      }

      if (!withdrawalData.withdrawalResponsible || !SampleModel.validateResponsibleName(withdrawalData.withdrawalResponsible)) {
        throw new Error('Nome do responsável deve conter nome e sobrenome (MIABIS)');
      }

      if (!withdrawalData.linkedProject || withdrawalData.linkedProject.trim() === '') {
        throw new Error('Projeto vinculado é obrigatório (RF006)');
      }

      const update = {
        currentStatus: withdrawalData.withdrawalType === 'Total' ? 'Withdrawn' : 'Available',
        withdrawalDate: new Date(),
        withdrawalType: withdrawalData.withdrawalType,
        withdrawalResponsible: withdrawalData.withdrawalResponsible,
        sampleDestination: withdrawalData.sampleDestination || withdrawalData.withdrawalDestination,
        linkedProject: withdrawalData.linkedProject || sample.linkedProject,
        updatedAt: new Date()
      };

      await samplesCollection.updateOne(
        { _id: sampleID },
        { $set: update }
      );

      return { success: true };
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
      updateData.updatedAt = new Date();
      
      const result = await samplesCollection.updateOne(
        { _id: sampleID },
        { $set: updateData }
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
          patient = {
            patientID: patient.patientID,
            patientName: patient.patientName,
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
      logger.error('Erro ao buscar resultados da amostra:', error.message);
      throw error;
    }
  }

  async returnSample(db, sampleID, returnData) {
    try {
      const samplesCollection = db.collection('amostras');
      const sample = await samplesCollection.findOne({ _id: sampleID });

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      if (sample.currentStatus !== 'Withdrawn') {
        throw new Error('Amostra não está retirada');
      }

      const update = {
        currentStatus: 'Available',
        withdrawalDate: null,
        withdrawalType: null,
        withdrawalResponsible: null,
        sampleDestination: null,
        updatedAt: new Date()
      };

      await samplesCollection.updateOne(
        { _id: sampleID },
        { $set: update }
      );

      return { success: true };
    } catch (error) {
      logger.error('Erro ao retornar amostra:', error.message);
      throw error;
    }
  }
}

module.exports = new SampleService();

