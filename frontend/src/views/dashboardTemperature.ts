import type { TemperatureReading } from '../hooks/useTemperatureReadings';

// #1397 (RF009 AC7, RF015): the Dashboard's temperature chart draws the
// readings persisted in InfluxDB, and its alerts are the backend's open
// temperature incidents, never a generated value.

export const DASHBOARD_CHART_SENSORS = 3;
export const DASHBOARD_CHART_POINTS = 20;
export const DASHBOARD_ALERT_LIMIT = 10;

export type TemperaturePoint = { time: number; celsius: number };

export type TemperatureSeries = {
  sensorId: string;
  latest: TemperatureReading;
  points: TemperaturePoint[];
};

export type TemperatureChart = {
  series: TemperatureSeries[];
  domain: { min: number; max: number };
  timeRange: { start: number; end: number } | null;
};

/**
 * The chart's series from readings that arrive newest first: the first
 * sensors to appear, each with its newest reading and its latest points
 * oldest to newest, and a y domain widened to fit any excursion.
 */
export function buildTemperatureSeries(readings: TemperatureReading[]): TemperatureChart {
  const bySensor = new Map<string, { latest: TemperatureReading; points: TemperaturePoint[] }>();
  readings.forEach((reading) => {
    if (reading.sensorId === null) return;
    const time = Date.parse(reading.timestamp);
    if (!Number.isFinite(time)) return;
    let entry = bySensor.get(reading.sensorId);
    if (!entry) {
      if (bySensor.size >= DASHBOARD_CHART_SENSORS) return;
      entry = { latest: reading, points: [] };
      bySensor.set(reading.sensorId, entry);
    }
    if (entry.points.length < DASHBOARD_CHART_POINTS) {
      entry.points.push({ time, celsius: reading.temperatureCelsius });
    }
  });

  const series = Array.from(bySensor, ([sensorId, entry]) => ({
    sensorId,
    latest: entry.latest,
    points: entry.points.reverse(),
  }));
  const plotted = series.flatMap((item) => item.points);
  if (plotted.length === 0) {
    return { series: [], domain: { min: -90, max: -50 }, timeRange: null };
  }

  const celsius = plotted.map((point) => point.celsius);
  const times = plotted.map((point) => point.time);
  const lowest = Math.min(...celsius);
  const highest = Math.max(...celsius);
  return {
    series,
    domain: { min: Math.min(-90, Math.floor(lowest) - 2), max: Math.max(-50, Math.ceil(highest) + 2) },
    timeRange: { start: Math.min(...times), end: Math.max(...times) },
  };
}

/** The incidents still active (not resolved), in the given order, capped. */
export function activeIncidents<T extends { status: string }>(incidents: T[]): T[] {
  return incidents.filter((incident) => incident.status !== 'resolved').slice(0, DASHBOARD_ALERT_LIMIT);
}
