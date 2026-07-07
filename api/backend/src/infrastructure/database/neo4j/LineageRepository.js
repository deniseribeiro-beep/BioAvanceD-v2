const env = require('../../../config/env');
const logger = require('../../../utils/logger');

class LineageRepository {
  constructor(neo4jDriver, options = {}) {
    this.driver = neo4jDriver;
    this.database = options.database || env.NEO4J_DATABASE || 'neo4j';
    this.activeConsentStatuses = ['ACTIVE', 'VALID', 'GRANTED'];
  }

  normalizePointerId(pointer, fieldName) {
    const normalized = pointer !== undefined && pointer !== null ? String(pointer).trim() : '';
    if (!normalized) {
      throw new Error(`[ISO20387][NEO4J] ${fieldName} obrigatório para ponteiro semântico Mongo↔Neo4j`);
    }
    return normalized;
  }

  ensureDriver() {
    if (!this.driver || typeof this.driver.session !== 'function') {
      throw new Error('[ISO20387][NEO4J] Driver não inicializado para validação de cadeia de custódia');
    }
  }

  async validateBeforePersistence(input) {
    this.ensureDriver();

    const sampleId = this.normalizePointerId(input?.sampleId, 'sampleId');

    if (!input?.eventType) {
      throw new Error('[ISO20387][NEO4J] eventType obrigatório para trilha de custódia');
    }

    const requireEthicalConsent = input?.requireEthicalConsent !== false;

    const session = this.driver.session({ database: this.database });

    try {
      const result = await session.run(
        `
          MERGE (sample:Sample {id: $sampleId})
          ON CREATE SET sample.createdAt = datetime(), sample.source = 'BioAvanceD'
          SET sample.updatedAt = datetime(),
              sample.barcode = coalesce($barcode, sample.barcode)

          OPTIONAL MATCH (sample)-[:GOVERNED_BY]->(consent:EthicalConsent)

          RETURN sample.id AS sampleId,
                 coalesce(sample.consentStatus, 'UNKNOWN') AS sampleConsentStatus,
                 [status IN collect(DISTINCT consent.status) WHERE status IS NOT NULL] AS consentStatuses
        `,
        {
          sampleId,
          barcode: input?.barcode || null
        }
      );

      const record = result.records[0];
      const sampleConsentStatus = record?.get('sampleConsentStatus') || 'UNKNOWN';
      const consentStatuses = record?.get('consentStatuses') || [];

      if (requireEthicalConsent) {
        const normalizedStatuses = [sampleConsentStatus, ...consentStatuses]
          .map((status) => String(status || '').trim().toUpperCase())
          .filter(Boolean);

        const hasActiveConsent = normalizedStatuses.some((status) => this.activeConsentStatuses.includes(status));
        if (!hasActiveConsent) {
          throw new Error('[ISO20387][NEO4J] Consentimento ético ativo não encontrado para operação de linhagem');
        }
      }

      return true;
    } finally {
      await session.close();
    }
  }

  async createSampleNodeWithParent(input) {
    this.ensureDriver();

    const sampleId = this.normalizePointerId(input?.sampleId, 'sampleId');
    const parentSampleId = this.normalizePointerId(input?.parentSampleId, 'parentSampleId');

    const session = this.driver.session({ database: this.database });

    try {
      const result = await session.run(
        `
          MATCH (parent:Sample {id: $parentSampleId})
          WITH parent, coalesce(parent.consentStatus, 'UNKNOWN') AS parentConsentStatus
          WHERE parentConsentStatus IN $activeConsentStatuses

          MERGE (child:Sample {id: $sampleId})
          ON CREATE SET child.createdAt = datetime(), child.source = 'BioAvanceD'
          SET child.updatedAt = datetime(),
              child.barcode = coalesce($barcode, child.barcode),
              child.status = coalesce($status, child.status),
              child.parentSampleId = $parentSampleId

          SET parent.updatedAt = datetime()

          MERGE (child)-[r:DERIVED_FROM]->(parent)
          ON CREATE SET r.createdAt = datetime(), r.relationshipType = $relationshipType
          SET r.updatedAt = datetime(), r.relationshipType = $relationshipType

          RETURN child.id AS sampleId, parent.id AS parentId, r.relationshipType AS relationshipType
        `,
        {
          sampleId,
          parentSampleId,
          barcode: input?.barcode || null,
          status: input?.status || null,
          relationshipType: input?.relationshipType || 'TOPOLOGICAL_PARENT',
          activeConsentStatuses: this.activeConsentStatuses
        }
      );

      if (!result.records.length) {
        throw new Error('[ISO20387][NEO4J] Amostra pai sem consentimento ativo para derivação de alíquota');
      }

      return result.records[0]?.toObject() || {
        sampleId,
        parentId: parentSampleId,
        relationshipType: input?.relationshipType || 'TOPOLOGICAL_PARENT'
      };
    } catch (error) {
      logger.error('[ISO20387][NEO4J] Falha ao criar linhagem topológica de amostra:', error.message);
      throw error;
    } finally {
      await session.close();
    }
  }

