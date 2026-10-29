import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1397 (RF009 AC7): Facility Management's temperature and reading-history
// tabs show the readings persisted in InfluxDB (GET /temperature), and an
// empty or failed read as such, never a generated value.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  temperatureService: { getAll: vi.fn() },
}));

import { temperatureService } from '../services/api';
import FacilityManagementPage from './FacilityManagementPage';

const getAll = vi.mocked(temperatureService.getAll);

type Row = {
  telemetryReadingId: string;
  logId: string;
  timestamp: string;
  sensorId: string;
  measurement: string;
  temperatureValue: number;
  temperatureUnit: string;
  temperatureCelsius: number;
};

function row(telemetryReadingId: string, sensorId: string, temperatureCelsius: number, timestamp: string): Row {
  return {
    telemetryReadingId,
    logId: telemetryReadingId,
    timestamp,
    sensorId,
    measurement: 'temperature',
    temperatureValue: temperatureCelsius,
    temperatureUnit: '°C',
    temperatureCelsius,
  };
}

// Newest first, as InfluxTelemetryReadRepository returns them.
const rows: Row[] = [
  row('reading-a-2', 'freezer-a', -45, '2026-10-22T10:10:00.000Z'),
  row('reading-a-1', 'freezer-a', -52, '2026-10-22T10:05:00.000Z'),
  row('reading-b-1', 'freezer-b', -80.3, '2026-10-22T10:00:00.000Z'),
];

function envelope(temperatures: Row[]) {
  return { data: { success: true, data: { temperatures, total: temperatures.length, limit: 100, skip: 0 } } };
}

function renderTab(tab: 'temperature' | 'history') {
  return render(
    <MemoryRouter initialEntries={[`/facility-management?tab=${tab}`]}>
      <FacilityManagementPage />
    </MemoryRouter>,
  );
}

function sensorCards() {
  return screen.queryAllByTestId(/^temperature-sensor-card-/);
}

describe('FacilityManagementPage persisted temperature readings (#1397, RF009 AC7)', () => {
  beforeEach(() => {
    getAll.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows each sensor\'s newest persisted reading', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    const { container } = renderTab('temperature');

    await waitFor(() => expect(sensorCards()).toHaveLength(2));
    const freezerA = screen.getByTestId('temperature-sensor-card-freezer-a');
    expect(freezerA).toHaveTextContent('-45.0°C');
    expect(freezerA).not.toHaveTextContent('-52.0°C');
    expect(screen.getByTestId('temperature-sensor-card-freezer-b')).toHaveTextContent('-80.3°C');
    expect(container.querySelectorAll('circle.temperature-monitor-chart-card__point')).toHaveLength(2);
  });

  it('shows an empty read as empty', async () => {
    getAll.mockResolvedValue(envelope([]) as never);
    renderTab('temperature');

    expect(await screen.findByTestId('temperature-readings-empty')).toBeInTheDocument();
    expect(sensorCards()).toHaveLength(0);
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
  });

  it('shows a failed read as failed', async () => {
    getAll.mockRejectedValue(new Error('Network Error'));
    renderTab('temperature');

    const alert = await screen.findByTestId('temperature-readings-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Network Error');
    expect(sensorCards()).toHaveLength(0);
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
  });

  it('treats a malformed envelope as a failed read', async () => {
    getAll.mockResolvedValue({ data: { success: true } } as never);
    renderTab('temperature');

    expect(await screen.findByTestId('temperature-readings-error')).toHaveAttribute('role', 'alert');
    expect(sensorCards()).toHaveLength(0);
  });

  it('draws no random value', async () => {
    const random = vi.spyOn(Math, 'random');
    getAll.mockResolvedValue(envelope(rows) as never);
    renderTab('temperature');

    await waitFor(() => expect(sensorCards()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(random).not.toHaveBeenCalled();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('Histórico de Leituras lists the persisted readings', async () => {
    getAll.mockResolvedValue(envelope(rows) as never);
    renderTab('history');

    await waitFor(() => expect(screen.getAllByTestId(/^history-row-/)).toHaveLength(3));
    for (const reading of rows) {
      const tableRow = screen.getByTestId(`history-row-${reading.telemetryReadingId}`);
      expect(tableRow).toHaveTextContent(reading.sensorId);
      expect(tableRow).toHaveTextContent(`${reading.temperatureCelsius.toFixed(1)}°C`);
      expect(tableRow).toHaveTextContent(reading.telemetryReadingId);
    }
    expect(within(screen.getByTestId('history-row-reading-a-2')).getByText('Alerta')).toBeInTheDocument();
    expect(within(screen.getByTestId('history-row-reading-b-1')).getByText('Normal')).toBeInTheDocument();
  });

  it('Histórico de Leituras shows a failed read as failed', async () => {
    getAll.mockRejectedValue(new Error('Network Error'));
    renderTab('history');

    const alert = await screen.findByTestId('history-readings-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Network Error');
    expect(screen.queryAllByTestId(/^history-row-/)).toHaveLength(0);
  });

  it('Histórico de Leituras shows an empty read as empty', async () => {
    getAll.mockResolvedValue(envelope([]) as never);
    renderTab('history');

    expect(await screen.findByTestId('history-readings-empty')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^history-row-/)).toHaveLength(0);
  });

  it('Atualizar re-reads the readings', async () => {
    getAll
      .mockResolvedValueOnce(envelope(rows) as never)
      .mockResolvedValueOnce(envelope([row('reading-a-3', 'freezer-a', -40, '2026-10-22T10:15:00.000Z')]) as never);
    renderTab('temperature');

    await waitFor(() => expect(screen.getByTestId('temperature-sensor-card-freezer-a')).toHaveTextContent('-45.0°C'));
    fireEvent.click(screen.getByTestId('temperature-readings-refresh'));

    await waitFor(() => expect(screen.getByTestId('temperature-sensor-card-freezer-a')).toHaveTextContent('-40.0°C'));
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});
