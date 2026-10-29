import { describe, it, expect } from 'vitest';

import { selectTemperatureRows, selectAccessLogRows, selectAuditEventRows, rowKey } from './ReportViewPage.helpers';

// #949: ReportViewPage's two detail tables read `recentReadings` and
// `recentLogs`. No report handler has ever emitted either key.
//
// `handleTemperature` (api/backend/src/interface/routes/reports.routes.js)
// returns `{ total, temperatures, statistics, mode, previewLimited }` and
// `handleAccessLogs` returns `{ total, logs, previewLimited }`. That object is
// persisted verbatim -- `reportData: JSON.stringify(previewData)` -- and
// parsed straight back by the page. So the keys below are the real contract.
//
// The effect was not dead code, which is how #949 framed it: a `temperature`
// or `accessLogs` report renders its total and statistics cards and then an
// EMPTY detail section, because the page has no `temperatures` or `logs`
// branch anywhere. Same defect family as #940, one level up -- an object key
// rather than a field name.

// Shaped exactly as `handleTemperature` returns it, with rows as
// TemperatureModel.create writes them (models/Temperature.js).
const temperaturePayload = {
  total: 2,
  temperatures: [
    {
      _id: '65f0000000000000000000a1',
      logId: 'LOG-1',
      timestamp: '2026-09-01T10:00:00.000Z',
      temperatureValue: -80.2,
      temperatureUnit: 'C',
      readingStatus: 'normal',
      sensorId: 'S-1',
    },
    {
      _id: '65f0000000000000000000a2',
      logId: 'LOG-2',
      timestamp: '2026-09-01T11:00:00.000Z',
      temperatureValue: -78.9,
      temperatureUnit: 'C',
      readingStatus: 'alert',
      sensorId: 'S-2',
    },
  ],
  statistics: { average: -79.55, min: -80.2, max: -78.9, alerts: 1 },
  mode: 'report',
  previewLimited: false,
};

// Shaped exactly as `handleAccessLogs` returns it.
const accessLogPayload = {
  total: 1,
  logs: [
    {
      _id: '65f0000000000000000000b1',
      logId: 42,
      timestamp: '2026-09-01T12:00:00.000Z',
      userName: 'ana',
      action: 'LOGIN',
      entity: 'User',
      result: 'success',
      severity: 'info',
    },
  ],
  previewLimited: false,
};

describe('#949: report detail tables read the keys the handlers actually emit', () => {
  it('selects temperature rows from the handler\'s own `temperatures` key', () => {
    const rows = selectTemperatureRows(temperaturePayload);

    expect(rows).toHaveLength(2);
    expect(rows[0].temperatureValue).toBe(-80.2);
    expect(rows[1].sensorId).toBe('S-2');
  });

  it('selects access-log rows from the handler\'s own `logs` key', () => {
    const rows = selectAccessLogRows(accessLogPayload);

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('LOGIN');
  });

  it('returns [] rather than throwing for a report type with no detail rows', () => {
    expect(selectTemperatureRows({ total: 0, statistics: {} })).toEqual([]);
    expect(selectAccessLogRows({ total: 0 })).toEqual([]);
    expect(selectTemperatureRows(null)).toEqual([]);
    expect(selectAccessLogRows(undefined)).toEqual([]);
  });

  // The legacy keys were never written by anything. Pinned so a future reader
  // does not "restore" them on the assumption they were the real contract.
  it('does not read the legacy recentReadings / recentLogs keys', () => {
    expect(selectTemperatureRows({ recentReadings: [{ temperatureValue: 1 }] })).toEqual([]);
    expect(selectAccessLogRows({ recentLogs: [{ action: 'X' }] })).toEqual([]);
  });
});

describe('#949: row keys use logId, not the logID input alias', () => {
  // models/Temperature.js:54 and models/Log.js:101 both write `logId`.
  // `logID` is accepted on the way IN and never emitted, so `key={r.logID}`
  // was undefined on every row -- which survives a key rename unless fixed.
  it('prefers logId', () => {
    expect(rowKey({ logId: 'LOG-1', _id: 'abc' }, 0)).toBe('LOG-1');
    expect(rowKey({ logId: 42, _id: 'abc' }, 0)).toBe('42');
  });

  it('falls back to _id when logId is null, which the models write by default', () => {
    expect(rowKey({ logId: null, _id: 'abc' }, 0)).toBe('abc');
    expect(rowKey({ _id: 'abc' }, 0)).toBe('abc');
  });

  it('falls back to the index when a row carries neither', () => {
    expect(rowKey({}, 3)).toBe('3');
  });

  it('ignores a logID-spelled property, which no model emits', () => {
    expect(rowKey({ logID: 'WRONG', _id: 'abc' } as never, 0)).toBe('abc');
  });
});

// #733: the `audit` report now reads the AuditEvent trail, and its handler
// returns `{ total, auditEvents, previewLimited }`, with rows bounded to the
// export catalog's columns.
describe('#733: selectAuditEventRows', () => {
  const auditPayload = {
    total: 1,
    auditEvents: [
      {
        eventId: 'E-1',
        sequenceNumber: 3,
        occurredAt: '2026-09-01T12:00:00.000Z',
        recordedAt: '2026-09-01T12:00:01.000Z',
        actorPseudonym: 'USR-1234ABCD',
        action: 'LOGIN',
        entityType: 'User',
        result: 'success',
        source: 'Autenticação',
      },
    ],
    previewLimited: false,
  };

  it('reads the rows off `auditEvents`', () => {
    expect(selectAuditEventRows(auditPayload)).toEqual(auditPayload.auditEvents);
  });

  it('CONTROL: an access-log payload yields no audit rows', () => {
    expect(selectAuditEventRows(accessLogPayload)).toEqual([]);
  });

  it('CONTROL: a missing or malformed blob yields no rows', () => {
    expect(selectAuditEventRows(null)).toEqual([]);
    expect(selectAuditEventRows({ auditEvents: 'nope' })).toEqual([]);
  });
});
