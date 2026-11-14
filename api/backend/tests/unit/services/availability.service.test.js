import { describe, it, expect } from 'vitest';

const {
  validateRecord,
  parseMonth,
  computeAvailability,
  monthlyReport,
} = require('../../../src/services/availability.service');

// RNF003 C1, C2, C4 (#1468): outage and maintenance records and the monthly
// availability computed from them.

const OUTAGE = {
  kind: 'outage',
  startedAt: '2000-02-15T10:00:00Z',
  endedAt: '2000-02-15T11:00:00Z',
  cause: 'Falha do banco',
  impact: 'API indisponível',
};
const MAINTENANCE = {
  kind: 'maintenance',
  startedAt: '2000-02-10T02:00:00Z',
  endedAt: '2000-02-10T04:00:00Z',
  announcedAt: '2000-02-01T00:00:00Z',
  cause: 'Atualização',
  impact: 'Plataforma fora do ar',
};

describe('validateRecord', () => {
  it('accepts an outage and a maintenance, keeping only the known fields', () => {
    const outage = validateRecord({ ...OUTAGE, extra: 'x' });
    expect(outage.errors).toBeUndefined();
    expect(outage.record).toEqual({
      kind: 'outage',
      startedAt: new Date(OUTAGE.startedAt),
      endedAt: new Date(OUTAGE.endedAt),
      cause: OUTAGE.cause,
      impact: OUTAGE.impact,
    });
    const maintenance = validateRecord(MAINTENANCE);
    expect(maintenance.record.announcedAt).toEqual(new Date(MAINTENANCE.announcedAt));
  });

  it('refuses an unknown kind', () => {
    expect(validateRecord({ ...OUTAGE, kind: 'incident' }).errors).toHaveLength(1);
  });

  it('refuses an end that is not after the start', () => {
    expect(validateRecord({ ...OUTAGE, endedAt: OUTAGE.startedAt }).errors).toEqual(['endedAt deve ser posterior a startedAt']);
  });

  it('refuses a blank cause and a 501-character cause', () => {
    expect(validateRecord({ ...OUTAGE, cause: '   ' }).errors).toEqual(['cause é obrigatório']);
    expect(validateRecord({ ...OUTAGE, cause: 'a'.repeat(501) }).errors).toEqual(['cause deve ter no máximo 500 caracteres']);
    expect(validateRecord({ ...OUTAGE, cause: 'a'.repeat(500) }).errors).toBeUndefined();
  });

  it('refuses a maintenance without announcedAt', () => {
    const { announcedAt, ...unannounced } = MAINTENANCE;
    expect(validateRecord(unannounced).errors).toEqual(['announcedAt é obrigatório para manutenção']);
  });

  it('refuses a maintenance announced at or after its start', () => {
    expect(validateRecord({ ...MAINTENANCE, announcedAt: MAINTENANCE.startedAt }).errors).toEqual(['announcedAt deve ser anterior a startedAt']);
    expect(validateRecord({ ...MAINTENANCE, announcedAt: '2000-02-10T03:00:00Z' }).errors).toEqual(['announcedAt deve ser anterior a startedAt']);
  });

  it('refuses an outage with announcedAt', () => {
    expect(validateRecord({ ...OUTAGE, announcedAt: '2000-02-01T00:00:00Z' }).errors).toEqual(['announcedAt não se aplica a indisponibilidade']);
  });
});

describe('validateRecord dates', () => {
  const NOW = new Date('2026-11-13T12:00:00Z');
  const at = (startedAt, endedAt) => validateRecord({ ...OUTAGE, startedAt, endedAt }, NOW).errors;

  it('refuses a year typed in the future, 2099', () => {
    expect(at('2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z')).toEqual([
      'startedAt não pode ser posterior ao momento atual',
      'endedAt não pode ser posterior ao momento atual',
    ]);
  });

  it("refuses a bare '5' and a non-ISO date", () => {
    expect(at('Feb 10 2000', '5')).toEqual([
      'startedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)',
      'endedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)',
    ]);
  });

  it('refuses an impossible 2000-02-30, which would roll over to 1 March', () => {
    expect(at('2000-02-30T00:00:00Z', '2000-03-02T00:00:00Z')).toEqual(['startedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)']);
  });

  it('refuses an ISO date with no offset', () => {
    expect(at('2000-02-10T02:00', '2000-02-10T03:00:00Z')).toEqual(['startedAt deve ser uma data ISO com fuso (Z ou ±hh:mm)']);
  });

  it('refuses an end later than now plus 5 minutes, and takes one within the skew', () => {
    expect(at('2026-11-13T11:00:00Z', '2026-11-13T12:05:01Z')).toEqual(['endedAt não pode ser posterior ao momento atual']);
    expect(at('2026-11-13T11:00:00Z', '2026-11-13T12:05:00Z')).toBeUndefined();
  });

  it('accepts an ISO date with an explicit offset', () => {
    const { record, errors } = validateRecord({ ...OUTAGE, startedAt: '2000-02-10T02:00:00-03:00', endedAt: '2000-02-10T06:30:00.250+01:00' }, NOW);
    expect(errors).toBeUndefined();
    expect(record.startedAt).toEqual(new Date('2000-02-10T05:00:00Z'));
    expect(record.endedAt).toEqual(new Date('2000-02-10T05:30:00.250Z'));
  });
});

