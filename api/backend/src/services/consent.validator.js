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

  async validateAccess(specimenId, requiredScope) {
    if (!this.db) {
      throw new Error('Banco de dados não inicializado para validação de consentimento');
    }

    if (!specimenId) {
      throw new Error('specimenId é obrigatório para validar consentimento');
    }

    const samplesCollection = await getCollection(this.db, 'Specimen');
    let sample = null;

    if (ObjectId.isValid(String(specimenId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(specimenId) });
    }

    if (!sample) {
      sample = await samplesCollection.findOne({ specimenId: String(specimenId) });
    }

    if (!sample) {
      sample = await samplesCollection.findOne({ barcode: String(specimenId) });
    }

    if (!sample) {
      throw new Error('Amostra não encontrada para validação de consentimento');
    }

    const participantId = sample.participantId;
    if (!participantId) {
      throw new Error('Amostra sem participantId para validação de consentimento');
    }

    const consentsCollection = await getCollection(this.db, 'consents');
    const consent = await consentsCollection
      .find({
        status: 'ACTIVE',
        $or: [
          { participantId: String(participantId) },
        ],
      })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();

    const activeConsent = consent[0];
    if (!activeConsent) {
      throw new Error('Consentimento inexistente ou revogado para este participante');
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
