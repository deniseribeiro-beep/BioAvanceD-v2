const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');

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

    const samplesCollection = await getCollection(this.db, 'samples');
    let sample = null;

    if (ObjectId.isValid(String(sampleId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(sampleId) });
    }

    if (!sample) {
      const parsedSampleId = Number(sampleId);
      if (!Number.isNaN(parsedSampleId)) {
        sample = await samplesCollection.findOne({
          $or: [{ sampleID: parsedSampleId }, { sampleID: String(sampleId) }],
        });
      }
    }

    if (!sample) {
      sample = await samplesCollection.findOne({
        $or: [
          { sampleID: String(sampleId) },
          { sampleId: String(sampleId) },
          { barcode: String(sampleId) },
        ],
      });
    }

    if (!sample) {
      throw new Error('Amostra não encontrada para validação de consentimento');
    }

    const patientId = sample.patientID || sample.patientId;
    if (!patientId) {
      throw new Error('Amostra sem patientID para validação de consentimento');
    }

    const consentsCollection = await getCollection(this.db, 'consents');
    const consent = await consentsCollection
      .find({
        status: 'ACTIVE',
        $or: [
          { patientId: String(patientId) },
          { patientID: String(patientId) },
          { patientObjectId: String(patientId) },
        ],
      })
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
