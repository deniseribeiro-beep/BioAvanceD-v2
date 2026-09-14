const env = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Caso de uso: liberar posição física atual da amostra.
 * RF023 v2: estado, auditoria e outbox são persistidos na mesma transação
 * MongoDB; Neo4j é somente projeção derivada.
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

    let releasedFrom = null;
    let lineageResult = { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const currentAssignment = sample?.storageAssignment;
      if (!currentAssignment?.boxId || !currentAssignment?.positionCode) {
        throw new Error('Amostra não possui localização de armazenamento');
      }

      const happenedAt = new Date();
      const lineagePayload = {
        specimenId: String(sample._id),
        barcode: sample.barcode || null,
        eventType: 'release',
        from: {
          boxId: String(currentAssignment.boxId),
          position: String(currentAssignment.positionCode).toUpperCase()
        },
        to: null,
        actorId: command?.actor?.userId || null,
        reason: 'release',
        happenedAt
      };

      lineageResult = await this.persistLineageInTransaction(lineagePayload, session);

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
          specimenId: String(sample._id),
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
          timestamp: happenedAt
        },
        session
      );
    });

    return {
      success: true,
      releasedFrom,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted,
      lineageQueued: lineageResult.lineageQueued,
      lineageEventId: lineageResult.eventId || null
    };
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
      logger.error('[RF023][LINEAGE] Falha na validação/outbox transacional (release):', error.message || error);
      if (shouldFailHard) {
        throw new Error(`RF023_LINEAGE_VALIDATION_FAILED: ${error.message || 'operação bloqueada'}`);
      }
      return { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };
    }
  }
}

module.exports = ReleaseSampleUseCase;
