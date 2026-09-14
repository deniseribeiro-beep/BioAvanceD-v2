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
      emptyStatus: data.emptyStatus || 'occupied',
      status: data.status || 'active',
      createdAt: nowOr(data.createdAt)
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
      coordinateScheme: data.coordinateScheme || 'alpha_numeric',
      orientationRule: data.orientationRule || 'top_left_origin',
      status: data.status || 'active',
      ...(data.storageLocationId ? { storageLocationId: String(data.storageLocationId) } : {}),
      ...(data.catalogReference ? { catalogReference: String(data.catalogReference) } : {})
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
      status: data.status || 'available'
    };
  }

  static specimenContainerAssignment(data) {
    const loadedAt = nowOr(data.loadedAt || data.assignedAt);
    return {
      specimenContainerAssignmentId: data.specimenContainerAssignmentId || crypto.randomUUID(),
      specimenId: String(data.specimenId),
      containerId: String(data.containerId),
      loadedAt,
      unloadedAt: data.unloadedAt || data.releasedAt || null,
      assignmentStatus: data.assignmentStatus || 'active',
      sourceEventId: String(data.sourceEventId || crypto.randomUUID())
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
      assignmentStatus: data.assignmentStatus || 'active',
      ...(data.sourceScanEventId ? { sourceScanEventId: String(data.sourceScanEventId) } : {})
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
      assignmentStatus: data.assignmentStatus || 'active',
      sourceEventId: String(data.sourceEventId || crypto.randomUUID())
    };
  }

  static closeFields(at = new Date()) {
    return { removedAt: at, assignmentStatus: 'inactive' };
  }

  static unloadContainerFields(at = new Date()) {
    return { unloadedAt: at, assignmentStatus: 'inactive' };
  }
}

module.exports = PhysicalStorageV2;
