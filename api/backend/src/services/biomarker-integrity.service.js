const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const merkleTree = require('../utils/merkleTree');

const COLLECTION_NAME = 'biomarker_integrity';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function normalizeDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('timestamp inválido para integridade de biomarcador');
  }
  return parsed;
}

function normalizeNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error('valor de biomarcador inválido');
  }
  return numericValue;
}

function computeBiomarkerHash({ participantId, value, timestamp }) {
  const normalizedPatientId = String(participantId || '').trim();
  if (!normalizedPatientId) {
    throw new Error('participantId é obrigatório para integridade de biomarcador');
  }

  const normalizedTimestamp = normalizeDate(timestamp).toISOString();
  const normalizedValue = normalizeNumber(value);
  const payload = `${normalizedPatientId}|${normalizedValue}|${normalizedTimestamp}`;
  return sha256Hex(payload);
}

class BiomarkerIntegrityService {
  constructor() {
    this.collectionName = COLLECTION_NAME;
  }

  async ensureIndexes(db) {
    const collection = db.collection(this.collectionName);
    await Promise.allSettled([
      collection.createIndex({ participantId: 1, biomarkerType: 1, timestamp: -1 }, { name: 'biomarker_integrity_patient_type_ts_idx_v1' }),
      collection.createIndex({ day: 1, timestamp: 1 }, { name: 'biomarker_integrity_day_ts_idx_v1' }),
      collection.createIndex({ integrityHash: 1 }, { name: 'biomarker_integrity_hash_idx_v1' })
    ]);
  }

  async appendBiomarkerHash(db, input = {}) {
    if (!db) {
      throw new Error('Banco de dados não disponível');
    }

    const participantId = String(input.participantId || '').trim();
    const biomarkerType = String(input.biomarkerType || '').trim();
    const value = normalizeNumber(input.value);
    const timestamp = normalizeDate(input.timestamp || new Date());

    if (!participantId || !biomarkerType) {
      throw new Error('participantId e biomarkerType são obrigatórios');
    }

    await this.ensureIndexes(db);

    const integrityHash = computeBiomarkerHash({
      participantId,
      value,
      timestamp
    });

    const document = {
      participantId,
      biomarkerType,
      value,
      timestamp,
      day: timestamp.toISOString().slice(0, 10),
      integrityHash,
      algorithm: 'sha256',
      source: String(input.source || 'patient_biomarkers'),
      eventType: String(input.eventType || 'update'),
      createdAt: new Date()
    };

    const result = await db.collection(this.collectionName).insertOne(document);
    return {
      _id: result.insertedId,
      ...document
    };
  }

  async getBiomarkerHashesForDate(db, date) {
    if (!db) throw new Error('Banco de dados não disponível');
    if (!date) throw new Error('Data é obrigatória');

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Formato de data inválido. Esperado YYYY-MM-DD');
    }

    const docs = await db.collection(this.collectionName)
      .find({
        $or: [
          { day: date },
          { timestamp: { $gte: start, $lte: end } }
        ]
      })
      .sort({ timestamp: 1, _id: 1 })
      .toArray();

    return docs;
  }

  async verifyBiomarkerById(db, biomarkerIntegrityId) {
    if (!db) throw new Error('Banco de dados não disponível');

    if (!ObjectId.isValid(String(biomarkerIntegrityId || ''))) {
      const notFoundError = new Error('ID de integridade de biomarcador inválido');
      notFoundError.statusCode = 400;
      throw notFoundError;
    }

    const integrityCollection = db.collection(this.collectionName);
    const doc = await integrityCollection.findOne({ _id: new ObjectId(String(biomarkerIntegrityId)) });

    if (!doc) {
      const notFoundError = new Error('Registro de integridade de biomarcador não encontrado');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    const recalculatedHash = computeBiomarkerHash({
      participantId: doc.participantId,
      value: doc.value,
      timestamp: doc.timestamp
    });

    const contentUntampered = recalculatedHash === doc.integrityHash;
    const date = String(doc.day || new Date(doc.timestamp).toISOString().slice(0, 10));

    const integrityService = require('./integrityCheckService');
    const merkleResult = await integrityService.buildMerkleForDate(date, db);

    const proof = merkleResult.getProofForHash(doc.integrityHash);
    const proofValid = merkleTree.verifyProof(doc.integrityHash, proof, merkleResult.root);

    return {
      biomarkerIntegrityId: String(doc._id),
      participantId: doc.participantId,
      biomarkerType: doc.biomarkerType,
      timestamp: doc.timestamp,
      day: date,
      integrityHash: doc.integrityHash,
      recalculatedHash,
      contentUntampered,
      merkleRoot: merkleResult.root,
      leafCount: merkleResult.leaves.length,
      proof,
      proofValid,
      verified: Boolean(contentUntampered && proofValid)
    };
  }
}

const service = new BiomarkerIntegrityService();
service.computeBiomarkerHash = computeBiomarkerHash;

module.exports = service;