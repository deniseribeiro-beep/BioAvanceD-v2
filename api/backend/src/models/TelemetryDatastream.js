const crypto = require('crypto');
const { findConflict } = require('./temporalAssignment');

// Canonical Data Model v2.0.0 TelemetryDatastream (V2E-0562..0571), RF017
// AC5 (#1316): binds a sensor to the equipment it watches, the storage
// location, the observed property, its UCUM unit, its sampling and threshold
// profiles, and a validity period [start, end). A reading is interpreted
// through the datastream valid when it was observed, so one sensor carries
// one datastream per property at a time.
//
// status (V2E-0571) names `active`; `retired`, for a datastream whose
// validity has ended, is a documented local extension like the physical
// chain's `ended`.
const STATUS_VALUES = ['active', 'retired'];
const REQUIRED = [
  'sensorId', 'equipmentId', 'storageLocationId', 'observedProperty', 'unit', 'samplingPolicyId', 'thresholdProfileId',
];
// V2E-0567's vocabulary is UCUM: a case-sensitive code with no spaces, such
// as `Cel`, `%` or `[degF]`.
const UCUM_CODE = /^[!-~]+$/;

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function flat(stream) {
  return { ...stream, periodStart: stream.validityPeriod?.start, periodEnd: stream.validityPeriod?.end, streamKey: `${stream.sensorId}|${stream.observedProperty}` };
}

class TelemetryDatastreamModel {
  static fieldsOf(data = {}) {
    const period = data.validityPeriod || {};
    return {
      telemetryDatastreamId: data.telemetryDatastreamId || crypto.randomUUID(),
      sensorId: optionalString(data.sensorId),
      equipmentId: optionalString(data.equipmentId),
      storageLocationId: optionalString(data.storageLocationId),
      observedProperty: optionalString(data.observedProperty),
      unit: optionalString(data.unit),
      samplingPolicyId: optionalString(data.samplingPolicyId),
      thresholdProfileId: optionalString(data.thresholdProfileId),
      validityPeriod: { start: toDate(period.start), end: toDate(period.end) },
      status: data.status ? String(data.status).toLowerCase() : 'active',
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of REQUIRED) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para TelemetryDatastream (1..1)`);
    }
    if (!UCUM_CODE.test(fields.unit)) throw new Error(`unit deve ser um código UCUM: ${fields.unit}`);
    if (!STATUS_VALUES.includes(fields.status)) throw new Error(`status inválido: ${fields.status}`);
    const { start, end } = fields.validityPeriod;
    if (!start || end === undefined) throw new Error('validityPeriod.start é obrigatório, e start e end devem ser datas ISO 8601');
    if (end && end <= start) throw new Error('validityPeriod.end deve ser posterior a validityPeriod.start ([start, end))');
    return end ? { ...fields, status: 'retired' } : fields;
  }

  // Whether the datastream interprets a reading observed at `at`.
  static validAt(stream, at) {
    const t = new Date(at).getTime();
    const { start, end } = stream.validityPeriod || {};
    return new Date(start).getTime() <= t && (!end || t < new Date(end).getTime());
  }

  // One datastream per sensor and property at a time.
  static assertNoOverlap(candidate, existing = []) {
    const conflict = findConflict(flat(candidate), existing.map(flat), {
      idField: 'telemetryDatastreamId', from: 'periodStart', to: 'periodEnd', keys: ['streamKey'],
    });
    if (conflict) {
      throw new Error(`Sensor ${candidate.sensorId} já tem datastream de ${candidate.observedProperty} nesse intervalo (${conflict.other.telemetryDatastreamId})`);
    }
  }
}

module.exports = TelemetryDatastreamModel;
module.exports.STATUS_VALUES = STATUS_VALUES;
