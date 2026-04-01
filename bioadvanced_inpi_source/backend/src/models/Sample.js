
/**
 * Modelo de validação e estrutura para Sample
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { validateQualityMIABIS, validateQualityMIABISOrThrow } = require('../utils/qualityMIABISValidator');
const {
  SPECIMEN_TYPE_IDS,
  SAMPLE_ORIGIN_IDS,
  EXTRACTION_PROTOCOL_IDS,
} = require('../config/constants/specimen.constants');

// Definição básica do schema para Sample (ajuste conforme necessário)
const SampleSchema = new Schema({
  patientID: { type: String, required: true },
  sampleType: { type: String, required: true },
  sampleOrigin: { type: String, required: true },
  extractionProtocol: { type: String, required: true },
  barcode: { type: String },
  registrationDate: { type: Date },
  registerDate: { type: Date },
  withdrawalDate: { type: Date },
  quantity: { type: Number, required: true },
  unit: { type: String },
  quality: { type: String },
  locationID: { type: Number },
  location: { type: Object },
  linkedProject: { type: String, required: true },
  status: { type: String },
  currentStatus: { type: String },
  availableQuantity: { type: Number },
  originalQuantity: { type: Number },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'samples' });

// Registra o modelo apenas se ainda não estiver registrado (evita erro em hot reload)
const Sample = mongoose.models.Sample || mongoose.model('Sample', SampleSchema);

class SampleModel {
  static STATUS = {
    // Amostra pronta para uso em pesquisa/clínica
    AVAILABLE: 'AVAILABLE',
    // Amostra eticamente bloqueada - aguardando consentimento (TCLE)
    QUARANTINED: 'QUARANTINED',
    // Amostra parcialmente utilizada (volume retirado)
    PARTIAL: 'PARTIAL',
    // Amostra consumida totalmente
    DEPLETED: 'DEPLETED',
    // Amostra danificada/inutilizável
    UNAVAILABLE: 'UNAVAILABLE'
  };

  static validateLifecycleStatus(status) {
    return Object.values(this.STATUS).includes(status);
  }

  static computeStatus(initialVolume, currentVolume, currentStatus) {
    const init = Number(initialVolume ?? 0);
    const curr = Number(currentVolume ?? 0);

    if (curr <= 0) return this.STATUS.DEPLETED;
    if (currentStatus === this.STATUS.UNAVAILABLE) return this.STATUS.UNAVAILABLE;
    if (init > 0 && curr < init) return this.STATUS.PARTIAL;
    return this.STATUS.AVAILABLE;
  }

  static mapLifecycleToLegacy(status) {
    switch (status) {
      case this.STATUS.AVAILABLE:
        return 'Available';
      case this.STATUS.PARTIAL:
        return 'PartiallyWithdrawn';
      case this.STATUS.DEPLETED:
        return 'TotallyWithdrawn';
      case this.STATUS.UNAVAILABLE:
        return 'Unusable';
      default:
        return 'Available';
    }
  }

  static validate(data) {
    const errors = [];

    // RF004 - Campos obrigatórios
    if (!data.patientID) {
      errors.push('patientID é obrigatório');
    } else if (typeof data.patientID !== 'string' || data.patientID.length !== 8 || !/^\d{8}$/.test(data.patientID)) {
      errors.push('patientID deve ser um ID anonimizado de 8 dígitos numéricos');
    }

    if (!data.sampleType || typeof data.sampleType !== 'string') {
      errors.push('sampleType é obrigatório e deve ser string');
    } else if (!this.validateSampleType(data.sampleType)) {
      errors.push('sampleType inválido conforme MIABIS');
    }

    if (!data.sampleOrigin || typeof data.sampleOrigin !== 'string') {
      errors.push('sampleOrigin é obrigatório e deve ser string');
    } else if (!this.validateSampleOrigin(data.sampleOrigin)) {
      errors.push('sampleOrigin inválido conforme MIABIS');
    }

    if (!data.extractionProtocol || typeof data.extractionProtocol !== 'string') {
      errors.push('extractionProtocol é obrigatório e deve ser string');
    } else if (!this.validateExtractionType(data.extractionProtocol)) {
      errors.push('extractionProtocol inválido conforme MIABIS');
    }

    // Barcode é opcional - será gerado automaticamente se não fornecido
    if (data.barcode && typeof data.barcode !== 'string') {
      errors.push('barcode deve ser string');
    }

    if (!data.registerDate && !data.registrationDate) {
      errors.push('registerDate é obrigatório');
    }

    if (data.quantity === undefined || data.quantity === null) {
      errors.push('quantity é obrigatório');
    } else if (typeof data.quantity !== 'number' || data.quantity <= 0) {
      errors.push('quantity deve ser um número maior que zero (µL)');
    }

    if (data.quality === undefined || data.quality === null) {
      errors.push('quality é obrigatório');
    } else if (!validateQualityMIABIS(data.quality)) {
      errors.push('quality deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN');
    }

    if (!data.linkedProject || typeof data.linkedProject !== 'string' || data.linkedProject.trim() === '') {
      errors.push('linkedProject é obrigatório');
    }

    // locationID é opcional durante import, mas será validado no service se fornecido
    // A validação de obrigatoriedade é feita no sampleService.createSample para criação manual

    // Valida registrationDate (aceita Date ou string ISO)
    if (data.registrationDate) {
      if (!(data.registrationDate instanceof Date)) {
        if (typeof data.registrationDate === 'string') {
          const date = new Date(data.registrationDate);
          if (isNaN(date.getTime())) {
            errors.push('registrationDate deve ser uma data válida (Date ou string ISO)');
          }
        } else {
          errors.push('registrationDate deve ser Date ou string ISO');
        }
      }
    }

    // Valida withdrawalDate (aceita Date ou string ISO)
    if (data.withdrawalDate) {
      if (!(data.withdrawalDate instanceof Date)) {
        if (typeof data.withdrawalDate === 'string') {
          const date = new Date(data.withdrawalDate);
          if (isNaN(date.getTime())) {
            errors.push('withdrawalDate deve ser uma data válida (Date ou string ISO)');
          }
        } else {
          errors.push('withdrawalDate deve ser Date ou string ISO');
        }
      }
    }

    if (data.currentStatus && !this.validateSampleStatus(data.currentStatus)) {
      errors.push('currentStatus deve ser: Available, Withdrawn, Expired ou Destroyed');
    }

    if (data.status && !this.validateLifecycleStatus(data.status)) {
      errors.push('status deve ser: AVAILABLE, PARTIAL, DEPLETED ou UNAVAILABLE');
    }

    // Validar storageLocation se fornecido (opcional)
    if (data.storageLocation) {
      if (typeof data.storageLocation !== 'object') {
        errors.push('storageLocation deve ser um objeto com boxId e position');
      } else {
        if (data.storageLocation.boxId && typeof data.storageLocation.boxId !== 'string') {
          errors.push('storageLocation.boxId deve ser uma string (ObjectId)');
        }
        if (data.storageLocation.position && typeof data.storageLocation.position !== 'string') {
          errors.push('storageLocation.position deve ser uma string (ex: A1)');
        }
        // Validar formato de position se fornecido (ex: A1, B4, I9)
        if (data.storageLocation.position) {
          const posRegex = /^([A-Z])(\d+)$/;
          if (!posRegex.test(data.storageLocation.position)) {
            errors.push('storageLocation.position deve seguir formato: Letra+Número (ex: A1, B4)');
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    // RF004 - Garante que registerDate seja definido
    let registerDate;
    if (data.registerDate) {
      registerDate = data.registerDate instanceof Date ? data.registerDate : new Date(data.registerDate);
    } else if (data.registrationDate) {
      registerDate = data.registrationDate instanceof Date ? data.registrationDate : new Date(data.registrationDate);
    } else {
      registerDate = new Date(); // Padrão: hoje
    }

    // HL7 FHIR - Campos adicionais
    const receivedTime = data.receivedTime ? (data.receivedTime instanceof Date ? data.receivedTime : new Date(data.receivedTime)) : registerDate;
    const processingStatus = data.processingStatus || data.processing?.status || 'pending'; // pending, processing, completed, failed

    // Volumes e status de ciclo de vida
    const availableQuantity = data.availableQuantity !== undefined ? data.availableQuantity : data.quantity;
    const originalQuantity = data.originalQuantity || data.quantity;
    const lifecycleStatus = this.computeStatus(originalQuantity, availableQuantity, data.status);
    const legacyStatus = data.currentStatus || this.mapLifecycleToLegacy(lifecycleStatus);

    return {
      patientID: data.patientID,
      patientObjectId: data.patientObjectId || null,
      sampleID: data.sampleID || null,
      sampleType: data.sampleType,
      sampleOrigin: data.sampleOrigin,
      extractionProtocol: data.extractionProtocol || null,
      barcode: data.barcode || null, // Código de barras gerado automaticamente se não fornecido
      barcodeSymbologies: data.barcodeSymbologies || null,
      barcodeIndustrial: data.barcodeIndustrial || null,
      registrationDate: registerDate,
      registerDate: registerDate, // Mantém compatibilidade com ambos os campos
      withdrawalDate: data.withdrawalDate ? (data.withdrawalDate instanceof Date ? data.withdrawalDate : new Date(data.withdrawalDate)) : null,
      quantity: data.quantity || null, // Float (pode ser em diferentes unidades)
      unit: data.unit || 'µL', // Unidade de medida (µL, mL, L, mg, g, kg, unidades, etc.)
      quality: data.quality !== undefined && data.quality !== null ? String(data.quality) : (data.qualityID !== undefined && data.qualityID !== null ? String(data.qualityID) : null), // Id MIABIS canônico
      locationID: data.locationID || null,
      location: data.location || null,
      linkedProject: data.linkedProject || null,
      withdrawalType: data.withdrawalType || null,
      withdrawalResponsible: data.withdrawalResponsible || null,
      sampleDestination: data.sampleDestination || null,
      currentStatus: legacyStatus, // Legacy status textual
      // Controle de quantidade disponível (para retiradas parciais)
      availableQuantity,
      originalQuantity, // Quantidade original (nunca muda)
      status: lifecycleStatus,
      totalWithdrawn: data.totalWithdrawn || 0, // Total já retirado
      totalReturned: data.totalReturned || 0,   // Total já devolvido
      // HL7 FHIR - Campos obrigatórios
      accessionNumber: data.accessionNumber || null, // Número de acesso único (FHIR)
      orderNumber: data.orderNumber || null, // Número do pedido/ordem (FHIR)
      receivedTime: receivedTime, // Tempo de recebimento (FHIR Specimen.receivedTime)
      processingStatus: processingStatus, // Status de processamento (FHIR)
      protocolApplied: data.protocolApplied || data.extractionProtocol || null, // Protocolo aplicado (FHIR)
      specimenCollection: data.specimenCollection || null, // Dados de coleta (FHIR Specimen.collection)
      linkedFiles: data.linkedFiles || [], // Arquivos vinculados (DocumentReference)
      qrCode: data.qrCode || null, // QRCode gerado automaticamente
      // Nova armazenagem física (ISO 20387)
      storageLocation: data.storageLocation ? {
        boxId: data.storageLocation.boxId || null, // Referência para StorageBox._id
        position: data.storageLocation.position || null, // Coordenada ex: A1, B4
      } : {
        boxId: null,
        position: null,
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  static validateWithdrawalType(withdrawalType) {
    return ['Parcial', 'Total'].includes(withdrawalType);
  }

  static validateSampleStatus(status) {
    return ['Available', 'PartiallyWithdrawn', 'TotallyWithdrawn', 'Withdrawn', 'Expired', 'Destroyed', 'Unusable'].includes(status);
  }

  // Métodos de validação MIABIS conforme requisitos RF004
  static validateSampleType(sampleType) {
    if (!sampleType || typeof sampleType !== 'string') {
      return false;
    }
    return SPECIMEN_TYPE_IDS.includes(sampleType);
  }

  static validateSampleOrigin(sampleOrigin) {
    if (!sampleOrigin || typeof sampleOrigin !== 'string') {
      return false;
    }
    return SAMPLE_ORIGIN_IDS.includes(sampleOrigin);
  }

  static validateExtractionType(extractionProtocol) {
    if (!extractionProtocol || typeof extractionProtocol !== 'string') {
      return false;
    }
    return EXTRACTION_PROTOCOL_IDS.includes(extractionProtocol);
  }

  static validateWithdrawalType(withdrawalType) {
    return ['Parcial', 'Total'].includes(withdrawalType);
  }

  static validateResponsibleName(withdrawalResponsible) {
    if (!withdrawalResponsible || typeof withdrawalResponsible !== 'string') {
      return false;
    }
    const parts = withdrawalResponsible.trim().split(' ');
    return parts.length >= 2 && withdrawalResponsible.length >= 5;
  }

  // Método getResults() - retorna histórico de análises associadas
  static async getResults(db, sampleID) {
    try {
      const resultsCollection = db.collection('results');
      const results = await resultsCollection.find({ sampleID: sampleID }).toArray();
      return results;
    } catch (error) {
      throw new Error(`Erro ao buscar arquivos de analise: ${error.message}`);
    }
  }
}

module.exports = Sample;
module.exports.SampleModel = SampleModel;

