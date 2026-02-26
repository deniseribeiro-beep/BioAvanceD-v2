const env = require('../../../config/env');
const logger = require('../../../utils/logger');

class LineageRepository {
  constructor(neo4jDriver, options = {}) {
    this.driver = neo4jDriver;
    this.database = options.database || env.NEO4J_DATABASE || 'neo4j';
  }

  ensureDriver() {
    if (!this.driver || typeof this.driver.session !== 'function') {
      throw new Error('[ISO20387][NEO4J] Driver não inicializado para validação de cadeia de custódia');
    }
  }

  async validateBeforePersistence(input) {
    this.ensureDriver();

    if (!input?.sampleId) {
      throw new Error('[ISO20387][NEO4J] sampleId obrigatório para validação pré-MongoDB');
    }

    if (!input?.eventType) {
      throw new Error('[ISO20387][NEO4J] eventType obrigatório para trilha de custódia');
    }

    const session = this.driver.session({ database: this.database });

    try {
      await session.run('RETURN 1 AS ok');
      return true;
    } finally {
      await session.close();
    }
  }

  async createSampleNodeWithParent(input) {
    this.ensureDriver();

    const sampleId = input?.sampleId ? String(input.sampleId) : null;
    const parentSampleId = input?.parentSampleId ? String(input.parentSampleId) : null;

    if (!sampleId) {
      throw new Error('[ISO20387][NEO4J] sampleId é obrigatório para criar linhagem topológica');
    }

    if (!parentSampleId) {
      throw new Error('[ISO20387][NEO4J] parentSampleId é obrigatório para vincular linhagem topológica');
    }

    const session = this.driver.session({ database: this.database });

    try {
      const result = await session.run(
        `
          MERGE (child:Sample {id: $sampleId})
          ON CREATE SET child.createdAt = datetime(), child.source = 'BioAvanceD'
          SET child.updatedAt = datetime(),
              child.barcode = coalesce($barcode, child.barcode),
              child.status = coalesce($status, child.status)

          MERGE (parent:Sample {id: $parentSampleId})
          ON CREATE SET parent.createdAt = datetime(), parent.source = 'BioAvanceD'
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
          relationshipType: input?.relationshipType || 'TOPOLOGICAL_PARENT'
        }
      );

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

    const session = this.driver.session({ database: this.database });
    const eventId = `${input.eventType}-${input.sampleId}-${Date.now()}`;

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
          sampleId: String(input.sampleId),
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
}

module.exports = LineageRepository;
