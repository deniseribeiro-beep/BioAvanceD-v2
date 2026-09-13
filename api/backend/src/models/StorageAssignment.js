const crypto = require('crypto');

/**
 * dict-02 StorageAssignment (ELM-0167–0178, P1X-0072/0073): one record per
 * "permanência física" — a specimen's physical stay at a position, closed
 * (removedAt set) rather than overwritten when the specimen moves or is
 * released.
 */
class StorageAssignmentModel {
  static OCCUPANCY_STATUS = {
    OCCUPIED: 'ocupada',
    FREE: 'livre'
  };

  static open(data) {
    const now = data.placedAt || new Date();
    return {
      storageAssignmentId: data.storageAssignmentId || crypto.randomUUID(),
      specimenId: String(data.specimenId),
      storageLocationId: data.boxId ? String(data.boxId) : null,
      facilityId: data.facilityId || null,
      roomId: data.roomId || null,
      equipmentId: data.equipmentId || null,
      shelfId: data.shelfId || null,
      rackId: data.rackId || null,
      boxId: data.boxId ? String(data.boxId) : null,
      positionCode: data.positionCode,
      nominalTemperature: data.nominalTemperature ?? null,
      placedAt: now,
      removedAt: null,
      occupancyStatus: this.OCCUPANCY_STATUS.OCCUPIED,
      createdAt: now,
      updatedAt: now
    };
  }

  static closeFields(removedAt = new Date()) {
    return {
      removedAt,
      occupancyStatus: this.OCCUPANCY_STATUS.FREE,
      updatedAt: removedAt
    };
  }
}

module.exports = StorageAssignmentModel;
