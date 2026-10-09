const mongoose = require('mongoose');
const { ObjectId } = require('mongodb'); // Native MongoDB driver para evitar conflitos BSON
const logger = require('../utils/logger');
const { GraphProjectionService } = require('./graphProjection.service');
const { getCollection } = require('../utils/collectionResolver');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const positionGrid = require('../utils/storagePositionGrid');
// #988: same guard MongoStorageRepository.withTransaction applies to
// allocate/move/release -- autoAssignSampleToBox is the fourth storage
// endpoint that runs a Mongo transaction, and it was the only one still
// opening a raw session with no topology attribution.
const { isKnownStandaloneDeployment } = require('../utils/mongoTransaction');

/**
 * #988: identical wording to the error MongoStorageRepository.withTransaction
 * throws for allocate/move/release, kept here (not imported) because
 * autoAssignSampleToBox does not go through that repository method -- it
 * opens its own raw session. See that method's own comment for the full
 * context of why this check exists.
 */
const STANDALONE_DEPLOYMENT_TRANSACTION_ERROR =
  'Transação Mongo indisponível: esta implantação não é um replica set nem mongos. ' +
  'Alocação, movimentação e liberação de amostras exigem transação (RF006 item 7, F3-G10). ' +
  'Configure o mongod com --replSet (ver compose.test.yml) ou aponte MONGO_URI para um replica set.';

/**
 * Storage Service - Núcleo de Armazenamento Físico
 * Responsável por:
 * - Validação de disponibilidade de posições
 * - Detecção de colisão (STORAGE_COLLISION)
 * - Alocação atômica de amostras
 * - Liberação de posições
 *
 * Data: Feb 12, 2026 (Semana 2)
 * RFC: ISO 20387 compliance
 */
class StorageService {
  // #1312: no Neo4j driver. The graph is reached only through the outbox.
  constructor(db, options = {}) {
    this.db = db;
    this.graphProjection = options?.graphProjection || new GraphProjectionService();
    this.storageRepository = new MongoStorageRepository(db);
    this.auditRepository = new MongoAuditRepository(db);
  }

  _normalizeObjectId(value) {
    if (value instanceof ObjectId) {
      return value;
    }

    if (typeof value === 'string' && ObjectId.isValid(value)) {
      return new ObjectId(value);
    }

    return value;
  }

  _findFirstAvailablePosition(box) {
    return positionGrid.findFirstAvailablePosition(box);
  }

