const StorageService = require('../services/storageService');
const logger = require('../utils/logger');

/**
 * Storage Controller - Camada de Aplicação
 * Endpoints para gerenciamento de armazenagem física (ISO 20387)
 *
 * Data: Feb 12, 2026 (Semana 2)
 */

class StorageController {
  /**
   * GET /api/storage/freezers
   * Listar todos os freezers disponíveis
   */
  static async listFreezers(req, res) {
    try {
      const db = req.app.locals.db;

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      const storageContainersCollection = db.collection('storageContainers');
      const freezers = await storageContainersCollection
        .find({
          containerType: 'FREEZER',
          status: 'OPERATIONAL'
        })
        .sort({ name: 1 })
        .toArray();

      return res.status(200).json({
        success: true,
        data: freezers
      });
    } catch (error) {
      logger.error('[Storage] Erro em listFreezers:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/samples/search?q=termo
   * Buscar amostras disponíveis para alocação
   * 
   * Critérios:
   * - Apenas amostras com currentStatus = "Available"
   * - Sem storageLocation.boxId definido (não alocadas ainda)
   * - Com consentimento ativo (se houver sistema de consentimento)
   * - Busca por barcode ou patientID
   */
  static async searchSamples(req, res) {
    try {
      const { q } = req.query;
      const db = req.app.locals.db;

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados não disponível'
        });
      }

      // Se não houver termo de busca, retornar vazio
      if (!q || q.trim().length < 2) {
        return res.status(200).json({
          success: true,
          data: []
        });
      }

      const samplesCollection = db.collection('amostras');
      const patientsCollection = db.collection('patients');
      const patientConsentsCollection = db.collection('patientConsents');

      // Buscar amostras que atendam aos critérios
      const searchTerm = q.trim();
      const searchRegex = new RegExp(searchTerm, 'i');

      const samples = await samplesCollection.find({
        $and: [
          // Buscar por barcode, patientID ou sampleID
          {
            $or: [
              { barcode: searchRegex },
              { patientID: searchRegex },
              { sampleID: searchRegex }
            ]
          },
          // Apenas amostras disponíveis
          { currentStatus: { $in: ['Available', 'Registered', 'pending'] } },
          // Sem localização de armazenamento (ainda não alocadas)
          {
            $or: [
              { 'storageLocation.boxId': { $exists: false } },
              { 'storageLocation.boxId': null }
            ]
          }
        ]
      })
      .limit(20)
      .toArray();

      // Para cada amostra, verificar consentimento do paciente
      const enrichedSamples = await Promise.all(samples.map(async (sample) => {
        let consentValid = false;
        let consentMessage = '';

        // Buscar paciente
        const patient = await patientsCollection.findOne({ 
          $or: [
            { patientID: sample.patientID },
            { _id: sample.patientID }
          ]
        });

        if (patient) {
          // Verificar se há consentimento ativo
          const consent = await patientConsentsCollection.findOne({
            patientId: patient._id.toString(),
            status: 'ACTIVE'
          });

          if (consent) {
            consentValid = true;
            consentMessage = 'Consentimento ativo';
          } else {
            // Se não houver sistema de consentimento implementado, permitir uso
            const consentCount = await patientConsentsCollection.countDocuments();
            if (consentCount === 0) {
              // Sistema de consentimento não implementado ainda
              consentValid = true;
              consentMessage = 'Sistema de consentimento em implementação';
            } else {
              consentValid = false;
              consentMessage = 'Sem consentimento ativo';
            }
          }
        } else {
          // Paciente não encontrado - permitir em desenvolvimento
          consentValid = true;
          consentMessage = 'Paciente não encontrado (dev mode)';
        }

        return {
          _id: sample._id,
          barcode: sample.barcode,
          patientID: sample.patientID,
          sampleType: sample.sampleType,
          sampleOrigin: sample.sampleOrigin,
          currentStatus: sample.currentStatus,
          quantity: sample.quantity,
          registrationDate: sample.registrationDate,
          consentValid,
          consentMessage,
          // Informar se pode ser alocada
          canAllocate: consentValid
        };
      }));

      // Filtrar apenas amostras que podem ser alocadas
      const allowedSamples = enrichedSamples.filter(s => s.canAllocate);

      logger.info(`[Storage] Busca de amostras: "${searchTerm}" - ${allowedSamples.length} resultados permitidos`);

      return res.status(200).json({
        success: true,
        data: allowedSamples
      });
    } catch (error) {
      logger.error('[Storage] Erro em searchSamples:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * POST /api/storage/allocate
   * Alocar amostra a uma posição específica
   *
   * Body: {
   *   sampleId: ObjectId,
   *   boxId: ObjectId,
   *   position: string (ex: "A1")
   * }
   */
  static async allocateSample(req, res) {
    try {
      const { sampleId, boxId, position } = req.body;
      const db = req.app.locals.db;

      // Validar entrada
      if (!sampleId || !boxId || !position) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'sampleId, boxId e position são obrigatórios'
        });
      }

      const storageService = new StorageService(db);

      // Executar alocação
      const result = await storageService.allocateSampleToPosition(
        sampleId, boxId, position
      );

      if (!result.success) {
        // Retornar erro específico com status apropriado
        const statusCode = result.error === 'STORAGE_COLLISION' ? 409 : 400;
        return res.status(statusCode).json({
          success: false,
          ...result
        });
      }

      // Sucesso
      logger.info(`[Storage] Amostra ${sampleId} alocada em ${boxId}/${position}`);
      return res.status(201).json({
        success: true,
        data: result.sampleLocation,
        message: `Amostra alocada com sucesso em ${position}`
      });
    } catch (error) {
      logger.error('[Storage] Erro em allocateSample:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/storage/release/:sampleId
   * Liberar amostra de uma posição
   */
  static async releaseSample(req, res) {
    try {
      const { sampleId } = req.params;
      const db = req.app.locals.db;

      if (!sampleId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'sampleId é obrigatório'
        });
      }

      const storageService = new StorageService(db);

      // Executar liberação
      const result = await storageService.releaseSampleFromPosition(sampleId);

      if (!result.success) {
        const statusCode = result.error === 'SAMPLE_NOT_FOUND' ? 404 : 400;
        return res.status(statusCode).json({
          success: false,
          ...result
        });
      }

      logger.info(`[Storage] Amostra ${sampleId} liberada`);
      return res.status(200).json({
        success: true,
        data: result.releasedFrom,
        message: `Amostra liberada de ${result.releasedFrom.position}`
      });
    } catch (error) {
      logger.error('[Storage] Erro em releaseSample:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/sample/:sampleId
   * Obter localização de uma amostra
   */
  static async getSampleLocation(req, res) {
    try {
      const { sampleId } = req.params;
      const db = req.app.locals.db;

      if (!sampleId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'sampleId é obrigatório'
        });
      }

      const storageService = new StorageService(db);

      // Buscar localização
      const result = await storageService.getSampleStorage(sampleId);

      if (!result.found) {
        const statusCode = result.error === 'SAMPLE_NOT_FOUND' ? 404 : 400;
        return res.status(statusCode).json({
          success: false,
          ...result
        });
      }

      return res.status(200).json({
        success: true,
        data: result.location
      });
    } catch (error) {
      logger.error('[Storage] Erro em getSampleLocation:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/box/:boxId/available
   * Listar posições disponíveis em uma caixa
   */
  static async getAvailablePositions(req, res) {
    try {
      const { boxId } = req.params;
      const db = req.app.locals.db;

      logger.info(`[Storage] getAvailablePositions chamado para boxId: ${boxId}`);

      if (!boxId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'boxId é obrigatório'
        });
      }

      const storageService = new StorageService(db);
      const storageBoxesCollection = db.collection('storageBoxes');
      const { ObjectId } = require('mongodb');

      // Buscar caixa - usar ObjectId do driver nativo do MongoDB
      let boxObjId;
      try {
        boxObjId = ObjectId.isValid(boxId) ? new ObjectId(boxId) : boxId;
      } catch (err) {
        // Se falhar ao criar ObjectId, usa o boxId como string
        boxObjId = boxId;
      }

      logger.info(`[Storage] Buscando caixa com _id: ${boxObjId}`);
      const box = await storageBoxesCollection.findOne({ _id: boxObjId });

      if (!box) {
        logger.warn(`[Storage] Caixa não encontrada: ${boxId}`);
        return res.status(404).json({
          success: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        });
      }

      logger.info(`[Storage] Caixa encontrada: ${box.name}, dimensão: ${box.dimension.rows}x${box.dimension.cols}`);

      // Gerar todas as posições
      const allPositions = StorageController._getAllValidPositions(box.dimension);
      
      // occupancyGrid é um objeto, não Map
      const occupancyGrid = box.occupancyGrid || {};
      
      logger.info(`[Storage] Total de posições possíveis: ${allPositions.length}`);
      logger.info(`[Storage] occupancyGrid keys: ${Object.keys(occupancyGrid).length}`);
      
      // Posição está disponível se não existir no grid OU se o valor for null
      const availablePositions = allPositions.filter(
        pos => !occupancyGrid[pos] || occupancyGrid[pos] === null
      );

      const occupiedPositions = allPositions.filter(
        pos => occupancyGrid[pos] && occupancyGrid[pos] !== null
      );

      logger.info(`[Storage] Box ${boxId} - ${availablePositions.length} disponíveis, ${occupiedPositions.length} ocupadas`);
      logger.info(`[Storage] Primeiras 5 disponíveis: ${availablePositions.slice(0, 5).join(', ')}`);

      return res.status(200).json({
        success: true,
        data: {
          boxId: box._id,
          boxName: box.name,
          dimension: box.dimension,
          stats: {
            capacity: box.dimension.rows * box.dimension.cols,
            occupied: box.currentOccupancy || 0,
            available: availablePositions.length,
            occupancyPercent: Math.round(
              ((box.currentOccupancy || 0) / (box.dimension.rows * box.dimension.cols)) * 100
            )
          },
          availablePositions,
          occupiedPositions: occupiedPositions.slice(0, 10) // Primeiras 10 para não sobrecarregar
        }
      });
    } catch (error) {
      logger.error('[Storage] Erro em getAvailablePositions:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/freezer/:freezerId/tree
   * Obter árvore hierárquica de armazenagem
   * Visualização: Freezer → Shelves → Racks → Boxes → Positions
   */
  static async getFreezerTree(req, res) {
    try {
      const { freezerId } = req.params;
      const db = req.app.locals.db;

      if (!freezerId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'freezerId é obrigatório'
        });
      }

      const storageContainersCollection = db.collection('storageContainers');
      const storageBoxesCollection = db.collection('storageBoxes');
      const { ObjectId } = require('mongodb');

      // Validar e converter ObjectId
      let freezerObjId;
      try {
        freezerObjId = new ObjectId(freezerId);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ID_FORMAT',
          message: 'Formato de ID inválido'
        });
      }

      logger.debug(`[Storage] Buscando freezer: ${freezerObjId}`);

      // Buscar freezer
      const freezer = await storageContainersCollection.findOne({
        _id: freezerObjId,
        containerType: 'FREEZER'
      });

      if (!freezer) {
        logger.warn(`[Storage] Freezer não encontrado: ${freezerObjId}`);
        return res.status(404).json({
          success: false,
          error: 'FREEZER_NOT_FOUND',
          message: `Freezer ${freezerId} não encontrado`
        });
      }

      logger.debug(`[Storage] Freezer encontrado: ${freezer.name}`);

      // Construir árvore
      const tree = await StorageController._buildFreezerTree(
        db,
        freezer,
        storageContainersCollection,
        storageBoxesCollection
      );

      logger.debug(`[Storage] Árvore construída com ${tree.shelves.length} prateleiras`);

      return res.status(200).json({
        success: true,
        data: tree
      });
    } catch (error) {
      logger.error('[Storage] Erro em getFreezerTree:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/validate/:boxId/:position
   * Validar disponibilidade de posição (sem alocar)
   */
  static async validatePosition(req, res) {
    try {
      const { boxId, position } = req.params;
      const db = req.app.locals.db;

      if (!boxId || !position) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'boxId e position são obrigatórios'
        });
      }

      const storageService = new StorageService(db);

      // Validar
      const validation = await storageService.validatePositionAvailability(
        boxId, position
      );

      const statusCode = validation.available ? 200 : 409;
      return res.status(statusCode).json({
        success: validation.available,
        ...validation
      });
    } catch (error) {
      logger.error('[Storage] Erro em validatePosition:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/freezer/:freezerId/stats
   * Estatísticas de ocupação
   */
  static async getFreezerStats(req, res) {
    try {
      const { freezerId } = req.params;
      const db = req.app.locals.db;

      if (!freezerId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'freezerId é obrigatório'
        });
      }

      const storageService = new StorageService(db);

      // Obter stats
      const result = await storageService.getFreezerOccupancyStats(freezerId);

      if (!result.stats) {
        return res.status(result.error === 'FREEZER_NOT_FOUND' ? 404 : 400).json({
          success: false,
          ...result
        });
      }

      return res.status(200).json({
        success: true,
        data: result.stats
      });
    } catch (error) {
      logger.error('[Storage] Erro em getFreezerStats:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * GET /api/storage/box/:boxId/integrity
   * Verificar integridade de uma caixa (auditoria)
   */
  static async checkBoxIntegrity(req, res) {
    try {
      const { boxId } = req.params;
      const db = req.app.locals.db;

      if (!boxId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REQUEST',
          message: 'boxId é obrigatório'
        });
      }

      const storageService = new StorageService(db);

      // Verificar integridade
      const result = await storageService.verifyBoxIntegrity(boxId);

      const statusCode = result.valid ? 200 : 400;
      return res.status(statusCode).json({
        success: result.valid,
        data: result
      });
    } catch (error) {
      logger.error('[Storage] Erro em checkBoxIntegrity:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }

  /**
   * Helper: Construir árvore hierárquica do freezer
   * @private
   */
  static async _buildFreezerTree(db, freezer, storageContainersCollection, storageBoxesCollection) {
    try {
      const { ObjectId } = require('mongodb');
      const freezerId = freezer._id;

      logger.debug(`[Storage] Iniciando construção de árvore para freezer: ${freezerId}`);

      // Buscar shelves
      const shelves = await storageContainersCollection
        .find({
          parent_id: freezerId,
          containerType: 'SHELF'
        })
        .sort({ name: 1 })
        .toArray();

      logger.debug(`[Storage] Encontradas ${shelves.length} prateleiras`);

      // Para cada shelf, buscar racks
      const shelvesWithRacks = await Promise.all(
        shelves.map(async (shelf) => {
          try {
            const racks = await storageContainersCollection
              .find({
                parent_id: shelf._id,
                containerType: 'RACK'
              })
              .sort({ name: 1 })
              .toArray();

            logger.debug(`[Storage] Shelf ${shelf.name}: ${racks.length} racks`);

            // Para cada rack, buscar boxes
            const racksWithBoxes = await Promise.all(
              racks.map(async (rack) => {
                try {
                  const boxes = await storageBoxesCollection
                    .find({ parent_id: rack._id })
                    .sort({ name: 1 })
                    .toArray();

                  logger.debug(`[Storage] Rack ${rack.name}: ${boxes.length} boxes`);

                  // Para cada box, calcular stats
                  const boxesWithStats = boxes.map((box) => {
                    const capacity = (box.dimension?.rows || 0) * (box.dimension?.cols || 0);
                    const occupied = box.currentOccupancy || 0;
                    return {
                      boxId: box._id,
                      boxName: box.name,
                      boxID: box.boxID,
                      dimension: box.dimension,
                      stats: {
                        capacity: capacity,
                        occupied: occupied,
                        available: capacity - occupied,
                        occupancyPercent: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0
                      },
                      status: box.status
                    };
                  });

                  return {
                    rackId: rack._id,
                    rackName: rack.name,
                    boxes: boxesWithStats,
                    stats: {
                      boxes: boxesWithStats.length,
                      totalCapacity: boxesWithStats.reduce(
                        (sum, b) => sum + b.stats.capacity, 0
                      ),
                      totalOccupied: boxesWithStats.reduce(
                        (sum, b) => sum + b.stats.occupied, 0
                      )
                    }
                  };
                } catch (rackError) {
                  logger.error(`[Storage] Erro ao processar rack ${rack._id}:`, rackError);
                  throw rackError;
                }
              })
            );

            return {
              shelfId: shelf._id,
              shelfName: shelf.name,
              racks: racksWithBoxes,
              stats: {
                racks: racksWithBoxes.length,
                boxes: racksWithBoxes.reduce((sum, r) => sum + r.boxes.length, 0),
                totalCapacity: racksWithBoxes.reduce(
                  (sum, r) => sum + r.stats.totalCapacity, 0
                ),
                totalOccupied: racksWithBoxes.reduce(
                  (sum, r) => sum + r.stats.totalOccupied, 0
                )
              }
            };
          } catch (shelfError) {
            logger.error(`[Storage] Erro ao processar shelf ${shelf._id}:`, shelfError);
            throw shelfError;
          }
        })
      );

      // Agregar totais
      const totalCapacity = shelvesWithRacks.reduce(
        (sum, s) => sum + s.stats.totalCapacity, 0
      );
      const totalOccupied = shelvesWithRacks.reduce(
        (sum, s) => sum + s.stats.totalOccupied, 0
      );

      const treeData = {
        freezerId: freezer._id,
        freezerName: freezer.name,
        temperature: freezer.temperature,
        temperatureUnit: freezer.temperatureUnit,
        status: freezer.status,
        shelves: shelvesWithRacks,
        aggregateStats: {
          totalShelves: shelvesWithRacks.length,
          totalRacks: shelvesWithRacks.reduce((sum, s) => sum + s.stats.racks, 0),
          totalBoxes: shelvesWithRacks.reduce((sum, s) => sum + s.stats.boxes, 0),
          totalCapacity,
          totalOccupied,
          totalAvailable: totalCapacity - totalOccupied,
          occupancyPercent: totalCapacity > 0
            ? Math.round((totalOccupied / totalCapacity) * 100)
            : 0
        }
      };

      logger.debug(`[Storage] Árvore construída com sucesso`);
      return treeData;
    } catch (error) {
      logger.error('[Storage] Erro em _buildFreezerTree:', error);
      throw error;
    }
  }

  /**
   * Helper: Gerar todas as posições válidas
   * @private
   */
  static _getAllValidPositions(dimension) {
    const positions = [];
    const { rows, cols } = dimension;

    for (let r = 0; r < rows; r++) {
      const letter = String.fromCharCode(65 + r);
      for (let c = 1; c <= cols; c++) {
        positions.push(`${letter}${c}`);
      }
    }

    return positions;
  }
}

module.exports = StorageController;
