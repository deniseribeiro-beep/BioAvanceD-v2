import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1397 (RF009 AC7, RF015): the Dashboard's temperature chart shows the
// readings persisted in InfluxDB (GET /temperature), and an empty or failed
// read as such; its alerts are the backend's temperature incidents
// (GET /incidents), never a generated value.
let roleName = 'Tecnico';

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { roleName } }),
}));

const noop = () => Promise.resolve();
vi.mock('../hooks/usePatients', () => ({
  usePatients: () => ({ patients: [], loading: false, loadPatients: noop }),
}));
vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ samples: [], loading: false, loadSamples: noop }),
}));
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ results: [], loading: false, loadResults: noop }),
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  temperatureService: { getAll: vi.fn() },
  securityService: { getConsentQueueStatus: vi.fn() },
  reportsService: { getAll: vi.fn() },
}));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiClient: { get: vi.fn() },
}));

import { temperatureService, securityService, reportsService } from '../services/api';
import { apiClient } from '../api/client';
import Dashboard from './Dashboard';

const getAll = vi.mocked(temperatureService.getAll);
const getConsentQueueStatus = vi.mocked(securityService.getConsentQueueStatus);
const getReports = vi.mocked(reportsService.getAll);
const clientGet = vi.mocked(apiClient.get);

type Row = {
  telemetryReadingId: string;
  timestamp: string;
  sensorId: string;
  temperatureValue: number;
  temperatureUnit: string;
  temperatureCelsius: number;
};

function row(telemetryReadingId: string, sensorId: string, temperatureCelsius: number, timestamp: string): Row {
  return { telemetryReadingId, timestamp, sensorId, temperatureValue: temperatureCelsius, temperatureUnit: '°C', temperatureCelsius };
}

// Newest first, as InfluxTelemetryReadRepository returns them.
const rows: Row[] = [
  row('reading-a-2', 'freezer-a', -47.5, '2026-10-22T10:10:00.000Z'),
  row('reading-b-2', 'freezer-b', -81.2, '2026-10-22T10:08:00.000Z'),
  row('reading-a-1', 'freezer-a', -52, '2026-10-22T10:05:00.000Z'),
  row('reading-b-1', 'freezer-b', -80.9, '2026-10-22T10:00:00.000Z'),
];

function envelope(temperatures: Row[]) {
  return { data: { success: true, data: { temperatures, total: temperatures.length, limit: 100, skip: 0 } } };
}

function incident(_id: string, status: string, sensorName: string, currentTemperature: number) {
  return {
    _id,
    sensorKey: sensorName,
    sensorName,
    openedAt: '2026-10-22T10:10:00.000Z',
    closedAt: null,
    currentTemperature,
    status,
  };
}

let incidentsResponse: () => Promise<unknown>;

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
    </MemoryRouter>,
  );
}

function lines() {
  return screen.queryAllByTestId(/^dashboard-temperature-line-/);
}

function alertItems() {
  return screen.queryAllByTestId(/^dashboard-alert-(?!s-)/);
}

function kpiValue(key: string) {
  return screen.getByTestId(`dashboard-card-${key}`).querySelector('.kpi-value')?.textContent;
}

describe('Dashboard temperature chart and alerts read persisted data (#1397, RF009 AC7)', () => {
  beforeEach(() => {
    roleName = 'Tecnico';
    getAll.mockReset();
    getConsentQueueStatus.mockReset().mockResolvedValue({ data: { data: null } } as never);
    getReports.mockReset().mockResolvedValue({ data: [] } as never);
    incidentsResponse = () => Promise.resolve({ data: { success: true, incidents: [], total: 0, limit: 50, skip: 0 } });
    clientGet.mockReset().mockImplementation(((url: string) => (
      url === '/incidents' ? incidentsResponse() : Promise.reject(new Error(`unexpected GET ${url}`))
    )) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws each sensor\'s persisted readings and its newest value, and no seed value', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    const { container } = renderDashboard();

    await waitFor(() => expect(lines()).toHaveLength(2));
    expect(screen.getByTestId('dashboard-temperature-sensor-freezer-a')).toHaveTextContent('freezer-a');
    expect(screen.getByTestId('dashboard-temperature-sensor-freezer-a')).toHaveTextContent('-47.5°C');
    expect(screen.getByTestId('dashboard-temperature-sensor-freezer-b')).toHaveTextContent('-81.2°C');
    expect(screen.getByTestId('dashboard-temperature-line-freezer-a').getAttribute('points')?.trim().split(/\s+/)).toHaveLength(2);
    const chartCard = container.querySelector('.temperature-card');
    expect(chartCard?.textContent).not.toMatch(/-80\.4|-79\.3|-60(?![\d.])/);
  });

  it('shows an empty read as empty', async () => {
    getAll.mockResolvedValue(envelope([]) as never);
    renderDashboard();

    expect(await screen.findByTestId('dashboard-temperature-empty')).toHaveTextContent('Nenhuma leitura de temperatura registrada.');
    expect(lines()).toHaveLength(0);
  });

  it('shows a failed read as failed', async () => {
    getAll.mockRejectedValue(new Error('influx down'));
    renderDashboard();

    expect(await screen.findByTestId('dashboard-temperature-error')).toHaveTextContent('influx down');
    expect(lines()).toHaveLength(0);
  });

  it('lists the open and escalated temperature incidents, not the resolved one, and counts them', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    incidentsResponse = () => Promise.resolve({
      data: {
        success: true,
        incidents: [
          incident('inc-open', 'open', 'Freezer A', -47.5),
          incident('inc-escalated', 'escalated', 'Freezer C', -55),
          incident('inc-resolved', 'resolved', 'Freezer D', -80),
        ],
      },
    });
    renderDashboard();

    await waitFor(() => expect(alertItems()).toHaveLength(2));
    expect(screen.getByTestId('dashboard-alert-inc-open')).toHaveTextContent('Freezer A');
    expect(screen.getByTestId('dashboard-alert-inc-open')).toHaveTextContent('-47.5°C');
    expect(screen.getByTestId('dashboard-alert-inc-escalated')).toHaveTextContent('Freezer C');
    expect(screen.queryByTestId('dashboard-alert-inc-resolved')).toBeNull();
    expect(kpiValue('temperatureAlerts')).toBe('2');
  });

  it('shows a failed incidents read as failed, with no alert count', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    incidentsResponse = () => Promise.reject(new Error('incidents down'));
    renderDashboard();

    expect(await screen.findByTestId('dashboard-alerts-error')).toHaveTextContent('Falha ao carregar os incidentes de temperatura.');
    expect(alertItems()).toHaveLength(0);
    expect(kpiValue('temperatureAlerts')).toBe('—');
  });

  it('reads neither the readings nor the incidents for an external user', async () => {
    roleName = 'UsuarioExterno';
    renderDashboard();

    await waitFor(() => expect(getReports).toHaveBeenCalled());
    expect(getAll).not.toHaveBeenCalled();
    expect(clientGet).not.toHaveBeenCalledWith('/incidents', expect.anything());
  });

  it('adds no point and no alert as time passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getAll.mockResolvedValue(envelope(rows) as never);
    renderDashboard();

    await waitFor(() => expect(lines()).toHaveLength(2));
    await screen.findByTestId('dashboard-alerts-empty');
    const pointsBefore = lines().map((line) => line.getAttribute('points'));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(lines().map((line) => line.getAttribute('points'))).toEqual(pointsBefore);
    expect(alertItems()).toHaveLength(0);
    expect(screen.getByTestId('dashboard-alerts-empty')).toBeInTheDocument();
  });
});
