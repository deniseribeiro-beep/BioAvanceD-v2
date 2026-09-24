const crypto = require('crypto');
const logger = require('../utils/logger');
const fs = require('fs');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

class HL7AuditService {
  constructor() {
    this.LOG_TYPE = 'HL7_HASH';
  }

  async _hashFHIRResources(db, date) {
    const samplesCol = db.collection('specimens');
    // search for samples with a 'fhir' field and createdAt on date
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');

    const docs = await samplesCol.find({ 'fhir': { $exists: true }, createdAt: { $gte: start, $lte: end } }).toArray();
    const results = [];
    for (const doc of docs) {
      try {
        const json = JSON.stringify(doc.fhir);
        const hash = sha256Hex(json);
        results.push({ type: 'fhir', specimenId: doc.specimenId, hash, doc });
      } catch (err) {
        logger.error('Erro ao gerar hash FHIR da amostra:', err.message || err);
      }
    }
    return results;
  }

  async _hashHL7Files(db, date) {
    const filesCol = db.collection('sample_files');
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');

    // Find files that likely are HL7 (fileType contains 'hl7' or filename ends with .hl7)
    const candidates = await filesCol.find({
      uploadDate: { $gte: start, $lte: end },
      $or: [ { fileType: /hl7/i }, { fileName: /\.hl7$/i } ]
    }).toArray();

    const results = [];
    for (const f of candidates) {
      try {
        if (f.storagePath && fs.existsSync(f.storagePath)) {
          const content = fs.readFileSync(f.storagePath, 'utf8');
          const hash = sha256Hex(content);
          results.push({ type: 'hl7', fileId: f._id, hash, file: f });
        } else {
          // Fallback to fileName+meta hashing
          const hash = sha256Hex(f.fileName + '|' + (f.fileSize || 0));
          results.push({ type: 'hl7', fileId: f._id, hash, note: 'arquivo não encontrado em disco' });
        }
      } catch (err) {
        logger.error('Erro ao gerar hash do arquivo HL7:', err.message || err);
      }
    }
    return results;
  }

  async buildHL7HashesForDate(date, db) {
    const fhir = await this._hashFHIRResources(db, date);
    const hl7 = await this._hashHL7Files(db, date);

    // Insert logs for each hash if not already present
    const logsCol = db.collection('logs');
    const inserted = [];
    for (const item of [...fhir, ...hl7]) {
      const sourceId = item.specimenId != null
        ? String(item.specimenId)
        : item.fileId != null
          ? String(item.fileId)
          : null;

      if (!sourceId) {
        logger.warn('[HL7_AUDIT] Item sem specimenId/fileId ignorado para deduplicação');
        continue;
      }

      const existing = await logsCol.findOne({ 'payload.sourceId': sourceId, action: this.LOG_TYPE });
      if (existing) continue;

      const payload = { type: item.type, sourceId };
      const logDoc = {
        date: date,
        timestampISO: new Date().toISOString(),
        action: this.LOG_TYPE,
        entity: 'HL7Audit',
        message: `Hash ${item.type}`,
        payload,
        auditHash: item.hash,
        createdAt: new Date()
      };
      await logsCol.insertOne(logDoc);
      inserted.push(logDoc);
    }

    return { fhir, hl7, inserted };
  }

  async buildHL7MerkleForDate(date, db) {
    // Ensure HL7/FHIR hashes are present in logs
    await this.buildHL7HashesForDate(date, db);

    // Use integrityCheckService to build merkle over logs (it already reads logs.auditHash)
    const integrityService = require('./integrityCheckService');
    const res = await integrityService.buildMerkleForDate(date, db);
    return res; // {date, root, leaves, docs, getProofForHash}
  }
}

module.exports = new HL7AuditService();
