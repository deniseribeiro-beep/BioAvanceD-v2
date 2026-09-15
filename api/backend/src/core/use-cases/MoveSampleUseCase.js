const logger = require('../../utils/logger');
const env = require('../../config/env');

/**
 * Caso de uso: mover uma amostra entre posições físicas.
 * Estado canônico, auditoria e outbox são atômicos no MongoDB; Neo4j é
 * somente projeção assíncrona derivada.
 */
class MoveSampleUseCase {
  constructor({ storageRepository, auditRepository, lineageRepository }) {
    this.storageRepository = storageRepository;
    this.auditRepository = auditRepository;
    this.lineageRepository = lineageRepository;
  }

  async execute(command) {
    this.validateCommand(command);

    const snapshotSample = await this.storageRepository.findSampleById(command.specimenId);
    if (!snapshotSample) throw new Error('Amostra não encontrada');

    const sourceBoxId = snapshotSample?.currentStoragePlacement?.boxId;
    const sourcePosition = snapshotSample?.currentStoragePlacement?.positionCode;
    if (!sourceBoxId || !sourcePosition) {
      throw new Error('Amostra não possui posicionamento físico de origem para movimentação');
    }

    const from = {
      boxId: String(sourceBoxId),
      position: String(sourcePosition).toUpperCase()
    };
    const to = {
      boxId: String(command.targetBoxId),
      position: String(command.targetPosition).trim().toUpperCase()
    };

    if (from.boxId === to.boxId && from.position === to.position) {
      throw new Error('A posição de destino deve ser diferente da posição atual');
    }

    const targetBox = await this.storageRepository.findBoxById(to.boxId);
    if (!targetBox) throw new Error('Caixa de destino não encontrada');

    let movementID = null;
    let movedAt = new Date();
    let sampleSnapshot = null;
    let lineageResult = {
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      eventId: null
    };

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) throw new Error('Amostra não encontrada');

      const currentBoxId = sample?.currentStoragePlacement?.boxId;
      const currentPosition = sample?.currentStoragePlacement?.positionCode;
      if (!currentBoxId || !currentPosition) {
        throw new Error('Amostra não possui posicionamento físico de origem para movimentação');
      }

      const currentFrom = {
        boxId: String(currentBoxId),
        position: String(currentPosition).toUpperCase()
      };
      if (currentFrom.boxId !== from.boxId || currentFrom.position !== from.position) {
        throw new Error('Posicionamento físico de origem mudou durante a operação; recarregue a amostra');
      }

      const target = await this.storageRepository.findBoxById(to.boxId, session);
      if (!target) throw new Error('Caixa de destino não encontrada');

      movedAt = new Date();
      lineageResult = await this.persistLineageInTransaction({
        specimenId: String(sample._id),
        barcode: sample.barcode || null,
        eventType: 'move',
        from,
        to,
        actorId: command?.actor?.userId || null,
        reason: command.reason || null,
        happenedAt: movedAt
      }, session);

      await this.storageRepository.moveSamplePosition({
        specimenId: command.specimenId,
        fromBoxId: from.boxId,
        fromPosition: from.position,
        toBoxId: to.boxId,
        toPosition: to.position
      }, session);

      sampleSnapshot = {
        specimenId: String(sample._id),
        barcode: sample.barcode || null
      };

      const auditResult = await this.auditRepository.appendImmutableAudit({
        specimenId: String(sample._id),
        barcode: sample.barcode || null,
        eventType: 'move',
        before: { physicalStorage: { boxId: from.boxId, position: from.position } },
        after: { physicalStorage: { boxId: to.boxId, position: to.position } },
        context: {
          reason: command.reason || null,
          notes: command.notes || null,
          actor: command.actor
        },
        timestamp: movedAt
      }, session);

      movementID = auditResult.movementID;
    });

    return {
      success: true,
      movementID,
      specimenId: sampleSnapshot.specimenId,
      from,
      to,
      movedAt,
      lineageSynced: lineageResult.lineagePersisted,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted,
      lineageQueued: lineageResult.lineageQueued,
      lineageEventId: lineageResult.eventId || null
    };
  }

  validateCommand(command) {
    if (!command || typeof command !== 'object') throw new Error('Comando de movimentação inválido');
    if (!command.specimenId) throw new Error('specimenId é obrigatório');
    if (!command.targetBoxId) throw new Error('targetBoxId é obrigatório');
    if (!command.targetPosition || typeof command.targetPosition !== 'string') {
      throw new Error('targetPosition é obrigatório');
    }
    const positionRegex = /^([A-Z])(\d+)$/;
    if (!positionRegex.test(command.targetPosition.trim().toUpperCase())) {
      throw new Error('targetPosition deve seguir formato Letra+Número (ex: A1, B4)');
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
      logger.error('[RF023][LINEAGE] Falha na validação/outbox transacional (move):', error.message || error);
      if (shouldFailHard) {
        throw new Error(`RF023_LINEAGE_VALIDATION_FAILED: ${error.message || 'operação bloqueada'}`);
      }
      return { lineageValidated: false, lineagePersisted: false, lineageQueued: false, eventId: null };
    }
  }
}

module.exports = MoveSampleUseCase;
