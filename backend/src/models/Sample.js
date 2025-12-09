/**
 * Modelo de validação e estrutura para Sample
 */
const { validateQualityMIABIS, validateQualityMIABISOrThrow } = require('../utils/qualityMIABISValidator');

class SampleModel {
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
    } else if (typeof data.quality !== 'number' || !Number.isInteger(data.quality)) {
      errors.push('quality deve ser um número inteiro');
    } else if (!validateQualityMIABIS(data.quality)) {
      errors.push('quality deve estar na escala MIABIS: 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada)');
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

    return {
      patientID: data.patientID,
      sampleID: data.sampleID || null,
      sampleType: data.sampleType,
      sampleOrigin: data.sampleOrigin,
      extractionProtocol: data.extractionProtocol || null,
      barcode: data.barcode || null, // Código de barras gerado automaticamente se não fornecido
      registrationDate: registerDate,
      registerDate: registerDate, // Mantém compatibilidade com ambos os campos
      withdrawalDate: data.withdrawalDate ? (data.withdrawalDate instanceof Date ? data.withdrawalDate : new Date(data.withdrawalDate)) : null,
      quantity: data.quantity || null, // Float (pode ser em diferentes unidades)
      unit: data.unit || 'µL', // Unidade de medida (µL, mL, L, mg, g, kg, unidades, etc.)
      quality: data.quality !== undefined && data.quality !== null ? data.quality : (data.qualityID !== undefined && data.qualityID !== null ? data.qualityID : null), // Int conforme escala MIABIS (0, 1, 2)
      locationID: data.locationID || null,
      linkedProject: data.linkedProject || null,
      withdrawalType: data.withdrawalType || null,
      withdrawalResponsible: data.withdrawalResponsible || null,
      sampleDestination: data.sampleDestination || null,
      currentStatus: data.currentStatus || 'Available', // Available, Withdrawn conforme dicionário
      // HL7 FHIR - Campos obrigatórios
      accessionNumber: data.accessionNumber || null, // Número de acesso único (FHIR)
      orderNumber: data.orderNumber || null, // Número do pedido/ordem (FHIR)
      receivedTime: receivedTime, // Tempo de recebimento (FHIR Specimen.receivedTime)
      processingStatus: processingStatus, // Status de processamento (FHIR)
      protocolApplied: data.protocolApplied || data.extractionProtocol || null, // Protocolo aplicado (FHIR)
      specimenCollection: data.specimenCollection || null, // Dados de coleta (FHIR Specimen.collection)
      linkedFiles: data.linkedFiles || [], // Arquivos vinculados (DocumentReference)
      qrCode: data.qrCode || null, // QRCode gerado automaticamente
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  static validateWithdrawalType(withdrawalType) {
    return ['Parcial', 'Total'].includes(withdrawalType);
  }

  static validateSampleStatus(status) {
    return ['Available', 'Withdrawn', 'Expired', 'Destroyed'].includes(status);
  }

  // Métodos de validação MIABIS conforme requisitos RF004
  static validateSampleType(sampleType) {
    if (!sampleType || typeof sampleType !== 'string') {
      return false;
    }
    const validTypes = [
      'Sangue', 'Urina', 'Saliva', 'Tecido', 'DNA', 'RNA',
      'Plasma', 'Soro', 'Líquido Cefalorraquidiano'
    ];
    return validTypes.includes(sampleType);
  }

  static validateSampleOrigin(sampleOrigin) {
    if (!sampleOrigin || typeof sampleOrigin !== 'string') {
      return false;
    }
    const validOrigins = ['Coleta', 'Transferência', 'Doação', 'Pesquisa'];
    return validOrigins.includes(sampleOrigin) || (sampleOrigin && sampleOrigin.trim().length >= 3);
  }

  static validateExtractionType(extractionProtocol) {
    if (!extractionProtocol || typeof extractionProtocol !== 'string') {
      return false;
    }
    const validProtocols = [
      'Protocolo A', 'Protocolo B', 'Protocolo C',
      'QIAGEN', 'Phenol-Chloroform', 'Automated'
    ];
    return validProtocols.includes(extractionProtocol) || (extractionProtocol && extractionProtocol.trim().length >= 3);
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
      throw new Error(`Erro ao buscar resultados: ${error.message}`);
    }
  }
}

module.exports = SampleModel;

