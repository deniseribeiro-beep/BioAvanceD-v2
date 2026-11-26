// RNF003 C1, C2, C4 (#1468): outages and maintenance windows are recorded
// with start, end, cause and impact (C2), and the monthly availability is
// computed against the 99.5% target, leaving out maintenance announced
// beforehand, with the 4-hour monthly maintenance limit checked (C1), and
// published through GET /api/availability/report (C4).
const crypto = require('crypto');

const COLLECTION = 'availabilityRecords';
const KINDS = ['outage', 'maintenance'];
const MAX_TEXT = 500;
const MAINTENANCE_LIMIT_MINUTES = 240;
const TARGET_PERCENT = 99.5;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MINUTE_MS = 60 * 1000;

// A record's dates can be at most this far ahead of the server clock.
const CLOCK_SKEW_MS = 5 * MINUTE_MS;
// ISO-8601 date-time with Z or an explicit offset: a string with no offset
// would be read in the server's local time.
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/;

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_PATTERN.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((part) => Number(part || 0));
  // No rollover: 2000-02-30 would otherwise become 1 March.
  const calendar = new Date(Date.UTC(2000, month - 1, day));
  calendar.setUTCFullYear(year);
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function checkText(name, value, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${name} é obrigatório`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT) {
    errors.push(`${name} deve ter no máximo ${MAX_TEXT} caracteres`);
    return null;
  }
  return trimmed;
}

// Returns { record } with only the known fields, or { errors: [string] }.
// now: the server clock, injectable for tests.
function validateRecord(body, now = new Date()) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];

  const kind = input.kind;
  if (!KINDS.includes(kind)) errors.push("kind deve ser 'outage' ou 'maintenance'");

  const startedAt = parseDate(input.startedAt);
  const endedAt = parseDate(input.endedAt);
  if (!startedAt) errors.push('startedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)');
  if (!endedAt) errors.push('endedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)');
  // A record states what has happened; a future time would count in a
  // report before it occurs.
  const latest = new Date(now).getTime() + CLOCK_SKEW_MS;
  if (startedAt && startedAt.getTime() > latest) errors.push('startedAt não pode ser posterior ao momento atual');
  if (endedAt && endedAt.getTime() > latest) errors.push('endedAt não pode ser posterior ao momento atual');
  if (startedAt && endedAt && endedAt.getTime() <= startedAt.getTime()) {
    errors.push('endedAt deve ser posterior a startedAt');
  }

  const cause = checkText('cause', input.cause, errors);
  const impact = checkText('impact', input.impact, errors);

  let announcedAt = null;
  const hasAnnounced = input.announcedAt !== undefined && input.announcedAt !== null;
  if (kind === 'maintenance') {
    // A window not announced before it starts is not maintenance under RNF003.
    announcedAt = parseDate(input.announcedAt);
    if (!announcedAt) {
      errors.push('announcedAt é obrigatório para manutenção');
    } else if (startedAt && announcedAt.getTime() >= startedAt.getTime()) {
      errors.push('announcedAt deve ser anterior a startedAt');
    }
  } else if (kind === 'outage' && hasAnnounced) {
    errors.push('announcedAt não se aplica a indisponibilidade');
  }

  if (errors.length > 0) return { errors };

  const record = { kind, startedAt, endedAt, cause, impact };
  if (kind === 'maintenance') record.announcedAt = announcedAt;
  return { record };
}

async function createRecord(db, body, actorId) {
  const { record, errors } = validateRecord(body);
  if (errors) {
    const error = new Error(errors.join('; '));
    error.validationErrors = errors;
    throw error;
  }
  const doc = {
    recordId: crypto.randomUUID(),
    ...record,
    createdBy: actorId || null,
    createdAt: new Date(),
  };
  await db.collection(COLLECTION).insertOne({ ...doc });
  return doc;
}

// 'YYYY-MM' -> { start, end } in UTC, end being the first instant of the
// next month; anything else -> null.
function parseMonth(value) {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return { start: monthStart(year, month - 1), end: monthStart(year, month) };
}

// setUTCFullYear, not Date.UTC: Date.UTC reads a year 0-99 as 1900-1999, so
// 0050-03 would cover 1950-03. A month index of 12 rolls to the next year.
function monthStart(year, monthIndex) {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, 1);
  return date;
}

async function listRecords(db, month) {
  const { start, end } = month;
  return db.collection(COLLECTION)
    .find(
      { startedAt: { $lt: end }, endedAt: { $gt: start } },
      { projection: { _id: 0 }, maxTimeMS: 2000 }
    )
    .sort({ startedAt: 1 })
    .limit(500)
    .toArray();
}

// Each interval clipped to [start, end), then merged into a sorted union.
function unionOf(records, kind, startMs, endMs) {
  const intervals = records
    .filter((r) => r && r.kind === kind)
    .map((r) => [
      Math.max(new Date(r.startedAt).getTime(), startMs),
      Math.min(new Date(r.endedAt).getTime(), endMs),
    ])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const lengthOf = (intervals) => intervals.reduce((sum, [s, e]) => sum + (e - s), 0);

function overlapOf(a, b) {
  let total = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) total += e - s;
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return total;
}

// Pure: the availability of [start, end) given its outage and maintenance
// records. Outage time inside an announced maintenance window is not counted
// twice; maintenance time is left out of the period, as RNF003 asks. A period
// with no minutes left once maintenance is taken out has no availability to
// measure: evaluable is false, availabilityPercent null and met false.
function computeAvailability(records, { start, end }) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const maintenance = unionOf(records || [], 'maintenance', startMs, endMs);
  const outage = unionOf(records || [], 'outage', startMs, endMs);

  const periodMs = endMs - startMs;
  const maintenanceMs = lengthOf(maintenance);
  const outageMs = lengthOf(outage) - overlapOf(outage, maintenance);
  const periodMinutes = periodMs / MINUTE_MS;
  const maintenanceMinutes = maintenanceMs / MINUTE_MS;
  const outageMinutes = outageMs / MINUTE_MS;
  const denominatorMs = periodMs - maintenanceMs;
  const evaluable = denominatorMs > 0;
  const availabilityPercent = evaluable
    ? Math.round((100 * (denominatorMs - outageMs) / denominatorMs) * 10000) / 10000
    : null;
  // met is decided in whole milliseconds, with no division: outage at most
  // (100 - target)% of the period. A float ratio reads exactly 99.5 as
  // 99.49999999999999, and the rounded percent reads 99.49996 as 99.5.
  const allowedPerTenThousand = 10000 - Math.round(TARGET_PERCENT * 100);
  const met = evaluable && outageMs * 10000 <= denominatorMs * allowedPerTenThousand;

  return {
    periodMinutes,
    maintenanceMinutes,
    maintenanceLimitMinutes: MAINTENANCE_LIMIT_MINUTES,
    maintenanceWithinLimit: maintenanceMinutes <= MAINTENANCE_LIMIT_MINUTES,
    outageMinutes,
    availabilityPercent,
    targetPercent: TARGET_PERCENT,
    met,
    evaluable,
  };
}

// month: the 'YYYY-MM' string; now: the server clock, injectable for tests.
// A month still running is measured up to now, never to its end: minutes
// that have not happened yet are not available minutes. Such a report
// carries partial: true, and asOf is the instant it is measured to. A month
// that has not started has no minutes to measure and is refused with
// statusCode 422.
async function monthlyReport(db, month, now = new Date()) {
  const range = parseMonth(month);
  if (!range) throw new Error(`Mês inválido: ${month}`);
  const nowMs = new Date(now).getTime();
  if (nowMs <= range.start.getTime()) {
    const error = new Error(`Mês ainda não iniciado: ${month}`);
    error.statusCode = 422;
    throw error;
  }
  const partial = nowMs < range.end.getTime();
  const asOf = partial ? new Date(nowMs) : range.end;
  const records = await listRecords(db, range);
  return {
    month,
    partial,
    asOf,
    ...computeAvailability(records, { start: range.start, end: asOf }),
    records,
  };
}

module.exports = {
  COLLECTION,
  MAINTENANCE_LIMIT_MINUTES,
  TARGET_PERCENT,
  validateRecord,
  createRecord,
  parseMonth,
  listRecords,
  computeAvailability,
  monthlyReport,
};
