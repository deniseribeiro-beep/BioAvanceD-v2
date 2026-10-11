const logger = require('../../utils/logger');
const env = require('../../config/env');

/**
 * Caso de uso: mover uma amostra entre posições de armazenamento.
 *
 * Regras de negócio:
 * - A amostra deve existir e possuir localização de origem.
 * - O destino deve ser válido e estar livre.
 * - Escritas de estado + auditoria devem ocorrer na mesma transação Mongo.
 * - O evento de custódia (ISO 20387) é validado antes do MongoDB e registrado no
 *   outbox do grafo na mesma transação (#1312); nenhuma escrita direta no Neo4j.
 */
class MoveSampleUseCase {
  /**
   * @param {{
   *  storageRepository: import('../ports/IStorageRepository'),
   *  auditRepository: import('../ports/IAuditRepository'),
   *  lineageRepository?: import('../ports/ILineageRepository')
   * }} deps
   */
  constructor({ storageRepository, auditRepository, lineageRepository }) {
    this.storageRepository = storageRepository;
    this.auditRepository = auditRepository;
    this.lineageRepository = lineageRepository;
  }

  /**
   * @param {{
   *  specimenId: string,
   *  targetBoxId: string,
   *  targetPosition: string,
   *  reason?: string,
   *  notes?: string,
   *  actor: { userId?: string|null, userName?: string|null, userRole?: string|null, ipAddress?: string|null, userAgent?: string|null }
   * }} command
   * @returns {Promise<{ success: boolean, movementID: number, specimenId: string, from: { boxId: string, position: string }, to: { boxId: string, position: string }, movedAt: Date, lineageSynced: boolean }>}
   */
  async execute(command) {
    this.validateCommand(command);

    const snapshotSample = await this.storageRepository.findSampleById(command.specimenId);
    if (!snapshotSample) {
      throw new Error('Amostra não encontrada');
    }

    const sourceBoxId = snapshotSample?.storageAssignment?.boxId;
    const sourcePosition = snapshotSample?.storageAssignment?.positionCode;
    if (!sourceBoxId || !sourcePosition) {
      throw new Error('Amostra não possui localização de origem para movimentação');
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
    if (!targetBox) {
      throw new Error('Caixa de destino não encontrada');
    }

    const lineagePayload = {
      specimenId: String(snapshotSample._id),
      barcode: snapshotSample.barcode || null,
      eventType: 'move',
      from,
      to,
      actorId: command?.actor?.userId || null,
      reason: command.reason || null,
      happenedAt: new Date()
    };
    const lineageResult = await this.validateLineageBeforeMongo(lineagePayload);
    let lineageEventId = null;

    let movementID = null;
    let movedAt = new Date();
    let sampleSnapshot = null;

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.specimenId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const sourceBoxId = sample?.storageAssignment?.boxId;
      const sourcePosition = sample?.storageAssignment?.positionCode;
      if (!sourceBoxId || !sourcePosition) {
        throw new Error('Amostra não possui localização de origem para movimentação');
      }

      const targetBox = await this.storageRepository.findBoxById(to.boxId, session);
      if (!targetBox) {
        throw new Error('Caixa de destino não encontrada');
      }

      await this.storageRepository.moveSamplePosition(
        {
          specimenId: command.specimenId,
          fromBoxId: from.boxId,
          fromPosition: from.position,
          toBoxId: to.boxId,
          toPosition: to.position
        },
        session
      );

      movedAt = new Date();
      sampleSnapshot = {
        specimenId: String(sample._id),
        barcode: sample.barcode || null
      };

      const auditResult = await this.auditRepository.appendImmutableAudit(
        {
          specimenId: String(sample._id),
          barcode: sample.barcode || null,
          eventType: 'move',
          before: {
            storageLocation: {
              boxId: from.boxId,
              position: from.position
            }
          },
          after: {
            storageLocation: {
              boxId: to.boxId,
              position: to.position
            }
          },
          context: {
            reason: command.reason || null,
            notes: command.notes || null,
            actor: command.actor
          },
          timestamp: movedAt
        },
        session
      );

      movementID = auditResult.movementID;

      lineageEventId = await this.recordLineageInTransaction(
        lineageResult,
        { ...lineagePayload, happenedAt: movedAt },
        session
      );
    });

    return {
      success: true,
      movementID,
      specimenId: sampleSnapshot.specimenId,
      from,
      to,
      movedAt,
      lineageSynced: lineageResult.lineageValidated,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineageValidated,
      lineageEventId
    };
  }

  /**
   * @param {any} command
   */
  validateCommand(command) {
    if (!command || typeof command !== 'object') {
      throw new Error('Comando de movimentação inválido');
    }

    if (!command.specimenId) {
      throw new Error('specimenId é obrigatório');
    }

    if (!command.targetBoxId) {
      throw new Error('targetBoxId é obrigatório');
    }

    if (!command.targetPosition || typeof command.targetPosition !== 'string') {
      throw new Error('targetPosition é obrigatório');
    }

    const positionRegex = /^([A-Z])(\d+)$/;
    if (!positionRegex.test(command.targetPosition.trim().toUpperCase())) {
      throw new Error('targetPosition deve seguir formato Letra+Número (ex: A1, B4)');
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
      logger.error('[ISO20387][LINEAGE] Falha na validação pré-Mongo (move):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false };
    }
  }

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append inside the
  // move's own transaction, never a Neo4j write. A failed append aborts the
  // transaction, so the move is refused in either LINEAGE_MODE and MongoDB
  // never keeps a step the graph was not told about.
  async recordLineageInTransaction(lineageResult, payload, session) {
    if (!lineageResult?.lineageValidated) {
      return null;
    }
    const persisted = await this.lineageRepository.recordCustodyEvent(payload, { session });
    return persisted?.eventId || null;
  }
}

module.exports = MoveSampleUseCase;
