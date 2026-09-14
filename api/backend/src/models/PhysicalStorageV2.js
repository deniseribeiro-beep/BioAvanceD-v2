const crypto = require('crypto');

function nowOr(value) {
  return value || new Date();
}

class PhysicalStorageV2 {
  static containerIdForSpecimen(specimenId) {
    return `container:${String(specimenId)}`;
  }

  static storageRackIdForBox(boxId) {
    return String(boxId);
  }

  static storagePositionId(storageRackId, positionCode) {
    return `${String(storageRackId)}:${String(positionCode).trim().toUpperCase()}`;
  }

  static container(data) {
    return {
      containerId: data.containerId || this.containerIdForSpecimen(data.specimenId),
      containerType: data.containerType || 'specimen_primary_container',
      status: data.status || 'occupied',
      createdAt: nowOr(data.createdAt),
      updatedAt: nowOr(data.updatedAt)
    };
  }

  static storageRack(data) {
    const rows = Number(data.rowCount || 0);
    const columns = Number(data.columnCount || 0);
    return {
      storageRackId: String(data.storageRackId),
      rackType: data.rackType || 'specimen_storage_rack',
      rowCount: rows,
      columnCount: columns,
      capacity: Number(data.capacity || rows * columns),
      sourceStorageBoxId: data.sourceStorageBoxId ? String(data.sourceStorageBoxId) : null,
      createdAt: nowOr(data.createdAt),
      updatedAt: nowOr(data.updatedAt)
    };
  }

  static storagePosition(data) {
    const positionCode = String(data.positionCode).trim().toUpperCase();
    const match = positionCode.match(/^([A-Z])(\d+)$/);
    return {
      storagePositionId: data.storagePositionId || this.storagePositionId(data.storageRackId, positionCode),
      storageRackId: String(data.storageRackId),
      positionCode,
      rowIndex: match ? match[1].charCodeAt(0) - 64 : null,
      columnIndex: match ? Number(match[2]) : null,
      createdAt: nowOr(data.createdAt),
      updatedAt: nowOr(data.updatedAt)
    };
  }

  static specimenContainerAssignment(data) {
    const assignedAt = nowOr(data.assignedAt);
    return {
      specimenContainerAssignmentId: data.specimenContainerAssignmentId || crypto.randomUUID(),
      specimenId: String(data.specimenId),
      containerId: String(data.containerId),
      assignedAt,
      releasedAt: data.releasedAt || null,
      createdAt: assignedAt,
      updatedAt: assignedAt
    };
  }

  static containerPositionAssignment(data) {
    const placedAt = nowOr(data.placedAt);
    return {
      containerPositionAssignmentId: data.containerPositionAssignmentId || crypto.randomUUID(),
      containerId: String(data.containerId),
      storagePositionId: String(data.storagePositionId),
      placedAt,
      removedAt: data.removedAt || null,
      createdAt: placedAt,
      updatedAt: placedAt
    };
  }

  static rackLocationAssignment(data) {
    const placedAt = nowOr(data.placedAt);
    return {
      rackLocationAssignmentId: data.rackLocationAssignmentId || crypto.randomUUID(),
      storageRackId: String(data.storageRackId),
      storageLocationId: String(data.storageLocationId),
      placedAt,
      removedAt: data.removedAt || null,
      createdAt: placedAt,
      updatedAt: placedAt
    };
  }

  static closeFields(at = new Date(), field = 'removedAt') {
    return { [field]: at, updatedAt: at };
  }
}

module.exports = PhysicalStorageV2;
