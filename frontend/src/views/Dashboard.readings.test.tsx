import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// #1397 (RF009 AC7, RF015): the Dashboard's temperature chart shows the
// readings persisted in InfluxDB (GET /temperature), and an empty or failed
// read as such; its alerts are the backend's temperature incidents
// (GET /incidents), never a generated value.
let roleName = 'Tecnico';
let signedIn = true;
let sampleTotal: number | null = 0;

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: signedIn ? { roleName } : null }),
}));

const hooks = vi.hoisted(() => ({
  patients: { patients: [] as unknown, loading: false },
  samples: { samples: [] as unknown, loading: false },
  results: { results: [] as unknown, loading: false },
  loadPatients: vi.fn(() => Promise.resolve()),
  loadSamples: vi.fn(() => Promise.resolve()),
  loadResults: vi.fn(() => Promise.resolve()),
}));
vi.mock('../hooks/usePatients', () => ({
  usePatients: () => ({ ...hooks.patients, loadPatients: hooks.loadPatients }),
}));
vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ ...hooks.samples, total: sampleTotal, loadSamples: hooks.loadSamples }),
}));
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ ...hooks.results, loadResults: hooks.loadResults }),
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
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function CurrentPath() {
  return <div data-testid="current-path">{useLocation().pathname}</div>;
}

function dashboardTree() {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
      <CurrentPath />
    </MemoryRouter>
  );
}