describe('monthlyReport', () => {
  const dbWith = (records) => ({
    collection: () => ({
      find: () => {
        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => records };
        return cursor;
      },
    }),
  });

  it('measures a running month up to now, with partial and asOf', async () => {
    // 2026-11-11T00:00Z is 10 x 1440 = 14400 minutes into November; a
    // 144-minute outage is 1% of it: 100 x 14256 / 14400 = 99.
    const now = new Date('2026-11-11T00:00:00Z');
    const report = await monthlyReport(dbWith([rec('outage', '2026-11-02T00:00:00Z', '2026-11-02T02:24:00Z')]), '2026-11', now);
    expect(report.partial).toBe(true);
    expect(report.asOf).toEqual(now);
    expect(report.periodMinutes).toBe(14400);
    expect(report.outageMinutes).toBe(144);
    expect(report.availabilityPercent).toBe(99);
    expect(report.met).toBe(false);
  });

  it('measures a past month whole, partial false and asOf its end', async () => {
    const report = await monthlyReport(dbWith([MAINTENANCE, OUTAGE]), '2000-02', new Date('2026-11-11T00:00:00Z'));
    expect(report.partial).toBe(false);
    expect(report.asOf).toEqual(new Date('2000-03-01T00:00:00Z'));
    expect(report.periodMinutes).toBe(41760);
    expect(report.availabilityPercent).toBe(99.8559);
  });

  it('refuses a month that starts after now, with statusCode 422', async () => {
    const db = dbWith([]);
    await expect(monthlyReport(db, '2026-12', new Date('2026-11-11T00:00:00Z'))).rejects.toMatchObject({
      message: 'Mês ainda não iniciado: 2026-12',
      statusCode: 422,
    });
  });

  it("refuses a month when now is exactly its first instant, with statusCode 422", async () => {
    const db = dbWith([]);
    await expect(monthlyReport(db, '2026-11', new Date('2026-11-01T00:00:00Z'))).rejects.toMatchObject({
      message: 'Mês ainda não iniciado: 2026-11',
      statusCode: 422,
    });
  });
});

