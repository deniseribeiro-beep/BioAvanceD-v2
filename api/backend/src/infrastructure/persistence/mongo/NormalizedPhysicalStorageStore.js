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
          partialFilterExpression: { assignmentStatus: 'active' },
          name: 'ux_open_specimen_container_assignment'
        }],
        [containerPositionAssignments, { containerPositionAssignmentId: 1 }, { unique: true, name: 'ux_container_position_assignment_id' }],
        [containerPositionAssignments, { containerId: 1 }, {
          unique: true,
          partialFilterExpression: { assignmentStatus: 'active' },
          name: 'ux_open_container_position_assignment'
        }],
        [rackLocationAssignments, { rackLocationAssignmentId: 1 }, { unique: true, name: 'ux_rack_location_assignment_id' }],
        [rackLocationAssignments, { storageRackId: 1 }, {
          unique: true,
          partialFilterExpression: { assignmentStatus: 'active' },
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

  async ensureContainerForSpecimen(specimenId, sourceEventId, session) {
    await this.ensureIndexes();
    const { containers, specimenContainerAssignments } = this.collections();
    const existingAssignment = await specimenContainerAssignments.findOne(
      { specimenId: String(specimenId), assignmentStatus: 'active' },
      { session }
    );
    if (existingAssignment) return existingAssignment;

    const container = PhysicalStorageV2.container({ specimenId });
    await containers.updateOne(
      { containerId: container.containerId },
      {
        $setOnInsert: container,
        $set: { emptyStatus: 'occupied', status: 'active' }
      },
      { upsert: true, session }
    );

    const assignment = PhysicalStorageV2.specimenContainerAssignment({
      specimenId,
      containerId: container.containerId,
      sourceEventId
    });
    await specimenContainerAssignments.insertOne(assignment, { session });
    return assignment;
  }

  async ensureRackAndPosition({ box, positionCode, hierarchy, sourceEventId }, session) {
    await this.ensureIndexes();
    const { storageRacks, storagePositions, rackLocationAssignments } = this.collections();
    const storageRackId = PhysicalStorageV2.storageRackIdForBox(box._id);

    // StorageBox is configuration/layout input, not operational custody
    // authority. Keep the bridge to the canonical StorageRack on the
    // configuration document instead of leaking `sourceStorageBoxId` into
    // the canonical StorageRack document (#967/#1124).
    await this.db.collection('storageBoxes').updateOne(
      { _id: box._id },
      { $set: { canonicalStorageRackId: storageRackId } },
      { session }
    );

    const rack = PhysicalStorageV2.storageRack({
      storageRackId,
      rowCount: box?.dimension?.rows || 0,
      columnCount: box?.dimension?.cols || 0,
      coordinateScheme: 'alpha_numeric',
      orientationRule: 'top_left_origin',
      status: 'active'
    });
    await storageRacks.updateOne(
      { storageRackId },
      { $setOnInsert: rack, $set: { status: 'active' } },
      { upsert: true, session }
    );

    const position = PhysicalStorageV2.storagePosition({ storageRackId, positionCode, status: 'available' });
    await storagePositions.updateOne(
      { storagePositionId: position.storagePositionId },
      { $setOnInsert: position },
      { upsert: true, session }
    );

    const storageLocationId = await this.resolveStorageLocationId({ hierarchy, boxId: box._id });
    let rackLocationAssignment = await rackLocationAssignments.findOne(
      { storageRackId, assignmentStatus: 'active' },
      { session }
    );
    if (!rackLocationAssignment || String(rackLocationAssignment.storageLocationId) !== String(storageLocationId)) {
      if (rackLocationAssignment) {
        await rackLocationAssignments.updateOne(
          { rackLocationAssignmentId: rackLocationAssignment.rackLocationAssignmentId, assignmentStatus: 'active' },
          { $set: PhysicalStorageV2.closeFields() },
          { session }
        );
      }
      rackLocationAssignment = PhysicalStorageV2.rackLocationAssignment({
        storageRackId,
        storageLocationId,
        sourceEventId
      });
      await rackLocationAssignments.insertOne(rackLocationAssignment, { session });
    }

    return { rack, position, rackLocationAssignment };
  }

  async assignSpecimenPosition({ specimenId, box, positionCode, hierarchy, sourceEventId }, session) {
    await this.ensureIndexes();
    const { containerPositionAssignments, storagePositions } = this.collections();
    const specimenContainerAssignment = await this.ensureContainerForSpecimen(specimenId, sourceEventId, session);
    const { rack, position, rackLocationAssignment } = await this.ensureRackAndPosition({
      box,
      positionCode,
      hierarchy,
      sourceEventId
    }, session);

    const current = await containerPositionAssignments.findOne(
      { containerId: specimenContainerAssignment.containerId, assignmentStatus: 'active' },
      { session }
    );
    if (current) {
      if (String(current.storagePositionId) === String(position.storagePositionId)) {
        return {
          specimenContainerAssignment,
          containerPositionAssignment: current,
          rackLocationAssignment,
          storageRack: rack,
          storagePosition: position
        };
      }
      await containerPositionAssignments.updateOne(
        { containerPositionAssignmentId: current.containerPositionAssignmentId, assignmentStatus: 'active' },
        { $set: PhysicalStorageV2.closeFields() },
        { session }
      );
      await storagePositions.updateOne(
        { storagePositionId: current.storagePositionId },
        { $set: { status: 'available' } },
        { session }
      );
    }

    const containerPositionAssignment = PhysicalStorageV2.containerPositionAssignment({
      containerId: specimenContainerAssignment.containerId,
      storagePositionId: position.storagePositionId
    });
    await containerPositionAssignments.insertOne(containerPositionAssignment, { session });
    await storagePositions.updateOne(
      { storagePositionId: position.storagePositionId },
      { $set: { status: 'occupied' } },
      { session }
    );
    return {
      specimenContainerAssignment,
      containerPositionAssignment,
      rackLocationAssignment,
      storageRack: rack,
      storagePosition: { ...position, status: 'occupied' }
    };
  }

  async releaseSpecimenPosition(specimenId, session) {
    await this.ensureIndexes();
    const current = await this.findCurrentBySpecimen(specimenId, session);
    if (!current) return null;
    const { containerPositionAssignments, storagePositions } = this.collections();
    const removedAt = new Date();
    await containerPositionAssignments.updateOne(
      { containerPositionAssignmentId: current.containerPositionAssignmentId, assignmentStatus: 'active' },
      { $set: PhysicalStorageV2.closeFields(removedAt) },
      { session }
    );
    await storagePositions.updateOne(
      { storagePositionId: current.storagePositionId },
      { $set: { status: 'available' } },
      { session }
    );
    return { ...current, removedAt, assignmentStatus: 'inactive' };
  }

  async releaseSpecimenContainer(specimenId, session) {
    await this.ensureIndexes();
    const { specimenContainerAssignments, containers } = this.collections();
    const current = await specimenContainerAssignments.findOne(
      { specimenId: String(specimenId), assignmentStatus: 'active' },
      { session }
    );
    if (!current) return null;
    const at = new Date();
    await specimenContainerAssignments.updateOne(
      { specimenContainerAssignmentId: current.specimenContainerAssignmentId, assignmentStatus: 'active' },
      { $set: PhysicalStorageV2.unloadContainerFields(at) },
      { session }
    );
    await containers.updateOne(
      { containerId: current.containerId },
      { $set: { emptyStatus: 'empty', status: 'active' } },
      { session }
    );
    return { ...current, unloadedAt: at, assignmentStatus: 'inactive' };
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
      { specimenId: String(specimenId), assignmentStatus: 'active' },
      { session }
    );
    if (!specimenContainerAssignment) return null;
    const containerPositionAssignment = await containerPositionAssignments.findOne(
      { containerId: specimenContainerAssignment.containerId, assignmentStatus: 'active' },
      { session }
    );
    if (!containerPositionAssignment) return null;
    const storagePosition = await storagePositions.findOne(
      { storagePositionId: containerPositionAssignment.storagePositionId },
      { session }
    );
    if (!storagePosition) return null;
    const storageRack = await storageRacks.findOne({ storageRackId: storagePosition.storageRackId }, { session });
    if (!storageRack) return null;
    const rackLocationAssignment = await rackLocationAssignments.findOne(
      { storageRackId: storageRack.storageRackId, assignmentStatus: 'active' },
      { session }
    );
    const layoutBox = await this.db.collection('storageBoxes').findOne(
      { canonicalStorageRackId: storageRack.storageRackId },
      { session }
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
      boxId: layoutBox?._id || storageRack.storageRackId,
      positionCode: storagePosition.positionCode,
      loadedAt: specimenContainerAssignment.loadedAt,
      placedAt: containerPositionAssignment.placedAt,
      unloadedAt: specimenContainerAssignment.unloadedAt || null,
      removedAt: containerPositionAssignment.removedAt || null,
      sourceEventId: specimenContainerAssignment.sourceEventId || null
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
    const rackIds = boxKeys.map((boxId) => PhysicalStorageV2.storageRackIdForBox(boxId));
    const positionFilter = { storageRackId: { $in: rackIds } };
    if (positionCode) positionFilter.positionCode = String(positionCode);
    const positions = await storagePositions.find(positionFilter, queryOptions).toArray();
    const positionIds = positions.map((position) => position.storagePositionId);
    if (positionIds.length === 0) return [];
    const placements = await containerPositionAssignments.find(
      { storagePositionId: { $in: positionIds }, assignmentStatus: 'active' },
      queryOptions
    ).toArray();
    const containerIds = placements.map((placement) => placement.containerId);
    if (containerIds.length === 0) return [];
    const assignments = await specimenContainerAssignments.find(
      { containerId: { $in: containerIds }, assignmentStatus: 'active' },
      queryOptions
    ).toArray();
    return [...new Set(assignments.map((assignment) => String(assignment.specimenId)).filter(Boolean))];
  }
}

module.exports = NormalizedPhysicalStorageStore;