  /**
   * Alocação dinâmica baseada em capacidade e disponibilidade.
   *
   * Localiza automaticamente a próxima posição vazia da box em leitura row-major
   * (ex: A1, A2, A3...) e cria de forma idempotente o nó de Location no grafo,
   * vinculando a amostra por STORED_IN e a posição por PART_OF.
   *
   * Fluxo:
   * - consulta a caixa e a amostra no MongoDB;
   * - identifica a primeira coordenada vazia compatível com o grid da box;
   * - grava a posição em storageBoxes.currentOccupancy/occupancyGrid e storageLocation;
   * - sincroniza o grafo Neo4j com (Specimen)-[:STORED_IN]->(Location)-[:PART_OF]->(Box).
   *
   * @param {ObjectId|string} specimenId - ID da amostra (specimen) a ser alocada.
   * @param {ObjectId|string} boxId - ID da box de destino.
   * @returns {Promise<{ success: boolean, sampleLocation?: { specimenId: string, boxId: string, position: string }, graphPersisted?: boolean, error?: string, message?: string }>}
   */
  async autoAssignSampleToBox(specimenId, boxId) {
    const sampleObjId = this._normalizeObjectId(specimenId);
    const boxObjId = this._normalizeObjectId(boxId);
    let assignedPosition = null;
    let boxSnapshot = null;
    let sampleSnapshot = null;

    try {
      // #988: same topology refusal MongoStorageRepository.withTransaction
      // gives allocate/move/release, applied narrowly here since this method
      // opens its own raw session rather than going through that repository
      // method. Deliberately before startSession() below.
      // #994: this pre-check is now redundant with the identical refusal
      // inside storageRepository.withTransaction below, and is kept
      // DELIBERATELY. The repository's copy runs at the transaction, which is
      // after the two reads below -- so without this a standalone deployment
      // would answer BOX_NOT_FOUND/SAMPLE_NOT_FOUND before it ever reported
      // the topology problem. Removing it would silently regress e47219c6's
      // ordering, which is the only part of #988 part 1 that survived.
      if (await isKnownStandaloneDeployment(this.db)) {
        throw new Error(STANDALONE_DEPLOYMENT_TRANSACTION_ERROR);
      }

      boxSnapshot = await this.storageRepository.findBoxById(boxObjId);
      if (!boxSnapshot) {
        return {
          success: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        };
      }

      sampleSnapshot = await this.storageRepository.findSampleById(sampleObjId);
      if (!sampleSnapshot) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${specimenId} não encontrada`
        };
      }

      if (sampleSnapshot.storageAssignment?.boxId && sampleSnapshot.storageAssignment?.positionCode) {
        return {
          success: false,
          error: 'ALREADY_ALLOCATED',
          message: `Amostra já está alocada em ${sampleSnapshot.storageAssignment.boxId}/${sampleSnapshot.storageAssignment.positionCode}`
        };
      }

      const nextPosition = this._findFirstAvailablePosition(boxSnapshot);
      if (!nextPosition) {
        return {
          success: false,
          error: 'BOX_FULL',
          message: 'Nenhuma posição disponível nesta box'
        };
      }

      // #994: was `session = this.db.getMongo().startSession()` plus a raw
      // `session.withTransaction(...)`. `getMongo()` is a MONGOSH method --
      // the native driver's Db has no such thing, so this endpoint threw
      // `TypeError: this.db.getMongo is not a function` on every real
      // deployment, before it opened a session and before any write. Routing
      // through the repository's own withTransaction is what the three
      // sibling use-cases (allocate/move/release) already do, and it brings
      // the correct client derivation, the topology refusal and session
      // lifecycle with it instead of hand-rolling a fourth copy.
      await this.storageRepository.withTransaction(async (session) => {
        assignedPosition = await this.storageRepository.autoAssignSamplePosition(
          { specimenId: sampleObjId, boxId: boxObjId },
          session
        );

        // #988: the other three storage endpoints (allocate/move/release)
        // each append an immutable audit row inside their transaction --
        // autoAssignSampleToBox wrote none. Mirrors releaseSampleFromPosition's
        // shape (context.actor/timestamp convention) below, appended in the
        // same transaction so a committed relocation can never land without
        // its custody row.
        await this.auditRepository.appendImmutableAudit(
          {
            specimenId: sampleObjId.toString(),
            barcode: sampleSnapshot?.barcode || null,
            eventType: 'auto_allocate',
            before: {
              storageLocation: null
            },
            after: {
              storageLocation: { boxId: String(boxObjId), position: assignedPosition }
            },
            context: {
              actor: { userName: 'SYSTEM' }
            },
            timestamp: new Date()
          },
          session
        );

        // #1312 (RF023 AC8): the graph learns the placement through the
        // outbox, never a direct Neo4j write; the projector writes the
        // canonical Sample-[:STORED_AT]->StoragePosition. The event carries
        // assignedPosition, the position this transaction writes, never the
        // pre-transaction scan (#1004). #1313 (RF023 AC3): appended in the
        // same transaction, so a failed append aborts the placement and Mongo
        // never keeps one the projection was not told about.
        if (assignedPosition) {
          await this.graphProjection.appendStoragePositionEvent(this.db, {
            specimenId: String(sampleObjId),
            boxId: String(boxObjId),
            position: assignedPosition,
            sourceService: 'storage-service'
          }, { session });
        }
      });

      logger.info(`✅ Alocação inteligente realizada para amostra ${specimenId} em ${boxId}/${assignedPosition}`);

      return {
        success: true,
        // The placement's projection event is recorded; the projector applies it.
        graphPersisted: Boolean(assignedPosition),
        sampleLocation: {
          specimenId: String(sampleObjId),
          boxId: String(boxObjId),
          position: assignedPosition
        }
      };
    } catch (error) {
      logger.error('[Storage] Erro na alocação inteligente:', error);

      return {
        success: false,
        error: error.message === 'BOX_NOT_FOUND'
          ? 'BOX_NOT_FOUND'
          : error.message === 'SAMPLE_NOT_FOUND'
            ? 'SAMPLE_NOT_FOUND'
            : error.message === 'ALREADY_ALLOCATED'
              ? 'ALREADY_ALLOCATED'
              : error.message === 'BOX_FULL'
                ? 'BOX_FULL'
                : 'AUTO_ASSIGNMENT_ERROR',
        message: error.message || 'Erro ao realizar alocação inteligente'
      };
    }
    // #994: the `finally { session.endSession() }` that stood here is gone
    // with the raw session -- storageRepository.withTransaction owns the
    // session lifecycle and ends it in its own finally.
  }

  /**
   * Liberar amostra de uma posição
   * Remove de occupancyGrid e atualiza amostra
   *
   * @param {ObjectId} specimenId - ID da amostra
   * @returns {Promise<{ success: boolean, error?: string, releasedFrom?: object }>}
   */
  async releaseSampleFromPosition(specimenId) {
    try {
      // Converter specimenId
      let sampleObjId;
      try {
        sampleObjId = ObjectId.isValid(specimenId) ? new ObjectId(specimenId) : specimenId;
      } catch (err) {
        console.error('[Storage] Erro ao converter specimenId:', err);
        sampleObjId = specimenId;
      }

      // Buscar amostra e sua StorageAssignment canônica (dict-02 ELM-0167-0178, #507)
      // em vez do snapshot legado sample.storageLocation.
      const sample = await this.storageRepository.findSampleById(sampleObjId);

      if (!sample) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${specimenId} não encontrada`
        };
      }

