const mongoose = require('mongoose');
const { ObjectId } = require('mongodb'); // Native MongoDB driver para evitar conflitos BSON
const env = require('../config/env');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const positionGrid = require('../utils/storagePositionGrid');

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
  constructor(db, neo4jDriver = null) {
    this.db = db;
    this.neo4jDriver = neo4jDriver || db?.neo4jDriver || null;
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

  _isPositionOccupied(occupancyGrid, position) {
    return positionGrid.isPositionOccupied(occupancyGrid, position);
  }

  _findFirstAvailablePosition(box) {
    return positionGrid.findFirstAvailablePosition(box);
  }

  /**
   * FUNÇÃO PRINCIPAL: Validate Position Availability (Collision Detector)
   *
   * Verifica se uma posição está disponível de forma SEGURA
   * - Valida formato da posição (ex: A1)
   * - Valida se posição cabe nas dimensões da caixa (ex: nem J1 em 9x9)
   * - Verifica colisão com amostras existentes
   *
   * @param {ObjectId} boxId - ID da StorageBox
   * @param {string} position - Posição (ex: "A1", "B4")
   * @returns {Promise<{ available: boolean, error?: string, boxData?: object }>}
   */
  async validatePositionAvailability(boxId, position) {
    try {
      // Validar entrada
      if (!boxId || !position) {
        return {
          available: false,
          error: 'INVALID_INPUT',
          message: 'boxId e position são obrigatórios'
        };
      }

      // Converter boxId para ObjectId se necessário
      let boxObjId;
      try {
        boxObjId = ObjectId.isValid(boxId) ? new ObjectId(boxId) : boxId;
      } catch (err) {
        console.error('[Storage] Erro ao converter boxId:', err);
        boxObjId = boxId;
      }

      // Buscar caixa
      const storageBoxesCollection = this.db.collection('storageBoxes');
      const box = await storageBoxesCollection.findOne({ _id: boxObjId });

      if (!box) {
        return {
          available: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        };
      }

      // 1️⃣ VALIDAÇÃO: Formato de posição (ex: A1, B4, I9)
      const positionRegex = /^([A-Z])(\d+)$/;
      const match = position.match(positionRegex);

      if (!match) {
        return {
          available: false,
          error: 'INVALID_POSITION_FORMAT',
          message: `Posição "${position}" inválida. Usar formato: Letra+Número (ex: A1, B4)`
        };
      }

      // 2️⃣ VALIDAÇÃO: Posição dentro das dimensões da caixa
      const [, rowLetter, colStr] = match;
      const row = rowLetter.charCodeAt(0) - 65; // 0-indexed (A=0, B=1, etc)
      const col = parseInt(colStr, 10);

      const { rows: maxRows, cols: maxCols } = box.dimension;

      if (row >= maxRows || row < 0) {
        return {
          available: false,
          error: 'POSITION_OUT_OF_BOUNDS_ROW',
          message: `Posição "${position}" fora do intervalo. Linhas válidas: A até ${String.fromCharCode(65 + maxRows - 1)}`
        };
      }

      if (col > maxCols || col < 1) {
        return {
          available: false,
          error: 'POSITION_OUT_OF_BOUNDS_COL',
          message: `Posição "${position}" fora do intervalo. Colunas válidas: 1 até ${maxCols}`
        };
      }

      // 3️⃣ VALIDAÇÃO: Colisão (posição já ocupada)
      const occupiedSampleId = this._isPositionOccupied(box.occupancyGrid, position)
        ? (typeof box.occupancyGrid?.get === 'function'
          ? box.occupancyGrid.get(position)
          : box.occupancyGrid[position])
        : null;

      if (occupiedSampleId) {
        return {
          available: false,
          error: 'STORAGE_COLLISION',
          message: `Posição "${position}" já está ocupada por amostra ${occupiedSampleId}`,
          occupiedBySampleId: occupiedSampleId
        };
      }

      // ✅ Posição está disponível!
      return {
        available: true,
        boxData: {
          boxId: box._id,
          boxName: box.name,
          dimension: box.dimension,
          currentOccupancy: box.currentOccupancy,
          capacity: box.dimension.rows * box.dimension.cols,
          availablePositions: (box.dimension.rows * box.dimension.cols) - box.currentOccupancy
        }
      };
    } catch (error) {
      logger.error('Erro em validatePositionAvailability:', error);
      return {
        available: false,
        error: 'INTERNAL_ERROR',
        message: `Erro ao validar posição: ${error.message}`
      };
    }
  }

  /**
   * Alocar amostra a uma posição
   * Operação ATÔMICA: valida + insere em uma transação
   *
   * @param {ObjectId} specimenId - ID da amostra
   * @param {ObjectId} boxId - ID da StorageBox
   * @param {string} position - Posição (ex: "A1")
   * @returns {Promise<{ success: boolean, error?: string, sampleLocation?: object }>}
   */
  async allocateSampleToPosition(specimenId, boxId, position) {
    const session = this.db.getMongo().startSession();

    try {
      // Iniciar transação
      await session.withTransaction(async () => {
        const samplesCollection = await getCollection(this.db, 'samples');

        // Validar disponibilidade primeiro (fora da transação para speedup)
        const validation = await this.validatePositionAvailability(boxId, position);
        if (!validation.available) {
          throw new Error(JSON.stringify(validation));
        }

        // Converter IDs usando MongoDB native driver
        const { ObjectId } = require('mongodb');
        
        let sampleObjId, boxObjId;
        try {
          sampleObjId = ObjectId.isValid(specimenId) ? new ObjectId(specimenId) : specimenId;
          boxObjId = ObjectId.isValid(boxId) ? new ObjectId(boxId) : boxId;
        } catch (err) {
          console.error('[Storage] Erro ao converter ObjectIds:', err);
          sampleObjId = specimenId;
          boxObjId = boxId;
        }

        // CRITICAL SECTION: Dentro da transação

        // 1. Verificar se amostra já está em outra posição
        const existingSample = await samplesCollection.findOne(
          { _id: sampleObjId },
          { session }
        );

        if (!existingSample) {
          throw new Error(`Amostra ${specimenId} não encontrada`);
        }

        if (existingSample.storageLocation?.boxId && existingSample.storageLocation?.position) {
          throw new Error(
            `Amostra já está alocada em ${existingSample.storageLocation.boxId} / ${existingSample.storageLocation.position}`
          );
        }

        // 2 e 3. Alocar posição (occupancyGrid da box + storageLocation da amostra),
        // via MongoStorageRepository para não duplicar a lógica atômica de escrita.
        await this.storageRepository.allocateSamplePosition(
          { specimenId: sampleObjId, boxId: boxObjId, position },
          session
        );

        // 4. Registrar auditoria (mesmo ledger sample_movements usado pelos use-cases)
        await this.auditRepository.appendImmutableAudit(
          {
            specimenId: sampleObjId.toString(),
            barcode: existingSample.barcode,
            eventType: 'allocate',
            before: {
              storageLocation: null,
              quantity: existingSample.quantity,
              unit: existingSample.unit || 'µL'
            },
            after: {
              storageLocation: { boxId: boxObjId.toString(), position }
            },
            context: {
              actor: { userName: 'SYSTEM' }
            },
            timestamp: new Date()
          },
          session
        );
      });

      logger.info(`✅ Amostra ${specimenId} alocada em ${boxId}/${position}`);

      return {
        success: true,
        sampleLocation: {
          specimenId,
          boxId,
          position
        }
      };
    } catch (error) {
      const errorMsg = error.message;

      // Parse error response se for JSON
      let errorObj;
      try {
        errorObj = JSON.parse(errorMsg);
      } catch (e) {
        errorObj = {
          error: 'ALLOCATION_ERROR',
          message: errorMsg
        };
      }

      logger.error(`Erro ao alocar amostra: ${errorMsg}`);

      return {
        success: false,
        ...errorObj
      };
    } finally {
      await session.endSession();
    }
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
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this._normalizeObjectId(specimenId);
    const boxObjId = this._normalizeObjectId(boxId);
    const session = this.db.getMongo().startSession();
    let assignedPosition = null;
    let boxSnapshot = null;
    let sampleSnapshot = null;

    try {
      boxSnapshot = await storageBoxesCollection.findOne({ _id: boxObjId });
      if (!boxSnapshot) {
        return {
          success: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        };
      }

      sampleSnapshot = await samplesCollection.findOne({ _id: sampleObjId });
      if (!sampleSnapshot) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${specimenId} não encontrada`
        };
      }

      if (sampleSnapshot.storageLocation?.boxId && sampleSnapshot.storageLocation?.position) {
        return {
          success: false,
          error: 'ALREADY_ALLOCATED',
          message: `Amostra já está alocada em ${sampleSnapshot.storageLocation.boxId}/${sampleSnapshot.storageLocation.position}`
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

      const positionMatch = nextPosition.match(/^([A-Z])(\d+)$/);
      const rowLetter = positionMatch?.[1] || 'A';
      const column = Number(positionMatch?.[2] || 1);

      await session.withTransaction(async () => {
        assignedPosition = await this.storageRepository.autoAssignSamplePosition(
          { specimenId: sampleObjId, boxId: boxObjId },
          session
        );
      });

      const canPersistGraph = this.neo4jDriver && typeof this.neo4jDriver.session === 'function';
      if (canPersistGraph && assignedPosition) {
        const neo4jSession = this.neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j' });

        try {
          await neo4jSession.run(
            `
              MERGE (specimen:Sample:Specimen {specimenId: $specimenId})
              ON CREATE SET specimen.createdAt = datetime(), specimen.source = 'BioAvanceD'
              SET specimen.updatedAt = datetime(),
                  specimen.barcode = coalesce($barcode, specimen.barcode)

              MERGE (box:StorageBox:Box {mongoBoxId: $boxId})
              ON CREATE SET box.createdAt = datetime(), box.source = 'BioAvanceD'
              SET box.updatedAt = datetime(),
                  box.name = coalesce($boxName, box.name)

              MERGE (location:Location:StoragePosition {boxId: $boxId, coordinate: $coordinate})
              ON CREATE SET location.createdAt = datetime()
              SET location.updatedAt = datetime(),
                  location.coordinate = $coordinate,
                  location.row = $rowLetter,
                  location.column = $column,
                  location.capacity = $capacity

              MERGE (specimen)-[:STORED_IN]->(location)
              MERGE (location)-[:PART_OF]->(box)

              RETURN specimen.specimenId AS specimenId,
                     location.coordinate AS coordinate,
                     box.mongoBoxId AS boxId
            `,
            {
              specimenId: String(sampleObjId),
              boxId: String(boxObjId),
              barcode: sampleSnapshot?.barcode || null,
              boxName: boxSnapshot?.name || null,
              coordinate: assignedPosition,
              rowLetter,
              column,
              capacity: Number(boxSnapshot?.dimension?.rows || 0) * Number(boxSnapshot?.dimension?.cols || 0)
            }
          );
        } catch (neo4jError) {
          const rollbackSession = this.db.getMongo().startSession();
          try {
            await rollbackSession.withTransaction(async () => {
              await this.storageRepository.rollbackAutoAssignedPosition(
                { specimenId: sampleObjId, boxId: boxObjId, position: assignedPosition },
                rollbackSession
              );
            });
          } finally {
            await rollbackSession.endSession();
          }

          throw neo4jError;
        } finally {
          await neo4jSession.close();
        }
      }

      logger.info(`✅ Alocação inteligente realizada para amostra ${specimenId} em ${boxId}/${assignedPosition}`);

      return {
        success: true,
        graphPersisted: Boolean(this.neo4jDriver && typeof this.neo4jDriver.session === 'function'),
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
    } finally {
      await session.endSession();
    }
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
      const samplesCollection = await getCollection(this.db, 'samples');

      // Converter specimenId
      let sampleObjId;
      try {
        sampleObjId = ObjectId.isValid(specimenId) ? new ObjectId(specimenId) : specimenId;
      } catch (err) {
        console.error('[Storage] Erro ao converter specimenId:', err);
        sampleObjId = specimenId;
      }

      // Buscar amostra e sua localização
      const sample = await samplesCollection.findOne({ _id: sampleObjId });

      if (!sample) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${specimenId} não encontrada`
        };
      }

      if (!sample.storageLocation?.boxId || !sample.storageLocation?.position) {
        return {
          success: false,
          error: 'NO_STORAGE_LOCATION',
          message: 'Amostra não possui localização de armazenamento'
        };
      }

      const { boxId, position } = sample.storageLocation;

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
