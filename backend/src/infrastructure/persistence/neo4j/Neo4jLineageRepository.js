const logger = require('../../../utils/logger');

/**
 * Repositório de linhagem em Neo4j.
 *
 * Este adaptador é opcional: quando não houver driver configurado,
 * as operações se tornam no-op para manter compatibilidade do backend.
 */
class Neo4jLineageRepository {
  /**
   * @param {any} neo4jDriver
   */
  constructor(neo4jDriver) {
    this.driver = neo4jDriver;
  }

  /**
   * @param {{ sampleId: string, barcode?: string|null, from: { boxId: string, position: string }, to: { boxId: string, position: string }, movedAt: Date, movedBy?: string|null, reason?: string|null }} input
   */
  async registerSampleMove(input) {
    if (!this.driver || typeof this.driver.session !== 'function') {
      return;
    }

    const session = this.driver.session();
    try {
      await session.run(
        `
          MERGE (s:Sample {id: $sampleId})
          ON CREATE SET s.createdAt = datetime()
          SET s.barcode = coalesce($barcode, s.barcode)

          MERGE (fromPos:StoragePosition {boxId: $fromBoxId, position: $fromPosition})
          MERGE (toPos:StoragePosition {boxId: $toBoxId, position: $toPosition})

          CREATE (s)-[:MOVED {
            movedAt: datetime($movedAt),
            movedBy: $movedBy,
            reason: $reason
          }]->(toPos)

          MERGE (s)-[:MOVED_FROM]->(fromPos)
        `,
        {
          sampleId: input.sampleId,
          barcode: input.barcode || null,
          fromBoxId: input.from.boxId,
          fromPosition: input.from.position,
          toBoxId: input.to.boxId,
          toPosition: input.to.position,
          movedAt: input.movedAt.toISOString(),
          movedBy: input.movedBy || null,
          reason: input.reason || null
        }
      );
    } catch (error) {
      logger.warn('[Neo4jLineageRepository] Falha ao registrar linhagem:', error.message || error);
      throw error;
    } finally {
      await session.close();
    }
  }
}

module.exports = Neo4jLineageRepository;
