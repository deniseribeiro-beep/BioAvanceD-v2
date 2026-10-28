/**
 * #1411: a DD/MM/YYYY birth date is day first, and is read the same way when
 * the participant identity is stored, by the duplicate check and by the
 * birth-date search.
 */
const DAY_MONTH_YEAR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseDayMonthYear(value) {
  if (typeof value !== 'string') return null;
  const match = DAY_MONTH_YEAR.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function parseBirthDateInput(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' && DAY_MONTH_YEAR.test(value.trim())) {
    return parseDayMonthYear(value) || new Date(NaN);
  }
  return new Date(value);
}

function parseBirthDateDay(value) {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : value;
  if (!input) return null;
  const date = parseBirthDateInput(input);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

module.exports = { parseDayMonthYear, parseBirthDateInput, parseBirthDateDay };
