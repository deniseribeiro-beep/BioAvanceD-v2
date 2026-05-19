const logger = require('../utils/logger');
const env = require('../config/env');
const { resolveSourceCollectionName } = require('../utils/collectionResolver');

class ConsentNeo4jSyncService {
  constructor() {
    this.batchSize = Number(env.CONSENT_SYNC_BATCH_SIZE || 500);
  }

  normalizeStatus(status) {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized === 'ACTIVE' || normalized === 'VALID' || normalized === 'GRANTED') return 'ACTIVE';
    if (normalized === 'REVOKED' || normalized === 'DENIED' || normalized === 'EXPIRED') return 'REVOKED';
    return 'UNKNOWN';
  }

  toIsoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async buildConsentMap(db) {
    const consentCollectionName = await resolveSourceCollectionName(db, 'consents');
    const consentsCollection = db.collection(consentCollectionName);

    const latestConsents = await consentsCollection
      .aggregate([
        {
          $sort: {
            signedAt: -1,
            createdAt: -1,
            updatedAt: -1,
            _id: -1
          }
        },
        {
          $group: {
            _id: '$patientId',
            consent: { $first: '$$ROOT' }
          }
        }
      ])
      .toArray();

    const consentMap = new Map();
    for (const item of latestConsents) {
      if (!item?._id) continue;
      consentMap.set(String(item._id), item.consent);
    }

    return { consentMap, consentCollectionName };
  }

  async sync({ db, neo4jDriver }) {
    if (!db) {
      logger.warn('[ISO20387][SYNC] Sincronização ignorada: Banco MongoDB indisponível');
      return {
        processed: 0,
        updated: 0,
        skipped: true,
        reason: 'missing_mongodb'
      };
    }

    if (!neo4jDriver || typeof neo4jDriver.session !== 'function') {
      logger.warn('[ISO20387][SYNC] Sincronização ignorada: Driver Neo4j indisponível');
      return {
        processed: 0,
        updated: 0,
        skipped: true,
        reason: 'missing_neo4j'
      };
    }

    const { consentMap, consentCollectionName } = await this.buildConsentMap(db);
    const sampleSourceName = await resolveSourceCollectionName(db, 'samples');
    const samplesCollection = db.collection(sampleSourceName);

    const cursor = samplesCollection.find(
      { _id: { $exists: true } },
      {
        projection: {
          _id: 1,
          patientID: 1,
          barcode: 1,
          updatedAt: 1
        },
        batchSize: this.batchSize
      }
    );

    const session = neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j' });

    let processed = 0;
    let updated = 0;

    try {
      const buffer = [];

      while (await cursor.hasNext()) {
        const sample = await cursor.next();
        processed += 1;

        const patientId = sample?.patientID ? String(sample.patientID).trim() : null;
        const consent = patientId ? consentMap.get(patientId) : null;
        const normalizedStatus = this.normalizeStatus(consent?.status);

        const payload = {
          sampleId: String(sample._id),
          barcode: sample?.barcode ? String(sample.barcode) : null,
          patientId,
          consentNodeId: patientId ? `CONSENT::${patientId}` : null,
          consentStatus: normalizedStatus,
          consentSignedAt: this.toIsoDate(consent?.signedAt),
          consentUpdatedAt: this.toIsoDate(consent?.updatedAt || consent?.createdAt || sample?.updatedAt),
          consentTemplateId: consent?.templateId ? String(consent.templateId) : null,
          consentId: consent?._id ? String(consent._id) : null,
          hasConsent: Boolean(consent)
        };

        buffer.push(payload);

        if (buffer.length >= this.batchSize) {
          const count = await this.flushBatch(session, buffer);
          updated += count;
          buffer.length = 0;
        }
      }

      if (buffer.length > 0) {
        const count = await this.flushBatch(session, buffer);
        updated += count;
      }

      logger.info(`[ISO20387][SYNC] Consentimento Mongo→Neo4j concluído: processadas=${processed}, atualizadas=${updated}, source=${consentCollectionName}`);
      return {
        processed,
        updated,
        consentCollection: consentCollectionName
      };
    } finally {
      await session.close();
    }
  }

  async flushBatch(session, rows) {
    if (!rows.length) return 0;

    const result = await session.run(
      `
        UNWIND $rows AS row
        MERGE (sample:Sample {id: row.sampleId})
        ON CREATE SET sample.createdAt = datetime(), sample.source = 'BioAvanceD'
        SET sample.updatedAt = datetime(),
            sample.barcode = coalesce(row.barcode, sample.barcode),
            sample.patientId = coalesce(row.patientId, sample.patientId),
            sample.consentStatus = row.consentStatus,
            sample.consentSyncedAt = datetime()

        WITH sample, row
        OPTIONAL MATCH (sample)-[oldRel:HAS_CONSENT]->(:EthicalConsent)
        DELETE oldRel

        WITH sample, row
        FOREACH (_ IN CASE WHEN row.hasConsent THEN [1] ELSE [] END |
          MERGE (consent:EthicalConsent {id: row.consentNodeId})
          ON CREATE SET consent.createdAt = datetime(), consent.source = 'BioAvanceD'
          SET consent.updatedAt = datetime(),
              consent.patientId = row.patientId,
              consent.status = row.consentStatus,
              consent.templateId = row.consentTemplateId,
              consent.mongoConsentId = row.consentId,
              consent.signedAt = CASE WHEN row.consentSignedAt IS NULL THEN consent.signedAt ELSE datetime(row.consentSignedAt) END,
              consent.lastSyncedAt = CASE WHEN row.consentUpdatedAt IS NULL THEN datetime() ELSE datetime(row.consentUpdatedAt) END,
              consent.isCurrent = true
          MERGE (sample)-[:HAS_CONSENT]->(consent)
        )

        RETURN count(sample) AS synced
      `,
      { rows }
    );

    return Number(result.records[0]?.get('synced') || 0);
  }
}

module.exports = new ConsentNeo4jSyncService();