function renderDashboard() {
  return render(dashboardTree());
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

function consentQueueCard() {
  return screen.getByRole('heading', { name: 'Fila de Consentimentos' }).parentElement!.parentElement!;
}

function queueCount(card: HTMLElement, label: string) {
  return within(card).getByText(label).nextElementSibling?.textContent;
}

beforeEach(() => {
  roleName = 'Tecnico';
  signedIn = true;
  sampleTotal = null;
  hooks.patients = { patients: [], loading: false };
  hooks.samples = { samples: [], loading: false };
  hooks.results = { results: [], loading: false };
  hooks.loadPatients.mockClear();
  hooks.loadSamples.mockClear();
  hooks.loadResults.mockClear();
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

describe('Dashboard temperature chart and alerts read persisted data (#1397, RF009 AC7)', () => {
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

  it('centres a read whose readings share one timestamp, with one time label', async () => {
    getAll.mockResolvedValue(envelope([row('reading-c-1', 'freezer-c', -60, '2026-10-22T10:00:00.000Z')]) as never);
    const { container } = renderDashboard();

    await waitFor(() => expect(lines()).toHaveLength(1));
    // The y domain hugs the plotted points, -62 to -58 for a lone -60.
    // x = 56 + (860 - 56 - 24) / 2; y = 20 + ((-58 - -60) / 4) * (280 - 20 - 36)
    expect(screen.getByTestId('dashboard-temperature-line-freezer-c').getAttribute('points')).toBe('446,132');
    expect(container.querySelectorAll('svg text[font-size="11"]')).toHaveLength(1);
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

  it('shows an incidents payload without an incidents list as failed, with no alert count', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    incidentsResponse = () => Promise.resolve({ data: { success: true } });
    renderDashboard();

    expect(await screen.findByTestId('dashboard-alerts-error')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-alerts-empty')).toBeNull();
    expect(kpiValue('temperatureAlerts')).toBe('—');
  });

  it('ignores an incidents read that fails after the role changed', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    const first = deferred<unknown>();
    incidentsResponse = () => first.promise;
    const { rerender } = renderDashboard();
    await waitFor(() => expect(clientGet).toHaveBeenCalledTimes(1));

    roleName = 'Coordenador';
    incidentsResponse = () => Promise.resolve({ data: { success: true, incidents: [] } });
    rerender(dashboardTree());
    expect(await screen.findByTestId('dashboard-alerts-empty')).toBeInTheDocument();

    await act(async () => { first.reject(new Error('stale incidents read')); });
    expect(screen.getByTestId('dashboard-alerts-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-alerts-error')).toBeNull();
    expect(kpiValue('temperatureAlerts')).toBe('0');
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

// RF002 AC1-AC4: each role's cards, their counts and where each one leads.
describe('Dashboard cards (RF002)', () => {
  beforeEach(() => {
    getAll.mockResolvedValue(envelope([]) as never);
  });

  it('counts the patients, samples and results it was given, and a list that is not an array as 0', async () => {
    hooks.patients = { patients: [{ id: 'p1' }, { id: 'p2' }], loading: false };
    hooks.samples = { samples: null, loading: false };
    hooks.results = { results: { items: [{ id: 'r1' }] }, loading: false };
    renderDashboard();

    expect(kpiValue('patients')).toBe('2');
    expect(kpiValue('samples')).toBe('0');
    expect(kpiValue('custodyReports')).toBe('0');
    expect(kpiValue('results')).toBe('0');
    await screen.findByTestId('dashboard-alerts-empty');
  });

  it('shows every card value as loading while any list loads', async () => {
    hooks.patients = { patients: [{ id: 'p1' }], loading: false };
    hooks.results = { results: [], loading: true };
    renderDashboard();

    expect(kpiValue('patients')).toBe('...');
    expect(kpiValue('storage')).toBe('...');
    await screen.findByTestId('dashboard-alerts-empty');
  });

  it('opens the page a card names when it is clicked', async () => {
    renderDashboard();

    fireEvent.click(screen.getByTestId('dashboard-card-samples'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/samples');
    await screen.findByTestId('dashboard-alerts-empty');
  });

  it('shows the saved-report count to a coordinator', async () => {
    roleName = 'Coordenador';
    getReports.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as never);
    renderDashboard();

    await waitFor(() => expect(kpiValue('governanceReports')).toBe('3'));
  });

  it('counts a reports payload that is not a list as 0', async () => {
    roleName = 'Coordenador';
    getReports.mockResolvedValue({ data: { reports: [{ id: 'a' }] } } as never);
    renderDashboard();

    await waitFor(() => expect(kpiValue('governanceReports')).toBe('0'));
  });

  it('shows no report count when the reports read fails', async () => {
    roleName = 'UsuarioExterno';
    getReports.mockRejectedValue(new Error('reports down'));
    renderDashboard();

    await waitFor(() => expect(getReports).toHaveBeenCalled());
    await act(async () => {});
    expect(kpiValue('authorizedReports')).toBe('—');
  });

  it('ignores a reports read that answers after the role changed', async () => {
    roleName = 'Coordenador';
    const first = deferred<unknown>();
    getReports.mockReturnValueOnce(first.promise as never).mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }] } as never);
    const { rerender } = renderDashboard();
    await waitFor(() => expect(getReports).toHaveBeenCalledTimes(1));

    roleName = 'Administrador';
    rerender(dashboardTree());
    await waitFor(() => expect(kpiValue('governanceReports')).toBe('2'));

    await act(async () => { first.resolve({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }] }); });
    expect(kpiValue('governanceReports')).toBe('2');
  });

  it('reads nothing and shows no card for a user with no dashboard role', async () => {
    signedIn = false;
    renderDashboard();

    await act(async () => {});
    expect(screen.queryAllByTestId(/^dashboard-card-/)).toHaveLength(0);
    expect(getAll).not.toHaveBeenCalled();
    expect(getReports).not.toHaveBeenCalled();
    expect(clientGet).not.toHaveBeenCalled();
    expect(getConsentQueueStatus).not.toHaveBeenCalled();
  });

  it('reloads the patients, samples and results when the dashboard data changes, until it unmounts', async () => {
    const { unmount } = renderDashboard();
    await screen.findByTestId('dashboard-alerts-empty');

    act(() => { notifyDashboardDataChanged(); });
    expect(hooks.loadPatients).toHaveBeenCalledTimes(1);
    expect(hooks.loadSamples).toHaveBeenCalledTimes(1);
    expect(hooks.loadResults).toHaveBeenCalledTimes(1);

    unmount();
    notifyDashboardDataChanged();
    expect(hooks.loadPatients).toHaveBeenCalledTimes(1);
  });
});

// The administrator's consent queue panel (GET /security/consent-queue).
describe('Dashboard consent queue', () => {
  beforeEach(() => {
    roleName = 'Administrador';
    getAll.mockResolvedValue(envelope([]) as never);
  });

  it('shows the queued, sending and failed counts of an available queue', async () => {
    getConsentQueueStatus.mockResolvedValue({ data: { data: { available: true, totalQueued: 4, active: 2, failed: 1, waiting: 3, delayed: 1 } } } as never);
    renderDashboard();

    await waitFor(() => expect(queueCount(consentQueueCard(), 'Na fila')).toBe('4'));
    expect(queueCount(consentQueueCard(), 'Em envio')).toBe('2');
    expect(queueCount(consentQueueCard(), 'Falhas')).toBe('1');
  });

  it('shows 0 for a count an available queue leaves out', async () => {
    getConsentQueueStatus.mockResolvedValue({ data: { data: { available: true } } } as never);
    renderDashboard();

    await waitFor(() => expect(queueCount(consentQueueCard(), 'Na fila')).toBe('0'));
    expect(queueCount(consentQueueCard(), 'Em envio')).toBe('0');
    expect(queueCount(consentQueueCard(), 'Falhas')).toBe('0');
  });

  it('shows the queue as loading until its read answers', async () => {
    const pending = deferred<unknown>();
    getConsentQueueStatus.mockReturnValue(pending.promise as never);
    renderDashboard();

    expect(within(consentQueueCard()).getByText('Carregando...')).toBeInTheDocument();
    await act(async () => { pending.resolve({ data: { data: { available: false } } }); });
    expect(within(consentQueueCard()).queryByText('Carregando...')).toBeNull();
    expect(within(consentQueueCard()).getByText('Fila indisponível (Redis não configurado).')).toBeInTheDocument();
  });

  it('shows the queue as unavailable when its read fails', async () => {
    getConsentQueueStatus.mockRejectedValue(new Error('queue down'));
    renderDashboard();

    await waitFor(() => expect(getConsentQueueStatus).toHaveBeenCalled());
    expect(await within(consentQueueCard()).findByText('Fila indisponível (Redis não configurado).')).toBeInTheDocument();
    expect(within(consentQueueCard()).queryByText('Na fila')).toBeNull();
  });

  it('re-reads the queue every 15 seconds, and stops when the dashboard unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderDashboard();
    await waitFor(() => expect(getConsentQueueStatus).toHaveBeenCalledTimes(1));

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(getConsentQueueStatus).toHaveBeenCalledTimes(2);

    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getConsentQueueStatus).toHaveBeenCalledTimes(2);
  });

  it('shows no consent queue to a coordinator', async () => {
    roleName = 'Coordenador';
    renderDashboard();

    await screen.findByTestId('dashboard-alerts-empty');
    expect(screen.queryByRole('heading', { name: 'Fila de Consentimentos' })).toBeNull();
    expect(getConsentQueueStatus).not.toHaveBeenCalled();
  });
});
