import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1397 (RF009 AC7, RF015): the Dashboard's temperature chart shows the
// readings persisted in InfluxDB (GET /temperature), and an empty or failed
// read as such; its alerts are the backend's temperature incidents
// (GET /incidents), never a generated value.
let roleName = 'Tecnico';
let sampleTotal: number | null = 0;

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
  useSamples: () => ({ samples: [], total: sampleTotal, loading: false, loadSamples: noop }),
}));
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ results: [], loading: false, loadResults: noop }),
}));
vi.mock('../hooks/useTemperature', () => ({
  useTemperature: () => ({ temperatures: [], loading: false, viewControl: noop }),
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  temperatureService: { getAll: vi.fn() },
  securityService: { getConsentQueueStatus: vi.fn() },
  reportsService: { getAll: vi.fn() },
  equipmentService: { getAll: vi.fn() },
  userService: { getAll: vi.fn() },
  logService: { getLogs: vi.fn() },
}));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiClient: { get: vi.fn() },
}));

import { temperatureService, securityService, reportsService, equipmentService, userService, logService } from '../services/api';
import { apiClient } from '../api/client';
import Dashboard from './Dashboard';

const getAll = vi.mocked(temperatureService.getAll);
const getConsentQueueStatus = vi.mocked(securityService.getConsentQueueStatus);
const getReports = vi.mocked(reportsService.getAll);
const getEquipment = vi.mocked(equipmentService.getAll);
const getUsers = vi.mocked(userService.getAll);
const getLogs = vi.mocked(logService.getLogs);
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
    sampleTotal = 0;
    getAll.mockReset();
    getEquipment.mockReset().mockResolvedValue({ data: { success: true, data: [] } } as never);
    getUsers.mockReset().mockResolvedValue({ data: { success: true, data: [] } } as never);
    getLogs.mockReset().mockResolvedValue({ data: { success: true, data: { logs: [], total: 0 } } } as never);
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
    expect(screen.queryByTestId('dashboard-alerts-more')).toBeNull();
  });

  it('shows three alerts and the active total, with a link to the rest', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    incidentsResponse = () => Promise.resolve({
      data: {
        success: true,
        total: 12,
        incidents: [
          incident('inc-1', 'open', 'Freezer A', -47.5),
          incident('inc-2', 'open', 'Freezer B', -48),
          incident('inc-3', 'escalated', 'Freezer C', -55),
          incident('inc-4', 'open', 'Freezer D', -60),
          incident('inc-5', 'acknowledged', 'Freezer E', -61),
        ],
      },
    });
    renderDashboard();

    await waitFor(() => expect(alertItems()).toHaveLength(3));
    expect(screen.queryByTestId('dashboard-alert-inc-4')).toBeNull();
    expect(kpiValue('temperatureAlerts')).toBe('12');
    expect(screen.getByTestId('dashboard-alerts-more')).toHaveAttribute('href', '/incidents');
  });

  it('shows each list page\'s total, and leaves pages without a list as Abrir', async () => {
    roleName = 'Administrador';
    sampleTotal = 528;
    getAll.mockResolvedValue(envelope([]) as never);
    getEquipment.mockResolvedValue({ data: { success: true, data: [{}, {}, {}] } } as never);
    getUsers.mockResolvedValue({ data: { success: true, data: [{}, {}] } } as never);
    getLogs.mockResolvedValue({ data: { success: true, data: { logs: [], total: 41 } } } as never);
    renderDashboard();

    await waitFor(() => expect(kpiValue('storage')).toBe('3'));
    expect(kpiValue('samples')).toBe('528');
    expect(kpiValue('custodyReports')).toBe('528');
    expect(kpiValue('users')).toBe('2');
    expect(kpiValue('audit')).toBe('41');
    expect(screen.queryByTestId('dashboard-card-security')).toBeNull();
    expect(screen.queryByTestId('dashboard-card-settings')).toBeNull();
    expect(getLogs).toHaveBeenCalledWith({ limit: 1 });
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
