/**
 * #1411: a DD/MM/YYYY birth date is day first, and is read the same way when
 * the participant identity is stored, by the duplicate check and by the
 * birth-date search.
 *
 * #1412: a birth date is stored as the instant 12:00:00.000 UTC of its
 * calendar day, and its day is read with UTC getters, so it is the same day
 * in every zone from UTC-11 to UTC+11 and on any server host
 * (docs/decisions/2026-10-28-birth-date-noon-utc.md). A YYYY-MM-DD string is
 * that day, not new Date()'s UTC midnight.
 */
const DAY_MONTH_YEAR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const YEAR_MONTH_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MS = 60 * 60 * 1000;

// Noon UTC of the day, or null where the day does not exist (31/02 is never
// rolled to 3 March).
function calendarDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  // Date.UTC reads a year below 100 as 19xx.
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function parseDayMonthYear(value) {
  if (typeof value !== 'string') return null;
  const match = DAY_MONTH_YEAR.exec(value.trim());
  if (!match) return null;
  return calendarDay(Number(match[3]), Number(match[2]), Number(match[1]));
}

function parseYearMonthDay(value) {
  if (typeof value !== 'string') return null;
  const match = YEAR_MONTH_DAY.exec(value.trim());
  if (!match) return null;
  return calendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

// The calendar day a stored instant stands for: noon UTC is its UTC day; an
// exact local midnight on this host is its local day (the #1411 writer); any
// other instant, a legacy UTC midnight among them, is its UTC day.
function calendarDayOf(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  if (date.getUTCHours() === 12 && date.getUTCMinutes() === 0
      && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) {
    return calendarDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (date.getHours() === 0 && date.getMinutes() === 0
      && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
    return calendarDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  return calendarDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseBirthDateInput(value) {
  let date;
  if (value instanceof Date) {
    date = calendarDayOf(value);
  } else if (typeof value === 'string' && DAY_MONTH_YEAR.test(value.trim())) {
    date = parseDayMonthYear(value);
  } else if (typeof value === 'string' && YEAR_MONTH_DAY.test(value.trim())) {
    date = parseYearMonthDay(value);
  } else {
    date = calendarDayOf(new Date(value));
  }
  return date || new Date(NaN);
}

function parseBirthDateDay(value) {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : value;
  if (!input) return null;
  return calendarDayOf(parseBirthDateInput(input));
}

// The blind-index key: the UTC YYYY-MM-DD of the noon value.
function birthDateKey(value) {
  const day = parseBirthDateDay(value);
  return day ? day.toISOString().slice(0, 10) : null;
}

// [00:00Z, next 00:00Z) of the day: holds the noon value, a legacy UTC
// midnight and a UTC-3 local midnight (03:00Z).
function birthDateDayRange(value) {
  const day = parseBirthDateDay(value);
  if (!day) return null;
  const start = new Date(day.getTime() - 12 * HOUR_MS);
  return { start, end: new Date(start.getTime() + 24 * HOUR_MS) };
}

module.exports = {
  calendarDay,
  calendarDayOf,
  parseDayMonthYear,
  parseYearMonthDay,
  parseBirthDateInput,
  parseBirthDateDay,
  birthDateKey,
  birthDateDayRange,
};
