const mongoose = require('mongoose');
const { ObjectId } = require('mongodb'); // Native MongoDB driver para evitar conflitos BSON
const logger = require('../utils/logger');

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
  constructor(db) {
    this.db = db;
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
      const occupiedSampleId = box.occupancyGrid?.get(position);

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
   * @param {ObjectId} sampleId - ID da amostra
   * @param {ObjectId} boxId - ID da StorageBox
   * @param {string} position - Posição (ex: "A1")
   * @returns {Promise<{ success: boolean, error?: string, sampleLocation?: object }>}
   */
  async allocateSampleToPosition(sampleId, boxId, position) {
    const session = this.db.getMongo().startSession();

    try {
      // Iniciar transação
      await session.withTransaction(async () => {
        const storageBoxesCollection = this.db.collection('storageBoxes');
        const samplesCollection = this.db.collection('amostras');

        // Validar disponibilidade primeiro (fora da transação para speedup)
        const validation = await this.validatePositionAvailability(boxId, position);
        if (!validation.available) {
          throw new Error(JSON.stringify(validation));
        }

        // Converter IDs usando MongoDB native driver
        const { ObjectId } = require('mongodb');
        
        let sampleObjId, boxObjId;
        try {
          sampleObjId = ObjectId.isValid(sampleId) ? new ObjectId(sampleId) : sampleId;
          boxObjId = ObjectId.isValid(boxId) ? new ObjectId(boxId) : boxId;
        } catch (err) {
          console.error('[Storage] Erro ao converter ObjectIds:', err);
          sampleObjId = sampleId;
          boxObjId = boxId;
        }

        // CRITICAL SECTION: Dentro da transação

        // 1. Verificar se amostra já está em outra posição
        const existingSample = await samplesCollection.findOne(
          { _id: sampleObjId },
          { session }
        );

        if (!existingSample) {
          throw new Error(`Amostra ${sampleId} não encontrada`);
        }

        if (existingSample.storageLocation?.boxId && existingSample.storageLocation?.position) {
          throw new Error(
            `Amostra já está alocada em ${existingSample.storageLocation.boxId} / ${existingSample.storageLocation.position}`
          );
        }

        // 2. Update Box: adicionar sample ao occupancyGrid
        const updateBoxResult = await storageBoxesCollection.updateOne(
          {
            _id: boxObjId,
            [`occupancyGrid.${position}`]: { $exists: false }
          },
          {
            $set: {
              [`occupancyGrid.${position}`]: sampleObjId,
              'currentOccupancy': { $inc: 1 },
              'updatedAt': new Date()
            }
          },
          { session }
        );

        if (updateBoxResult.matchedDocuments === 0) {
          throw new Error('STORAGE_COLLISION: Colisão detectada durante alocação');
        }

        // 3. Update Sample: definir storageLocation
        const updateSampleResult = await samplesCollection.updateOne(
          { _id: sampleObjId },
          {
            $set: {
              'storageLocation.boxId': boxObjId,
              'storageLocation.position': position,
              'status': 'AVAILABLE', // Amostra agora tem localização
              'updatedAt': new Date()
            }
          },
          { session }
        );

        if (updateSampleResult.modifiedCount === 0) {
          throw new Error('Falha ao atualizar amostra');
        }

        // 4. Criar/atualizar SampleMovement (auditoria)
        const movementsCollection = this.db.collection('sample_movements');
        await movementsCollection.insertOne(
          {
            sampleID: sampleObjId,
            barcode: existingSample.barcode,
            type: 'allocate',
            quantity: existingSample.quantity,
            unit: existingSample.unit || 'µL',
            responsible: 'SYSTEM',
            userId: null,
            timestamp: new Date(),
            storageAction: {
              boxId: boxObjId,
              position: position
            },
            createdAt: new Date()
          },
          { session }
        );
      });

      logger.info(`✅ Amostra ${sampleId} alocada em ${boxId}/${position}`);

      return {
        success: true,
        sampleLocation: {
          sampleId,
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
   * Liberar amostra de uma posição
   * Remove de occupancyGrid e atualiza amostra
   *
   * @param {ObjectId} sampleId - ID da amostra
   * @returns {Promise<{ success: boolean, error?: string, releasedFrom?: object }>}
   */
  async releaseSampleFromPosition(sampleId) {
    try {
      const samplesCollection = this.db.collection('amostras');
      const storageBoxesCollection = this.db.collection('storageBoxes');

      // Converter sampleId
      let sampleObjId;
      try {
        sampleObjId = ObjectId.isValid(sampleId) ? new ObjectId(sampleId) : sampleId;
      } catch (err) {
        console.error('[Storage] Erro ao converter sampleId:', err);
        sampleObjId = sampleId;
      }

      // Buscar amostra e sua localização
      const sample = await samplesCollection.findOne({ _id: sampleObjId });

      if (!sample) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${sampleId} não encontrada`
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

      // Remover de occupancyGrid
      let boxObjId;
      try {
        boxObjId = new ObjectId(boxId);
      } catch (err) {
        console.error('[Storage] Erro ao converter boxId:', err);
        boxObjId = boxId;
      }
      
      const updateBoxResult = await storageBoxesCollection.updateOne(
        { _id: boxObjId },
        {
          $unset: {
            [`occupancyGrid.${position}`]: ''
          },
          $set: {
            'updatedAt': new Date()
          }
        }
      );

      // Limpar storageLocation em Sample
      await samplesCollection.updateOne(
        { _id: sampleObjId },
        {
          $unset: {
            'storageLocation': ''
          },
          $set: {
            'updatedAt': new Date()
          }
        }
      );

      // Criar movimento de auditoria
      const movementsCollection = this.db.collection('sample_movements');
      await movementsCollection.insertOne({
        sampleID: sampleObjId,
        barcode: sample.barcode,
        type: 'release',
        quantity: sample.quantity,
        unit: sample.unit || 'µL',
        responsible: 'SYSTEM',
        timestamp: new Date(),
        storageAction: {
          boxId: boxId,
          position: position,
          action: 'released'
        },
        createdAt: new Date()
      });

      logger.info(`✅ Amostra ${sampleId} liberada de ${boxId}/${position}`);

      return {
        success: true,
        releasedFrom: {
          sampleId,
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
   * Encontrar primeira posição disponível em uma caixa
   *
   * @param {ObjectId} boxId - ID da StorageBox
   * @returns {Promise<{ found: boolean, position?: string, availableCount?: number }>}
   */
  async findAvailablePosition(boxId) {
    try {
      const storageBoxesCollection = this.db.collection('storageBoxes');

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
          found: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        };
      }

      // Gerar todas as posições válidas
      const allPositions = this._getAllValidPositions(box.dimension);

      // Encontrar primeira posição vazia
      for (const pos of allPositions) {
        if (!box.occupancyGrid?.has(pos)) {
          const availableCount = allPositions.filter(
            p => !box.occupancyGrid?.has(p)
          ).length;

          return {
            found: true,
            position: pos,
            availableCount,
            boxStats: {
              capacity: box.dimension.rows * box.dimension.cols,
              occupied: box.currentOccupancy,
              available: availableCount
            }
          };
        }
      }

      return {
        found: false,
        message: 'Nenhuma posição disponível nesta caixa',
        boxStats: {
          capacity: box.dimension.rows * box.dimension.cols,
          occupied: box.currentOccupancy,
          available: 0
        }
      };
    } catch (error) {
      logger.error('Erro ao procurar posição disponível:', error);
      return {
        found: false,
        error: 'SEARCH_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Obter localização de armazenagem de uma amostra
   *
   * @param {ObjectId} sampleId - ID da amostra
   * @returns {Promise<{ found: boolean, location?: object }>}
   */
  async getSampleStorage(sampleId) {
    try {
      const samplesCollection = this.db.collection('amostras');
      const storagePathsCollection = this.db.collection('storagePaths');

      const sampleObjId = ObjectId.isValid(sampleId)
        ? new ObjectId(sampleId)
        : sampleId;

      const sample = await samplesCollection.findOne({ _id: sampleObjId });

      if (!sample) {
        return {
          found: false,
          error: 'SAMPLE_NOT_FOUND'
        };
      }

      if (!sample.storageLocation?.boxId) {
        return {
          found: false,
          message: 'Amostra sem localização de armazenamento'
        };
      }

      // Buscar caminho completo
      let boxObjId2;
      try {
        boxObjId2 = new ObjectId(sample.storageLocation.boxId);
      } catch (err) {
        console.error('[Storage] Erro ao converter boxId:', err);
        boxObjId2 = sample.storageLocation.boxId;
      }
      
      const storagePath = await storagePathsCollection.findOne({
        boxId: boxObjId2
      });

      return {
        found: true,
        location: {
          sampleId: sample._id,
          barcode: sample.barcode,
          box: {
            boxId: sample.storageLocation.boxId,
            position: sample.storageLocation.position
          },
          path: storagePath?.path || 'N/A',
          fullHierarchy: storagePath ? {
            freezerId: storagePath.freezerId,
            shelfId: storagePath.shelfId,
            rackId: storagePath.rackId,
            boxId: storagePath.boxId
          } : null
        }
      };
    } catch (error) {
      logger.error('Erro ao obter localização de amostra:', error);
      return {
        found: false,
        error: 'QUERY_ERROR',
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
    const positions = [];
    const { rows, cols } = dimension;

    for (let r = 0; r < rows; r++) {
      const letter = String.fromCharCode(65 + r); // A, B, C...
      for (let c = 1; c <= cols; c++) {
        positions.push(`${letter}${c}`);
      }
    }

    return positions;
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
      const samplesCollection = this.db.collection('amostras');

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
      for (const [position, sampleId] of (box.occupancyGrid || new Map())) {
        if (sampleId) {
          actualCount++;

          // Confirmar que amostra ainda existe e está apontando para essa posição
          const sample = await samplesCollection.findOne({ _id: sampleId });

          if (!sample) {
            errors.push(`Orfão: posição ${position} referencia amostra inexistente ${sampleId}`);
          } else if (
            sample.storageLocation?.boxId?.toString() !== boxObjId.toString() ||
            sample.storageLocation?.position !== position
          ) {
            errors.push(
              `Inconsistência: Box referencia ${sampleId} em ${position}, ` +
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

  /**
   * Estatísticas de ocupação para um freezer completo
   *
   * @param {ObjectId} freezerId - ID do StorageContainer (FREEZER)
   * @returns {Promise<{ stats: object }>}
   */
  async getFreezerOccupancyStats(freezerId) {
    try {
      const storageContainersCollection = this.db.collection('storageContainers');
      const storageBoxesCollection = this.db.collection('storageBoxes');

      let freezerObjId;
      try {
        freezerObjId = ObjectId.isValid(freezerId) ? new ObjectId(freezerId) : freezerId;
      } catch (err) {
        console.error('[Storage] Erro ao converter freezerId:', err);
        freezerObjId = freezerId;
      }

      const freezer = await storageContainersCollection.findOne({
        _id: freezerObjId,
        containerType: 'FREEZER'
      });

      if (!freezer) {
        return {
          stats: null,
          error: 'FREEZER_NOT_FOUND'
        };
      }

      // Aggregação para calcular ocupação por shelf e rack
      const stats = await storageBoxesCollection
        .aggregate([
          {
            $lookup: {
              from: 'storageContainers',
              localField: 'parent_id',
              foreignField: '_id',
              as: 'rack'
            }
          },
          {
            $unwind: '$rack'
          },
          {
            $group: {
              _id: '$rack._id',
              rackName: { $first: '$rack.name' },
              totalCapacity: {
                $sum: {
                  $multiply: ['$dimension.rows', '$dimension.cols']
                }
              },
              totalOccupied: { $sum: '$currentOccupancy' }
            }
          },
          {
            $sort: { rackName: 1 }
          }
        ])
        .toArray();

      const totalCapacity = stats.reduce((sum, r) => sum + r.totalCapacity, 0);
      const totalOccupied = stats.reduce((sum, r) => sum + r.totalOccupied, 0);

      return {
        stats: {
          freezerId: freezer._id,
          freezerName: freezer.name,
          temperature: freezer.temperature,
          rackStats: stats,
          aggregate: {
            totalCapacity,
            totalOccupied,
            totalAvailable: totalCapacity - totalOccupied,
            occupancyPercent: Math.round((totalOccupied / totalCapacity) * 100)
          }
        }
      };
    } catch (error) {
      logger.error('Erro ao calcular stats de freezer:', error);
      return {
        stats: null,
        error: 'STATS_ERROR',
        message: error.message
      };
    }
  }
}

module.exports = StorageService;
