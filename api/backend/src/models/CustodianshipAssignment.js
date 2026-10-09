const crypto = require('crypto');
const { findConflict } = require('./temporalAssignment');

// Canonical Data Model v2.0.0 CustodianshipAssignment (V2E-0105..0112),
// RF021 AC4/AC5/AC6, checklist BIO-006: which organization holds a specimen
// in custody, under which approval, over effectivePeriod. Custody is kept
// apart from the collection site (ELM-0128) and from the physical location,
// which is optional here (V2E-0109).
//
// effectivePeriod runs half-open, [start, end), like the physical chain's
// assignments (temporalAssignment.js): a handover at t ends one custody at t
// and starts the next at t. Append-only: an assignment is closed by setting
// effectivePeriod.end, never rewritten or deleted.
//
// assignmentStatus (V2E-0111) names `planned` and its example `active`;
// `ended`, for a closed interval, is a documented local extension like
// SpecimenContainerAssignment's.
const ASSIGNMENT_STATUS_VALUES = ['planned', 'active', 'ended'];

function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

// findConflict reads top-level interval fields.
function flat(assignment) {
  return {
    ...assignment,
    periodStart: assignment.effectivePeriod?.start,
    periodEnd: assignment.effectivePeriod?.end,
  };
}

class CustodianshipAssignmentModel {
  static fieldsOf(data = {}) {
    const period = data.effectivePeriod || {};
    return {
      custodianshipAssignmentId: data.custodianshipAssignmentId || crypto.randomUUID(),
      specimenId: optionalString(data.specimenId),
      custodianOrganizationId: optionalString(data.custodianOrganizationId),
      responsibleInvestigatorId: optionalString(data.responsibleInvestigatorId),
      locationId: optionalString(data.locationId),
      effectivePeriod: { start: toDate(period.start), end: toDate(period.end) },
      assignmentStatus: data.assignmentStatus ? String(data.assignmentStatus).toLowerCase() : 'active',
      authorizationId: optionalString(data.authorizationId),
    };
  }

  // `governanceRegime` is the specimen's collection regime: V2E-0108 makes
  // the responsible investigator mandatory for a biorepository (RF021 AC3).
  static create(data = {}, { governanceRegime } = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['specimenId', 'custodianOrganizationId', 'authorizationId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para CustodianshipAssignment (1..1)`);
      }
    }
    if (governanceRegime === 'biorepository' && !fields.responsibleInvestigatorId) {
      throw new Error('responsibleInvestigatorId é obrigatório para biorrepositório (V2E-0108)');
    }
    if (!ASSIGNMENT_STATUS_VALUES.includes(fields.assignmentStatus)) {
      throw new Error(`assignmentStatus inválido: ${fields.assignmentStatus}`);
    }
    const { start, end } = fields.effectivePeriod;
    if (start === undefined || end === undefined) {
      throw new Error('effectivePeriod.start e effectivePeriod.end devem ser datas ISO 8601');
    }
    const assignment = { ...fields, effectivePeriod: { start: start || new Date(), end } };
    if (end && end <= assignment.effectivePeriod.start) {
      throw new Error('effectivePeriod.end deve ser posterior a effectivePeriod.start ([start, end))');
    }
    // An interval recorded with its end is closed from the start.
    if (end) assignment.assignmentStatus = 'ended';
    return assignment;
  }

  // Closes the interval at its exclusive end.
  static end(assignment, endAt = new Date()) {
    const end = new Date(endAt);
    if (end <= new Date(assignment.effectivePeriod.start)) {
      throw new Error('effectivePeriod.end deve ser posterior a effectivePeriod.start ([start, end))');
    }
    return { ...assignment, effectivePeriod: { ...assignment.effectivePeriod, end }, assignmentStatus: 'ended' };
  }

  // Whether the assignment holds custody at an instant. A planned one holds
  // nothing yet.
  static holdsAt(assignment, at = new Date()) {
    if (!assignment || assignment.assignmentStatus === 'planned') return false;
    const t = new Date(at).getTime();
    const { start, end } = assignment.effectivePeriod || {};
    return new Date(start).getTime() <= t && (!end || t < new Date(end).getTime());
  }

  // RF021 AC5: one custody per specimen at a time. A planned assignment
  // reserves its interval too, so two plans cannot both come into force.
  static assertNoOverlap(candidate, existing = []) {
    const conflict = findConflict(flat(candidate), existing.map(flat), {
      idField: 'custodianshipAssignmentId', from: 'periodStart', to: 'periodEnd', keys: ['specimenId'],
    });
    if (conflict) {
      throw new Error(
        `Espécime ${candidate.specimenId} já está sob custódia de ${conflict.other.custodianOrganizationId} nesse intervalo `
        + `(atribuição ${conflict.other.custodianshipAssignmentId})`
      );
    }
  }
}

module.exports = CustodianshipAssignmentModel;
module.exports.ASSIGNMENT_STATUS_VALUES = ASSIGNMENT_STATUS_VALUES;
