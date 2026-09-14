const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { getCollection } = require('../utils/collectionResolver');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const MongoLineageRepository = require('../infrastructure/persistence/mongo/MongoLineageRepository');
const positionGrid = require('../utils/storagePositionGrid');
const { isKnownStandaloneDeployment } = require('../utils/mongoTransaction');

const STANDALONE_DEPLOYMENT_TRANSACTION_ERROR =
  'Transação Mongo indisponível: esta implantação não é um replica set nem mongos. ' +
  'Alocação, movimentação e liberação de amostras exigem transação (RF006 item 7, F3-G10). ' +
  'Configure o mongod com --replSet (ver compose.test.yml) ou aponte MONGO_URI para um replica set.';

/**
 * Storage Service - núcleo de armazenamento físico.
 *
 * RF023 v2: MongoDB é a autoridade operacional. Nenhuma operação deste
 * serviço escreve Neo4j diretamente; projeções são enfileiradas no outbox
 * na mesma transação do estado e da auditoria.
 */
class StorageService {
  constructor(db) {
    this.db = db;
    this.storageRepository = new MongoStorageRepository(db);
    this.auditRepository = new MongoAuditRepository(db);
    this.lineageRepository = new MongoLineageRepository(db);
  }

  _normalizeObjectId(value) {
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
    return value;
  }

  _findFirstAvailablePosition(box) {
    return positionGrid.findFirstAvailablePosition(box);
  }

