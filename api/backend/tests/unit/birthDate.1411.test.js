import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const { parseDayMonthYear, parseBirthDateInput, parseBirthDateDay } = require('../../src/utils/birthDate');

// #1411: a DD/MM/YYYY birth date is day first, read the same way when the
// participant identity is stored, by the duplicate check and by the search.
// Edges: 5/12/1990 is 5 December (a one-digit day is accepted); 31/02/1990
// is invalid, never rolled to 3 March; 25/12/90 is no DD/MM/YYYY (a 4-digit
// year only). #1412: every date, ISO included, is stored as 12:00 UTC of its
// calendar day.

function expectDay(date, year, month, day) {
  expect(date.getFullYear()).toBe(year);
  expect(date.getMonth()).toBe(month);
  expect(date.getDate()).toBe(day);
}

describe('birth date DD/MM/YYYY (#1411)', () => {
  it('stores 25/12/1990 as 25 December 1990', () => {
    const record = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: '25/12/1990' });

    expectDay(record.birthDate, 1990, 11, 25);
  });

  it('stores 05/12/1990 as 5 December 1990', () => {
    const record = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: '05/12/1990' });

    expectDay(record.birthDate, 1990, 11, 5);
  });

  it('the stored date hashes to the day the duplicate check hashes', () => {
    const record = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: '25/12/1990' });

    expect(participantIdentityService.normalizeForHash('birthDate', record.birthDate)).toBe('1990-12-25');
  });

  it('parseDayMonthYear reads a one-digit day and rejects every other shape', () => {
    expectDay(parseDayMonthYear('5/12/1990'), 1990, 11, 5);
    expect(parseDayMonthYear('31/02/1990')).toBeNull();
    expect(parseDayMonthYear('25/12/90')).toBeNull();
    expect(parseDayMonthYear('12/1990')).toBeNull();
    expect(parseDayMonthYear('1990-12-25')).toBeNull();
  });

  it('parseBirthDateInput reads an ISO string as its day at noon UTC (#1412)', () => {
    expect(parseBirthDateInput('1990-12-25').toISOString()).toBe('1990-12-25T12:00:00.000Z');
  });

  it('parseBirthDateDay normalizes a Date and a DD/MM string to noon UTC (#1412)', () => {
    const fromDate = parseBirthDateDay(new Date(1990, 11, 25, 15, 30));
    expectDay(fromDate, 1990, 11, 25);
    expect(fromDate.getUTCHours()).toBe(12);
    expect(fromDate.getUTCMinutes()).toBe(0);

    const fromString = parseBirthDateDay(' 25/12/1990 ');
    expectDay(fromString, 1990, 11, 25);
    expect(fromString.getUTCHours()).toBe(12);

    expect(parseBirthDateDay('')).toBeNull();
    expect(parseBirthDateDay('garbage')).toBeNull();
  });
});
