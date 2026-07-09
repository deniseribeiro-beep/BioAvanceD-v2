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

    const sourceLocation = sampleSnapshot?.storageLocation;
    if (!sourceLocation?.boxId || !sourceLocation?.position) {
      throw new Error('Amostra não possui localização de armazenamento');
    }

    const lineageResult = await this.ensureLineageBeforeMongo({
      specimenId: String(sampleSnapshot._id),
      barcode: sampleSnapshot.barcode || null,
      eventType: 'release',
      from: {
        boxId: String(sourceLocation.boxId),
        position: String(sourceLocation.position).toUpperCase()
      },
      to: null,
      actorId: command?.actor?.userId || null,
      reason: 'release',
      happenedAt: new Date()
    });

    let releasedFrom = null;

    try {
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
            timestamp: new Date()
          },
          session
        );
      });
    } catch (mongoError) {
      await this.compensateLineageIfNeeded(lineageResult, String(sampleSnapshot._id));
      throw mongoError;
    }

    return {
      success: true,
      releasedFrom,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted,
      lineageEventId: lineageResult.eventId || null
    };
  }

  async ensureLineageBeforeMongo(payload) {
    const shouldFailHard = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';

    if (!this.lineageRepository) {
      const error = new Error('[ISO20387][LINEAGE] Repositório Neo4j ausente para operação de custódia');
      if (shouldFailHard) {
        throw error;
      }
      logger.warn(error.message);
      return { lineageValidated: false, lineagePersisted: false };
    }

    try {
      await this.lineageRepository.validateBeforePersistence(payload);
      const persisted = await this.lineageRepository.recordCustodyEvent(payload);
      return { lineageValidated: true, lineagePersisted: true, eventId: persisted?.eventId || null };
    } catch (error) {
      logger.error('[ISO20387][LINEAGE] Falha na validação/persistência pré-Mongo (release):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false, lineagePersisted: false, eventId: null };
    }
  }

  async compensateLineageIfNeeded(lineageResult, specimenId) {
    if (!lineageResult?.lineagePersisted || !lineageResult?.eventId || !this.lineageRepository) {
      return;
    }

    try {
      await this.lineageRepository.compensateCustodyEvent({
        eventId: lineageResult.eventId,
        specimenId,
        reason: 'mongo_transaction_failed'
      });
      logger.warn('[ISO20387][SAGA] Compensação Neo4j concluída após falha Mongo (release)');
    } catch (compensationError) {
      logger.error('[ISO20387][SAGA] Falha ao compensar evento de linhagem (release):', compensationError.message || compensationError);
    }
  }
}

module.exports = ReleaseSampleUseCase;