describe('parseMonth', () => {
  it('reads 2000-02 as the UTC month', () => {
    expect(parseMonth('2000-02')).toEqual({
      start: new Date('2000-02-01T00:00:00Z'),
      end: new Date('2000-03-01T00:00:00Z'),
    });
  });

  it('reads 0050-03 as year 50, never 1950', () => {
    const range = parseMonth('0050-03');
    expect(range.start.getUTCFullYear()).toBe(50);
    expect(range.start.toISOString()).toBe('0050-03-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('0050-04-01T00:00:00.000Z');
  });

  it('ends 0099-12 at the first instant of year 100', () => {
    expect(parseMonth('0099-12').end.toISOString()).toBe('0100-01-01T00:00:00.000Z');
    expect(parseMonth('2000-12').end).toEqual(new Date('2001-01-01T00:00:00Z'));
  });

  it('refuses 2000-13', () => {
    expect(parseMonth('2000-13')).toBeNull();
  });

  it('refuses 2000-2', () => {
    expect(parseMonth('2000-2')).toBeNull();
  });

  it('refuses a missing month', () => {
    expect(parseMonth(undefined)).toBeNull();
  });
});

const rec = (kind, startedAt, endedAt) => ({ kind, startedAt, endedAt });

describe('computeAvailability', () => {
  it('2000-02: 120 announced maintenance minutes and a 60-minute outage give 99.8559, met', () => {
    const report = computeAvailability([MAINTENANCE, OUTAGE], parseMonth('2000-02'));
    expect(report).toEqual({
      periodMinutes: 41760,
      maintenanceMinutes: 120,
      maintenanceLimitMinutes: 240,
      maintenanceWithinLimit: true,
      outageMinutes: 60,
      availabilityPercent: 99.8559,
      targetPercent: 99.5,
      met: true,
      evaluable: true,
    });
  });

  it('2001-04: 300 maintenance minutes and 240 outage minutes give 99.4406, not met, over the limit', () => {
    const report = computeAvailability([
      rec('maintenance', '2001-04-05T00:00:00Z', '2001-04-05T05:00:00Z'),
      rec('outage', '2001-04-20T08:00:00Z', '2001-04-20T12:00:00Z'),
    ], parseMonth('2001-04'));
    expect(report.periodMinutes).toBe(43200);
    expect(report.maintenanceMinutes).toBe(300);
    expect(report.outageMinutes).toBe(240);
    expect(report.availabilityPercent).toBe(99.4406);
    expect(report.met).toBe(false);
    expect(report.maintenanceWithinLimit).toBe(false);
  });

  it('2001-04: a 216.0173-minute outage is 99.49996 percent, published as 99.5 but not met', () => {
    const report = computeAvailability([
      rec('outage', '2001-04-10T00:00:00.000Z', '2001-04-10T03:36:01.038Z'),
    ], parseMonth('2001-04'));
    expect(report.outageMinutes).toBeCloseTo(216.0173, 6);
    expect(report.availabilityPercent).toBe(99.5);
    expect(report.met).toBe(false);
  });

  it('2000-02: an outage of exactly 208.8 minutes, 0.5% of 41760, is met; one millisecond more is not', () => {
    const exact = computeAvailability([
      rec('outage', '2000-02-10T00:00:00.000Z', '2000-02-10T03:28:48.000Z'),
    ], parseMonth('2000-02'));
    expect(exact.outageMinutes).toBe(208.8);
    expect(exact.availabilityPercent).toBe(99.5);
    expect(exact.met).toBe(true);
    const over = computeAvailability([
      rec('outage', '2000-02-10T00:00:00.000Z', '2000-02-10T03:28:48.001Z'),
    ], parseMonth('2000-02'));
    expect(over.availabilityPercent).toBe(99.5);
    expect(over.met).toBe(false);
  });

  it('2001-01: 6 s of maintenance and an outage of exactly 0.5% of the rest is met', () => {
    const report = computeAvailability([
      rec('maintenance', '2001-01-02T00:00:00.000Z', '2001-01-02T00:00:06.000Z'),
      rec('outage', '2001-01-20T00:00:00.000Z', '2001-01-20T03:43:11.970Z'),
    ], parseMonth('2001-01'));
    expect(report.met).toBe(true);
  });

  it('two overlapping outages count their union, 90 minutes', () => {
    const report = computeAvailability([
      rec('outage', '2000-02-15T10:00:00Z', '2000-02-15T11:00:00Z'),
      rec('outage', '2000-02-15T10:30:00Z', '2000-02-15T11:30:00Z'),
    ], parseMonth('2000-02'));
    expect(report.outageMinutes).toBe(90);
  });

  it('an outage lying 30 minutes inside a maintenance window counts only its part outside', () => {
    const report = computeAvailability([
      rec('maintenance', '2000-02-10T02:00:00Z', '2000-02-10T04:00:00Z'),
      rec('outage', '2000-02-10T03:30:00Z', '2000-02-10T04:30:00Z'),
    ], parseMonth('2000-02'));
    expect(report.maintenanceMinutes).toBe(120);
    expect(report.outageMinutes).toBe(30);
  });

  it('a record crossing the month boundary counts only its part inside', () => {
    const report = computeAvailability([
      rec('outage', '2000-01-31T23:00:00Z', '2000-02-01T00:45:00Z'),
      rec('maintenance', '2000-02-29T23:30:00Z', '2000-03-01T02:00:00Z'),
    ], parseMonth('2000-02'));
    expect(report.outageMinutes).toBe(45);
    expect(report.maintenanceMinutes).toBe(30);
  });

  it('a month wholly under maintenance is not evaluable: null availability, not met', () => {
    const report = computeAvailability([
      rec('maintenance', '2000-01-01T00:00:00Z', '2000-04-01T00:00:00Z'),
    ], parseMonth('2000-02'));
    expect(report.maintenanceMinutes).toBe(41760);
    expect(report.evaluable).toBe(false);
    expect(report.met).toBe(false);
    expect(report.availabilityPercent).toBeNull();
  });

  it('a period with no records is evaluable at 100, met', () => {
    const report = computeAvailability([], parseMonth('2000-02'));
    expect(report.evaluable).toBe(true);
    expect(report.availabilityPercent).toBe(100);
    expect(report.met).toBe(true);
  });
});
