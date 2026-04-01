const crypto = require('crypto');
const logger = require('../utils/logger');
const merkleTree = require('../utils/merkleTree');
const biomarkerIntegrityService = require('./biomarker-integrity.service');
const mqttIngestionAuditService = require('./mqtt-ingestion-audit.service');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return JSON.stringify(value.toHexString());
    }
    if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') {
      return JSON.stringify(String(value));
    }
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }

  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }

  return JSON.stringify(value);
}

function getTimestampISO(log) {
  if (log.timestampISO) return log.timestampISO;
  const date = log.dateTime || log.timestamp || log.createdAt || null;
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildHashPayload(log) {
  return {
    userID: log.userID || log.userId || null,
    userName: log.userName || null,
    action: log.action || null,
    entity: log.entity || null,
    entityID: log.entityID || null,
    result: log.result || null,
    severity: log.severity || null,
    source: log.source || log.origin || null,
    ipSource: log.ipSource || log.sourceIP || null,
    module: log.module || null,
    message: log.message || null,
    payload: log.payload || null,
    errorStack: log.errorStack || null,
    timestampISO: getTimestampISO(log),
    metadata: log.metadata || null
  };
}

function computeAuditHash(log) {
  const payload = buildHashPayload(log);
  const serialized = stableStringify(payload);
  return sha256Hex(serialized);
}

class IntegrityCheckService {
  async buildMerkleForDate(date, db, options = {}) {
    const { persistMissing = false } = options;
    if (!db) throw new Error('Banco de dados não disponível');
    if (!date) throw new Error('Data é obrigatória');

    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Formato de data inválido. Esperado YYYY-MM-DD');
    }

    const logsCol = db.collection('logs');
    const query = {
      $or: [
        { date },
        { timestamp: { $gte: start, $lte: end } },
        { dateTime: { $gte: start, $lte: end } }
      ]
    };

    const docs = await logsCol
      .find(query)
      .sort({ timestamp: 1, dateTime: 1, _id: 1 })
      .toArray();

    const leaves = [];
    const updates = [];

    for (const doc of docs) {
      const hash = doc.auditHash || computeAuditHash(doc);
      leaves.push(hash);
      if (persistMissing && !doc.auditHash) {
        updates.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { auditHash: hash } }
          }
        });
      }
    }

    if (persistMissing && updates.length) {
      try {
        await logsCol.bulkWrite(updates, { ordered: false });
      } catch (err) {
        logger.warn('Falha ao persistir auditHash em alguns logs:', err.message || err);
      }
    }

    let biomarkerDocs = [];
    try {
      biomarkerDocs = await biomarkerIntegrityService.getBiomarkerHashesForDate(db, date);
    } catch (error) {
      logger.warn('Falha ao carregar hashes de biomarcadores para Merkle diária:', error.message || error);
      biomarkerDocs = [];
    }

    const biomarkerLeaves = biomarkerDocs
      .map((doc) => doc.integrityHash)
      .filter((hash) => typeof hash === 'string' && hash.length > 0);

    let mqttLeaves = [];
    try {
      mqttLeaves = await mqttIngestionAuditService.getHashesForDate(db, date);
    } catch (error) {
      logger.warn('Falha ao carregar hashes de ingestão MQTT para Merkle diária:', error.message || error);
      mqttLeaves = [];
    }

    const allLeaves = leaves.concat(biomarkerLeaves, mqttLeaves);
    const tree = merkleTree.buildMerkleTree(allLeaves);

    return {
      date,
      root: tree.root,
      leaves: allLeaves,
      logsLeafCount: leaves.length,
      biomarkersLeafCount: biomarkerLeaves.length,
      mqttLeafCount: mqttLeaves.length,
      docs,
      biomarkerDocs,
      getProofForHash: (hash) => merkleTree.getProofForHash(allLeaves, tree.layers, hash)
    };
  }
}

module.exports = new IntegrityCheckService();
module.exports.computeAuditHash = computeAuditHash;
