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
  equipment: {
    equipment: [] as any[],
    createEquipment: vi.fn(),
    updateEquipment: vi.fn(),
    loadEquipment: vi.fn(),
  },
  orgs: { organizations: [{ organizationId: 'org-1', officialName: 'Hospital Um' }, { organizationId: 'org-2', officialName: 'Hospital Dois' }] },
}));

vi.mock('../hooks/useEquipment', () => ({ useEquipment: () => h.equipment }));
vi.mock('../hooks/useOrganizations', () => ({ useOrganizations: () => h.orgs }));

import EquipmentFormPage from './EquipmentFormPage';

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/equipment/new" element={<EquipmentFormPage />} />
        <Route path="/equipment/:id/edit" element={<EquipmentFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  h.equipment.equipment = [];
  h.equipment.createEquipment.mockResolvedValue(undefined);
  h.equipment.updateEquipment.mockResolvedValue(undefined);
  h.equipment.loadEquipment.mockResolvedValue(undefined);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EquipmentFormPage', () => {
  it('creates equipment and returns to the list', async () => {
    renderForm('/equipment/new');
    expect(screen.getByRole('heading', { name: 'Novo Equipamento' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Descrição do Equipamento'), { target: { value: 'Freezer novo' } });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'ULT-80' } });
    fireEvent.change(screen.getByTestId('equipment-organization-select'), { target: { value: 'org-2' } });
    fireEvent.click(screen.getByTestId('equipment-save-button'));
    await waitFor(() => expect(h.equipment.createEquipment).toHaveBeenCalledTimes(1));
    expect(h.equipment.loadEquipment).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/facility-management?tab=equipment');
  });

  it('updates by _id from location state', async () => {
    const item = {
      equipmentID: 1,
      _id: 'mongo-1',
      equipmentDescription: 'Freezer 1',
      model: 'M1',
      purchaseDate: '2024-01-15T12:00:00Z',
      organizationId: 'org-1',
    };
    h.equipment.equipment = [item];
    renderForm('/equipment/mongo-1/edit', { equipment: item });
    expect(screen.getByLabelText('Descrição do Equipamento')).toHaveValue('Freezer 1');
    fireEvent.click(screen.getByTestId('equipment-save-button'));
    await waitFor(() => expect(h.equipment.updateEquipment).toHaveBeenCalledWith('mongo-1', expect.objectContaining({ equipmentDescription: 'Freezer 1' })));
  });

  it.each([
    [{ response: { data: { message: 'msg do servidor' } } }, 'msg do servidor'],
    [new Error('falha local'), 'falha local'],
  ])('alerts on failed save and stays on the form (%#)', async (rejection, message) => {
    h.equipment.createEquipment.mockRejectedValue(rejection);
    renderForm('/equipment/new');
    fireEvent.change(screen.getByLabelText('Descrição do Equipamento'), { target: { value: 'X' } });
    fireEvent.click(screen.getByTestId('equipment-save-button'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(message));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Cancelar returns to the list without saving', () => {
    renderForm('/equipment/new');
    fireEvent.click(screen.getByTestId('equipment-cancel-button'));
    expect(navigate).toHaveBeenCalledWith('/facility-management?tab=equipment');
    expect(h.equipment.createEquipment).not.toHaveBeenCalled();
  });
});