      if (!sample.storageAssignment?.boxId || !sample.storageAssignment?.positionCode) {
        return {
          success: false,
          error: 'NO_STORAGE_LOCATION',
          message: 'Amostra não possui localização de armazenamento'
        };
      }

      const boxId = sample.storageAssignment.boxId;
      const position = sample.storageAssignment.positionCode;

      // Liberar posição (occupancyGrid da box + storageLocation da amostra),
      // via MongoStorageRepository para não duplicar a lógica atômica de escrita.
      await this.storageRepository.releaseSamplePosition({ specimenId: sampleObjId });

      // Registrar auditoria (mesmo ledger sample_movements usado pelos use-cases)
      await this.auditRepository.appendImmutableAudit({
        specimenId: sampleObjId.toString(),
        barcode: sample.barcode,
        eventType: 'release',
        before: {
          storageLocation: { boxId, position },
          quantity: sample.quantity,
          unit: sample.unit || 'µL'
        },
        after: {
          storageLocation: null
        },
        context: {
          actor: { userName: 'SYSTEM' }
        },
        timestamp: new Date()
      });

      logger.info(`✅ Amostra ${specimenId} liberada de ${boxId}/${position}`);

      return {
        success: true,
        releasedFrom: {
          specimenId,
          boxId,
          position
        }
      };
    } catch (error) {
      logger.error('Erro ao liberar posição:', error);
      return {
        success: false,
        error: 'RELEASE_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Gerar todas as posições válidas para uma caixa
   * Helper method - privado
   *
   * @private
   */
  _getAllValidPositions(dimension) {
    return positionGrid.getAllValidPositions(dimension);
  }

  /**
   * Verificar integridade de ocupação de uma caixa (auditoria)
   *
   * @param {ObjectId} boxId - ID da StorageBox
   * @returns {Promise<{ valid: boolean, errors?: array }>}
   */
  async verifyBoxIntegrity(boxId) {
    try {
      const storageBoxesCollection = this.db.collection('storageBoxes');
      const samplesCollection = await getCollection(this.db, 'samples');

      let boxObjId;
      try {
        boxObjId = ObjectId.isValid(boxId) ? new ObjectId(boxId) : boxId;
      } catch (err) {
        console.error('[Storage] Erro ao converter boxId:', err);
        boxObjId = boxId;
      }

      const box = await storageBoxesCollection.findOne({ _id: boxObjId });

      if (!box) {
        return {
          valid: false,
          error: 'BOX_NOT_FOUND'
        };
      }

      const errors = [];
      let actualCount = 0;

      // Verificar cada posição ocupada
      for (const [position, specimenId] of (box.occupancyGrid || new Map())) {
        if (specimenId) {
          actualCount++;

          // Confirmar que amostra ainda existe e está apontando para essa posição
          const sample = await samplesCollection.findOne({ _id: specimenId });

          if (!sample) {
            errors.push(`Orfão: posição ${position} referencia amostra inexistente ${specimenId}`);
          } else if (
            sample.storageLocation?.boxId?.toString() !== boxObjId.toString() ||
            sample.storageLocation?.position !== position
          ) {
            errors.push(
              `Inconsistência: Box referencia ${specimenId} em ${position}, ` +
              `mas amostra aponta para ${sample.storageLocation?.boxId}/${sample.storageLocation?.position}`
            );
          }
        }
      }

      // Verificar if currentOccupancy está correto
      if (actualCount !== box.currentOccupancy) {
        errors.push(
          `Contagem incorreta: currentOccupancy=${box.currentOccupancy}, mas ocupação real=${actualCount}`
        );
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        stats: {
          boxId: box._id,
          dimension: box.dimension,
          capacity: box.dimension.rows * box.dimension.cols,
          currentOccupancy: box.currentOccupancy,
          actualOccupancy: actualCount
        }
      };
    } catch (error) {
      logger.error('Erro ao verificar integridade de caixa:', error);
      return {
        valid: false,
        error: 'INTEGRITY_CHECK_ERROR',
        message: error.message
      };
    }
  }

}

module.exports = StorageService;
