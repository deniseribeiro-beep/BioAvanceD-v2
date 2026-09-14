const PhysicalStorageV2 = require('../../../models/PhysicalStorageV2');

class NormalizedPhysicalStorageStore {
  constructor(db, options = {}) {
    this.db = db;
    this.resolveStorageLocationId = options.resolveStorageLocationId || (async ({ hierarchy, boxId }) => (
      hierarchy?.equipmentId || hierarchy?.roomId || hierarchy?.facilityId || String(boxId)
    ));
    this.indexesPromise = null;
  }

  collections() {
    return {
      containers: this.db.collection('containers'),
      storageRacks: this.db.collection('storageRacks'),
      storagePositions: this.db.collection('storagePositions'),
      specimenContainerAssignments: this.db.collection('specimenContainerAssignments'),
      containerPositionAssignments: this.db.collection('containerPositionAssignments'),
      rackLocationAssignments: this.db.collection('rackLocationAssignments')
    };
  }

  async ensureIndexes() {
    if (this.indexesPromise) return this.indexesPromise;
    this.indexesPromise = (async () => {
      const {
        containers,
        storageRacks,
        storagePositions,
        specimenContainerAssignments,
        containerPositionAssignments,
        rackLocationAssignments
      } = this.collections();

      const definitions = [
        [containers, { containerId: 1 }, { unique: true, name: 'ux_container_id' }],
        [storageRacks, { storageRackId: 1 }, { unique: true, name: 'ux_storage_rack_id' }],
        [storagePositions, { storagePositionId: 1 }, { unique: true, name: 'ux_storage_position_id' }],
        [specimenContainerAssignments, { specimenContainerAssignmentId: 1 }, { unique: true, name: 'ux_specimen_container_assignment_id' }],
        [specimenContainerAssignments, { specimenId: 1 }, {
          unique: true,
          partialFilterExpression: { releasedAt: null },
          name: 'ux_open_specimen_container_assignment'
        }],
        [containerPositionAssignments, { containerPositionAssignmentId: 1 }, { unique: true, name: 'ux_container_position_assignment_id' }],
        [containerPositionAssignments, { containerId: 1 }, {
          unique: true,
          partialFilterExpression: { removedAt: null },
          name: 'ux_open_container_position_assignment'
        }],
        [rackLocationAssignments, { rackLocationAssignmentId: 1 }, { unique: true, name: 'ux_rack_location_assignment_id' }],
        [rackLocationAssignments, { storageRackId: 1 }, {
          unique: true,
          partialFilterExpression: { removedAt: null },
          name: 'ux_open_rack_location_assignment'
        }]
      ];

      for (const [collection, keys, options] of definitions) {
        if (typeof collection.createIndex === 'function') {
          await collection.createIndex(keys, options);
        }
      }
    })().catch((error) => {
      this.indexesPromise = null;
      throw error;
    });
    return this.indexesPromise;
  }

  async ensureContainerForSpecimen(specimenId, session) {
    await this.ensureIndexes();
    const { containers, specimenContainerAssignments } = this.collections();
    const existingAssignment = await specimenContainerAssignments.findOne(
      { specimenId: String(specimenId), releasedAt: null },
      { session }
    );
    if (existingAssignment) return existingAssignment;

    const container = PhysicalStorageV2.container({ specimenId });
    const { status: _status, updatedAt: _updatedAt, ...containerOnInsert } = container;
    await containers.updateOne(
      { containerId: container.containerId },
      {
        $setOnInsert: containerOnInsert,
        $set: { status: 'occupied', updatedAt: new Date() }
      },
      { upsert: true, session }
    );

    const assignment = PhysicalStorageV2.specimenContainerAssignment({ specimenId, containerId: container.containerId });
    await specimenContainerAssignments.insertOne(assignment, { session });
    return assignment;
  }

