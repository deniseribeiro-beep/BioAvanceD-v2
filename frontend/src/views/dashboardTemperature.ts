import type { TemperatureReading } from '../hooks/useTemperatureReadings';

// #1397 (RF009 AC7, RF015): the Dashboard's temperature chart draws the
// readings persisted in InfluxDB, and its alerts are the backend's open
// temperature incidents, never a generated value.

export const DASHBOARD_CHART_SENSORS = 3;
export const DASHBOARD_CHART_POINTS = 20;
export const DASHBOARD_CHART_WINDOW_MS = 30 * 60 * 1000;
export const DASHBOARD_ALERT_LIMIT = 3;

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
 * oldest to newest, and a y domain around the plotted points.
 * A sensor whose newest point is more than half an hour behind the latest
 * reading is left out, so an old extreme does not flatten the live line.
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
  const newest = series.reduce((latest, item) => Math.max(latest, item.points[item.points.length - 1]?.time ?? 0), 0);
  const live = series
    .map((item) => ({
      ...item,
      points: item.points.filter((point) => newest - point.time <= DASHBOARD_CHART_WINDOW_MS),
    }))
    .filter((item) => item.points.length > 0);
  const drawn = live.length > 0 ? live : series;
  const plotted = drawn.flatMap((item) => item.points);
  if (plotted.length === 0) {
    return { series: [], domain: { min: -90, max: -50 }, timeRange: null };
  }

  const celsius = plotted.map((point) => point.celsius);
  const times = plotted.map((point) => point.time);
  const lowest = Math.min(...celsius);
  const highest = Math.max(...celsius);
  return {
    series: drawn,
    domain: { min: Math.floor(lowest) - 2, max: Math.ceil(highest) + 2 },
    timeRange: { start: Math.min(...times), end: Math.max(...times) },
  };
}

/** The incidents still active (not resolved), in the given order, capped. */
export function activeIncidents<T extends { status: string }>(incidents: T[]): T[] {
  return incidents.filter((incident) => incident.status !== 'resolved').slice(0, DASHBOARD_ALERT_LIMIT);
}
