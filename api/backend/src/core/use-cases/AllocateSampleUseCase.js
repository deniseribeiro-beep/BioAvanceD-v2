const env = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Caso de uso: alocar amostra em posição física.
 * RF023 v2: estado, auditoria e evento de projeção são persistidos na mesma
 * transação MongoDB. Neo4j é derivado pelo worker do outbox.
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
    const snapshot = await this.storageRepository.findSampleById(command.specimenId);
    if (!snapshot) {
      throw new Error('Amostra não encontrada');
    }

    let lineageResult = { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };

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
        reason: 'allocate',
        happenedAt: new Date()
      };

      lineageResult = await this.persistLineageInTransaction(lineagePayload, session);

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
    });

    return {
      success: true,
      sampleLocation: {
        specimenId: String(command.specimenId),
        boxId: String(command.boxId),
        position: normalizedPosition
      },
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted,
      lineageQueued: lineageResult.lineageQueued,
      lineageEventId: lineageResult.eventId || null
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

  async persistLineageInTransaction(payload, session) {
    const shouldFailHard = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';

    if (!this.lineageRepository) {
      const error = new Error('[RF023][LINEAGE] Repositório canônico de linhagem ausente');
      if (shouldFailHard) throw error;
      logger.warn(error.message);
      return { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };
    }

    try {
      await this.lineageRepository.validateBeforePersistence(payload, session);
      const persisted = await this.lineageRepository.recordCustodyEvent(payload, session);
      return {
        lineageValidated: true,
        lineagePersisted: true,
        lineageQueued: persisted?.queued !== false,
        eventId: persisted?.eventId || null
      };
    } catch (error) {
      logger.error('[RF023][LINEAGE] Falha na validação/outbox transacional (allocate):', error.message || error);
      if (shouldFailHard) {
        throw new Error(`RF023_LINEAGE_VALIDATION_FAILED: ${error.message || 'operação bloqueada'}`);
      }
      return { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };
    }
  }
}

module.exports = AllocateSampleUseCase;
