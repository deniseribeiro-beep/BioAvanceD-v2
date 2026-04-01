const logger = require('../utils/logger');
const BiomarkerObservationModel = require('../models/BiomarkerObservation');
const { encryptValue, decryptValue } = require('../utils/fieldEncryption');
const { getCollection } = require('../utils/collectionResolver');

const indexedObservationCollections = new Set();

class BiomarkerObservationService {
  async ensureIndexes(collection, collectionName) {
    if (!collection || !collectionName || indexedObservationCollections.has(collectionName)) return;

    const indexDefinitions = [
      [{ patientID: 1, biomarkerType: 1, collectedAt: -1 }, { name: 'biomarker_obs_patient_type_collected_idx_v1' }],
      [{ patientID: 1, collectedAt: -1 }, { name: 'biomarker_obs_patient_collected_idx_v1' }],
      [{ biomarkerType: 1, collectedAt: -1 }, { name: 'biomarker_obs_type_collected_idx_v1' }],
      [{ status: 1, collectedAt: -1 }, { name: 'biomarker_obs_status_collected_idx_v1' }],
      [{ idempotencyKey: 1 }, { name: 'biomarker_obs_idempotency_unique_v1', unique: true }]
    ];

    for (const [keys, options] of indexDefinitions) {
      try {
        await collection.createIndex(keys, options);
      } catch (error) {
        logger.warn(`Não foi possível criar índice ${options.name} em ${collectionName}: ${error.message}`);
      }
    }

    indexedObservationCollections.add(collectionName);
  }

  async getObservationsCollection(db) {
    const collection = await getCollection(db, 'biomarkerObservations');
    const collectionName = collection?.collectionName || 'biomarker_observations';
    await this.ensureIndexes(collection, collectionName);
    return collection;
  }

  encryptObservationValue(doc = {}) {
    const nextDoc = { ...doc };
    const encryptedPayload = encryptValue(nextDoc.value);
    if (encryptedPayload) {
      nextDoc.valueEncrypted = encryptedPayload;
      nextDoc.value = null;
    }
    return nextDoc;
  }

  decryptObservationValue(doc = {}) {
    if (!doc || typeof doc !== 'object') return doc;

    const nextDoc = { ...doc };
    if (nextDoc.value !== null && nextDoc.value !== undefined && nextDoc.value !== '') {
      return nextDoc;
    }

    if (!nextDoc.valueEncrypted) return nextDoc;

    try {
      const value = decryptValue(nextDoc.valueEncrypted);
      if (value !== null && value !== undefined) {
        nextDoc.value = Number(value);
      }
    } catch (error) {
      logger.warn(`Falha ao descriptografar observação biomarcadora ${String(nextDoc._id || '')}: ${error.message}`);
    }

    return nextDoc;
  }

  async createObservation(db, payload = {}) {
    const collection = await this.getObservationsCollection(db);
    const observation = BiomarkerObservationModel.create(payload);
    const encryptedObservation = this.encryptObservationValue(observation);

    try {
      const result = await collection.insertOne(encryptedObservation);
      return {
        _id: result.insertedId,
        ...observation
      };
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await collection.findOne({ idempotencyKey: observation.idempotencyKey });
        if (existing) {
          return this.decryptObservationValue(existing);
        }
      }
      throw error;
    }
  }

  async listPatientObservations(db, patientID, filters = {}) {
    const normalizedPatientID = String(patientID || '').trim();
    if (!/^\d{8}$/.test(normalizedPatientID)) {
      throw new Error('patientID inválido. Deve ter 8 dígitos numéricos');
    }

    const collection = await this.getObservationsCollection(db);
    const query = { patientID: normalizedPatientID };

    if (filters.biomarkerType) {
      query.biomarkerType = String(filters.biomarkerType).trim();
    }

    if (filters.status) {
      query.status = String(filters.status).trim().toLowerCase();
    }

    if (filters.from || filters.to) {
      query.collectedAt = {};
      if (filters.from) {
        const fromDate = new Date(filters.from);
        if (!Number.isNaN(fromDate.getTime())) {
          query.collectedAt.$gte = fromDate;
        }
      }
      if (filters.to) {
        const toDate = new Date(filters.to);
        if (!Number.isNaN(toDate.getTime())) {
          query.collectedAt.$lte = toDate;
        }
      }
      if (Object.keys(query.collectedAt).length === 0) {
        delete query.collectedAt;
      }
    }

    const limit = Number(filters.limit) > 0 ? Math.min(Number(filters.limit), 200) : 50;
    const skip = Number(filters.skip) > 0 ? Number(filters.skip) : 0;

    const docs = await collection.find(query).sort({ collectedAt: -1, createdAt: -1 }).skip(skip).limit(limit).toArray();
    const total = await collection.countDocuments(query);

    return {
      observations: docs.map((doc) => this.decryptObservationValue(doc)),
      total,
      limit,
      skip
    };
  }
}

module.exports = new BiomarkerObservationService();
