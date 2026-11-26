import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportQueryPage from './ReportQueryPage';

// #1337: the page as an operator uses it -- the header a report type or a
// custom template names, the sections its filter catalog renders, the
// dictionary lookups, the storage box picker, and the CSV export with the
// filters it sends.
const mocks = vi.hoisted(() => ({
  getFilters: vi.fn(),
  exportReport: vi.fn(),
  apiGet: vi.fn(),
  listFreezers: vi.fn(),
  getFreezerTree: vi.fn(),
  hasReportAccess: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../services/api', () => ({
  reportsService: {
    getFilters: (...args: unknown[]) => mocks.getFilters(...args),
    exportReport: (...args: unknown[]) => mocks.exportReport(...args),
  },
}));

vi.mock('../api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mocks.apiGet(...args) },
}));

vi.mock('../services/storageApi', () => ({
  storageApi: {
    listFreezers: (...args: unknown[]) => mocks.listFreezers(...args),
    getFreezerTree: (...args: unknown[]) => mocks.getFreezerTree(...args),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ hasReportAccess: (...args: unknown[]) => mocks.hasReportAccess(...args) }),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

function renderPage(type: string) {
  return render(
    <MemoryRouter initialEntries={[`/reports/query/${type}`]}>
      <Routes>
        <Route path="/reports/query/:type" element={<ReportQueryPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function catalog(filters: unknown, extra: Record<string, unknown> = {}) {
  return { data: { filters, ...extra } };
}

let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getFilters.mockResolvedValue({ data: {} });
  mocks.exportReport.mockResolvedValue({ data: 'col\nvalue' });
  mocks.hasReportAccess.mockReturnValue(true);
  mocks.listFreezers.mockResolvedValue({ success: true, data: [] });
  mocks.getFreezerTree.mockResolvedValue({ success: true, data: { shelves: [] } });
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:report') });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function exportAndReadFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
  await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledTimes(1));
  return mocks.exportReport.mock.calls[0];
}

describe('ReportQueryPage header and sections', () => {
  it('a system report shows its definition label and description, and its clinical section', async () => {
    renderPage('patients');

    expect(screen.getByRole('heading', { level: 1, name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByText('Resumo dos pacientes cadastrados e seus vínculos clínicos.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relatório de Pacientes / Clínico' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getFilters).toHaveBeenCalledWith('patients'));
  });

  it('a custom template is titled by its catalog name and grouped as its handler', async () => {
    mocks.getFilters.mockResolvedValue(
      catalog(
        [
          { name: 'collectionId', label: 'Coleção', type: 'text' },
          { name: 'status', label: 'Estado', type: 'select', options: ['AVAILABLE'] },
        ],
        { handlerKey: 'sample', name: 'Inventário mensal', description: 'Amostras por mês' }
      )
    );
    renderPage('inventario_mensal');

    expect(await screen.findByRole('heading', { level: 1, name: 'Inventário mensal' })).toBeInTheDocument();
    expect(screen.getByText('Amostras por mês')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventário (período, coleção, tipo, origem, localização)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relatório de Amostras / Qualidade' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtro de Status' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filtro SPREC - Matriz' })).not.toBeInTheDocument();
  });

  it('a custom template whose catalog fails to load keeps the generic title and offers export without filters', async () => {
    mocks.getFilters.mockRejectedValue(new Error('offline'));
    renderPage('modelo_sem_catalogo');

    await waitFor(() => expect(mocks.getFilters).toHaveBeenCalledWith('modelo_sem_catalogo'));
    expect(screen.getByRole('heading', { level: 1, name: 'Relatório' })).toBeInTheDocument();
    expect(screen.getByText('Configure os filtros e exporte o relatório')).toBeInTheDocument();
    expect(screen.getByText(/Nenhum filtro específico foi definido para este relatório/)).toBeInTheDocument();
  });

  it('a catalog answer without a filters list, or with non-string metadata, keeps the key-set sections and generic title', async () => {
    mocks.getFilters.mockResolvedValue({ data: { filters: 'none', handlerKey: 7, name: 7, description: 7 } });
    renderPage('temperature');

    await waitFor(() => expect(mocks.getFilters).toHaveBeenCalledWith('temperature'));
    expect(screen.getByRole('heading', { name: 'Relatório de Monitoramento (IoT/Equipamentos)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Temperatura' })).toBeInTheDocument();
  });

  it('Voltar and Cancelar both return to the reports list', () => {
    renderPage('patients');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mocks.navigate).toHaveBeenNthCalledWith(1, '/reports');
    expect(mocks.navigate).toHaveBeenNthCalledWith(2, '/reports');
  });
});

describe('ReportQueryPage export', () => {
  it('exports the CSV with no filters and downloads it under the report name', async () => {
    renderPage('samples');

    const [type, format, filters] = await exportAndReadFilters();

    expect([type, format, filters]).toEqual(['samples', 'csv', {}]);
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toMatch(/^relatorio_amostras_\d+\.csv$/);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
    expect(mocks.hasReportAccess).toHaveBeenCalledWith('reports.types.samples');
  });

  it('shows Exportando... and disables both footer buttons while the export runs', async () => {
    let resolveExport: (value: unknown) => void = () => {};
    mocks.exportReport.mockReturnValue(new Promise((resolve) => { resolveExport = resolve; }));
    renderPage('samples');

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByRole('button', { name: 'Exportando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => { resolveExport({ data: 'x' }); });
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled();
  });

  it('refuses the export without report access and says so', async () => {
    mocks.hasReportAccess.mockReturnValue(false);
    renderPage('samples');

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByText('Você não tem permissão para exportar este relatório.')).toBeInTheDocument();
    expect(mocks.exportReport).not.toHaveBeenCalled();
  });

  it('access granted on the report key alone, not its type label, still exports', async () => {
    mocks.hasReportAccess.mockImplementation((key: string) => key === 'samples');
    renderPage('samples');

    const [type] = await exportAndReadFilters();

    expect(type).toBe('samples');
    expect(screen.queryByText('Você não tem permissão para exportar este relatório.')).not.toBeInTheDocument();
  });

  it.each([
    ['the server error', { response: { data: { error: 'Tipo inválido' } } }, 'Erro ao exportar relatório: Tipo inválido'],
    ['the thrown message', new Error('Network Error'), 'Erro ao exportar relatório: Network Error'],
    ['a fallback', {}, 'Erro ao exportar relatório: falha inesperada'],
  ])('a failed export shows %s', async (_name, rejection, message) => {
    mocks.exportReport.mockRejectedValue(rejection);
    renderPage('samples');

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled();
  });

  it('a page with no report type says it cannot identify the report and exports nothing', async () => {
    render(
      <MemoryRouter initialEntries={['/reports/query']}>
        <Routes>
          <Route path="/reports/query" element={<ReportQueryPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByText('Não foi possível identificar o relatório selecionado.')).toBeInTheDocument();
    expect(mocks.getFilters).not.toHaveBeenCalled();
    expect(mocks.exportReport).not.toHaveBeenCalled();
  });

  it('sends the monitoring period and the critical-alerts flag, and drops the flag once unticked', async () => {
    const { container } = renderPage('temperature');
    await waitFor(() => expect(mocks.getFilters).toHaveBeenCalled());

    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: '2026-01-01' } });
    fireEvent.change(dates[1], { target: { value: '2026-01-31' } });
    const flag = screen.getByRole('checkbox', { name: /Alertas Críticos/ });
    fireEvent.click(flag);

    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31', criticalAlertsOnly: true });

    fireEvent.click(flag);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledTimes(2));
    expect(mocks.exportReport.mock.calls[1][2]).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
  });

  it('sends the treatment status chosen, and nothing once set back to Todos', async () => {
    renderPage('patients');
    const select = screen.getByRole('combobox', { name: 'Filtro de Status de Tratamento' });

    fireEvent.change(select, { target: { value: 'WASHOUT' } });
    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ treatmentStatus: 'WASHOUT' });

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledTimes(2));
    expect(mocks.exportReport.mock.calls[1][2]).toEqual({});
  });
});