  async autoAssignSampleToBox(specimenId, boxId) {
    const sampleObjId = this._normalizeObjectId(specimenId);
    const boxObjId = this._normalizeObjectId(boxId);

    try {
      if (await isKnownStandaloneDeployment(this.db)) {
        throw new Error(STANDALONE_DEPLOYMENT_TRANSACTION_ERROR);
      }

      const boxSnapshot = await this.storageRepository.findBoxById(boxObjId);
      if (!boxSnapshot) {
        return {
          success: false,
          error: 'BOX_NOT_FOUND',
          message: `StorageBox ${boxId} não encontrada`
        };
      }

      const sampleSnapshot = await this.storageRepository.findSampleById(sampleObjId);
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

      let assignedPosition = null;
      let projectionEventId = null;

      await this.storageRepository.withTransaction(async (session) => {
        const freshSample = await this.storageRepository.findSampleById(sampleObjId, session);
        if (!freshSample) throw new Error('SAMPLE_NOT_FOUND');

        await this.lineageRepository.validateBeforePersistence(
          {
            specimenId: String(sampleObjId),
            barcode: freshSample.barcode || null,
            eventType: 'auto_allocate',
            requireEthicalConsent: true,
          },
          session
        );

        assignedPosition = await this.storageRepository.autoAssignSamplePosition(
          { specimenId: sampleObjId, boxId: boxObjId },
          session
        );

        const happenedAt = new Date();
        await this.auditRepository.appendImmutableAudit(
          {
            specimenId: sampleObjId.toString(),
            barcode: freshSample.barcode || null,
            eventType: 'auto_allocate',
            before: { storageLocation: null },
            after: {
              storageLocation: { boxId: String(boxObjId), position: assignedPosition }
            },
            context: { actor: { userName: 'SYSTEM' } },
            timestamp: happenedAt
          },
          session
        );

        const projection = await this.lineageRepository.recordCustodyEvent(
          {
            specimenId: String(sampleObjId),
            barcode: freshSample.barcode || null,
            eventType: 'auto_allocate',
            from: null,
            to: { boxId: String(boxObjId), position: assignedPosition },
            actorId: null,
            reason: 'auto_allocate',
            happenedAt
          },
          session
        );
        projectionEventId = projection?.eventId || null;
      });

      logger.info(`✅ Alocação inteligente realizada para amostra ${specimenId} em ${boxId}/${assignedPosition}`);

      return {
        success: true,
        graphPersisted: false,
        projectionQueued: true,
        projectionEventId,
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
  }

  async releaseSampleFromPosition(specimenId) {
    try {
      const sampleObjId = this._normalizeObjectId(specimenId);
      const sampleSnapshot = await this.storageRepository.findSampleById(sampleObjId);

      if (!sampleSnapshot) {
        return {
          success: false,
          error: 'SAMPLE_NOT_FOUND',
          message: `Amostra ${specimenId} não encontrada`
        };
      }

      if (!sampleSnapshot.storageAssignment?.boxId || !sampleSnapshot.storageAssignment?.positionCode) {
        return {
          success: false,
          error: 'NO_STORAGE_LOCATION',
          message: 'Amostra não possui localização de armazenamento'
        };
      }

      let releasedFrom = null;
      let projectionEventId = null;

      await this.storageRepository.withTransaction(async (session) => {
        const sample = await this.storageRepository.findSampleById(sampleObjId, session);
        if (!sample) throw new Error('SAMPLE_NOT_FOUND');

        const assignment = sample.storageAssignment;
        if (!assignment?.boxId || !assignment?.positionCode) {
          throw new Error('NO_STORAGE_LOCATION');
        }

        const from = {
          boxId: String(assignment.boxId),
          position: String(assignment.positionCode).toUpperCase()
        };
        const happenedAt = new Date();

        await this.lineageRepository.validateBeforePersistence(
          {
            specimenId: String(sampleObjId),
            barcode: sample.barcode || null,
            eventType: 'release',
            requireEthicalConsent: true,
          },
          session
        );

        const release = await this.storageRepository.releaseSamplePosition(
          { specimenId: sampleObjId },
          session
        );

        releasedFrom = {
          specimenId: String(specimenId),
          boxId: release.from.boxId,
          position: release.from.position
        };

        await this.auditRepository.appendImmutableAudit(
          {
            specimenId: sampleObjId.toString(),
            barcode: sample.barcode || null,
            eventType: 'release',
            before: {
              storageLocation: from,
              quantity: sample.quantity,
              unit: sample.unit || 'µL'
            },
            after: { storageLocation: null },
            context: { actor: { userName: 'SYSTEM' } },
            timestamp: happenedAt
          },
          session
        );

        const projection = await this.lineageRepository.recordCustodyEvent(
          {
            specimenId: String(sampleObjId),
            barcode: sample.barcode || null,
            eventType: 'release',
            from,
            to: null,
            actorId: null,
            reason: 'release',
            happenedAt
          },
          session
        );
        projectionEventId = projection?.eventId || null;
      });

      logger.info(`✅ Amostra ${specimenId} liberada de ${releasedFrom.boxId}/${releasedFrom.position}`);

      return {
        success: true,
        projectionQueued: true,
        projectionEventId,
        releasedFrom
      };
    } catch (error) {
      logger.error('Erro ao liberar posição:', error);
      return {
        success: false,
        error: error.message === 'SAMPLE_NOT_FOUND'
          ? 'SAMPLE_NOT_FOUND'
          : error.message === 'NO_STORAGE_LOCATION'
            ? 'NO_STORAGE_LOCATION'
            : 'RELEASE_ERROR',
        message: error.message
      };
    }
  }

  _getAllValidPositions(dimension) {
    return positionGrid.getAllValidPositions(dimension);
  }

  async verifyBoxIntegrity(boxId) {
    try {
      const storageBoxesCollection = this.db.collection('storageBoxes');
      const samplesCollection = await getCollection(this.db, 'samples');
      const boxObjId = this._normalizeObjectId(boxId);
      const box = await storageBoxesCollection.findOne({ _id: boxObjId });

      if (!box) {
        return { valid: false, error: 'BOX_NOT_FOUND' };
      }

      const errors = [];
      let actualCount = 0;
      const occupancyEntries = box.occupancyGrid instanceof Map
        ? box.occupancyGrid.entries()
        : Object.entries(box.occupancyGrid || {});

      for (const [position, storedSpecimenId] of occupancyEntries) {
        if (!storedSpecimenId) continue;
        actualCount += 1;
        const sample = await samplesCollection.findOne({ _id: storedSpecimenId });

        if (!sample) {
          errors.push(`Orfão: posição ${position} referencia amostra inexistente ${storedSpecimenId}`);
          continue;
        }

        const assignment = await this.storageRepository.findCurrentStorageAssignment(
          String(sample._id)
        );
        const assignmentBoxId = assignment?.boxId ? String(assignment.boxId) : null;
        const assignmentPosition = assignment?.positionCode || null;

        if (assignmentBoxId !== String(boxObjId) || assignmentPosition !== position) {
          errors.push(
            `Inconsistência: Box referencia ${storedSpecimenId} em ${position}, ` +
            `mas a atribuição física aponta para ${assignmentBoxId}/${assignmentPosition}`
          );
        }
      }

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
