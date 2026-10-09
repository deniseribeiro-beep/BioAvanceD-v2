const crypto = require('crypto');
const { findConflict, assertEndAfterStart } = require('./temporalAssignment');

// Canonical Data Model v2.0.0 RackLocationAssignment (V2E-0684..0690),
// RF016 AC3, RF017 AC3: where a storage rack sits, over [placedAt,
// removedAt). RULE-035: no two overlapping locations for the same rack.
// Append-only, closed by remove().
//
// assignmentStatus adds `ended` to the catalog's `active`, the local
// extension SpecimenContainerAssignment.js documents.
const ASSIGNMENT_STATUS_VALUES = ['active', 'ended'];
const INTERVAL = { from: 'placedAt', to: 'removedAt' };

class RackLocationAssignmentModel {
  static fieldsOf(data = {}) {
    return {
      rackLocationAssignmentId: data.rackLocationAssignmentId || crypto.randomUUID(),
      storageRackId: data.storageRackId ? String(data.storageRackId) : null,
      storageLocationId: data.storageLocationId ? String(data.storageLocationId) : null,
      placedAt: data.placedAt ? new Date(data.placedAt) : null,
      removedAt: data.removedAt ? new Date(data.removedAt) : null,
      assignmentStatus: data.assignmentStatus ? String(data.assignmentStatus).toLowerCase() : 'active',
      sourceEventId: data.sourceEventId ? String(data.sourceEventId) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['storageRackId', 'storageLocationId', 'sourceEventId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para RackLocationAssignment (1..1)`);
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

  // RULE-035: a rack is in one location at a time.
  static assertNoOverlap(candidate, existing = []) {
    const conflict = findConflict(candidate, existing, {
      ...INTERVAL, idField: 'rackLocationAssignmentId', keys: ['storageRackId'],
    });
    if (conflict) {
      throw new Error(
        `Rack ${candidate.storageRackId} já está no local ${conflict.other.storageLocationId} nesse intervalo `
        + `(atribuição ${conflict.other.rackLocationAssignmentId})`
      );
    }
  }
}

module.exports = RackLocationAssignmentModel;
module.exports.ASSIGNMENT_STATUS_VALUES = ASSIGNMENT_STATUS_VALUES;
