const { getCollection } = require('../../../utils/collectionResolver');
const MongoStorageRepositoryLegacy = require('./MongoStorageRepositoryLegacy');
const NormalizedPhysicalStorageStore = require('./NormalizedPhysicalStorageStore');
const { GraphProjectionService } = require('../../../services/graphProjection.service');
const positionGrid = require('../../../utils/storagePositionGrid');

class MongoStorageRepositoryV2 extends MongoStorageRepositoryLegacy {
  constructor(db, options = {}) {
    super(db);
    this.physicalStore = options.physicalStore || new NormalizedPhysicalStorageStore(db);
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
  }

  async findSampleById(specimenId, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const sample = await samplesCollection.findOne({ _id: this.toObjectId(specimenId) }, { session });
    if (!sample) return null;
    const storageAssignment = await this.findCurrentStorageAssignment(specimenId, session);
    return { ...sample, storageAssignment, storageLocation: undefined };
  }

  async findCurrentStorageAssignment(specimenId, session) {
    return this.physicalStore.findCurrentBySpecimen(specimenId, session);
  }

  async openStorageAssignment(input, session) {
    const box = await this.findBoxById(input.boxId, session);
    if (!box) throw new Error('Caixa de armazenamento não encontrada');
    const hierarchy = await this.findStorageHierarchyForBox(this.toObjectId(input.boxId), session);
    const assignment = await this.physicalStore.assignSpecimenPosition({
      specimenId: input.specimenId,
      box,
      positionCode: input.positionCode,
      hierarchy
    }, session);
    await this.appendStorageProjection(assignment, session);
    return this.physicalStore.findCurrentBySpecimen(input.specimenId, session);
  }

