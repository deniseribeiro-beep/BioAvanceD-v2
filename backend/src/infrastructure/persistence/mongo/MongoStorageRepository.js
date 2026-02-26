const { ObjectId } = require('mongodb');

/**
 * Repositório Mongo para operações de armazenamento físico de amostras.
 */
class MongoStorageRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {(session: import('mongodb').ClientSession) => Promise<any>} handler
   * @returns {Promise<any>}
   */
  async withTransaction(handler) {
    const client = this.db?.client || this.db?.s?.client;
    if (!client || typeof client.startSession !== 'function') {
      throw new Error('Cliente Mongo não suporta transação');
    }

    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await handler(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * @param {string} sampleId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findSampleById(sampleId, session) {
    const samplesCollection = this.db.collection('amostras');
    const normalizedId = this.toObjectId(sampleId);
    return samplesCollection.findOne({ _id: normalizedId }, { session });
  }

  /**
   * @param {string} boxId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findBoxById(boxId, session) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const normalizedId = this.toObjectId(boxId);
    return storageBoxesCollection.findOne({ _id: normalizedId }, { session });
  }

  /**
   * @param {{ sampleId: string, fromBoxId: string, fromPosition: string, toBoxId: string, toPosition: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async moveSamplePosition(input, session) {
    const samplesCollection = this.db.collection('amostras');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.sampleId);
    const fromBoxObjId = this.toObjectId(input.fromBoxId);
    const toBoxObjId = this.toObjectId(input.toBoxId);

    const sourceUpdate = await storageBoxesCollection.updateOne(
      {
        _id: fromBoxObjId,
        [`occupancyGrid.${input.fromPosition}`]: sampleObjId
      },
      {
        $unset: {
          [`occupancyGrid.${input.fromPosition}`]: ''
        },
        $inc: {
          currentOccupancy: -1
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (sourceUpdate.matchedCount === 0) {
      throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');
    }

    const targetUpdate = await storageBoxesCollection.updateOne(
      {
        _id: toBoxObjId,
        [`occupancyGrid.${input.toPosition}`]: { $exists: false }
      },
      {
        $set: {
          [`occupancyGrid.${input.toPosition}`]: sampleObjId,
          updatedAt: new Date()
        },
        $inc: {
          currentOccupancy: 1
        }
      },
      { session }
    );

    if (targetUpdate.matchedCount === 0) {
      throw new Error('STORAGE_COLLISION: posição de destino já ocupada ou inválida');
    }

    const sampleUpdate = await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $set: {
          'storageLocation.boxId': toBoxObjId,
          'storageLocation.position': input.toPosition,
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (sampleUpdate.matchedCount === 0) {
      throw new Error('Falha ao atualizar localização da amostra');
    }
  }

  /**
   * @param {{ sampleId: string, boxId: string, position: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async allocateSamplePosition(input, session) {
    const samplesCollection = this.db.collection('amostras');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.sampleId);
    const boxObjId = this.toObjectId(input.boxId);
    const normalizedPosition = String(input.position).trim().toUpperCase();

    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    if (sample?.storageLocation?.boxId && sample?.storageLocation?.position) {
      throw new Error('Amostra já está alocada em outra posição');
    }

    const box = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!box) {
      throw new Error('Caixa de armazenamento não encontrada');
    }

    const positionRegex = /^([A-Z])(\d+)$/;
    const positionMatch = normalizedPosition.match(positionRegex);
    if (!positionMatch) {
      throw new Error('Posição inválida. Use o formato Letra+Número (ex: A1, B4)');
    }

    const [, rowLetter, columnString] = positionMatch;
    const rowIndex = rowLetter.charCodeAt(0) - 65;
    const column = parseInt(columnString, 10);
    const maxRows = Number(box?.dimension?.rows || 0);
    const maxCols = Number(box?.dimension?.cols || 0);

    if (rowIndex < 0 || rowIndex >= maxRows || column < 1 || column > maxCols) {
      throw new Error('Posição fora dos limites da caixa');
    }

    const updateBox = await storageBoxesCollection.updateOne(
      {
        _id: boxObjId,
        [`occupancyGrid.${normalizedPosition}`]: { $exists: false }
      },
      {
        $set: {
          [`occupancyGrid.${normalizedPosition}`]: sampleObjId,
          updatedAt: new Date()
        },
        $inc: {
          currentOccupancy: 1
        }
      },
      { session }
    );

    if (updateBox.matchedCount === 0) {
      throw new Error('STORAGE_COLLISION: posição já ocupada');
    }

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $set: {
          'storageLocation.boxId': boxObjId,
          'storageLocation.position': normalizedPosition,
          status: 'AVAILABLE',
          updatedAt: new Date()
        }
      },
      { session }
    );
  }

  /**
   * @param {{ sampleId: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async releaseSamplePosition(input, session) {
    const samplesCollection = this.db.collection('amostras');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.sampleId);
    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });

    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    const sourceBoxId = sample?.storageLocation?.boxId;
    const sourcePosition = sample?.storageLocation?.position;

    if (!sourceBoxId || !sourcePosition) {
      throw new Error('Amostra não possui localização de armazenamento');
    }

    const sourceBoxObjId = this.toObjectId(sourceBoxId);

    await storageBoxesCollection.updateOne(
      {
        _id: sourceBoxObjId,
        [`occupancyGrid.${sourcePosition}`]: sampleObjId
      },
      {
        $unset: {
          [`occupancyGrid.${sourcePosition}`]: ''
        },
        $inc: {
          currentOccupancy: -1
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $unset: {
          storageLocation: ''
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    return {
      from: {
        boxId: String(sourceBoxId),
        position: String(sourcePosition).toUpperCase()
      },
      barcode: sample.barcode || null,
      quantity: sample.quantity || null,
      unit: sample.unit || 'µL'
    };
  }

  /**
   * @param {{ boxId: string, position: string }} input
   */
  async validatePositionAvailability(input) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const boxObjId = this.toObjectId(input.boxId);
    const position = String(input.position).trim().toUpperCase();

    const box = await storageBoxesCollection.findOne({ _id: boxObjId });
    if (!box) {
      return {
        available: false,
        error: 'BOX_NOT_FOUND',
        message: `StorageBox ${input.boxId} não encontrada`
      };
    }

    const positionRegex = /^([A-Z])(\d+)$/;
    const match = position.match(positionRegex);
    if (!match) {
      return {
        available: false,
        error: 'INVALID_POSITION_FORMAT',
        message: `Posição "${position}" inválida. Usar formato: Letra+Número (ex: A1, B4)`
      };
    }

    const [, rowLetter, colStr] = match;
    const row = rowLetter.charCodeAt(0) - 65;
    const col = parseInt(colStr, 10);
    const maxRows = Number(box?.dimension?.rows || 0);
    const maxCols = Number(box?.dimension?.cols || 0);

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

    const occupiedSampleId = box.occupancyGrid?.[position] || null;
    if (occupiedSampleId) {
      return {
        available: false,
        error: 'STORAGE_COLLISION',
        message: `Posição "${position}" já está ocupada por amostra ${occupiedSampleId}`,
        occupiedBySampleId: String(occupiedSampleId)
      };
    }

    return {
      available: true,
      boxData: {
        boxId: box._id,
        boxName: box.name,
        dimension: box.dimension,
        currentOccupancy: box.currentOccupancy || 0,
        capacity: (box.dimension?.rows || 0) * (box.dimension?.cols || 0),
        availablePositions: ((box.dimension?.rows || 0) * (box.dimension?.cols || 0)) - (box.currentOccupancy || 0)
      }
    };
  }

  /**
   * @param {{ boxId: string }} input
   */
  async getBoxAvailablePositions(input) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const boxObjId = this.toObjectId(input.boxId);
    const box = await storageBoxesCollection.findOne({ _id: boxObjId });

    if (!box) return null;

    const positions = [];
    const rows = Number(box?.dimension?.rows || 0);
    const cols = Number(box?.dimension?.cols || 0);
    for (let row = 0; row < rows; row += 1) {
      const rowLetter = String.fromCharCode(65 + row);
      for (let col = 1; col <= cols; col += 1) {
        positions.push(`${rowLetter}${col}`);
      }
    }

    const occupancyGrid = box.occupancyGrid || {};
    const availablePositions = positions.filter((position) => !occupancyGrid[position]);
    const occupiedPositions = positions.filter((position) => !!occupancyGrid[position]);
    const capacity = rows * cols;
    const occupied = Number(box.currentOccupancy || 0);

    return {
      boxId: box._id,
      boxName: box.name,
      dimension: box.dimension,
      stats: {
        capacity,
        occupied,
        available: availablePositions.length,
        occupancyPercent: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0
      },
      availablePositions,
      occupiedPositions: occupiedPositions.slice(0, 10)
    };
  }

  /**
   * @param {{ sampleId: string }} input
   */
  async getSampleStorageLocation(input) {
    const samplesCollection = this.db.collection('amostras');
    const storagePathsCollection = this.db.collection('storagePaths');
    const sampleObjId = this.toObjectId(input.sampleId);

    const sample = await samplesCollection.findOne({ _id: sampleObjId });
    if (!sample) {
      return {
        found: false,
        error: 'SAMPLE_NOT_FOUND'
      };
    }

    if (!sample?.storageLocation?.boxId) {
      return {
        found: false,
        message: 'Amostra sem localização de armazenamento'
      };
    }

    const boxObjId = this.toObjectId(sample.storageLocation.boxId);
    const storagePath = await storagePathsCollection.findOne({ boxId: boxObjId });

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
        fullHierarchy: storagePath
          ? {
              freezerId: storagePath.freezerId,
              shelfId: storagePath.shelfId,
              rackId: storagePath.rackId,
              boxId: storagePath.boxId
            }
          : null
      }
    };
  }

  /**
   * @param {{ query: string }} input
   */
  async searchAllocatableSampleCandidates(input) {
    const searchTerm = String(input.query || '').trim();
    if (searchTerm.length < 2) return [];

    const samplesCollection = this.db.collection('amostras');

    const searchRegex = new RegExp(searchTerm, 'i');
    return samplesCollection.find({
      $and: [
        {
          $or: [
            { barcode: searchRegex },
            { patientID: searchRegex },
            { sampleID: searchRegex }
          ]
        },
        { currentStatus: { $in: ['Available', 'Registered', 'pending'] } },
        {
          $or: [
            { 'storageLocation.boxId': { $exists: false } },
            { 'storageLocation.boxId': null }
          ]
        }
      ]
    }).limit(20).toArray();
  }

  /**
   * @param {string|import('mongodb').ObjectId} id
   */
  toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && ObjectId.isValid(id)) {
      return new ObjectId(id);
    }
    return id;
  }
}

module.exports = MongoStorageRepository;
