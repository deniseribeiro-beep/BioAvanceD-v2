const crypto = require('crypto');

// Canonical Data Model v2.0.0 TelemetryValidationIssue (V2E-0597..0603),
// RF009 AC7 (#1317): one problem the ingestion contract found in a received
// reading, recorded in MongoDB against the TelemetryIngestionEvent that
// received it. The reading itself stays in InfluxDB; the issue carries no
// raw telemetry.
//
// The dictionary lists no closed vocabulary for issueCode, severity or
// disposition, only the example `clock_drift` / `error` / `quarantined`.
// The values accepted are the ones the contract emits:
// - issueCode: `clock_drift` (device time beyond the clock tolerance),
//   `invalid_value` (a value that is not a physically possible reading),
//   `unbound_datastream` (no TelemetryDatastream of the sensor valid at
//   observedAt) and `device_not_registered` (no active DeviceRegistration
//   for the sensor), RF009 AC4; `device_unusable` (the sensor's Device is
//   not registered, not homologated or retired), RF017 AC8;
//   `personal_data_stripped` (fields outside the reading contract were
//   dropped before anything was stored, since they may carry personal
//   data), RF009 AC8, #1540; `payload_hash_mismatch` (the payloadHash the
//   client sent does not match the canonical payload received, so the
//   message is corrupted), RNF004 C4, #1521;
// - severity: `error`, the dictionary's own value for a clock drift;
// - disposition: `quarantined` (the reading is kept, flagged by this issue)
//   and `rejected` (the reading is refused), RF009 AC7's two outcomes.
const ISSUE_CODE_VALUES = ['clock_drift', 'invalid_value', 'unbound_datastream', 'device_not_registered', 'device_unusable', 'personal_data_stripped', 'payload_hash_mismatch'];
const SEVERITY_VALUES = ['error'];
const DISPOSITION_VALUES = ['quarantined', 'rejected'];
const REQUIRED = ['ingestionEventId', 'issueCode', 'severity', 'details', 'disposition'];

function optionalString(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

class TelemetryValidationIssueModel {
  static fieldsOf(data = {}) {
    return {
      telemetryValidationIssueId: data.telemetryValidationIssueId || crypto.randomUUID(),
      ingestionEventId: optionalString(data.ingestionEventId),
      issueCode: optionalString(data.issueCode),
      severity: optionalString(data.severity),
      fieldPath: optionalString(data.fieldPath),
      details: optionalString(data.details),
      disposition: optionalString(data.disposition),
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of REQUIRED) {
      if (!fields[field]) throw new Error(`${field} é obrigatório para TelemetryValidationIssue (1..1)`);
    }
    for (const [field, values] of [
      ['issueCode', ISSUE_CODE_VALUES],
      ['severity', SEVERITY_VALUES],
      ['disposition', DISPOSITION_VALUES],
    ]) {
      if (!values.includes(fields[field])) throw new Error(`${field} inválido: ${fields[field]}`);
    }
    return fields;
  }
}

module.exports = TelemetryValidationIssueModel;
module.exports.ISSUE_CODE_VALUES = ISSUE_CODE_VALUES;
module.exports.SEVERITY_VALUES = SEVERITY_VALUES;
module.exports.DISPOSITION_VALUES = DISPOSITION_VALUES;
