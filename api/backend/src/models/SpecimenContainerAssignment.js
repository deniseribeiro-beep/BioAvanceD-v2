const crypto = require('crypto');
const { overlaps, findConflict } = require('./temporalAssignment');

// Canonical Data Model v2.0.0 SpecimenContainerAssignment (V2E-0677..0683),
// RF016 AC3, RF017 AC3/AC4: which container holds a specimen, over
// [loadedAt, unloadedAt). Append-only: an assignment is closed by setting
// unloadedAt (the exclusive end, V2E-0681), never rewritten or deleted.
//
// assignmentStatus (V2E-0682) lists only `active` in the catalog; `ended`
// is a documented local extension for a closed interval, the same
// mechanism QuarantineAction.js uses for its `released`.
const ASSIGNMENT_STATUS_VALUES = ['active', 'ended'];
const INTERVAL = { from: 'loadedAt', to: 'unloadedAt' };

function toDate(value) {
  return value ? new Date(value) : null;
}

class SpecimenContainerAssignmentModel {
  static fieldsOf(data = {}) {
    return {
      specimenContainerAssignmentId: data.specimenContainerAssignmentId || crypto.randomUUID(),
      specimenId: data.specimenId ? String(data.specimenId) : null,
      containerId: data.containerId ? String(data.containerId) : null,
      loadedAt: toDate(data.loadedAt),
      unloadedAt: toDate(data.unloadedAt),
      assignmentStatus: data.assignmentStatus ? String(data.assignmentStatus).toLowerCase() : 'active',
      sourceEventId: data.sourceEventId ? String(data.sourceEventId) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['specimenId', 'containerId', 'sourceEventId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para SpecimenContainerAssignment (1..1)`);
      }
    }
    if (!ASSIGNMENT_STATUS_VALUES.includes(fields.assignmentStatus)) {
      throw new Error(`assignmentStatus inválido: ${fields.assignmentStatus}`);
    }
    const assignment = { ...fields, loadedAt: fields.loadedAt || new Date() };
    if (assignment.unloadedAt && assignment.unloadedAt <= assignment.loadedAt) {
      throw new Error('unloadedAt deve ser posterior a loadedAt ([loadedAt, unloadedAt))');
    }
    return assignment;
  }

  // Closes the interval at its exclusive end.
  static unload(assignment, unloadedAt = new Date()) {
    const end = new Date(unloadedAt);
    if (end <= new Date(assignment.loadedAt)) {
      throw new Error('unloadedAt deve ser posterior a loadedAt ([loadedAt, unloadedAt))');
    }
    return { ...assignment, unloadedAt: end, assignmentStatus: 'ended' };
  }

  static overlaps(a, b) {
    return overlaps(a, b, INTERVAL);
  }

  // RF017 AC4: no two assignments of one specimen may overlap in time; a
  // specimen is in one container at a time.
  static assertNoOverlap(candidate, existing = []) {
    const conflict = findConflict(candidate, existing, { ...INTERVAL, idField: 'specimenContainerAssignmentId', keys: ['specimenId'] });
    if (conflict) {
      throw new Error(
        `Espécime ${candidate.specimenId} já está no recipiente ${conflict.other.containerId} nesse intervalo `
        + `(atribuição ${conflict.other.specimenContainerAssignmentId})`
      );
    }
  }
}

module.exports = SpecimenContainerAssignmentModel;
module.exports.ASSIGNMENT_STATUS_VALUES = ASSIGNMENT_STATUS_VALUES;