  async ensureRackAndPosition({ box, positionCode, hierarchy }, session) {
    await this.ensureIndexes();
    const { storageRacks, storagePositions, rackLocationAssignments } = this.collections();
    const storageRackId = PhysicalStorageV2.storageRackIdForBox(box._id);
    const rack = PhysicalStorageV2.storageRack({
      storageRackId,
      sourceStorageBoxId: box._id,
      rowCount: box?.dimension?.rows || 0,
      columnCount: box?.dimension?.cols || 0,
      capacity: Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0)
    });
    const { updatedAt: _rackUpdatedAt, ...rackOnInsert } = rack;
    await storageRacks.updateOne(
      { storageRackId },
      { $setOnInsert: rackOnInsert, $set: { updatedAt: new Date() } },
      { upsert: true, session }
    );

    const position = PhysicalStorageV2.storagePosition({ storageRackId, positionCode });
    const { updatedAt: _positionUpdatedAt, ...positionOnInsert } = position;
    await storagePositions.updateOne(
      { storagePositionId: position.storagePositionId },
      { $setOnInsert: positionOnInsert, $set: { updatedAt: new Date() } },
      { upsert: true, session }
    );

    const storageLocationId = await this.resolveStorageLocationId({ hierarchy, boxId: box._id });
    let rackLocationAssignment = await rackLocationAssignments.findOne({ storageRackId, removedAt: null }, { session });
    if (!rackLocationAssignment || String(rackLocationAssignment.storageLocationId) !== String(storageLocationId)) {
      if (rackLocationAssignment) {
        await rackLocationAssignments.updateOne(
          { rackLocationAssignmentId: rackLocationAssignment.rackLocationAssignmentId, removedAt: null },
          { $set: PhysicalStorageV2.closeFields() },
          { session }
        );
      }
      rackLocationAssignment = PhysicalStorageV2.rackLocationAssignment({ storageRackId, storageLocationId });
      await rackLocationAssignments.insertOne(rackLocationAssignment, { session });
    }

