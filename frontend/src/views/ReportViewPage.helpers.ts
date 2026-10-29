// #949: the detail tables on ReportViewPage read keys off the parsed
// `reportData` blob. Extracted here as pure functions so the key contract
// between the report handlers and this page is testable without rendering a
// component -- the convention every other test in this directory follows.
//
// The blob is whatever `reports.routes.js#buildPreviewData` returned, stored
// verbatim: `reportData: JSON.stringify(previewData)` with no key transform.
// So these key names ARE the handler's return keys, and nothing else.

export interface TemperatureRow {
  timestamp?: string;
  temperatureValue?: number;
  temperatureUnit?: string;
  readingStatus?: string;
  sensorId?: string;
  sensorID?: string;
  logId?: string | number | null;
  _id?: string;
}

export interface AccessLogRow {
  timestamp?: string;
  userName?: string;
  action?: string;
  entity?: string;
  result?: string;
  severity?: string;
  logId?: string | number | null;
  _id?: string;
}

// `handleTemperature` (reports.routes.js) returns
// `{ total, temperatures, statistics, mode, previewLimited }`.
export function selectTemperatureRows(reportData: Record<string, unknown> | null | undefined): TemperatureRow[] {
  const rows = (reportData as { temperatures?: unknown })?.temperatures;
  return Array.isArray(rows) ? (rows as TemperatureRow[]) : [];
}

// `handleAccessLogs` (reports.routes.js) returns `{ total, logs, previewLimited }`.
export function selectAccessLogRows(reportData: Record<string, unknown> | null | undefined): AccessLogRow[] {
  const rows = (reportData as { logs?: unknown })?.logs;
  return Array.isArray(rows) ? (rows as AccessLogRow[]) : [];
}

export interface AuditEventRow {
  eventId?: string;
  sequenceNumber?: number;
  occurredAt?: string;
  actorPseudonym?: string;
  action?: string;
  entityType?: string;
  result?: string;
  source?: string;
}

// #733: `handleAuditEvents` (reports.routes.js) returns
// `{ total, auditEvents, previewLimited }` for the `audit` report.
export function selectAuditEventRows(reportData: Record<string, unknown> | null | undefined): AuditEventRow[] {
  const rows = (reportData as { auditEvents?: unknown })?.auditEvents;
  return Array.isArray(rows) ? (rows as AuditEventRow[]) : [];
}

// Both Temperature and Log write `logId` (lowercase d) -- `logID` is an
// accepted INPUT alias on the way in, never an output field. Falls back to
// `_id`, which every row read straight off a Mongo cursor carries.
export function rowKey(row: { logId?: string | number | null; _id?: string }, index: number): string {
  if (row.logId !== undefined && row.logId !== null) return String(row.logId);
  if (row._id) return String(row._id);
  return String(index);
}
