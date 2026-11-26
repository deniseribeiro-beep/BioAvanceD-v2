import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsParametersPage from '@/views/SettingsParametersPage';

// The page runs over the real useAnalysisTypes hook: only the service is
// mocked, so the page reads what the hook makes of the list response.
const h = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  analysisTypeService: { getAll: h.getAll, create: h.create },
}));

const NAME_PLACEHOLDER = 'Nome do tipo (ex: PCR Real Time)';

const listOf = (items: unknown[]) => ({ data: { data: items } });

function nameInput() {
  return screen.getByPlaceholderText(NAME_PLACEHOLDER) as HTMLInputElement;
}

function codeInput() {
  // The code field's placeholder changes with the name, so it is read by position.
  return screen.getAllByRole('textbox')[1] as HTMLInputElement;
}

async function renderLoaded(items: unknown[] = []) {
  h.getAll.mockResolvedValue(listOf(items));
  render(<SettingsParametersPage />);
  // The page copies the hook's types into its own list in a later effect, so
  // the loading line can go before the rows come: wait for the final list.
  await waitFor(() => {
    expect(screen.queryByText('Carregando...')).toBeNull();
    if (items.length === 0) expect(screen.getByText('Nenhum tipo encontrado.')).toBeTruthy();
    else expect(screen.getAllByRole('row')).toHaveLength(items.length + 1);
  });
}

beforeEach(() => {
  h.getAll.mockReset();
  h.create.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SettingsParametersPage list', () => {
  it('shows the loading line while the list request is pending', () => {
    h.getAll.mockReturnValue(new Promise(() => {}));
    render(<SettingsParametersPage />);
    expect(screen.getByText('Carregando...')).toBeTruthy();
    expect(screen.queryByText('Nenhum tipo encontrado.')).toBeNull();
  });

  it('shows the empty line when the list is empty', async () => {
    await renderLoaded([]);
    expect(screen.getByText('Nenhum tipo encontrado.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the load error from the hook', async () => {
    h.getAll.mockRejectedValue(new Error('falha na rede'));
    render(<SettingsParametersPage />);
    expect(await screen.findByText('Erro: falha na rede')).toBeTruthy();
  });

  it('renders each type with Sim unless active is false', async () => {
    await renderLoaded([
      { _id: 'a1', name: 'PCR', code: 'pcr', active: true },
      { name: 'Sequenciamento', code: 'seq', active: false },
      { _id: 'a3', name: 'Elisa', code: 'elisa' },
    ]);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['PCR', 'pcr', 'Sim'],
      ['Sequenciamento', 'seq', 'Não'],
      ['Elisa', 'elisa', 'Sim'],
    ]);
    expect(screen.queryByText('Nenhum tipo encontrado.')).toBeNull();
  });
});

describe('SettingsParametersPage code suggestion', () => {
  it('offers the optional placeholder while the name is empty', async () => {
    await renderLoaded();
    expect(codeInput().placeholder).toBe('Código (opcional)');
  });

  it('suggests a slug with accents, punctuation and edge separators removed', async () => {
    await renderLoaded();
    fireEvent.change(nameInput(), { target: { value: '  Análise: PCR (Real-Time)!  ' } });
    expect(codeInput().placeholder).toBe('Código sugerido: analise_pcr_real_time');
  });
});

describe('SettingsParametersPage create', () => {
  it('refuses a blank name without calling the service', async () => {
    await renderLoaded();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Informe o nome do tipo')).toBeTruthy();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('sends the trimmed name and typed code, prepends the created type and clears the form', async () => {
    await renderLoaded([{ _id: 'a1', name: 'PCR', code: 'pcr' }]);
    h.create.mockResolvedValue({ data: { data: { _id: 'n1', name: 'Elisa', code: 'eli' } } });
    fireEvent.change(nameInput(), { target: { value: '  Elisa  ' } });
    fireEvent.change(codeInput(), { target: { value: '  eli  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Tipo criado com sucesso')).toBeTruthy();
    expect(h.create).toHaveBeenCalledWith({ name: 'Elisa', code: 'eli' });
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['Elisa', 'PCR']);
    expect(nameInput().value).toBe('');
    expect(codeInput().value).toBe('');
  });

  it('falls back to the suggested code and reads an unwrapped response body', async () => {
    await renderLoaded();
    h.create.mockResolvedValue({ data: { _id: 'n2', name: 'PCR Real Time', code: 'pcr_real_time' } });
    fireEvent.change(nameInput(), { target: { value: 'PCR Real Time' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Tipo criado com sucesso')).toBeTruthy();
    expect(h.create).toHaveBeenCalledWith({ name: 'PCR Real Time', code: 'pcr_real_time' });
    expect(screen.getByText('pcr_real_time')).toBeTruthy();
    expect(screen.queryByText('Nenhum tipo encontrado.')).toBeNull();
  });

  it('adds no row when the response carries no created type', async () => {
    await renderLoaded();
    h.create.mockResolvedValue({ data: undefined });
    fireEvent.change(nameInput(), { target: { value: 'Vazio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Tipo criado com sucesso')).toBeTruthy();
    expect(screen.getByText('Nenhum tipo encontrado.')).toBeTruthy();
  });

  it('shows Salvando... and disables the button while the request is pending', async () => {
    await renderLoaded();
    let resolve!: (v: unknown) => void;
    h.create.mockReturnValue(new Promise((r) => { resolve = r; }));
    fireEvent.change(nameInput(), { target: { value: 'PCR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    const busy = await screen.findByRole('button', { name: 'Salvando...' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    resolve({ data: { name: 'PCR', code: 'pcr' } });
    const idle = await screen.findByRole('button', { name: 'Adicionar' });
    expect((idle as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the error message from a failed create and keeps the typed name', async () => {
    await renderLoaded();
    h.create.mockRejectedValue(new Error('Código já existe'));
    fireEvent.change(nameInput(), { target: { value: 'PCR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Código já existe')).toBeTruthy();
    expect(screen.queryByText('Tipo criado com sucesso')).toBeNull();
    expect(nameInput().value).toBe('PCR');
    expect((screen.getByRole('button', { name: 'Adicionar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('falls back to a generic error when the failure carries no message', async () => {
    await renderLoaded();
    h.create.mockRejectedValue({});
    fireEvent.change(nameInput(), { target: { value: 'PCR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Erro ao criar tipo')).toBeTruthy();
  });

  it('clears an earlier error when a later create succeeds', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Informe o nome do tipo')).toBeTruthy();

    h.create.mockResolvedValue({ data: { name: 'PCR', code: 'pcr' } });
    fireEvent.change(nameInput(), { target: { value: 'PCR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Tipo criado com sucesso')).toBeTruthy();
    expect(screen.queryByText('Informe o nome do tipo')).toBeNull();
  });
});
