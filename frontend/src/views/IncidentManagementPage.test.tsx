import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncidentManagement from './IncidentManagementPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key, language: 'pt-BR' }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user-1', roleName: 'Administrador' } }),
}));

const incident = {
  _id: 'inc-1',
  sensorKey: 's1',
  sensorName: 'Freezer A',
  openedAt: '2026-11-05T18:00:00.000Z',
  closedAt: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  currentTemperature: -12.4,
  maxTemperature: -10,
  minTemperature: -20,
  samplesOutOfRange: 2,
  status: 'open',
  notes: [],
  escalationLevel: 0,
  lastEscalatedAt: null,
};

describe('IncidentManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiClient.get).mockResolvedValue({ data: { incidents: [incident] } } as never);
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} } as never);
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as never);
  });

  it('lists an open incident and records acknowledge, note, escalate and resolve', async () => {
    const user = userEvent.setup();
    render(<IncidentManagement />);
    expect(await screen.findByTestId('incident-row-inc-1')).toHaveTextContent('Freezer A');
    expect(screen.getByText('Aberto')).toBeInTheDocument();

    await user.click(screen.getByTestId('incident-details-button-inc-1'));
    await user.click(screen.getByTestId('incident-acknowledge-button'));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/incidents/inc-1/acknowledge',
      expect.objectContaining({ userId: 'user-1' }),
      expect.anything(),
    ));

    await user.click(screen.getByTestId('incident-details-button-inc-1'));
    await user.click(screen.getByTestId('incident-escalate-button'));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/incidents/inc-1/escalate',
      expect.anything(),
      expect.anything(),
    ));

    await user.click(screen.getByTestId('incident-details-button-inc-1'));
    await user.click(screen.getByTestId('incident-resolve-button'));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/incidents/inc-1/resolve',
      expect.anything(),
      expect.anything(),
    ));
  });

  it('shows the load error and the action error', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce({ response: { data: { message: 'sem leitura' } } });
    render(<IncidentManagement />);
    expect(await screen.findByText(/sem leitura/)).toBeInTheDocument();

    vi.mocked(apiClient.get).mockResolvedValue({ data: { incidents: [{ ...incident, status: 'acknowledged' }] } } as never);
    vi.mocked(apiClient.put).mockRejectedValueOnce({ message: 'não fecha' });
    const user = userEvent.setup();
    render(<IncidentManagement />);
    await user.selectOptions(screen.getAllByTestId('incidents-status-filter')[1], 'all');
    await user.click(await screen.findByTestId('incident-details-button-inc-1'));
    await user.type(screen.getByTestId('incident-note-input'), 'Verificado');
    await user.click(screen.getByTestId('incident-add-note-button'));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    await user.click(screen.getByTestId('incident-resolve-button'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('não fecha'));
  });
});
