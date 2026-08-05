/**
 * Minimal ISO 8601 duration parser (RF014 #444: RetentionPolicy.retentionPeriod,
 * ELM-0410). Supports the date components used by retention windows
 * (years/months/weeks/days) -- no time-of-day component, since retention
 * periods are whole-day windows.
 */
const ISO8601_DURATION_PATTERN = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidISO8601Duration(value) {
  return typeof value === 'string' && ISO8601_DURATION_PATTERN.test(value);
}

// Approximates years as 365 days and months as 30 days -- retention windows
// only need a stable, monotonic cutoff, not calendar-accurate arithmetic.
function iso8601DurationToMs(value) {
  const match = ISO8601_DURATION_PATTERN.exec(value);
  if (!match) {
    throw new Error(`retentionPeriod não é uma duração ISO 8601 válida: ${value}`);
  }

  const [, years, months, weeks, days] = match;
  const totalDays =
    Number(years || 0) * 365 +
    Number(months || 0) * 30 +
    Number(weeks || 0) * 7 +
    Number(days || 0);

  return totalDays * DAY_MS;
}

module.exports = { isValidISO8601Duration, iso8601DurationToMs };
