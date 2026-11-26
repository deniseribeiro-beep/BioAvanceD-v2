import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// #1443: the quality-description list, with its create, edit and delete
// entry points, and the form page it opens for create and edit, read through
// what the user sees, where each action goes and the hook calls it makes.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  hook: {
    qualities: [] as Array<{ id: string; description: string }>,
    loading: false,
    error: null as string | null,
    createQuality: vi.fn(),
    updateQuality: vi.fn(),
    deleteQuality: vi.fn(),
  },
}));

vi.mock('../hooks/useQualityDescriptions', () => ({ useQualityDescriptions: () => h.hook }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => h.navigate };
});

import QualityDescriptionPage from './QualityDescriptionPage';
import QualityDescriptionFormPage from './QualityDescriptionFormPage';

const ROWS = [
  { id: 'Q1', description: 'Hemolisada' },
  { id: 'Q2', description: 'Lipêmica' },
];

function row(id: string): HTMLElement {
  return screen.getByText(id).closest('tr') as HTMLElement;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/quality-descriptions']}>
      <QualityDescriptionPage />
    </MemoryRouter>,
  );
}

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/quality-descriptions/new" element={<QualityDescriptionFormPage />} />
        <Route path="/quality-descriptions/:id/edit" element={<QualityDescriptionFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function descriptionInput(): HTMLInputElement {
  return within(screen.getByTestId('quality-description-form')).getByLabelText(/Descrição/) as HTMLInputElement;
}

let alertSpy: ReturnType<typeof vi.spyOn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.hook.qualities = ROWS;
  h.hook.loading = false;
  h.hook.error = null;
  h.hook.createQuality.mockResolvedValue({});
  h.hook.updateQuality.mockResolvedValue({});
  h.hook.deleteQuality.mockResolvedValue(undefined);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('QualityDescriptionPage', () => {
  it('lists each description, and shows the loading and error states only while the hook reports them', () => {
    const { rerender } = renderList();
    expect(row('Q1').textContent).toContain('Hemolisada');
    expect(row('Q2').textContent).toContain('Lipêmica');
    expect(screen.queryByText('Carregando...')).toBeNull();
    expect(screen.queryByText(/^Erro:/)).toBeNull();

    h.hook.loading = true;
    h.hook.error = 'falha na rede';
    rerender(
      <MemoryRouter initialEntries={['/quality-descriptions']}>
        <QualityDescriptionPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Carregando...')).toBeTruthy();
    expect(screen.getByText('Erro: falha na rede')).toBeTruthy();
  });

  it('opens the new-description form page', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /Nova Descrição/ }));
    expect(h.navigate).toHaveBeenCalledWith('/quality-descriptions/new');
  });

  it('opens a row in the edit form page with that row as its state', () => {
    renderList();
    fireEvent.click(within(row('Q2')).getByTitle('Editar'));
    expect(h.navigate).toHaveBeenCalledWith('/quality-descriptions/Q2/edit', { state: { quality: ROWS[1] } });
  });

  it('deletes a row only when confirmed, and alerts a failed delete', async () => {
    renderList();
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(within(row('Q1')).getByTitle('Excluir'));
    expect(confirmSpy).toHaveBeenCalledWith('Tem certeza que deseja excluir esta descrição?');
    expect(h.hook.deleteQuality).not.toHaveBeenCalled();

    fireEvent.click(within(row('Q1')).getByTitle('Excluir'));
    await waitFor(() => expect(h.hook.deleteQuality).toHaveBeenCalledWith('Q1'));
    expect(alertSpy).not.toHaveBeenCalled();

    h.hook.deleteQuality.mockRejectedValueOnce(new Error('Erro ao deletar qualidade'));
    fireEvent.click(within(row('Q2')).getByTitle('Excluir'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao deletar qualidade'));
    expect(h.hook.deleteQuality).toHaveBeenLastCalledWith('Q2');
  });
});

describe('QualityDescriptionFormPage', () => {
  it('creates a description from an empty form and returns to the list', async () => {
    renderForm('/quality-descriptions/new');
    expect(screen.getByText('Nova Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('');

    fireEvent.change(descriptionInput(), { target: { value: 'Coagulada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(h.hook.createQuality).toHaveBeenCalledWith({ description: 'Coagulada' }));
    expect(h.hook.updateQuality).not.toHaveBeenCalled();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/quality-descriptions'));
  });

  it('edits a row from its own values and saves through update with that row id', async () => {
    renderForm('/quality-descriptions/Q2/edit', { quality: ROWS[1] });
    expect(screen.getByText('Editar Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('Lipêmica');

    fireEvent.change(descriptionInput(), { target: { value: 'Lipêmica grave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(h.hook.updateQuality).toHaveBeenCalledWith('Q2', { id: 'Q2', description: 'Lipêmica grave' }));
    expect(h.hook.createQuality).not.toHaveBeenCalled();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/quality-descriptions'));
  });

  it('finds the edited row by its id when the link carries no state', () => {
    renderForm('/quality-descriptions/Q1/edit');
    expect(descriptionInput().value).toBe('Hemolisada');
  });

  it('alerts a failed save and stays on the form', async () => {
    h.hook.createQuality.mockRejectedValue(new Error('Erro ao criar qualidade'));
    renderForm('/quality-descriptions/new');
    fireEvent.change(descriptionInput(), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao criar qualidade'));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('quality-description-form')).toBeTruthy();
  });

  it('Cancelar returns to the list without saving', () => {
    renderForm('/quality-descriptions/Q1/edit', { quality: ROWS[0] });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(h.navigate).toHaveBeenCalledWith('/quality-descriptions');
    expect(h.hook.createQuality).not.toHaveBeenCalled();
    expect(h.hook.updateQuality).not.toHaveBeenCalled();
  });
});
