import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  policies: {
    policies: [] as any[],
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
  },
}));

vi.mock('../hooks/usePolicies', () => ({ usePolicies: () => h.policies }));

import PolicyFormPage from './PolicyFormPage';

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

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/policies/new" element={<PolicyFormPage />} />
        <Route path="/policies/:id/edit" element={<PolicyFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  h.policies.policies = [];
  h.policies.createPolicy.mockResolvedValue(undefined);
  h.policies.updatePolicy.mockResolvedValue(undefined);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PolicyFormPage', () => {
  it('creates a policy with Celsius fixed', async () => {
    renderForm('/policies/new');
    expect(screen.getByRole('heading', { name: 'Nova Política' })).toBeInTheDocument();
    expect(screen.getByTestId('policy-temperature-unit')).toHaveTextContent('Celsius (°C)');
    fireEvent.change(screen.getByLabelText('Nome da Política'), { target: { value: 'Geladeira' } });
    fireEvent.change(screen.getByLabelText('Limite Mínimo'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Limite Máximo'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('policy-form-submit'));
    await waitFor(() => expect(h.policies.createPolicy).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/facility-management?tab=policies');
  });

  it('refuses invalid temperature limits', () => {
    renderForm('/policies/new');
    fireEvent.change(screen.getByLabelText('Nome da Política'), { target: { value: 'Errada' } });
    fireEvent.change(screen.getByLabelText('Limite Mínimo'), { target: { value: '-70' } });
    fireEvent.click(screen.getByTestId('policy-form-submit'));
    expect(alertSpy).toHaveBeenCalledWith('Limites de temperatura inválidos! Verifique se min < target < max.');
    expect(h.policies.createPolicy).not.toHaveBeenCalled();
  });

  it('updates a policy from location state', async () => {
    h.policies.policies = [policy];
    renderForm('/policies/pol-1/edit', { policy });
    expect(screen.getByLabelText('Nome da Política')).toHaveValue('Freezer -80');
    fireEvent.change(screen.getByLabelText('Limite Máximo'), { target: { value: '-74' } });
    fireEvent.click(screen.getByTestId('policy-form-submit'));
    await waitFor(() => expect(h.policies.updatePolicy).toHaveBeenCalledWith('pol-1', expect.objectContaining({ maxTemp: -74 })));
  });
});
