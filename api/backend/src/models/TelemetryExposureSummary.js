const crypto = require('crypto');

// Canonical Data Model v2.0.0 TelemetryExposureSummary (V2E-0572..0588,
// V2E-0638..0641), RF009 AC5/AC6, RULE-027, VAL-019: a specimen's
// temperature exposure over one piece of its assignment path, the
// intersection of one SpecimenContainerAssignment, ContainerPositionAssignment
// and RackLocationAssignment, kept with the hashes that make it reproducible.
//
// storageAssignmentId (V2E-0574) is written null: the three chain ids carry
// the path, and StorageAssignment is read-only legacy
// (docs/decisions/2026-10-21-telemetry-exposure-summary.md, decision 1).
const CALCULATION_VERSION = '1.0.0';
const HASH = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REQUIRED = [
  'telemetryExposureSummaryId', 'specimenId', 'windowStart', 'windowEnd', 'observationCount',
  'timeOutsideThresholdSeconds', 'excursionCount', 'coverageRatio', 'sourceQueryHash', 'sourceReadingSetHash',
  'calculationVersion', 'calculatedAt', 'specimenContainerAssignmentId', 'containerPositionAssignmentId',
  'rackLocationAssignmentId', 'exposurePathHash',
];
const STATISTICS = ['minimumValue', 'maximumValue', 'meanValue'];

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value) {
  return value === undefined || value === null || value === '' ? null : Number(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

class TelemetryExposureSummaryModel {
  static fieldsOf(data = {}) {
    return {
      telemetryExposureSummaryId: data.telemetryExposureSummaryId || crypto.randomUUID(),
      specimenId: optionalString(data.specimenId),
      storageAssignmentId: null,
      datastreamIds: Array.isArray(data.datastreamIds) ? data.datastreamIds.map(String) : [],
      windowStart: toDate(data.windowStart),
      windowEnd: toDate(data.windowEnd),
      observationCount: toNumber(data.observationCount),
      minimumValue: toNumber(data.minimumValue),
      maximumValue: toNumber(data.maximumValue),
      meanValue: toNumber(data.meanValue),
      timeOutsideThresholdSeconds: toNumber(data.timeOutsideThresholdSeconds),
      excursionCount: toNumber(data.excursionCount),
      coverageRatio: toNumber(data.coverageRatio),
      sourceQueryHash: optionalString(data.sourceQueryHash),
      sourceReadingSetHash: optionalString(data.sourceReadingSetHash),
      calculationVersion: optionalString(data.calculationVersion),
      calculatedAt: toDate(data.calculatedAt),
      specimenContainerAssignmentId: optionalString(data.specimenContainerAssignmentId),
      containerPositionAssignmentId: optionalString(data.containerPositionAssignmentId),
      rackLocationAssignmentId: optionalString(data.rackLocationAssignmentId),
      exposurePathHash: optionalString(data.exposurePathHash),
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of REQUIRED) {
      if (fields[field] === null) {
        throw new Error(`${field} é obrigatório para TelemetryExposureSummary (1..1)`);
      }
    }
    if (fields.datastreamIds.length === 0) {
      throw new Error('datastreamIds deve citar ao menos um TelemetryDatastream (1..*)');
    }
    if (fields.windowEnd <= fields.windowStart) {
      throw new Error('windowEnd deve ser posterior a windowStart ([windowStart, windowEnd))');
    }
    for (const field of ['observationCount', 'excursionCount', 'timeOutsideThresholdSeconds']) {
      if (!isNonNegativeInteger(fields[field])) {
        throw new Error(`${field} deve ser um inteiro não negativo: ${fields[field]}`);
      }
    }
    if (!(fields.coverageRatio >= 0 && fields.coverageRatio <= 1)) {
      throw new Error(`coverageRatio deve estar em [0, 1]: ${fields.coverageRatio}`);
    }
    for (const field of ['sourceQueryHash', 'sourceReadingSetHash', 'exposurePathHash']) {
      if (!HASH.test(fields[field])) {
        throw new Error(`${field} deve ter a forma sha256:<hex de 64 dígitos>: ${fields[field]}`);
      }
    }
    if (!SEMVER.test(fields.calculationVersion)) {
      throw new Error(`calculationVersion deve ser SemVer: ${fields.calculationVersion}`);
    }
    // V2E-0579..0581 are required for a numeric aggregation, and absent
    // when no reading was aggregated.
    for (const field of STATISTICS) {
      if (fields.observationCount > 0 && !Number.isFinite(fields[field])) {
        throw new Error(`${field} é obrigatório quando observationCount > 0`);
      }
      if (fields.observationCount === 0 && fields[field] !== null) {
        throw new Error(`${field} deve ser nulo quando observationCount é 0`);
      }
    }
    return fields;
  }
}

module.exports = TelemetryExposureSummaryModel;
module.exports.CALCULATION_VERSION = CALCULATION_VERSION;
