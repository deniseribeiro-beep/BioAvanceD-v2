const crypto = require('crypto');
const logger = require('../utils/logger');

const COLLECTION = 'mqtt_ingestion_audit';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function buildChainPayload(entry, previousHash) {
  return JSON.stringify({
    topic: entry.topic || null,
    payloadHash: entry.payloadHash || null,
    signatureVerified: Boolean(entry.signatureVerified),
    status: entry.status || null,
    reason: entry.reason || null,
    sensorId: entry.sensorId || null,
    timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : null,
    previousHash: previousHash || null
  });
}

class MqttIngestionAuditService {
  async ensureIndexes(db) {
    const collection = db.collection(COLLECTION);
    await Promise.allSettled([
      collection.createIndex({ day: 1, timestamp: 1 }, { name: 'mqtt_ingestion_day_ts_idx_v1' }),
      collection.createIndex({ payloadHash: 1 }, { name: 'mqtt_ingestion_payload_hash_idx_v1' }),
      collection.createIndex({ chainHash: 1 }, { name: 'mqtt_ingestion_chain_hash_idx_v1', unique: true, partialFilterExpression: { chainHash: { $exists: true } } })
    ]);
  }

  async append(db, entry = {}) {
    if (!db) return null;

    try {
      await this.ensureIndexes(db);
      const collection = db.collection(COLLECTION);

      const previous = await collection.find({}).sort({ timestamp: -1, _id: -1 }).limit(1).next();
      const chainPrevHash = previous?.chainHash || null;

      const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
      const chainHash = sha256Hex(buildChainPayload({ ...entry, timestamp }, chainPrevHash));

      const document = {
        topic: entry.topic || null,
        payloadHash: entry.payloadHash || null,
        payloadSignature: entry.payloadSignature || null,
        signatureVerified: Boolean(entry.signatureVerified),
        signatureRequired: Boolean(entry.signatureRequired),
        status: entry.status || 'processed',
        reason: entry.reason || null,
        sensorId: entry.sensorId || null,
        temperatureValue: Number.isFinite(Number(entry.temperatureValue)) ? Number(entry.temperatureValue) : null,
        readingTimestamp: entry.readingTimestamp ? new Date(entry.readingTimestamp) : null,
        timestamp,
        day: timestamp.toISOString().slice(0, 10),
        source: 'mqtt',
        chainPrevHash,
        chainHash,
        chainAlgorithm: 'sha256',
        chainVersion: 1,
        immutable: true,
        createdAt: new Date()
      };

      const result = await collection.insertOne(document);
      return { _id: result.insertedId, chainHash, chainPrevHash };
    } catch (error) {
      logger.warn('[ISO20387][MQTT][AUDIT] Falha ao registrar trilha de ingestão:', error.message || error);
      return null;
    }
  }

  async getHashesForDate(db, date) {
    if (!db || !date) return [];

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }

    const docs = await db.collection(COLLECTION)
      .find({
        $or: [
          { day: date },
          { timestamp: { $gte: start, $lte: end } }
        ]
      })
      .sort({ timestamp: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => doc.chainHash).filter(Boolean);
  }
}

module.exports = new MqttIngestionAuditService();