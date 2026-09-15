const env = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Caso de uso: alocar amostra em posição física.
 * Estado canônico, auditoria e outbox são persistidos na mesma transação
 * MongoDB; Neo4j permanece somente como projeção assíncrona derivada.
 */
class AllocateSampleUseCase {
  constructor({ storageRepository, auditRepository, lineageRepository }) {
    this.storageRepository = storageRepository;
    this.auditRepository = auditRepository;
    this.lineageRepository = lineageRepository;
  }

  async execute(command) {
    this.validateCommand(command);

    const normalizedPosition = String(command.position).trim().toUpperCase();
    const snapshot = await this.storageRepository.findSampleById(command.specimenId);
    if (!snapshot) throw new Error('Amostra não encontrada');

    let lineageResult = {
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      eventId: null
    };

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) throw new Error('Amostra não encontrada');

      const beforePlacement = sample.currentStoragePlacement
        ? {
            boxId: sample.currentStoragePlacement.boxId
              ? String(sample.currentStoragePlacement.boxId)
              : null,
            position: sample.currentStoragePlacement.positionCode
              ? String(sample.currentStoragePlacement.positionCode).toUpperCase()
              : null
          }
        : null;

      const lineagePayload = {
        specimenId: String(sample._id),
        barcode: sample.barcode || null,
        eventType: 'allocate',
        from: beforePlacement,
        to: { boxId: String(command.boxId), position: normalizedPosition },
        actorId: command?.actor?.userId || null,
        reason: 'allocate',
        happenedAt: new Date()
      };

      lineageResult = await this.persistLineageInTransaction(lineagePayload, session);

      await this.storageRepository.allocateSamplePosition({
        specimenId: command.specimenId,
        boxId: command.boxId,
        position: normalizedPosition
      }, session);

      await this.auditRepository.appendImmutableAudit({
        specimenId: String(sample._id),
        barcode: sample.barcode || null,
        eventType: 'allocate',
        before: { physicalStorage: beforePlacement },
        after: {
          physicalStorage: { boxId: String(command.boxId), position: normalizedPosition }
        },
        context: { actor: command.actor, reason: 'allocate' },
        timestamp: new Date()
      }, session);
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
