const crypto = require('crypto');
const { SYMBOLOGY_VALUES } = require('./LabelIdentifier');

// Canonical Data Model v2.0.0 ScanEvent (V2E-0217..0229), RF016 AC6: one
// capture-decode-normalize-resolve of a physical code. The resolver only
// records what it read and what it resolved to; authorizing the operation
// stays in the backend.
//
// targetType, operationContext and result each list one value in the
// catalog (specimen, lookup, resolved), and that is the one value accepted
// until the resolver's design names more. symbology draws on RF016 AC5's
// three. rawValueProtected is kept only when the policy authorizes
// temporary retention (V2E-0221), so a caller states that it does.
const TARGET_TYPE_VALUES = ['specimen'];
const OPERATION_CONTEXT_VALUES = ['lookup'];
const RESULT_VALUES = ['resolved'];

function lower(value) {
  return value ? String(value).toLowerCase() : null;
}

class ScanEventModel {
  static fieldsOf(data = {}) {
    return {
      scanEventId: data.scanEventId || crypto.randomUUID(),
      deviceId: data.deviceId ? String(data.deviceId) : null,
      actorId: data.actorId ? String(data.actorId) : null,
      locationId: data.locationId ? String(data.locationId) : null,
      rawValueProtected: data.rawValueProtected ?? null,
      normalizedValue: data.normalizedValue ?? null,
      symbology: lower(data.symbology),
      targetType: lower(data.targetType),
      targetId: data.targetId ? String(data.targetId) : null,
      operationContext: lower(data.operationContext),
      result: lower(data.result),
      correlationId: data.correlationId ? String(data.correlationId) : null,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : null,
    };
  }

  static create(data = {}, { retainRawValue = false } = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['deviceId', 'actorId', 'normalizedValue', 'symbology', 'targetType', 'targetId', 'operationContext', 'result', 'correlationId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para ScanEvent (1..1)`);
      }
    }
    for (const [field, values] of [
      ['symbology', SYMBOLOGY_VALUES],
      ['targetType', TARGET_TYPE_VALUES],
      ['operationContext', OPERATION_CONTEXT_VALUES],
      ['result', RESULT_VALUES],
    ]) {
      if (!values.includes(fields[field])) {
        throw new Error(`${field} inválido: ${fields[field]}`);
      }
    }
    if (fields.rawValueProtected !== null && !retainRawValue) {
      throw new Error('rawValueProtected só é retido quando a política autoriza (V2E-0221)');
    }
    return { ...fields, occurredAt: fields.occurredAt || new Date() };
  }
}

module.exports = ScanEventModel;
module.exports.TARGET_TYPE_VALUES = TARGET_TYPE_VALUES;
module.exports.OPERATION_CONTEXT_VALUES = OPERATION_CONTEXT_VALUES;
module.exports.RESULT_VALUES = RESULT_VALUES;
