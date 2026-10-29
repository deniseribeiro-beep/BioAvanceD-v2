const crypto = require('crypto');

// Canonical Data Model v2.0.0 TelemetryIngestionEvent (V2E-0589..0596),
// RF009 AC7 (#1317): the receipt of one reading at the ingestion contract,
// and the TelemetryValidationIssues found in it (issueIds). It is what a
// TelemetryValidationIssue's ingestionEventId references, and it links the
// issue to the reading (telemetryReadingId).
//
// - protocol: RF009 AC9 names MQTT, HTTPS and an approved adapter; the
//   dictionary's example is `mqtt`.
// - validationStatus: `accepted` is the dictionary's example; `quarantined`
//   and `rejected` are RF009 AC7's two outcomes for a reading with an issue.
// - telemetryReadingId is required when accepted (V2E-0594). A rejected
//   reading is never stored, so it has none.
const PROTOCOL_VALUES = ['mqtt', 'https', 'adapter'];
const VALIDATION_STATUS_VALUES = ['accepted', 'quarantined', 'rejected'];
const REQUIRED = ['sourceEventId', 'protocol', 'receivedAt', 'validationStatus', 'payloadHash'];

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

class TelemetryIngestionEventModel {
  static fieldsOf(data = {}) {
    return {
      telemetryIngestionEventId: data.telemetryIngestionEventId || crypto.randomUUID(),
      sourceEventId: optionalString(data.sourceEventId),
      protocol: optionalString(data.protocol),
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
      validationStatus: optionalString(data.validationStatus),
      telemetryReadingId: optionalString(data.telemetryReadingId),
      issueIds: Array.isArray(data.issueIds) ? data.issueIds.map(String) : [],
      payloadHash: optionalString(data.payloadHash),
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of REQUIRED) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para TelemetryIngestionEvent (1..1)`);
    }
    if (Number.isNaN(fields.receivedAt.getTime())) throw new Error('receivedAt deve ser uma data ISO 8601');
    if (!PROTOCOL_VALUES.includes(fields.protocol)) throw new Error(`protocol inválido: ${fields.protocol}`);
    if (!VALIDATION_STATUS_VALUES.includes(fields.validationStatus)) throw new Error(`validationStatus inválido: ${fields.validationStatus}`);
    if (fields.validationStatus === 'accepted' && !fields.telemetryReadingId) {
      throw new Error('telemetryReadingId é obrigatório quando a leitura é aceita (V2E-0594)');
    }
    return fields;
  }
}

module.exports = TelemetryIngestionEventModel;
module.exports.PROTOCOL_VALUES = PROTOCOL_VALUES;
module.exports.VALIDATION_STATUS_VALUES = VALIDATION_STATUS_VALUES;
