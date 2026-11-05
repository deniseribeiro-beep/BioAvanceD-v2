import { describe, it, expect } from 'vitest';
import type { TemperatureReading } from '../hooks/useTemperatureReadings';
import {
  activeIncidents,
  buildTemperatureSeries,
  DASHBOARD_ALERT_LIMIT,
  DASHBOARD_CHART_POINTS,
  DASHBOARD_CHART_SENSORS,
} from './dashboardTemperature';

// #1397 (RF009 AC7, RF015): the Dashboard chart's series come from the
// persisted readings, and its alerts from the backend's incidents.
function reading(sensorId: string | null, temperatureCelsius: number, timestamp: string): TemperatureReading {
  return { telemetryReadingId: null, timestamp, sensorId, temperatureValue: temperatureCelsius, temperatureUnit: '°C', temperatureCelsius };
}

function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 22, 10, minute)).toISOString();
}

describe('buildTemperatureSeries', () => {
  it('takes the sensors in order of first appearance, at most three', () => {
    const { series } = buildTemperatureSeries([
      reading('c', -80, at(9)),
      reading('a', -80, at(8)),
      reading('c', -80, at(7)),
      reading('b', -80, at(6)),
      reading('d', -80, at(5)),
    ]);
    expect(DASHBOARD_CHART_SENSORS).toBe(3);
    expect(series.map((item) => item.sensorId)).toEqual(['c', 'a', 'b']);
  });

  it('keeps each sensor\'s latest twenty points, oldest to newest, and its newest reading', () => {
    const readings = Array.from({ length: 25 }, (_, index) => reading('a', -80 + index / 10, at(59 - index)));
    const [series] = buildTemperatureSeries(readings).series;
    expect(series.points).toHaveLength(DASHBOARD_CHART_POINTS);
    expect(series.points[0].time).toBe(Date.parse(at(59 - 19)));
    expect(series.points[19].time).toBe(Date.parse(at(59)));
    expect(series.latest).toBe(readings[0]);
  });

  it('skips a reading with no sensor or an unparseable timestamp', () => {
    const { series } = buildTemperatureSeries([
      reading(null, -80, at(9)),
      reading('a', -80, 'not a date'),
      reading('a', -81, at(7)),
    ]);
    expect(series.map((item) => item.sensorId)).toEqual(['a']);
    expect(series[0].points).toEqual([{ time: Date.parse(at(7)), celsius: -81 }]);
    expect(series[0].latest.temperatureCelsius).toBe(-81);
  });

  it('fits the domain around readings near -80, over the plotted time range', () => {
    const chart = buildTemperatureSeries([reading('a', -79.4, at(9)), reading('b', -81.6, at(3))]);
    expect(chart.domain).toEqual({ min: -84, max: -77 });
    expect(chart.timeRange).toEqual({ start: Date.parse(at(3)), end: Date.parse(at(9)) });
  });

  it('fits the domain to an excursion above -50 or below -90', () => {
    expect(buildTemperatureSeries([reading('a', -47.5, at(9))]).domain).toEqual({ min: -50, max: -45 });
    expect(buildTemperatureSeries([reading('a', -101, at(9))]).domain).toEqual({ min: -103, max: -99 });
  });

  it('leaves out a sensor whose last reading is more than half an hour behind the live one', () => {
    const chart = buildTemperatureSeries([
      reading('freezer', -50, at(40)),
      reading('stale-cold', -77, at(0)),
      reading('stale-warm', 25, at(1)),
    ]);
    expect(chart.series.map((item) => item.sensorId)).toEqual(['freezer']);
    expect(chart.domain).toEqual({ min: -52, max: -48 });
    expect(chart.timeRange).toEqual({ start: Date.parse(at(40)), end: Date.parse(at(40)) });
  });

  it('includes both a freezer reading and a warm reading in the same scale', () => {
    expect(buildTemperatureSeries([
      reading('warm', 25, at(9)),
      reading('freezer', -77, at(3)),
    ]).domain).toEqual({ min: -79, max: 27 });
  });

  it('returns no series, the default domain and no time range for no readings', () => {
    expect(buildTemperatureSeries([])).toEqual({ series: [], domain: { min: -90, max: -50 }, timeRange: null });
  });
});

describe('activeIncidents', () => {
  it('drops the resolved incidents and keeps the order', () => {
    const incidents = [
      { _id: '1', status: 'open' },
      { _id: '2', status: 'resolved' },
      { _id: '3', status: 'escalated' },
      { _id: '4', status: 'acknowledged' },
    ];
    expect(activeIncidents(incidents).map((item) => item._id)).toEqual(['1', '3', '4']);
  });

  it('keeps at most three', () => {
    const incidents = Array.from({ length: 15 }, (_, index) => ({ _id: String(index), status: 'open' }));
    expect(DASHBOARD_ALERT_LIMIT).toBe(3);
    expect(activeIncidents(incidents).map((item) => item._id)).toEqual(['0', '1', '2']);
  });
});
