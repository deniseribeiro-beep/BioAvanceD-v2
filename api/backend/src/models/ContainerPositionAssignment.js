const crypto = require('crypto');
const { findConflict, assertEndAfterStart } = require('./temporalAssignment');

// Canonical Data Model v2.0.0 ContainerPositionAssignment (V2E-0670..0676),
// RF016 AC3, RF017 AC2: which storage position holds a container, over
// [placedAt, removedAt). RULE-030: no two overlapping assignments for the
// same container or the same position. Append-only, closed by remove().
//
// assignmentStatus adds `ended` to the catalog's `active`, the local
// extension SpecimenContainerAssignment.js documents.
const ASSIGNMENT_STATUS_VALUES = ['active', 'ended'];
const INTERVAL = { from: 'placedAt', to: 'removedAt' };

class ContainerPositionAssignmentModel {
  static fieldsOf(data = {}) {
    return {
      containerPositionAssignmentId: data.containerPositionAssignmentId || crypto.randomUUID(),
      containerId: data.containerId ? String(data.containerId) : null,
      storagePositionId: data.storagePositionId ? String(data.storagePositionId) : null,
      placedAt: data.placedAt ? new Date(data.placedAt) : null,
      removedAt: data.removedAt ? new Date(data.removedAt) : null,
      assignmentStatus: data.assignmentStatus ? String(data.assignmentStatus).toLowerCase() : 'active',
      sourceScanEventId: data.sourceScanEventId ? String(data.sourceScanEventId) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['containerId', 'storagePositionId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para ContainerPositionAssignment (1..1)`);
      }
    }
    if (!ASSIGNMENT_STATUS_VALUES.includes(fields.assignmentStatus)) {
      throw new Error(`assignmentStatus inválido: ${fields.assignmentStatus}`);
    }
    const assignment = { ...fields, placedAt: fields.placedAt || new Date() };
    assertEndAfterStart(assignment.placedAt, assignment.removedAt);
    return assignment;
  }

  static remove(assignment, removedAt = new Date()) {
    assertEndAfterStart(assignment.placedAt, removedAt);
    return { ...assignment, removedAt: new Date(removedAt), assignmentStatus: 'ended' };
  }

  // RULE-030: one container per position, one position per container.
  static assertNoOverlap(candidate, existing = []) {
    const conflict = findConflict(candidate, existing, {
      ...INTERVAL, idField: 'containerPositionAssignmentId', keys: ['containerId', 'storagePositionId'],
    });
    if (conflict) {
      throw new Error(
        `Ocupação incompatível: ${conflict.key} ${candidate[conflict.key]} já está atribuído nesse intervalo `
        + `(atribuição ${conflict.other.containerPositionAssignmentId})`
      );
    }
  }
}

module.exports = ContainerPositionAssignmentModel;
module.exports.ASSIGNMENT_STATUS_VALUES = ASSIGNMENT_STATUS_VALUES;
