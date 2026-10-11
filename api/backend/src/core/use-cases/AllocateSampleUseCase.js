const env = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Caso de uso: alocar amostra em posição física.
 */
class AllocateSampleUseCase {
  /**
   * @param {{ storageRepository: import('../ports/IStorageRepository'), auditRepository: import('../ports/IAuditRepository'), lineageRepository?: import('../ports/ILineageRepository') }} deps
   */
  constructor({ storageRepository, auditRepository, lineageRepository }) {
    this.storageRepository = storageRepository;
    this.auditRepository = auditRepository;
    this.lineageRepository = lineageRepository;
  }

  /**
   * @param {{ specimenId: string, boxId: string, position: string, actor: { userId?: string|null, userName?: string|null, userRole?: string|null, ipAddress?: string|null, userAgent?: string|null } }} command
   */
  async execute(command) {
    this.validateCommand(command);

    const normalizedPosition = String(command.position).trim().toUpperCase();
    const sample = await this.storageRepository.findSampleById(command.specimenId);
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    const beforeLocation = sample.storageAssignment
      ? {
          boxId: sample.storageAssignment.boxId ? String(sample.storageAssignment.boxId) : null,
          position: sample.storageAssignment.positionCode
            ? String(sample.storageAssignment.positionCode).toUpperCase()
            : null
        }
      : null;

    const lineagePayload = {
      specimenId: String(sample._id),
      barcode: sample.barcode || null,
      eventType: 'allocate',
      from: beforeLocation,
      to: {
        boxId: String(command.boxId),
        position: normalizedPosition
      },
      actorId: command?.actor?.userId || null,
      reason: 'allocate'
    };
    const lineageResult = await this.validateLineageBeforeMongo(lineagePayload);
    let lineageEventId = null;

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const beforeLocation = sample.storageAssignment
        ? {
            boxId: sample.storageAssignment.boxId ? String(sample.storageAssignment.boxId) : null,
            position: sample.storageAssignment.positionCode
              ? String(sample.storageAssignment.positionCode).toUpperCase()
              : null
          }
        : null;

      await this.storageRepository.allocateSamplePosition(
        {
          specimenId: command.specimenId,
          boxId: command.boxId,
          position: normalizedPosition
        },
        session
      );

      await this.auditRepository.appendImmutableAudit(
        {
          specimenId: String(sample._id),
          barcode: sample.barcode || null,
          eventType: 'allocate',
          before: {
            storageLocation: beforeLocation
          },
          after: {
            storageLocation: {
              boxId: String(command.boxId),
              position: normalizedPosition
            }
          },
          context: {
            actor: command.actor,
            reason: 'allocate'
          },
          timestamp: new Date()
        },
        session
      );

      lineageEventId = await this.recordLineageInTransaction(
        lineageResult,
        { ...lineagePayload, from: beforeLocation },
        session
      );
    });

    return {
      success: true,
      sampleLocation: {
        specimenId: String(command.specimenId),
        boxId: String(command.boxId),
        position: normalizedPosition
      },
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineageValidated,
      lineageEventId
    };
  }

  /**
   * @param {any} command
   */
  validateCommand(command) {
    if (!command?.specimenId || !command?.boxId || !command?.position) {
      throw new Error('specimenId, boxId e position são obrigatórios');
    }
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
      logger.error('[ISO20387][LINEAGE] Falha na validação pré-Mongo (allocate):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false };
    }
  }

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append inside the
  // allocation's own transaction, never a Neo4j write. A failed append
  // aborts the transaction, so the allocation is refused in either
  // LINEAGE_MODE and MongoDB never keeps a step the graph was not told about.
  async recordLineageInTransaction(lineageResult, payload, session) {
    if (!lineageResult?.lineageValidated) {
      return null;
    }
    const persisted = await this.lineageRepository.recordCustodyEvent(payload, { session });
    return persisted?.eventId || null;
  }
}

module.exports = AllocateSampleUseCase;
