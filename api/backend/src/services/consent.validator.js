const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');

class ConsentValidator {
  constructor() {
    this.db = null;
  }

  init(db) {
    this.db = db;
  }

  async validateAccess(sampleId, requiredScope) {
    if (!this.db) {
      throw new Error('Banco de dados não inicializado para validação de consentimento');
    }

    if (!sampleId) {
      throw new Error('sampleId é obrigatório para validar consentimento');
    }

    const samplesCollection = this.db.collection('amostras');
    let sample = null;

    try {
      sample = await samplesCollection.findOne({ _id: new ObjectId(sampleId) });
    } catch (error) {
      const parsedSampleId = Number(sampleId);
      if (!Number.isNaN(parsedSampleId)) {
        sample = await samplesCollection.findOne({ sampleID: parsedSampleId });
      }
    }

    if (!sample) {
      throw new Error('Amostra não encontrada para validação de consentimento');
    }

    const patientId = sample.patientID || sample.patientId;
    if (!patientId) {
      throw new Error('Amostra sem patientID para validação de consentimento');
    }

    const consentsCollection = this.db.collection('patient_consents');
    const consent = await consentsCollection
      .find({ patientId, status: 'ACTIVE' })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();

    const activeConsent = consent[0];
    if (!activeConsent) {
      throw new Error('Consentimento inexistente ou revogado para este paciente');
    }

    if (requiredScope && typeof requiredScope === 'string') {
      const responses = activeConsent.responses || {};
      if (responses[requiredScope] !== true) {
        throw new Error(`Consentimento não permite o escopo solicitado: ${requiredScope}`);
      }
    }

    return true;
  }
}

module.exports = new ConsentValidator();