describe('ReportQueryPage inventory and SPREC filters', () => {
  it('sends the inventory text and select dimensions the catalog lists', async () => {
    mocks.getFilters.mockResolvedValue(
      catalog([
        { name: 'collectionId', label: 'Coleção', type: 'text' },
        { name: 'sampleType', label: 'Tipo de amostra', type: 'select', options: ['PLASMA', 'SERUM'] },
      ])
    );
    renderPage('samples');

    const collection = await screen.findByRole('textbox', { name: 'Coleção' });
    fireEvent.change(collection, { target: { value: 'COL-7' } });
    const sampleType = screen.getByRole('combobox', { name: 'Tipo de amostra' });
    expect(within(sampleType).getByRole('option', { name: 'Soro' })).toBeInTheDocument();
    fireEvent.change(sampleType, { target: { value: 'SERUM' } });

    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ collectionId: 'COL-7', sampleType: 'SERUM' });
  });

  it('switching the SPREC matrix to solids swaps the axis options and clears the axes chosen', async () => {
    renderPage('samples');
    const axis1 = screen.getByRole('combobox', { name: 'Axis 1 - Tipo de Amostra' });
    expect(within(axis1).getByRole('option', { name: 'Sangue total' })).toBeInTheDocument();
    fireEvent.change(axis1, { target: { value: 'BLD' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtro RCS-GOV - Grade final' }), { target: { value: 'B' } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtro SPREC - Matriz' }), { target: { value: 'solid' } });

    const solidAxis1 = screen.getByRole('combobox', { name: 'Axis 1 - Tipo de Amostra' });
    expect(within(solidAxis1).getByRole('option', { name: 'Cabelo' })).toBeInTheDocument();
    expect(within(solidAxis1).queryByRole('option', { name: 'Sangue total' })).not.toBeInTheDocument();
    expect(solidAxis1).toHaveValue('');

    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ sprecMatrixType: 'solid', qualityCategory: 'B' });
  });

  it('picks a storage box from the chosen freezer and sends its id', async () => {
    mocks.getFilters.mockResolvedValue(catalog([{ name: 'storageBoxId', label: 'Caixa de armazenamento', type: 'storageBox' }]));
    mocks.listFreezers.mockResolvedValue({ success: true, data: [{ _id: 'f1', freezerName: 'Freezer -80' }] });
    mocks.getFreezerTree.mockResolvedValue({
      success: true,
      data: { shelves: [{ shelfName: 'Prateleira 1', racks: [{ rackName: 'Rack A', boxes: [{ boxId: 'b1', boxName: 'Caixa 1' }] }] }] },
    });
    renderPage('samples');

    const box = await screen.findByRole('combobox', { name: 'Caixa de armazenamento' });
    expect(box).toBeDisabled();
    const freezer = screen.getByRole('combobox', { name: 'Caixa de armazenamento — freezer' });
    await screen.findByRole('option', { name: 'Freezer -80' });
    fireEvent.change(freezer, { target: { value: 'f1' } });

    await screen.findByRole('option', { name: 'Prateleira 1 / Rack A / Caixa 1' });
    expect(mocks.getFreezerTree).toHaveBeenCalledWith('f1');
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: 'b1' } });

    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ storageBoxId: 'b1' });
  });

  it('a failed freezer list or tree leaves the picker with no options', async () => {
    mocks.getFilters.mockResolvedValue(catalog([{ name: 'storageBoxId', label: 'Caixa de armazenamento', type: 'storageBox' }]));
    mocks.listFreezers.mockResolvedValue({ success: false, error: 'LIST_ERROR' });
    renderPage('samples');

    const freezer = await screen.findByRole('combobox', { name: 'Caixa de armazenamento — freezer' });
    await waitFor(() => expect(mocks.listFreezers).toHaveBeenCalled());
    expect(within(freezer).getAllByRole('option')).toHaveLength(1);
  });
});