  async recordCustodyEvent(input) {
    this.ensureDriver();

    const sampleId = this.normalizePointerId(input?.sampleId, 'sampleId');

    if (!input?.eventType) {
      throw new Error('[ISO20387][NEO4J] eventType obrigatório para trilha de custódia');
    }

    const session = this.driver.session({ database: this.database });
    const eventId = `${input.eventType}-${sampleId}-${Date.now()}`;

    try {
      await session.run(
        `
          MERGE (sample:Sample {id: $sampleId})
          ON CREATE SET sample.createdAt = datetime(), sample.source = 'BioAvanceD'
          SET sample.updatedAt = datetime(),
              sample.barcode = coalesce($barcode, sample.barcode)

          CREATE (event:CustodyEvent {
            id: $eventId,
            eventType: $eventType,
            happenedAt: datetime($happenedAt),
            actorId: $actorId,
            reason: $reason,
            source: 'ISO20387'
          })

          MERGE (sample)-[:HAS_CUSTODY_EVENT]->(event)

          FOREACH (_ IN CASE WHEN $fromBoxId IS NULL OR $fromPosition IS NULL THEN [] ELSE [1] END |
            MERGE (fromPos:StoragePosition {boxId: $fromBoxId, position: $fromPosition})
            ON CREATE SET fromPos.createdAt = datetime()
            SET fromPos.updatedAt = datetime()
            MERGE (event)-[:FROM]->(fromPos)
          )

          FOREACH (_ IN CASE WHEN $toBoxId IS NULL OR $toPosition IS NULL THEN [] ELSE [1] END |
            MERGE (toPos:StoragePosition {boxId: $toBoxId, position: $toPosition})
            ON CREATE SET toPos.createdAt = datetime()
            SET toPos.updatedAt = datetime()
            MERGE (event)-[:TO]->(toPos)
          )

          RETURN event.id AS eventId
        `,
        {
          eventId,
          sampleId,
          barcode: input.barcode || null,
          eventType: String(input.eventType),
          happenedAt: (input.happenedAt || new Date()).toISOString(),
          actorId: input.actorId || null,
          reason: input.reason || null,
          fromBoxId: input.from?.boxId ? String(input.from.boxId) : null,
          fromPosition: input.from?.position ? String(input.from.position).toUpperCase() : null,
          toBoxId: input.to?.boxId ? String(input.to.boxId) : null,
          toPosition: input.to?.position ? String(input.to.position).toUpperCase() : null
        }
      );

      return { eventId };
    } catch (error) {
      logger.error('[ISO20387][NEO4J] Falha ao persistir evento de custódia:', error.message);
      throw error;
    } finally {
      await session.close();
    }
  }

  async compensateCustodyEvent(input) {
    this.ensureDriver();

    const eventId = this.normalizePointerId(input?.eventId, 'eventId');
    const session = this.driver.session({ database: this.database });

    try {
      const result = await session.run(
        `
          OPTIONAL MATCH (event:CustodyEvent {id: $eventId})
          WITH event
          WHERE event IS NOT NULL

          OPTIONAL MATCH (event)-[:FROM|TO]->(pos:StoragePosition)
          WITH event, collect(DISTINCT pos) AS touchedPositions
          DETACH DELETE event

          UNWIND touchedPositions AS touchedPos
          WITH DISTINCT touchedPos
          WHERE touchedPos IS NOT NULL
          OPTIONAL MATCH (touchedPos)<-[:FROM|TO]-(:CustodyEvent)
          WITH touchedPos, count(*) AS remainingRefs
          WHERE remainingRefs = 0
          DETACH DELETE touchedPos

          RETURN count(touchedPos) AS cleanedPositions
        `,
        {
          eventId
        }
      );

      const cleanedPositions = result.records[0]?.get('cleanedPositions') || 0;
      return {
        compensated: true,
        eventId,
        cleanedPositions: Number(cleanedPositions)
      };
    } catch (error) {
      logger.error('[ISO20387][NEO4J] Falha ao compensar evento de custódia (Saga):', error.message);
      throw error;
    } finally {
      await session.close();
    }
  }
}

module.exports = LineageRepository;