  async closeStorageAssignment(input, session) {
    const released = await this.physicalStore.releaseSpecimenPosition(input.specimenId, session);
    if (released) {
      await this.appendStorageProjection({
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

  async appendStorageProjection(assignment, session) {
    const sca = assignment?.specimenContainerAssignment || {};
    const cpa = assignment?.containerPositionAssignment || {};
    const rla = assignment?.rackLocationAssignment || {};
    if (!sca.specimenId) return null;
    return this.graphProjectionService.appendStorageAssignmentEvent(this.db, {
      specimenContainerAssignmentId: sca.specimenContainerAssignmentId,
      specimenId: sca.specimenId,
      containerId: sca.containerId,
      containerPositionAssignmentId: cpa.containerPositionAssignmentId,
      storagePositionId: cpa.storagePositionId,
      rackLocationAssignmentId: rla.rackLocationAssignmentId || null,
      storageRackId: rla.storageRackId || assignment?.storageRack?.storageRackId || null,
      storageLocationId: rla.storageLocationId || null,
      assignedAt: sca.assignedAt || null,
      releasedAt: sca.releasedAt || null,
      placedAt: cpa.placedAt || null,
      removedAt: cpa.removedAt || null,
      sourceService: 'mongo-storage-repository-v2'
    }, { session });
  }

  async allocateSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);
    const normalizedPosition = String(input.position).trim().toUpperCase();

    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!sample) throw new Error('Amostra não encontrada');
    if (await this.findCurrentStorageAssignment(input.specimenId, session)) {
      throw new Error('Amostra já está alocada em outra posição');
    }

    const box = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!box) throw new Error('Caixa de armazenamento não encontrada');
    const locationCheck = await this.checkLocationBlocked(box, session);
    if (locationCheck.blocked) throw new Error(locationCheck.message);

    const match = normalizedPosition.match(/^([A-Z])(\d+)$/);
    if (!match) throw new Error('Posição inválida. Use o formato Letra+Número (ex: A1, B4)');
    const rowIndex = match[1].charCodeAt(0) - 65;
    const column = Number(match[2]);
    const maxRows = Number(box?.dimension?.rows || 0);
    const maxCols = Number(box?.dimension?.cols || 0);
    if (rowIndex < 0 || rowIndex >= maxRows || column < 1 || column > maxCols) {
      throw new Error('Posição fora dos limites da caixa');
    }

    const updateBox = await storageBoxesCollection.updateOne(
      { _id: boxObjId, [`occupancyGrid.${normalizedPosition}`]: { $exists: false } },
      {
        $set: { [`occupancyGrid.${normalizedPosition}`]: sampleObjId, updatedAt: new Date() },
        $inc: { currentOccupancy: 1 }
      },
      { session }
    );
    if (updateBox.matchedCount === 0) throw new Error('STORAGE_COLLISION: posição já ocupada');

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() }, $unset: { storageLocation: '' } },
      { session }
    );

    return this.openStorageAssignment({
      specimenId: input.specimenId,
      boxId: boxObjId,
      positionCode: normalizedPosition
    }, session);
  }

  async autoAssignSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);

    const box = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!box) throw new Error('BOX_NOT_FOUND');
    const locationCheck = await this.checkLocationBlocked(box, session);
    if (locationCheck.blocked) throw new Error(locationCheck.error);

    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!sample) throw new Error('SAMPLE_NOT_FOUND');
    if (await this.findCurrentStorageAssignment(input.specimenId, session)) throw new Error('ALREADY_ALLOCATED');

    const position = positionGrid.findFirstAvailablePosition(box);
    if (!position) throw new Error('BOX_FULL');

    const update = await storageBoxesCollection.updateOne(
      { _id: boxObjId, [`occupancyGrid.${position}`]: { $exists: false } },
      {
        $set: {
          [`occupancyGrid.${position}`]: sampleObjId,
          currentOccupancy: Number(box.currentOccupancy || 0) + 1,
          updatedAt: new Date(),
          lastModified: new Date()
        }
      },
      { session }
    );
    if (update.matchedCount === 0) throw new Error('STORAGE_COLLISION: Colisão detectada durante alocação automática');

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() }, $unset: { storageLocation: '' } },
      { session }
    );

    await this.openStorageAssignment({ specimenId: input.specimenId, boxId: boxObjId, positionCode: position }, session);
    return position;
  }

  async moveSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const fromBoxObjId = this.toObjectId(input.fromBoxId);
    const toBoxObjId = this.toObjectId(input.toBoxId);
    const current = await this.findCurrentStorageAssignment(input.specimenId, session);
    if (!current || String(current.boxId) !== String(input.fromBoxId) || current.positionCode !== input.fromPosition) {
      throw new Error('Origem inconsistente: atribuição física canônica não corresponde à origem informada');
    }

    const sourceUpdate = await storageBoxesCollection.updateOne(
      { _id: fromBoxObjId, [`occupancyGrid.${input.fromPosition}`]: sampleObjId },
      {
        $unset: { [`occupancyGrid.${input.fromPosition}`]: '' },
        $inc: { currentOccupancy: -1 },
        $set: { updatedAt: new Date() }
      },
      { session }
    );
    if (sourceUpdate.matchedCount === 0) throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');

    const toBox = await storageBoxesCollection.findOne({ _id: toBoxObjId }, { session });
    if (!toBox) throw new Error('Caixa de destino não encontrada');
    const locationCheck = await this.checkLocationBlocked(toBox, session);
    if (locationCheck.blocked) throw new Error(locationCheck.message);

    const targetUpdate = await storageBoxesCollection.updateOne(
      { _id: toBoxObjId, [`occupancyGrid.${input.toPosition}`]: { $exists: false } },
      {
        $set: { [`occupancyGrid.${input.toPosition}`]: sampleObjId, updatedAt: new Date() },
        $inc: { currentOccupancy: 1 }
      },
      { session }
    );
    if (targetUpdate.matchedCount === 0) throw new Error('STORAGE_COLLISION: posição de destino já ocupada ou inválida');

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() }, $unset: { storageLocation: '' } },
      { session }
    );

    await this.closeStorageAssignment({ specimenId: input.specimenId }, session);
    return this.openStorageAssignment({
      specimenId: input.specimenId,
      boxId: toBoxObjId,
      positionCode: input.toPosition
    }, session);
  }

  async releaseSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!sample) throw new Error('Amostra não encontrada');

    const current = await this.findCurrentStorageAssignment(input.specimenId, session);
    if (!current) throw new Error('Amostra não possui localização de armazenamento');

    const sourceBoxObjId = this.toObjectId(current.boxId);
    const boxUpdate = await storageBoxesCollection.updateOne(
      { _id: sourceBoxObjId, [`occupancyGrid.${current.positionCode}`]: sampleObjId },
      {
        $unset: { [`occupancyGrid.${current.positionCode}`]: '' },
        $inc: { currentOccupancy: -1 },
        $set: { updatedAt: new Date() }
      },
      { session }
    );
    if (boxUpdate.matchedCount === 0) throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() }, $unset: { storageLocation: '' } },
      { session }
    );
    await this.closeStorageAssignment({ specimenId: input.specimenId }, session);

    return {
      from: { boxId: String(current.boxId), position: current.positionCode },
      barcode: sample.barcode || null,
      quantity: sample.quantity || null,
      unit: sample.unit || 'µL'
    };
  }

  async rollbackAutoAssignedPosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);
    await storageBoxesCollection.updateOne(
      { _id: boxObjId, [`occupancyGrid.${input.position}`]: sampleObjId },
      {
        $unset: { [`occupancyGrid.${input.position}`]: '' },
        $inc: { currentOccupancy: -1 },
        $set: { updatedAt: new Date(), lastModified: new Date() }
      },
      { session }
    );
    await samplesCollection.updateOne(
      { _id: sampleObjId },
      { $set: { updatedAt: new Date() }, $unset: { storageLocation: '' } },
      { session }
    );
    await this.closeStorageAssignment({ specimenId: input.specimenId }, session);
  }

  async getSampleStorageLocation(input) {
    const sample = await this.findSampleById(input.specimenId);
    if (!sample) return { found: false, error: 'SAMPLE_NOT_FOUND' };
    const assignment = sample.storageAssignment;
    if (!assignment) return { found: false, message: 'Amostra sem localização de armazenamento' };

    const boxObjId = this.toObjectId(assignment.boxId);
    const storagePath = await this.db.collection('storagePaths').findOne({ boxId: boxObjId });
    const liveResolution = storagePath ? null : await this.resolveLiveStoragePath(boxObjId);
    const box = await this.findBoxById(boxObjId);
    return {
      found: true,
      location: {
        specimenId: sample._id,
        barcode: sample.barcode,
        box: { boxId: assignment.boxId, boxName: box?.name || null, position: assignment.positionCode },
        locationID: assignment.storageLocationId || null,
        readable: null,
        path: storagePath?.path || liveResolution?.path || 'N/A',
        fullHierarchy: storagePath
          ? { freezerId: storagePath.freezerId, shelfId: storagePath.shelfId, rackId: storagePath.rackId, boxId: storagePath.boxId }
          : (liveResolution ? liveResolution.fullHierarchy : null),
        physicalAssignment: assignment
      }
    };
  }

  async resolveStorageLocationsForSamples(samples) {
    const result = new Map();
    for (const sample of samples || []) {
      const resolved = await this.getSampleStorageLocation({ specimenId: sample._id });
      result.set(String(sample._id), resolved.found ? resolved.location : null);
    }
    return result;
  }

  async searchAllocatableSampleCandidates(input) {
    const searchTerm = String(input.query || '').trim();
    if (searchTerm.length < 2) return [];
    const samplesCollection = await getCollection(this.db, 'samples');
    const searchRegex = new RegExp(searchTerm, 'i');
    const candidates = await samplesCollection.find({
      $and: [
        { $or: [{ barcode: searchRegex }, { participantId: searchRegex }, { specimenId: searchRegex }] },
        { specimenStatus: { $in: ['available', 'reserved'] } }
      ]
    }).limit(100).toArray();

    const result = [];
    for (const sample of candidates) {
      if (!(await this.findCurrentStorageAssignment(sample._id))) result.push(sample);
      if (result.length >= 20) break;
    }
    return result;
  }
}

module.exports = MongoStorageRepositoryV2;
