import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// #1337: the Facility Management page's tabs, equipment, sensors, policies,
// temperature tones and reading-history filters, read through what the user
// sees and the hook calls each action makes.
const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const h = vi.hoisted(() => ({
  equipment: {
    equipment: [] as any,
    loading: false,
    error: null as string | null,
    loadEquipment: vi.fn(),
    createEquipment: vi.fn(),
    updateEquipment: vi.fn(),
    deleteEquipment: vi.fn(),
  },
  sensors: {
    sensors: [] as any,
    loading: false,
    error: null as string | null,
    loadSensors: vi.fn(),
    createSensor: vi.fn(),
    updateSensor: vi.fn(),
    deleteSensor: vi.fn(),
  },
  policies: {
    policies: [] as any,
    loading: false,
    error: null as string | null,
    loadPolicies: vi.fn(),
    getActiveLimit: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
  },
  orgs: {
    organizations: [] as any[],
  },
  readings: {
    readings: [] as any[],
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
  },
  listFreezers: vi.fn(),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../hooks/useEquipment', () => ({ useEquipment: () => h.equipment }));
vi.mock('../hooks/useSensors', () => ({ useSensors: () => h.sensors }));
vi.mock('../hooks/usePolicies', () => ({ usePolicies: () => h.policies }));
vi.mock('../hooks/useOrganizations', () => ({ useOrganizations: () => h.orgs }));
vi.mock('../hooks/useTemperatureReadings', () => ({ useTemperatureReadings: () => h.readings }));
vi.mock('../services/storageApi', () => ({ storageApi: { listFreezers: h.listFreezers } }));
vi.mock('./IncidentManagementPage', () => ({ default: () => <div>incident-management-stub</div> }));

import FacilityManagementPage from './FacilityManagementPage';

function renderPage(tab?: string) {
  return render(
    <MemoryRouter initialEntries={[tab ? `/facility-management?tab=${tab}` : '/facility-management']}>
      <FacilityManagementPage />
    </MemoryRouter>,
  );
}

function reading(id: string | null, sensorId: string | null, celsius: number, timestamp: string) {
  return {
    telemetryReadingId: id,
    timestamp,
    sensorId,
    temperatureValue: celsius,
    temperatureUnit: '°C',
    temperatureCelsius: celsius,
  };
}

function equipmentRow(n: number, extra: Record<string, unknown> = {}) {
  return { equipmentID: n, equipmentDescription: `Freezer ${n}`, ...extra };
}

let alertSpy: ReturnType<typeof vi.spyOn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  h.equipment.equipment = [];
  h.equipment.loading = false;
  h.equipment.error = null;
  h.equipment.createEquipment.mockResolvedValue(undefined);
  h.equipment.updateEquipment.mockResolvedValue(undefined);
  h.equipment.deleteEquipment.mockResolvedValue(undefined);
  h.equipment.loadEquipment.mockResolvedValue(undefined);
  h.sensors.sensors = [];
  h.sensors.loading = false;
  h.sensors.error = null;
  h.sensors.createSensor.mockResolvedValue(undefined);
  h.sensors.updateSensor.mockResolvedValue(undefined);
  h.sensors.deleteSensor.mockResolvedValue(undefined);
  h.policies.policies = [];
  h.policies.loading = false;
  h.policies.error = null;
  h.policies.getActiveLimit.mockResolvedValue({ limit: -78.5 });
  h.policies.createPolicy.mockResolvedValue(undefined);
  h.policies.updatePolicy.mockResolvedValue(undefined);
  h.policies.deletePolicy.mockResolvedValue(undefined);
  h.orgs.organizations = [
    { organizationId: 'org-1', officialName: 'Hospital Um' },
    { organizationId: 'org-2', officialName: 'Hospital Dois' },
  ];
  h.readings.readings = [];
  h.readings.loading = false;
  h.readings.error = null;
  h.readings.reload.mockResolvedValue(undefined);
  h.listFreezers.mockResolvedValue({
    success: true,
    data: [
      { _id: 'fz-1', name: 'Freezer A', containerID: 7 },
      { _id: 'fz-2', name: 'Freezer sem contêiner' },
    ],
  });
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FacilityManagementPage tabs', () => {
  it('opens on equipment, with or without an unknown tab in the URL', () => {
    renderPage('bogus');
    expect(screen.getByText('Gerenciamento de Instalações')).toBeInTheDocument();
    expect(screen.getByTestId('facility-tab-equipment')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('equipment-new-button')).toBeInTheDocument();
  });

  it('switches section on each tab click', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('facility-tab-sensors'));
    expect(screen.getByTestId('facility-tab-sensors')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('new-sensor-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('facility-tab-incidents'));
    expect(screen.getByText('incident-management-stub')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('facility-tab-policies'));
    expect(screen.getByRole('button', { name: /Nova Política/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('facility-tab-temperature'));
    expect(screen.getByTestId('temperature-readings-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('facility-tab-history'));
    expect(screen.getByTestId('history-readings-empty')).toBeInTheDocument();
  });
});

describe('FacilityManagementPage equipment', () => {
  it('shows the empty, loading and error states', () => {
    h.equipment.equipment = null;
    h.equipment.loading = true;
    h.equipment.error = 'boom';
    renderPage();
    expect(screen.getByText('Nenhum equipamento encontrado')).toBeInTheDocument();
    expect(screen.getByText('Nenhum equipamento cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.getByText('Erro: boom')).toBeInTheDocument();
  });

  it('lists the rows with their fallbacks and pages through them', () => {
    h.equipment.equipment = [
      equipmentRow(1, { model: 'M-80', serialNumber: 'SN1', purchaseDate: '2024-05-10T12:00:00Z' }),
      ...Array.from({ length: 11 }, (_, i) => equipmentRow(i + 2)),
    ];
    renderPage();
    const summary = () => document.querySelector('.equipment-pagination__summary');
    const firstRow = screen.getByText('Freezer 1').closest('tr') as HTMLElement;
    expect(firstRow).toHaveTextContent('M-80');
    expect(firstRow).toHaveTextContent('SN1');
    expect(firstRow).toHaveTextContent('10/05/2024');
    expect(screen.getByText('Freezer 2').closest('tr')).toHaveTextContent('---');
    expect(summary()).toHaveTextContent('Mostrando 1-10 de 12');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(summary()).toHaveTextContent('Mostrando 11-12 de 12');
    expect(screen.getByText('Freezer 12')).toBeInTheDocument();
    expect(screen.queryByText('Freezer 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(summary()).toHaveTextContent('Mostrando 1-10 de 12');

    fireEvent.change(screen.getByLabelText('Itens por página'), { target: { value: '5' } });
    expect(summary()).toHaveTextContent('Mostrando 1-5 de 12');
    expect(document.querySelector('.equipment-pagination__page')).toHaveTextContent('Página 1 de 3');
  });

  it('steps back to the last page when the list shrinks under it', () => {
    h.equipment.equipment = Array.from({ length: 12 }, (_, i) => equipmentRow(i + 1));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(document.querySelector('.equipment-pagination__page')).toHaveTextContent('Página 2 de 2');

    h.equipment.equipment = [equipmentRow(1)];
    view.rerender(
      <MemoryRouter initialEntries={['/facility-management']}>
        <FacilityManagementPage />
      </MemoryRouter>,
    );
    expect(document.querySelector('.equipment-pagination__page')).toHaveTextContent('Página 1 de 1');
    expect(screen.getByText('Freezer 1')).toBeInTheDocument();
  });

  it('navigates to the equipment form for create and edit', () => {
    const row1 = equipmentRow(1, { _id: 'mongo-1', model: 'M1' });
    h.equipment.equipment = [row1, equipmentRow(2)];
    renderPage();
    fireEvent.click(screen.getByTestId('equipment-new-button'));
    expect(navigate).toHaveBeenCalledWith('/equipment/new');
    fireEvent.click(screen.getByTestId('equipment-edit-button-1'));
    expect(navigate).toHaveBeenLastCalledWith('/equipment/mongo-1/edit', {
      state: { equipment: expect.objectContaining({ equipmentID: 1, _id: 'mongo-1' }) },
    });
    fireEvent.click(screen.getByTestId('equipment-edit-button-2'));
    expect(navigate).toHaveBeenLastCalledWith('/equipment/2/edit', {
      state: { equipment: expect.objectContaining({ equipmentID: 2 }) },
    });
  });

  it('deletes by _id or equipmentID only when confirmed, and alerts a failure', async () => {
    h.equipment.equipment = [equipmentRow(1, { _id: 'mongo-1' }), equipmentRow(2)];
    renderPage();
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('equipment-delete-button-1'));
    expect(h.equipment.deleteEquipment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('equipment-delete-button-1'));
    await waitFor(() => expect(h.equipment.deleteEquipment).toHaveBeenCalledWith('mongo-1'));
    fireEvent.click(screen.getByTestId('equipment-delete-button-2'));
    await waitFor(() => expect(h.equipment.deleteEquipment).toHaveBeenCalledWith(2));

    h.equipment.deleteEquipment.mockRejectedValueOnce(new Error('em uso'));
    fireEvent.click(screen.getByTestId('equipment-delete-button-2'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('em uso'));
    h.equipment.deleteEquipment.mockRejectedValueOnce({});
    fireEvent.click(screen.getByTestId('equipment-delete-button-2'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao excluir equipamento'));
  });
});

describe('FacilityManagementPage temperature', () => {
  it('shows the loading state while the first read is pending', () => {
    h.readings.loading = true;
    renderPage('temperature');
    expect(screen.getByTestId('temperature-readings-loading')).toBeInTheDocument();
  });

  it('tones each sensor card by its newest reading and charts the first sensor', () => {
    h.readings.readings = [
      reading('r-1', 'freezer-a', -80, '2026-10-22T10:00:00.000Z'),
      reading('r-2', 'freezer-b', -75, '2026-10-22T10:00:00.000Z'),
      reading('r-3', 'freezer-c', -50, '2026-10-22T10:00:00.000Z'),
      reading('r-4', null, -10, '2026-10-22T10:00:00.000Z'),
    ];
    const { container } = renderPage('temperature');
    expect(screen.getAllByTestId(/^temperature-sensor-card-/)).toHaveLength(3);
    expect(screen.getByTestId('temperature-sensor-card-freezer-a')).toHaveTextContent('Estável');
    expect(screen.getByTestId('temperature-sensor-card-freezer-b')).toHaveTextContent('Atenção');
    expect(screen.getByTestId('temperature-sensor-card-freezer-c')).toHaveTextContent('Crítico');
    expect(screen.getByText('Histórico recente de temperatura — freezer-a')).toBeInTheDocument();
    const points = container.querySelectorAll('circle.temperature-monitor-chart-card__point');
    expect(points).toHaveLength(1);
    expect(points[0]).toHaveAttribute('cx', '460');

    fireEvent.click(screen.getByTestId('temperature-readings-refresh'));
    expect(h.readings.reload).toHaveBeenCalledTimes(1);
  });

  it('names no sensor in the chart title when the newest reading has none', () => {
    h.readings.readings = [
      reading(null, null, -80, '2026-10-22T10:05:00.000Z'),
      reading(null, null, -81, '2026-10-22T10:00:00.000Z'),
    ];
    const { container } = renderPage('temperature');
    expect(screen.getByText('Histórico recente de temperatura — —')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^temperature-sensor-card-/)).toHaveLength(0);
    expect(container.querySelectorAll('circle.temperature-monitor-chart-card__point')).toHaveLength(2);
  });
});

describe('FacilityManagementPage reading history', () => {
  function manyReadings() {
    const rows = Array.from({ length: 13 }, (_, i) =>
      reading(`a-${i}`, 'freezer-a', -80, `2026-10-22T10:${String(i).padStart(2, '0')}:00.000Z`));
    rows.push(reading('b-1', 'freezer-b', -60, '2026-10-22T11:00:00.000Z'));
    rows.push(reading(null, null, -65, '2026-10-22T12:00:00.000Z'));
    return rows;
  }

  it('shows the loading row and re-reads on Atualizar', () => {
    h.readings.loading = true;
    renderPage('history');
    expect(screen.getByTestId('history-readings-loading')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('history-readings-refresh'));
    expect(h.readings.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeDisabled();
  });

  it('pages twelve rows at a time and fills a reading with no id or sensor', () => {
    h.readings.readings = manyReadings();
    renderPage('history');
    const summary = () => document.querySelector('.history-pagination__summary');
    expect(screen.getAllByTestId(/^history-row-/)).toHaveLength(12);
    expect(summary()).toHaveTextContent('Mostrando 1-12 de 15');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(summary()).toHaveTextContent('Mostrando 13-15 de 15');
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    const anonymous = screen.getByTestId('history-row-null-2026-10-22T12:00:00.000Z');
    expect(anonymous).toHaveTextContent('—');
    expect(anonymous).toHaveTextContent('-65.0°C');
    expect(within(anonymous).getByText('Alerta')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(summary()).toHaveTextContent('Mostrando 1-12 de 15');
  });

  it('filters by sensor and status, back to page one, and clears both', () => {
    h.readings.readings = manyReadings();
    renderPage('history');
    const clear = screen.getByRole('button', { name: /Limpar filtros/ });
    expect(clear).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    fireEvent.change(screen.getByLabelText('Filtrar por sensor'), { target: { value: 'freezer-b' } });
    expect(screen.getAllByTestId(/^history-row-/)).toHaveLength(1);
    expect(screen.getByTestId('history-row-b-1')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
    expect(clear).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'normal' } });
    expect(screen.getByTestId('history-readings-empty')).toBeInTheDocument();
    expect(document.querySelector('.history-pagination')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filtrar por sensor'), { target: { value: 'all' } });
    expect(screen.getAllByTestId(/^history-row-/)).toHaveLength(12);
    expect(screen.queryByTestId('history-row-b-1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'alerta' } });
    expect(screen.getAllByTestId(/^history-row-/)).toHaveLength(2);

    fireEvent.click(clear);
    expect(screen.getByLabelText('Filtrar por sensor')).toHaveValue('all');
    expect(screen.getByLabelText('Filtrar por status')).toHaveValue('all');
    expect(document.querySelector('.history-pagination__summary')).toHaveTextContent('de 15');
  });

  it('exports the filtered rows as a CSV download', () => {
    h.readings.readings = [
      reading('a-1', 'freezer-a', -80, '2026-10-22T10:00:00.000Z'),
      reading('b-1', 'free"zer-b', -60, '2026-10-22T11:00:00.000Z'),
    ];
    const parts: unknown[][] = [];
    const RealBlob = Blob;
    vi.stubGlobal('Blob', class extends RealBlob {
      constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
        super(blobParts, options);
        parts.push(blobParts ?? []);
      }
    });
    const createUrl = vi.fn(() => 'blob:csv');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderPage('history');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'alerta' } });
      fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));

      expect(click).toHaveBeenCalledTimes(1);
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toMatch(/^historico-leituras-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(revokeUrl).toHaveBeenCalledWith('blob:csv');
      const csv = String(parts[parts.length - 1][0]);
      expect(csv.split('\n')).toEqual([
        '﻿"Timestamp";"Sensor";"Temperatura";"Status";"ID da leitura"',
        '"2026-10-22T11:00:00.000Z";"free""zer-b";"-60.0°C";"Alerta";"b-1"',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('FacilityManagementPage sensors', () => {
  it('lists sensors by whichever id they carry, with status and calibration dates', () => {
    h.sensors.sensors = [
      { sensorID: 'S-UP', sensorId: 's-up', sensorType: 'PT100', sensorModel: 'X1', maintenanceStatus: 'calibration', lastCalibration: '2024-02-01T12:00:00Z', nextCalibration: '2025-02-01T12:00:00Z' },
      { sensorId: 's-low', sensorType: 'NTC' },
      { _id: 'mongo-s', sensorType: 'K' },
      { sensorType: 'sem id' },
    ];
    renderPage('sensors');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('S-UP');
    expect(rows[0]).toHaveTextContent('Calibração Pendente');
    expect(rows[0]).toHaveTextContent('01/02/2024');
    expect(rows[0]).toHaveTextContent('01/02/2025');
    expect(rows[1]).toHaveTextContent('s-low');
    expect(rows[1]).toHaveTextContent('Operacional');
    expect(rows[1]).toHaveTextContent('N/A');
    expect(rows[2]).toHaveTextContent('mongo-s');
    expect(rows[3]).toHaveTextContent('N/A');
  });

  it('shows the empty, loading and error states', () => {
    h.sensors.sensors = null;
    renderPage('sensors');
    expect(screen.getByText('Nenhum sensor cadastrado')).toBeInTheDocument();
  });

  it('shows loading and error over an empty list', () => {
    h.sensors.loading = true;
    h.sensors.error = 'falhou';
    renderPage('sensors');
    expect(screen.getAllByText('Carregando...')).toHaveLength(2);
    expect(screen.getByText('Erro: falhou')).toBeInTheDocument();
  });

  it('navigates to the sensor form for create and edit', () => {
    const sensor = { sensorId: 's-1', sensorType: 'PT100' };
    h.sensors.sensors = [sensor];
    renderPage('sensors');
    fireEvent.click(screen.getByTestId('new-sensor-button'));
    expect(navigate).toHaveBeenCalledWith('/sensors/new');
    fireEvent.click(screen.getByTestId('sensor-edit-s-1'));
    expect(navigate).toHaveBeenLastCalledWith('/sensors/s-1/edit', { state: { sensor } });
  });

  it('deletes a sensor only when confirmed, and alerts a failure', async () => {
    h.sensors.sensors = [{ sensorId: 's-1', sensorType: 'T' }];
    renderPage('sensors');
    const del = () => screen.getByTitle('Excluir');
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(del());
    expect(h.sensors.deleteSensor).not.toHaveBeenCalled();
    fireEvent.click(del());
    await waitFor(() => expect(h.sensors.deleteSensor).toHaveBeenCalledWith('s-1'));
    h.sensors.deleteSensor.mockRejectedValueOnce(new Error('vinculado'));
    fireEvent.click(del());
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('vinculado'));
  });
});

describe('FacilityManagementPage policies', () => {
  const policy = {
    _id: 'pol-1',
    name: 'Freezer -80',
    minTemp: -85,
    maxTemp: -75,
    hysteresis: 2,
    minimumDuration: 30,
    temperatureUnit: '°C',
    effectivePeriod: { start: '2026-01-10T12:00:00Z', end: '2026-12-20T12:00:00Z' },
  };

  it('shows the empty state, loading and error, leaving out a policy with no _id', () => {
    h.policies.policies = [{ name: 'sem id' }];
    h.policies.loading = true;
    h.policies.error = 'falhou';
    renderPage('policies');
    expect(screen.getByText('Nenhuma política encontrada')).toBeInTheDocument();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.getByText('Erro: falhou')).toBeInTheDocument();
    expect(h.policies.getActiveLimit).not.toHaveBeenCalled();
  });

  it('lists each policy with its active limit, or N/A when that read fails', async () => {
    h.policies.policies = [policy, { ...policy, _id: 'pol-2', name: 'Sem fim', effectivePeriod: { start: '2026-01-10T12:00:00Z', end: null } }];
    h.policies.getActiveLimit.mockImplementation(async (id: string) => {
      if (id === 'pol-2') throw new Error('sem limite');
      return { limit: -78.5 };
    });
    renderPage('policies');
    const first = screen.getByTestId('policy-row-pol-1');
    await waitFor(() => expect(first).toHaveTextContent('Limite ativo: -78.5°C'));
    expect(first).toHaveTextContent('-85°C');
    expect(first).toHaveTextContent('2°C');
    expect(first).toHaveTextContent('10/01/2026');
    expect(first).toHaveTextContent('20/12/2026');
    const second = screen.getByTestId('policy-row-pol-2');
    expect(second).toHaveTextContent('Limite ativo: N/A°C');
    expect(second).toHaveTextContent('—');
    expect(h.policies.getActiveLimit).toHaveBeenCalledWith('pol-1', true);
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });

  it('navigates to the policy form for create and edit', () => {
    h.policies.policies = [policy];
    renderPage('policies');
    fireEvent.click(screen.getByTestId('new-policy-button'));
    expect(navigate).toHaveBeenCalledWith('/policies/new');
    fireEvent.click(screen.getByTestId('policy-edit-pol-1'));
    expect(navigate).toHaveBeenLastCalledWith('/policies/pol-1/edit', { state: { policy } });
  });

  it('deletes a policy only when confirmed, and alerts a failure', async () => {
    h.policies.policies = [policy];
    renderPage('policies');
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('policy-delete-pol-1'));
    expect(h.policies.deletePolicy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('policy-delete-pol-1'));
    await waitFor(() => expect(h.policies.deletePolicy).toHaveBeenCalledWith('pol-1'));
    h.policies.deletePolicy.mockRejectedValueOnce(new Error('em uso'));
    fireEvent.click(screen.getByTestId('policy-delete-pol-1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('em uso'));
  });
});