describe('ReportQueryPage dictionary lookups', () => {
  it('searches ORPHA after typing, selects a result, sends code and name, and clears it', async () => {
    mocks.apiGet.mockResolvedValue({
      data: {
        results: [
          { code: 'ORPHA:586', display: 'Fibrose cística' },
          { codigo: 'ORPHA:79', descricao: 'Fenilcetonúria' },
          { code: '', display: 'sem código' },
        ],
      },
    });
    renderPage('patients');

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar ORPHA code ou nome da doença' }), { target: { value: ' fibrose ' } });

    const option = await screen.findByRole('button', { name: /Fibrose cística/ });
    expect(screen.getByRole('button', { name: /Fenilcetonúria/ })).toBeInTheDocument();
    expect(screen.queryByText('sem código')).not.toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith('/dictionary/search', expect.objectContaining({ params: { query: 'fibrose' } }));

    fireEvent.click(option);
    expect(screen.getByText('Selecionado: Fibrose cística (ORPHA:586)')).toBeInTheDocument();

    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ orphaCode: 'ORPHA:586', orphaName: 'Fibrose cística' });

    fireEvent.click(screen.getByRole('button', { name: 'Limpar Filtro de Doença' }));
    expect(screen.queryByText(/^Selecionado:/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar ORPHA code ou nome da doença' })).toHaveValue('');
  });

  it('searches drugs, sends the ATC code and generic name, and typing over a choice drops it', async () => {
    mocks.apiGet.mockResolvedValue({
      data: { medications: [{ atc_code: 'A10BA02', generic_name: 'metformina' }, { code: 'N02BE01', name: 'paracetamol' }] },
    });
    renderPage('patients');
    const input = screen.getByRole('textbox', { name: 'Buscar generic_name ou ATC code' });

    fireEvent.change(input, { target: { value: 'met' } });
    fireEvent.click(await screen.findByRole('button', { name: /metformina/ }));

    expect(mocks.apiGet).toHaveBeenCalledWith('/dictionary/medications/search', expect.objectContaining({ params: { q: 'met', limit: 20 } }));
    expect(screen.queryByRole('button', { name: /paracetamol/ })).not.toBeInTheDocument();
    expect(screen.getByText('Selecionado: metformina (A10BA02)')).toBeInTheDocument();
    const [, , filters] = await exportAndReadFilters();
    expect(filters).toEqual({ atcCode: 'A10BA02', genericName: 'metformina' });

    fireEvent.change(input, { target: { value: 'metformina (A10BA02) x' } });
    expect(screen.queryByText('Selecionado: metformina (A10BA02)')).not.toBeInTheDocument();
  });

  it('a lookup that fails says the options cannot load, and one with no list shows none', async () => {
    mocks.apiGet.mockRejectedValueOnce(new Error('down'));
    renderPage('patients');
    const input = screen.getByRole('textbox', { name: 'Buscar ORPHA code ou nome da doença' });

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(await screen.findByText('Não foi possível carregar as opções agora.')).toBeInTheDocument();

    mocks.apiGet.mockResolvedValueOnce({ data: {} });
    fireEvent.change(input, { target: { value: 'abcd' } });
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Buscando opções...')).not.toBeInTheDocument());
    expect(screen.queryByText('Não foi possível carregar as opções agora.')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /ORPHA/ })).toHaveLength(0);
  });

  it('a drug lookup with no medications list shows no options', async () => {
    mocks.apiGet.mockResolvedValue({ data: { medications: null } });
    renderPage('patients');

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar generic_name ou ATC code' }), { target: { value: 'zz' } });

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/dictionary/medications/search', expect.anything()));
    await waitFor(() => expect(screen.queryByText('Buscando opções...')).not.toBeInTheDocument());
    expect(screen.queryByText(/^Selecionado:/)).not.toBeInTheDocument();
  });

  it('a blank query searches nothing', async () => {
    renderPage('patients');

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar ORPHA code ou nome da doença' }), { target: { value: '   ' } });
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(mocks.apiGet).not.toHaveBeenCalled();
  });
});
