import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// #1443: the quality-description page's list, create, edit, delete and
// modal close paths, read through what the user sees and the hook calls
// each action makes.
const h = vi.hoisted(() => ({
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

import QualityDescriptionPage from './QualityDescriptionPage';

const ROWS = [
  { id: 'Q1', description: 'Hemolisada' },
  { id: 'Q2', description: 'Lipêmica' },
];

function row(id: string): HTMLElement {
  return screen.getByText(id).closest('tr') as HTMLElement;
}

function descriptionInput(): HTMLInputElement {
  return within(screen.getByRole('dialog')).getByLabelText(/Descrição/) as HTMLInputElement;
}

describe('QualityDescriptionPage', () => {
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

  it('lists each description, and shows the loading and error states only while the hook reports them', () => {
    const { rerender } = render(<QualityDescriptionPage />);
    expect(row('Q1').textContent).toContain('Hemolisada');
    expect(row('Q2').textContent).toContain('Lipêmica');
    expect(screen.queryByText('Carregando...')).toBeNull();
    expect(screen.queryByText(/^Erro:/)).toBeNull();

    h.hook.loading = true;
    h.hook.error = 'falha na rede';
    rerender(<QualityDescriptionPage />);
    expect(screen.getByText('Carregando...')).toBeTruthy();
    expect(screen.getByText('Erro: falha na rede')).toBeTruthy();
  });

  it('creates a description from an empty form and closes the modal', async () => {
    render(<QualityDescriptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /Nova Descrição/ }));
    expect(within(screen.getByRole('dialog')).getByText('Nova Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('');

    fireEvent.change(descriptionInput(), { target: { value: 'Coagulada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(h.hook.createQuality).toHaveBeenCalledWith({ description: 'Coagulada' }));
    expect(h.hook.updateQuality).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('edits a row from its own values and saves through update with that row id', async () => {
    render(<QualityDescriptionPage />);
    fireEvent.click(within(row('Q2')).getByTitle('Editar'));
    expect(within(screen.getByRole('dialog')).getByText('Editar Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('Lipêmica');

    fireEvent.change(descriptionInput(), { target: { value: 'Lipêmica grave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(h.hook.updateQuality).toHaveBeenCalledWith('Q2', { id: 'Q2', description: 'Lipêmica grave' }));
    expect(h.hook.createQuality).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('alerts a failed save and keeps the modal open', async () => {
    h.hook.createQuality.mockRejectedValue(new Error('Erro ao criar qualidade'));
    render(<QualityDescriptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /Nova Descrição/ }));
    fireEvent.change(descriptionInput(), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Erro ao criar qualidade'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Cancelar and the close button close an edit, and the next open is a new, empty form', async () => {
    render(<QualityDescriptionPage />);
    fireEvent.click(within(row('Q1')).getByTitle('Editar'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Nova Descrição/ }));
    expect(within(screen.getByRole('dialog')).getByText('Nova Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(row('Q1')).getByTitle('Editar'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Nova Descrição/ }));
    expect(within(screen.getByRole('dialog')).getByText('Nova Descrição')).toBeTruthy();
    expect(descriptionInput().value).toBe('');
    expect(h.hook.createQuality).not.toHaveBeenCalled();
    expect(h.hook.updateQuality).not.toHaveBeenCalled();
  });

  it('deletes a row only when confirmed, and alerts a failed delete', async () => {
    render(<QualityDescriptionPage />);
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
