const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
const { isKnownStandaloneDeployment } = require('../../../utils/mongoTransaction');
const NormalizedPhysicalStorageStore = require('./NormalizedPhysicalStorageStore');
const { GraphProjectionService } = require('../../../services/graphProjection.service');
const positionGrid = require('../../../utils/storagePositionGrid');

const STANDALONE_DEPLOYMENT_TRANSACTION_ERROR =
  'Transação Mongo indisponível: esta implantação não é um replica set nem mongos. ' +
  'Alocação, movimentação e liberação de amostras exigem transação (RF006 item 7, F3-G10). ' +
  'Configure o mongod com --replSet (ver compose.test.yml) ou aponte MONGO_URI para um replica set.';

/**
 * Repositório de armazenamento físico canônico v2.
 *
 * StorageBox/StorageContainer permanecem entradas de layout/configuração. A
 * autoridade operacional de posicionamento é exclusivamente a cadeia:
 * SpecimenContainerAssignment -> ContainerPositionAssignment ->
 * StoragePosition -> StorageRack -> RackLocationAssignment.
 *
 * Nenhum snapshot embutido em Sample é escrito ou tratado como autoridade.
 */
class MongoStorageRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.physicalStore = options.physicalStore || new NormalizedPhysicalStorageStore(db);
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
  }

  toObjectId(id) {
    if (id instanceof ObjectId) return id;
    try {
      return typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;
    } catch {
      return id;
    }
  }

  async withTransaction(handler) {
    const client = this.db?.client || this.db?.s?.client;
    if (!client || typeof client.startSession !== 'function') {
      throw new Error('Cliente Mongo não suporta transação');
    }
    if (await isKnownStandaloneDeployment(this.db)) {
      throw new Error(STANDALONE_DEPLOYMENT_TRANSACTION_ERROR);
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

  async findSampleById(specimenId, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const normalizedId = this.toObjectId(specimenId);
    const sample = await samplesCollection.findOne({
      $or: [{ _id: normalizedId }, { specimenId: String(specimenId) }]
    }, { session });
    if (!sample) return null;
    const currentStoragePlacement = await this.findCurrentStoragePlacement(
      sample.specimenId || sample._id,
      session
    );
    return { ...sample, currentStoragePlacement };
  }

  async findCurrentStoragePlacement(specimenId, session) {
    return this.physicalStore.findCurrentBySpecimen(specimenId, session);
  }

  async findBoxById(boxId, session) {
    return this.db.collection('storageBoxes').findOne({ _id: this.toObjectId(boxId) }, { session });
  }

  async resolveAncestorContainersLive(startParentId, session) {
    const result = [];
    let currentId = startParentId || null;
    if (!currentId) return result;
    const collection = this.db.collection('storageContainers');
    const visited = new Set();
    while (currentId) {
      const key = String(currentId);
      if (visited.has(key)) throw new Error('Ciclo detectado na hierarquia de armazenamento');
      visited.add(key);
      const container = await collection.findOne({ _id: this.toObjectId(currentId) }, { session });
      if (!container) break;
      result.push(container);
      currentId = container.parent_id || null;
    }
    return result;
  }

  async findFacilityAndRoomForFreezer(freezerId, session) {
    if (!freezerId) return { roomId: null, facilityId: null };
    const freezer = await this.db.collection('storageContainers').findOne(
      { _id: this.toObjectId(freezerId) }, { session }
    );
    if (!freezer?.roomId) return { roomId: null, facilityId: null };
    const room = await this.db.collection('rooms').findOne(
      { _id: this.toObjectId(freezer.roomId) },
      { session }
    );
    return {
      roomId: String(freezer.roomId),
      facilityId: room?.facilityId ? String(room.facilityId) : null
    };
  }

  async findStorageHierarchyForBox(boxObjId, session) {
    const storagePath = await this.db.collection('storagePaths').findOne({ boxId: boxObjId }, { session });
    let rackId = storagePath?.rackId ? String(storagePath.rackId) : null;
    let shelfId = storagePath?.shelfId ? String(storagePath.shelfId) : null;
    let freezerId = storagePath?.freezerId || null;

    if (!storagePath) {
      const box = await this.findBoxById(boxObjId, session);
      const ancestors = await this.resolveAncestorContainersLive(box?.parent_id, session);
      for (const container of ancestors) {
        if (container.containerType === 'RACK') rackId = String(container._id);
        else if (container.containerType === 'SHELF') shelfId = String(container._id);
        else if (container.containerType === 'FREEZER') freezerId = container._id;
      }
    }

    const { roomId, facilityId } = await this.findFacilityAndRoomForFreezer(freezerId, session);
    return {
      rackId,
      shelfId,
      equipmentId: freezerId ? String(freezerId) : null,
      roomId,
      facilityId
    };
  }

  async resolveLiveStoragePath(boxObjId, session) {
    const box = await this.findBoxById(boxObjId, session);
    if (!box) return null;
    const ancestors = await this.resolveAncestorContainersLive(box.parent_id, session);
    let rack = null;
    let shelf = null;
    let freezer = null;
    for (const container of ancestors) {
      if (container.containerType === 'RACK') rack = container;
      else if (container.containerType === 'SHELF') shelf = container;
      else if (container.containerType === 'FREEZER') freezer = container;
    }
    if (!rack || !shelf || !freezer) return null;
    return {
      path: `${freezer.name}/${shelf.name}/${rack.name}/${box.name}`,
      fullHierarchy: {
        freezerId: freezer._id,
        shelfId: shelf._id,
        rackId: rack._id,
        boxId: box._id
      }
    };
  }

  async checkLocationBlocked(box, session) {
    if (box.status === 'RETIRED') {
      return {
        blocked: true,
        error: 'BOX_UNAVAILABLE',
        message: `StorageBox ${box._id} está retirada de uso (status: RETIRED)`
      };
    }
    const storagePath = await this.db.collection('storagePaths').findOne({ boxId: box._id }, { session });
    const ancestorIds = storagePath
      ? [storagePath.rackId, storagePath.shelfId, storagePath.freezerId]
          .filter(Boolean)
          .map((id) => this.toObjectId(id))
      : (await this.resolveAncestorContainersLive(box.parent_id, session)).map((container) => container._id);
    if (ancestorIds.length) {
      const blocked = await this.db.collection('storageContainers').findOne({
        _id: { $in: ancestorIds },
        status: { $exists: true, $ne: 'OPERATIONAL' }
      }, { session });
      if (blocked) {
        return {
          blocked: true,
          error: 'LOCATION_UNAVAILABLE',
          message: `Localização indisponível: ${blocked.containerType || 'container'} "${blocked.name || blocked._id}" está com status ${blocked.status}`
        };
      }
    }
    return { blocked: false };
  }

  async validatePositionAvailability(input) {
    const box = await this.findBoxById(input.boxId);
    const position = String(input.position || '').trim().toUpperCase();
    if (!box) {
      return {
        available: false,
        error: 'BOX_NOT_FOUND',
        message: `StorageBox ${input.boxId} não encontrada`
      };
    }
    const locationCheck = await this.checkLocationBlocked(box);
    if (locationCheck.blocked) {
      return {
        available: false,
        error: locationCheck.error,
        message: locationCheck.message
      };
    }

    const match = position.match(/^([A-Z])(\d+)$/);
    if (!match) {
      return {
        available: false,
        error: 'INVALID_POSITION_FORMAT',
        message: `Posição "${position}" inválida. Usar formato: Letra+Número (ex: A1, B4)`
      };
    }
    const row = match[1].charCodeAt(0) - 65;
    const col = Number(match[2]);
    const rows = Number(box?.dimension?.rows || 0);
    const cols = Number(box?.dimension?.cols || 0);
    if (row < 0 || row >= rows) {
      return { available: false, error: 'POSITION_OUT_OF_BOUNDS_ROW', message: `Posição "${position}" fora do intervalo` };
    }
    if (col < 1 || col > cols) {
      return { available: false, error: 'POSITION_OUT_OF_BOUNDS_COL', message: `Posição "${position}" fora do intervalo` };
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
    const capacity = rows * cols;
    return {
      available: true,
      boxData: {
        boxId: box._id,
        boxName: box.name,
        dimension: box.dimension,
        currentOccupancy: Number(box.currentOccupancy || 0),
        capacity,
        availablePositions: capacity - Number(box.currentOccupancy || 0)
      }
    };
  }

  async getBoxAvailablePositions(input) {
    const box = await this.findBoxById(input.boxId);
    if (!box) return null;
    const positions = positionGrid.getAllValidPositions(box.dimension);
    const occupancyGrid = box.occupancyGrid || {};
    const availablePositions = positions.filter((position) => !occupancyGrid[position]);
    const occupiedPositions = positions.filter((position) => Boolean(occupancyGrid[position]));
    const capacity = positions.length;
    const occupied = Number(box.currentOccupancy || occupiedPositions.length);
    return {
      boxId: box._id,
      boxName: box.name,
      dimension: box.dimension,
      stats: {
        capacity,
        occupied,
        available: availablePositions.length,
        occupancyPercent: capacity ? Math.round((occupied / capacity) * 100) : 0
      },
      availablePositions,
      occupiedPositions: occupiedPositions.slice(0, 10)
    };
  }

  async assignCanonicalPhysicalPlacement(input, session) {
    const box = await this.findBoxById(input.boxId, session);
    if (!box) {
      throw new Error('Caixa de armazenamento não encontrada');
    }
    const hierarchy = await this.findStorageHierarchyForBox(this.toObjectId(input.boxId), session);
    const canonicalChain = await this.physicalStore.assignSpecimenPosition({
      specimenId: input.specimenId,
      box,
      positionCode: input.positionCode,
      hierarchy
    }, session);
    await this.enqueueCanonicalPhysicalStorageProjection(canonicalChain, session);
    return this.physicalStore.findCurrentBySpecimen(input.specimenId, session);
  }

  async releaseCanonicalPhysicalPlacement(input, session) {
    const released = await this.physicalStore.releaseSpecimenPosition(input.specimenId, session);
    if (released) {
      await this.enqueueCanonicalPhysicalStorageProjection({
        specimenContainerAssignment: {
          specimenContainerAssignmentId: released.specimenContainerAssignmentId,
          specimenId: released.specimenId,
          containerId: released.containerId,
          assignedAt: released.assignedAt,
          releasedAt: released.releasedAt
        },
        containerPositionAssignment: {
          containerPositionAssignmentId: released.containerPositionAssignmentId,
          storagePositionId: released.storagePositionId,
          placedAt: released.placedAt,
          removedAt: released.removedAt || new Date()
        },
        rackLocationAssignment: {
          rackLocationAssignmentId: released.rackLocationAssignmentId,
          storageRackId: released.storageRackId,
          storageLocationId: released.storageLocationId
        }
      }, session);
    }
    return released;
  }

  async enqueueCanonicalPhysicalStorageProjection(canonicalChain, session) {
    const sca = canonicalChain?.specimenContainerAssignment || {};
    const cpa = canonicalChain?.containerPositionAssignment || {};
    const rla = canonicalChain?.rackLocationAssignment || {};
    if (!sca.specimenId) return null;
    return this.graphProjectionService.appendSpecimenContainerAssignmentEvent(this.db, {
      specimenContainerAssignmentId: sca.specimenContainerAssignmentId,
      specimenId: sca.specimenId,
      containerId: sca.containerId,
      containerPositionAssignmentId: cpa.containerPositionAssignmentId,
      storagePositionId: cpa.storagePositionId,
      rackLocationAssignmentId: rla.rackLocationAssignmentId || null,
      storageRackId: rla.storageRackId || canonicalChain?.storageRack?.storageRackId || null,
      storageLocationId: rla.storageLocationId || null,
      assignedAt: sca.assignedAt || null,
      releasedAt: sca.releasedAt || null,
      placedAt: cpa.placedAt || null,
      removedAt: cpa.removedAt || null,
      sourceService: 'mongo-storage-repository-v2'
    }, { session });
  }

  async allocateSamplePosition(input, session) {
    const samples = await getCollection(this.db, 'samples');
    const boxes = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);
    const position = String(input.position || '').trim().toUpperCase();
    const sample = await samples.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }
    if (await this.findCurrentStoragePlacement(sample.specimenId || sample._id, session)) {
      throw new Error('Amostra já está alocada em outra posição');
    }
    const box = await boxes.findOne({ _id: boxObjId }, { session });
    if (!box) {
      throw new Error('Caixa de armazenamento não encontrada');
    }
    const locationCheck = await this.checkLocationBlocked(box, session);
    if (locationCheck.blocked) throw new Error(locationCheck.message);
    const match = position.match(/^([A-Z])(\d+)$/);
    if (!match) {
      throw new Error('Posição inválida. Use o formato Letra+Número (ex: A1, B4)');
    }
    const row = match[1].charCodeAt(0) - 65;
    const col = Number(match[2]);
    const rows = Number(box?.dimension?.rows || 0);
    const cols = Number(box?.dimension?.cols || 0);
    if (row < 0 || row >= rows || col < 1 || col > cols) {
      throw new Error('Posição fora dos limites da caixa');
    }

    const update = await boxes.updateOne(
      { _id: boxObjId, [`occupancyGrid.${position}`]: { $exists: false } },
      {
        $set: { [`occupancyGrid.${position}`]: sampleObjId, updatedAt: new Date() },
        $inc: { currentOccupancy: 1 }
      },
      { session }
    );
    if (!update.matchedCount) throw new Error('STORAGE_COLLISION: posição já ocupada');
    await samples.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() } },
      { session }
    );
    return this.assignCanonicalPhysicalPlacement({
      specimenId: sample.specimenId || sample._id,
      boxId: boxObjId,
      positionCode: position
    }, session);
  }

  async autoAssignSamplePosition(input, session) {
    const samples = await getCollection(this.db, 'samples');
    const boxes = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);
    const box = await boxes.findOne({ _id: boxObjId }, { session });
    if (!box) {
      throw new Error('BOX_NOT_FOUND');
    }
    const locationCheck = await this.checkLocationBlocked(box, session);
    if (locationCheck.blocked) throw new Error(locationCheck.error || locationCheck.message);
    const sample = await samples.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('SAMPLE_NOT_FOUND');
    }
    if (await this.findCurrentStoragePlacement(sample.specimenId || sample._id, session)) {
      throw new Error('ALREADY_ALLOCATED');
    }
    const position = positionGrid.findFirstAvailablePosition(box);
    if (!position) {
      throw new Error('BOX_FULL');
    }
    const update = await boxes.updateOne(
      { _id: boxObjId, [`occupancyGrid.${position}`]: { $exists: false } },
      {
        $set: {
          [`occupancyGrid.${position}`]: sampleObjId,
          updatedAt: new Date(),
          lastModified: new Date()
        },
        $inc: { currentOccupancy: 1 }
      },
      { session }
    );
    if (!update.matchedCount) {
      throw new Error('STORAGE_COLLISION: Colisão detectada durante alocação automática');
    }
    await samples.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() } },
      { session }
    );
    return this.assignCanonicalPhysicalPlacement({
      specimenId: sample.specimenId || sample._id,
      boxId: boxObjId,
      positionCode: position
    }, session);
  }

  async moveSamplePosition(input, session) {
    const samples = await getCollection(this.db, 'samples');
    const boxes = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const fromBoxObjId = this.toObjectId(input.fromBoxId);
    const toBoxObjId = this.toObjectId(input.toBoxId);
    const sample = await samples.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }
    const canonicalSpecimenId = sample.specimenId || sample._id;
    const current = await this.findCurrentStoragePlacement(canonicalSpecimenId, session);
    if (
      !current ||
      String(current.boxId) !== String(input.fromBoxId) ||
      String(current.positionCode) !== String(input.fromPosition).toUpperCase()
    ) {
      throw new Error('Origem inconsistente: posicionamento físico canônico não corresponde à origem informada');
    }
    const source = await boxes.updateOne(
      { _id: fromBoxObjId, [`occupancyGrid.${input.fromPosition}`]: sampleObjId },
      {
        $unset: { [`occupancyGrid.${input.fromPosition}`]: '' },
        $inc: { currentOccupancy: -1 },
        $set: { updatedAt: new Date() }
      },
      { session }
    );
    if (!source.matchedCount) {
      throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');
    }
    const targetBox = await boxes.findOne({ _id: toBoxObjId }, { session });
    if (!targetBox) {
      throw new Error('Caixa de destino não encontrada');
    }
    const locationCheck = await this.checkLocationBlocked(targetBox, session);
    if (locationCheck.blocked) throw new Error(locationCheck.message);
    const toPosition = String(input.toPosition).toUpperCase();
    const target = await boxes.updateOne(
      { _id: toBoxObjId, [`occupancyGrid.${toPosition}`]: { $exists: false } },
      {
        $set: { [`occupancyGrid.${toPosition}`]: sampleObjId, updatedAt: new Date() },
        $inc: { currentOccupancy: 1 }
      },
      { session }
    );
    if (!target.matchedCount) {
      throw new Error('STORAGE_COLLISION: posição de destino já ocupada ou inválida');
    }
    await samples.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() } },
      { session }
    );
    await this.releaseCanonicalPhysicalPlacement({ specimenId: canonicalSpecimenId }, session);
    return this.assignCanonicalPhysicalPlacement({
      specimenId: canonicalSpecimenId,
      boxId: toBoxObjId,
      positionCode: toPosition
    }, session);
  }

  async releaseSamplePosition(input, session) {
    const samples = await getCollection(this.db, 'samples');
    const boxes = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const sample = await samples.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }
    const canonicalSpecimenId = sample.specimenId || sample._id;
    const current = await this.findCurrentStoragePlacement(canonicalSpecimenId, session);
    if (!current) {
      throw new Error('Amostra não possui posicionamento físico ativo');
    }
    const boxUpdate = await boxes.updateOne(
      { _id: this.toObjectId(current.boxId), [`occupancyGrid.${current.positionCode}`]: sampleObjId },
      {
        $unset: { [`occupancyGrid.${current.positionCode}`]: '' },
        $inc: { currentOccupancy: -1 },
        $set: { updatedAt: new Date() }
      },
      { session }
    );
    if (!boxUpdate.matchedCount) {
      throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');
    }
    await samples.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() } },
      { session }
    );
    await this.releaseCanonicalPhysicalPlacement({ specimenId: canonicalSpecimenId }, session);
    return {
      from: { boxId: String(current.boxId), position: current.positionCode },
      barcode: sample.barcode || null,
      quantity: sample.quantity || null,
      unit: sample.unit || 'µL'
    };
  }

  async getSamplePhysicalPlacement(input) {
    const sample = await this.findSampleById(input.specimenId);
    if (!sample) {
      return { found: false, error: 'SAMPLE_NOT_FOUND' };
    }
    const currentStoragePlacement = sample.currentStoragePlacement;
    if (!currentStoragePlacement) {
      return { found: false, message: 'Amostra sem posicionamento físico ativo' };
    }
    const boxObjId = this.toObjectId(currentStoragePlacement.boxId);
    const storagePath = await this.db.collection('storagePaths').findOne({ boxId: boxObjId });
    const liveResolution = storagePath ? null : await this.resolveLiveStoragePath(boxObjId);
    const box = await this.findBoxById(boxObjId);
    return {
      found: true,
      placement: {
        specimenId: sample.specimenId || sample._id,
        barcode: sample.barcode,
        box: {
          boxId: currentStoragePlacement.boxId,
          boxName: box?.name || null,
          position: currentStoragePlacement.positionCode
        },
        path: storagePath?.path || liveResolution?.path || 'N/A',
        fullHierarchy: storagePath
          ? {
              freezerId: storagePath.freezerId,
              shelfId: storagePath.shelfId,
              rackId: storagePath.rackId,
              boxId: storagePath.boxId
            }
          : (liveResolution?.fullHierarchy || null),
        canonicalPlacement: currentStoragePlacement
      }
    };
  }

  async resolvePhysicalPlacementsForSamples(samples) {
    const result = new Map();
    for (const sample of samples || []) {
      const specimenId = sample.specimenId || sample._id;
      const resolved = await this.getSamplePhysicalPlacement({ specimenId });
      result.set(String(sample._id), resolved.found ? resolved.placement : null);
    }
    return result;
  }

  async searchAllocatableSampleCandidates(input) {
    const searchTerm = String(input.query || '').trim();
    if (searchTerm.length < 2) return [];
    const searchRegex = new RegExp(searchTerm, 'i');
    const samples = await getCollection(this.db, 'samples');
    const candidates = await samples.find({
      $and: [
        { $or: [{ barcode: searchRegex }, { participantId: searchRegex }, { specimenId: searchRegex }] },
        { specimenStatus: { $in: ['available', 'reserved'] } }
      ]
    }).limit(100).toArray();
    const result = [];
    for (const sample of candidates) {
      if (!(await this.findCurrentStoragePlacement(sample.specimenId || sample._id))) {
        result.push(sample);
      }
      if (result.length >= 20) break;
    }
    return result;
  }
}

module.exports = MongoStorageRepository;
