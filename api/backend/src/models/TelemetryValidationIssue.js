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
// - issueCode: `clock_drift` (device time beyond the clock tolerance) and
//   `invalid_value` (a value that is not a physically possible reading);
// - severity: `error`, the dictionary's own value for a clock drift;
// - disposition: `quarantined` (the reading is kept, flagged by this issue)
//   and `rejected` (the reading is refused), RF009 AC7's two outcomes.
const ISSUE_CODE_VALUES = ['clock_drift', 'invalid_value'];
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
