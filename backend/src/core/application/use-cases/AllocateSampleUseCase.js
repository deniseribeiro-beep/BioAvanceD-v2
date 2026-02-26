const env = require('../../../config/env');
const logger = require('../../../utils/logger');

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
   * @param {{ sampleId: string, boxId: string, position: string, actor: { userId?: string|null, userName?: string|null, userRole?: string|null, ipAddress?: string|null, userAgent?: string|null } }} command
   */
  async execute(command) {
    this.validateCommand(command);

    const normalizedPosition = String(command.position).trim().toUpperCase();
    const sample = await this.storageRepository.findSampleById(command.sampleId);
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    const beforeLocation = sample.storageLocation
      ? {
          boxId: sample.storageLocation.boxId ? String(sample.storageLocation.boxId) : null,
          position: sample.storageLocation.position ? String(sample.storageLocation.position).toUpperCase() : null
        }
      : null;

    const lineageResult = await this.ensureLineageBeforeMongo({
      sampleId: String(sample._id),
      barcode: sample.barcode || null,
      eventType: 'allocate',
      from: beforeLocation,
      to: {
        boxId: String(command.boxId),
        position: normalizedPosition
      },
      actorId: command?.actor?.userId || null,
      reason: 'allocate'
    });

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.sampleId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const beforeLocation = sample.storageLocation
        ? {
            boxId: sample.storageLocation.boxId ? String(sample.storageLocation.boxId) : null,
            position: sample.storageLocation.position ? String(sample.storageLocation.position).toUpperCase() : null
          }
        : null;

      await this.storageRepository.allocateSamplePosition(
        {
          sampleId: command.sampleId,
          boxId: command.boxId,
          position: normalizedPosition
        },
        session
      );

      await this.auditRepository.appendImmutableAudit(
        {
          sampleId: String(sample._id),
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
        sampleId: String(command.sampleId),
        boxId: String(command.boxId),
        position: normalizedPosition
      },
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted
    };
  }

  /**
   * @param {any} command
   */
  validateCommand(command) {
    if (!command?.sampleId || !command?.boxId || !command?.position) {
      throw new Error('sampleId, boxId e position são obrigatórios');
    }
  }

  async ensureLineageBeforeMongo(payload) {
    const shouldFailHard = env.NODE_ENV === 'production';

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
      await this.lineageRepository.recordCustodyEvent(payload);
      return { lineageValidated: true, lineagePersisted: true };
    } catch (error) {
      logger.error('[ISO20387][LINEAGE] Falha na validação/persistência pré-Mongo (allocate):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false, lineagePersisted: false };
    }
  }
}

module.exports = AllocateSampleUseCase;
