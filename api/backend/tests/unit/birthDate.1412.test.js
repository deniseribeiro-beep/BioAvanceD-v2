process.env.TZ = 'America/Sao_Paulo';

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const {
  parseBirthDateInput,
  parseBirthDateDay,
  birthDateKey,
  birthDateDayRange,
} = require('../../src/utils/birthDate');

// #1412: a birth date is stored as 12:00:00.000 UTC of its calendar day, the
// same day in every zone from UTC-11 to UTC+11. Read here under
// America/Sao_Paulo (UTC-3), where an ISO date read as UTC midnight was the
// day before.

function expectLocalDay(date, year, month, day) {
  expect(date.getFullYear()).toBe(year);
  expect(date.getMonth()).toBe(month);
  expect(date.getDate()).toBe(day);
}

function expectReadsBack(input) {
  const { birthDate } = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: input });
  expectLocalDay(birthDate, 1985, 2, 15);
  expect(birthDate.toISOString()).toBe('1985-03-15T12:00:00.000Z');
  expect(participantIdentityService.normalizeForHash('birthDate', birthDate)).toBe('1985-03-15');
}

describe('birth date is one calendar day in every zone (#1412)', () => {
  it('runs under America/Sao_Paulo', () => {
    expect(new Date(Date.UTC(1985, 2, 15)).getTimezoneOffset()).toBe(180);
  });

  it('ISO 1985-03-15 reads back as 15 March under America/Sao_Paulo', () => {
    expectReadsBack('1985-03-15');
  });

  it('DD/MM 15/03/1985 reads back as 15 March under America/Sao_Paulo', () => {
    expectReadsBack('15/03/1985');
  });

  it('ISO and DD/MM of one day give one blind-index key and one stored instant', () => {
    expect(participantIdentityService.normalizeForHash('birthDate', '1985-03-15'))
      .toBe(participantIdentityService.normalizeForHash('birthDate', '15/03/1985'));

    const fromIso = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: '1985-03-15' });
    const fromDayMonth = ParticipantIdentityModel.create({ participantId: '12345678', birthDate: '15/03/1985' });
    expect(fromIso.birthDate.getTime()).toBe(fromDayMonth.birthDate.getTime());
  });

  it('encryptIdentityFields stores the noon value and decryptIdentity reads the same day', () => {
    const stored = participantIdentityService.encryptIdentityFields({ birthDate: '1985-03-15' });
    expect(stored.birthDateCiphertext).toBeTruthy();

    const { birthDate } = participantIdentityService.decryptIdentity(stored);
    expectLocalDay(birthDate, 1985, 2, 15);
    expect(birthDate.toISOString()).toBe('1985-03-15T12:00:00.000Z');
    expect(stored.birthDateHash).toBe(participantIdentityService.computeBlindIndex('birthDate', '15/03/1985'));
  });

  it('a legacy UTC-midnight and a local-midnight Date read as their day', () => {
    expect(parseBirthDateInput(new Date(Date.UTC(1985, 2, 15))).toISOString()).toBe('1985-03-15T12:00:00.000Z');
    expect(parseBirthDateInput(new Date(1985, 2, 15)).toISOString()).toBe('1985-03-15T12:00:00.000Z');
  });

  it('invalid days stay invalid', () => {
    for (const input of ['31/02/1990', '1990-02-31', 'garbage']) {
      expect(Number.isNaN(parseBirthDateInput(input).getTime())).toBe(true);
      expect(parseBirthDateDay(input)).toBeNull();
      expect(birthDateKey(input)).toBeNull();
    }
  });

  it('birthDateDayRange holds the noon and both legacy midnight instants', () => {
    const { start, end } = birthDateDayRange('15/03/1985');
    for (const iso of ['1985-03-15T12:00:00.000Z', '1985-03-15T00:00:00.000Z', '1985-03-15T03:00:00.000Z']) {
      const instant = new Date(iso).getTime();
      expect(instant >= start.getTime() && instant < end.getTime()).toBe(true);
    }
  });
});
