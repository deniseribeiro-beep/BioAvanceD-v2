const logger = require('../../../utils/logger');
const env = require('../../../config/env');

/**
 * Caso de uso: mover uma amostra entre posições de armazenamento.
 *
 * Regras de negócio:
 * - A amostra deve existir e possuir localização de origem.
 * - O destino deve ser válido e estar livre.
 * - Escritas de estado + auditoria devem ocorrer na mesma transação Mongo.
 * - Operações de linhagem (Neo4j) devem ser validadas e persistidas antes do MongoDB
 *   conforme exigência de cadeia de custódia ISO 20387.
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
   *  sampleId: string,
   *  targetBoxId: string,
   *  targetPosition: string,
   *  reason?: string,
   *  notes?: string,
   *  actor: { userId?: string|null, userName?: string|null, userRole?: string|null, ipAddress?: string|null, userAgent?: string|null }
   * }} command
   * @returns {Promise<{ success: boolean, movementID: number, sampleId: string, from: { boxId: string, position: string }, to: { boxId: string, position: string }, movedAt: Date, lineageSynced: boolean }>}
   */
  async execute(command) {
    this.validateCommand(command);

    const snapshotSample = await this.storageRepository.findSampleById(command.sampleId);
    if (!snapshotSample) {
      throw new Error('Amostra não encontrada');
    }

    const sourceBoxId = snapshotSample?.storageLocation?.boxId;
    const sourcePosition = snapshotSample?.storageLocation?.position;
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

    const lineageResult = await this.ensureLineageBeforeMongo({
      sampleId: String(snapshotSample._id),
      barcode: snapshotSample.barcode || null,
      eventType: 'move',
      from,
      to,
      actorId: command?.actor?.userId || null,
      reason: command.reason || null,
      happenedAt: new Date()
    });

    let movementID = null;
    let movedAt = new Date();
    let sampleSnapshot = null;

    await this.storageRepository.withTransaction(async (session) => {
      const sample = await this.storageRepository.findSampleById(command.sampleId, session);
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const sourceBoxId = sample?.storageLocation?.boxId;
      const sourcePosition = sample?.storageLocation?.position;
      if (!sourceBoxId || !sourcePosition) {
        throw new Error('Amostra não possui localização de origem para movimentação');
      }

      const targetBox = await this.storageRepository.findBoxById(to.boxId, session);
      if (!targetBox) {
        throw new Error('Caixa de destino não encontrada');
      }

      await this.storageRepository.moveSamplePosition(
        {
          sampleId: command.sampleId,
          fromBoxId: from.boxId,
          fromPosition: from.position,
          toBoxId: to.boxId,
          toPosition: to.position
        },
        session
      );

      movedAt = new Date();
      sampleSnapshot = {
        sampleId: String(sample._id),
        barcode: sample.barcode || null
      };

      const auditResult = await this.auditRepository.appendImmutableAudit(
        {
          sampleId: String(sample._id),
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
    });

    return {
      success: true,
      movementID,
      sampleId: sampleSnapshot.sampleId,
      from,
      to,
      movedAt,
      lineageSynced: lineageResult.lineagePersisted,
      lineageValidated: lineageResult.lineageValidated,
      lineagePersisted: lineageResult.lineagePersisted
    };
  }

  /**
   * @param {any} command
   */
  validateCommand(command) {
    if (!command || typeof command !== 'object') {
      throw new Error('Comando de movimentação inválido');
    }

    if (!command.sampleId) {
      throw new Error('sampleId é obrigatório');
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
      logger.error('[ISO20387][LINEAGE] Falha na validação/persistência pré-Mongo (move):', error.message || error);
      if (shouldFailHard) {
        throw new Error('ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB');
      }
      return { lineageValidated: false, lineagePersisted: false };
    }
  }
}

module.exports = MoveSampleUseCase;