    return { rack, position, rackLocationAssignment };
  }

  async assignSpecimenPosition({ specimenId, box, positionCode, hierarchy }, session) {
    await this.ensureIndexes();
    const { containerPositionAssignments } = this.collections();
    const specimenContainerAssignment = await this.ensureContainerForSpecimen(specimenId, session);
    const { rack, position, rackLocationAssignment } = await this.ensureRackAndPosition({ box, positionCode, hierarchy }, session);

    const current = await containerPositionAssignments.findOne(
      { containerId: specimenContainerAssignment.containerId, removedAt: null },
      { session }
    );
    if (current) {
      if (String(current.storagePositionId) === String(position.storagePositionId)) {
        return { specimenContainerAssignment, containerPositionAssignment: current, rackLocationAssignment, storageRack: rack, storagePosition: position };
      }
      await containerPositionAssignments.updateOne(
        { containerPositionAssignmentId: current.containerPositionAssignmentId, removedAt: null },
        { $set: PhysicalStorageV2.closeFields() },
        { session }
      );
    }

    const containerPositionAssignment = PhysicalStorageV2.containerPositionAssignment({
      containerId: specimenContainerAssignment.containerId,
      storagePositionId: position.storagePositionId
    });
    await containerPositionAssignments.insertOne(containerPositionAssignment, { session });
    return { specimenContainerAssignment, containerPositionAssignment, rackLocationAssignment, storageRack: rack, storagePosition: position };
  }

  async releaseSpecimenPosition(specimenId, session) {
    await this.ensureIndexes();
    const current = await this.findCurrentBySpecimen(specimenId, session);
    if (!current) return null;
    const { containerPositionAssignments } = this.collections();
    const removedAt = new Date();
    await containerPositionAssignments.updateOne(
      { containerPositionAssignmentId: current.containerPositionAssignmentId, removedAt: null },
      { $set: PhysicalStorageV2.closeFields(removedAt) },
      { session }
    );
    return { ...current, removedAt };
  }

  async releaseSpecimenContainer(specimenId, session) {
    await this.ensureIndexes();
    const { specimenContainerAssignments, containers } = this.collections();
    const current = await specimenContainerAssignments.findOne({ specimenId: String(specimenId), releasedAt: null }, { session });
    if (!current) return null;
    const at = new Date();
    await specimenContainerAssignments.updateOne(
      { specimenContainerAssignmentId: current.specimenContainerAssignmentId, releasedAt: null },
      { $set: { releasedAt: at, updatedAt: at } },
      { session }
    );
    await containers.updateOne({ containerId: current.containerId }, { $set: { status: 'available', updatedAt: at } }, { session });
    return { ...current, releasedAt: at };
  }

  async findCurrentBySpecimen(specimenId, session) {
    await this.ensureIndexes();
    const {
      specimenContainerAssignments,
      containerPositionAssignments,
      storagePositions,
      storageRacks,
      rackLocationAssignments
    } = this.collections();

    const specimenContainerAssignment = await specimenContainerAssignments.findOne(
      { specimenId: String(specimenId), releasedAt: null },
      { session }
    );
    if (!specimenContainerAssignment) return null;
    const containerPositionAssignment = await containerPositionAssignments.findOne(
      { containerId: specimenContainerAssignment.containerId, removedAt: null }, { session }
    );
    if (!containerPositionAssignment) return null;
    const storagePosition = await storagePositions.findOne(
      { storagePositionId: containerPositionAssignment.storagePositionId }, { session }
    );
    if (!storagePosition) return null;
    const storageRack = await storageRacks.findOne({ storageRackId: storagePosition.storageRackId }, { session });
    if (!storageRack) return null;
    const rackLocationAssignment = await rackLocationAssignments.findOne(
      { storageRackId: storageRack.storageRackId, removedAt: null }, { session }
    );

    return {
      specimenContainerAssignmentId: specimenContainerAssignment.specimenContainerAssignmentId,
      containerPositionAssignmentId: containerPositionAssignment.containerPositionAssignmentId,
      rackLocationAssignmentId: rackLocationAssignment?.rackLocationAssignmentId || null,
      specimenId: String(specimenId),
      containerId: specimenContainerAssignment.containerId,
      storagePositionId: storagePosition.storagePositionId,
      storageRackId: storageRack.storageRackId,
      storageLocationId: rackLocationAssignment?.storageLocationId || null,
      boxId: storageRack.sourceStorageBoxId || storageRack.storageRackId,
      positionCode: storagePosition.positionCode,
      assignedAt: specimenContainerAssignment.assignedAt,
      placedAt: containerPositionAssignment.placedAt,
      releasedAt: specimenContainerAssignment.releasedAt || null,
      removedAt: containerPositionAssignment.removedAt || null
    };
  }

  async findCurrentBySpecimens(specimenIds, session) {
    await this.ensureIndexes();
    const result = new Map();
    for (const specimenId of specimenIds || []) {
      result.set(String(specimenId), await this.findCurrentBySpecimen(specimenId, session));
    }
    return result;
  }

  async findSpecimenIdsByLocation({ boxIds = [], positionCode = null, session } = {}) {
    await this.ensureIndexes();
    const {
      storageRacks,
      storagePositions,
      containerPositionAssignments,
      specimenContainerAssignments,
    } = this.collections();
    const boxKeys = [...new Set(
      (boxIds || [])
        .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
        .map(String)
    )];
    if (boxKeys.length === 0) return [];
    const queryOptions = session ? { session } : undefined;
    const racks = await storageRacks.find(
      { $expr: { $in: [{ $toString: '$sourceStorageBoxId' }, boxKeys] } },
      queryOptions
    ).toArray();
    const rackIds = racks.map((rack) => rack.storageRackId);
    if (rackIds.length === 0) return [];
    const positionFilter = { storageRackId: { $in: rackIds } };
    if (positionCode) positionFilter.positionCode = String(positionCode);
    const positions = await storagePositions.find(positionFilter, queryOptions).toArray();
    const positionIds = positions.map((position) => position.storagePositionId);
    if (positionIds.length === 0) return [];
    const placements = await containerPositionAssignments.find(
      { storagePositionId: { $in: positionIds }, removedAt: null },
      queryOptions
    ).toArray();
    const containerIds = placements.map((placement) => placement.containerId);
    if (containerIds.length === 0) return [];
    const assignments = await specimenContainerAssignments.find(
      { containerId: { $in: containerIds }, releasedAt: null },
      queryOptions
    ).toArray();
    return [...new Set(assignments.map((assignment) => String(assignment.specimenId)).filter(Boolean))];
  }

}

module.exports = NormalizedPhysicalStorageStore;
