const env = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Caso de uso: liberar posição física atual da amostra.
 */
class ReleaseSampleUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository'), auditRepository: import('../ports/IAuditRepository'), lineageRepository?: import('../ports/ILineageRepository') }} deps
   */
  constructor({ storageRepository, auditRepository, lineageRepository }) {
    this.storageRepository = storageRepository;
    this.auditRepository = auditRepository;
    this.lineageRepository = lineageRepository;
  }

  /**
   * @param {{ specimenId: string, actor: { userId?: string|null, userName?: string|null, userRole?: string|null, ipAddress?: string|null, userAgent?: string|null } }} command
   */
  async execute(command) {
    if (!command?.specimenId) {
      throw new Error('specimenId é obrigatório');
    }

    const sampleSnapshot = await this.storageRepository.findSampleById(command.specimenId);
    if (!sampleSnapshot) {
      throw new Error('Amostra não encontrada');
    }

    const sourceAssignment = sampleSnapshot?.storageAssignment;
    if (!sourceAssignment?.boxId || !sourceAssignment?.positionCode) {
      throw new Error('Amostra não possui localização de armazenamento');
    }

    const lineagePayload = {
      specimenId: String(sampleSnapshot._id),
      barcode: sampleSnapshot.barcode || null,
      eventType: 'release',
      from: {
        boxId: String(sourceAssignment.boxId),
        position: String(sourceAssignment.positionCode).toUpperCase()
      },
      to: null,
      actorId: command?.actor?.userId || null,
      reason: 'release',
      happenedAt: new Date()
    };
    const lineageResult = await this.validateLineageBeforeMongo(lineagePayload);
    let lineageEventId = null;

    let releasedFrom = null;

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const release = await this.storageRepository.releaseSamplePosition(
        { specimenId: command.specimenId },
        session
      );

      releasedFrom = {
        specimenId: String(command.specimenId),
        boxId: release.from.boxId,
        position: release.from.position
      };

      await this.auditRepository.appendImmutableAudit(
        {
          specimenId: String(sample.specimenId || sample._id),
          barcode: sample.barcode || null,
          eventType: 'release',
          before: {
            storageLocation: {
              boxId: release.from.boxId,
              position: release.from.position
            }
          },
          after: {
            storageLocation: null
          },
          context: {
            actor: command.actor,
            reason: 'release'
          },
          timestamp: new Date()
        },
        session
      );

      lineageEventId = await this.recordLineageInTransaction(
        lineageResult,
        {
          ...lineagePayload,
          from: release.from?.boxId && release.from?.position
            ? { boxId: String(release.from.boxId), position: String(release.from.position).toUpperCase() }
            : lineagePayload.from
        },
        session
      );
    });

    return {
      success: true,
      releasedFrom,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineageValidated,
      lineageEventId
    };
  }

  // LINEAGE_MODE governs this pre-MongoDB step only: a missing lineage
  // repository or a custody payload missing its fields refuses the operation
  // under fail-closed, and under fail-open the operation runs without a
  // custody event. It reads nothing; custody reads no consent (MongoDB is the
  // consent authority, and revocation is prospective, RF010 AC6).
  async validateLineageBeforeMongo(payload) {
    const shouldFailHard = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';

    if (!this.lineageRepository) {
      const error = new Error('[ISO20387][LINEAGE] Repositório de linhagem ausente para operação de custódia');
      if (shouldFailHard) {
        throw error;
      }
      logger.warn(error.message);
      return { lineageValidated: false };
    }

    try {
      await this.lineageRepository.validateBeforePersistence(payload);
      return { lineageValidated: true };
    } catch (error) {
      logger.error('[ISO20387][LINEAGE] Falha na validação pré-Mongo (release):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false };
    }
  }

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append inside the
  // release's own transaction, never a Neo4j write. A failed append aborts
  // the transaction, so the release is refused in either LINEAGE_MODE and
  // MongoDB never keeps a step the graph was not told about.
  async recordLineageInTransaction(lineageResult, payload, session) {
    if (!lineageResult?.lineageValidated) {
      return null;
    }
    const persisted = await this.lineageRepository.recordCustodyEvent(payload, { session });
    return persisted?.eventId || null;
  }
}

module.exports = ReleaseSampleUseCase;
