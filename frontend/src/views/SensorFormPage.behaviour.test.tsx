import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));

const h = vi.hoisted(() => ({
  sensors: { sensors: [] as any[], createSensor: vi.fn(), updateSensor: vi.fn() },
  policies: { policies: [] as any[] },
  orgs: { organizations: [{ organizationId: 'org-1', officialName: 'Hospital Um' }] },
  listFreezers: vi.fn(),
}));

vi.mock('../hooks/useSensors', () => ({ useSensors: () => h.sensors }));
vi.mock('../hooks/usePolicies', () => ({ usePolicies: () => h.policies }));
vi.mock('../hooks/useOrganizations', () => ({ useOrganizations: () => h.orgs }));
vi.mock('../services/storageApi', () => ({ storageApi: { listFreezers: h.listFreezers } }));

import SensorFormPage from './SensorFormPage';

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/sensors/new" element={<SensorFormPage />} />
        <Route path="/sensors/:id/edit" element={<SensorFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  h.sensors.createSensor.mockResolvedValue(undefined);
  h.sensors.updateSensor.mockResolvedValue(undefined);
  h.policies.policies = [
    { _id: 'pol-1', name: 'Freezer -80', minTemp: -85, maxTemp: -75, temperatureUnit: '°C' },
    { _id: 'pol-2', minTemp: -25, maxTemp: -15, temperatureUnit: '°C' },
  ];
  h.listFreezers.mockResolvedValue({
    success: true,
    data: [
      { _id: 'fz-1', name: 'Freezer A', containerID: 7 },
      { _id: 'fz-2', name: 'Freezer sem contêiner' },
    ],
  });
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SensorFormPage', () => {
  it('creates a sensor bound to policy and freezer via MAC', async () => {
    renderForm('/sensors/new');
    expect(screen.getByRole('heading', { name: 'Novo Sensor' })).toBeInTheDocument();
    await screen.findAllByRole('option', { name: 'Freezer A' });
    const policy = screen.getByTestId('sensor-policy-select');
    expect(policy).toBeDisabled();
    fireEvent.change(screen.getByTestId('sensor-id-input'), { target: { value: 'S-9' } });
    fireEvent.change(screen.getByTestId('sensor-type-input'), { target: { value: 'PT100' } });
    fireEvent.change(screen.getByTestId('sensor-mac-address-input'), { target: { value: 'AA:BB:CC:DD:EE:FF' } });
    fireEvent.change(policy, { target: { value: 'pol-1' } });
    fireEvent.click(screen.getByTestId('sensor-form-submit'));
    await waitFor(() => expect(h.sensors.createSensor).toHaveBeenCalledTimes(1));
    expect(h.sensors.createSensor.mock.calls[0][0]).toMatchObject({
      sensorID: 'S-9',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      temperaturePolicy: 'pol-1',
    });
    expect(navigate).toHaveBeenCalledWith('/facility-management?tab=sensors');
  });

  it('edits a sensor without the id field', async () => {
    const sensor = {
      sensorId: 's-1',
      sensorType: 'PT100',
      macAddress: 'AA:BB',
      temperaturePolicy: 'pol-1',
      lastCalibration: '2024-02-01T12:00:00Z',
    };
    h.sensors.sensors = [sensor];
    renderForm('/sensors/s-1/edit', { sensor });
    expect(screen.queryByTestId('sensor-id-input')).toBeNull();
    fireEvent.change(screen.getByTestId('sensor-type-input'), { target: { value: 'NTC' } });
    fireEvent.click(screen.getByTestId('sensor-form-submit'));
    await waitFor(() => expect(h.sensors.updateSensor).toHaveBeenCalledWith('s-1', expect.objectContaining({ sensorType: 'NTC' })));
  });

  it('alerts when the edited sensor has no id', async () => {
    renderForm('/sensors/undefined/edit', { sensor: { sensorType: 'sem id' } });
    fireEvent.click(screen.getByTestId('sensor-form-submit'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('ID do sensor não encontrado'));
    expect(h.sensors.updateSensor).not.toHaveBeenCalled();
  });

  it('lists no freezer when the freezer read fails', async () => {
    h.listFreezers.mockResolvedValue({ success: false, error: 'LIST_ERROR' });
    renderForm('/sensors/new');
    await waitFor(() => expect(h.listFreezers).toHaveBeenCalledTimes(1));
    expect(within(screen.getByLabelText('Localização')).getAllByRole('option')).toHaveLength(1);
  });
});
