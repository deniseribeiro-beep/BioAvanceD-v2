import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ImportLGPDPage from './ImportLGPDPage';
import { importLGPDService, organizationService } from '../services/api';

// #997: the "N linha(s) em branco ignorada(s)" notice at
// ImportLGPDPage.tsx:244-252 renders off `summary.skipped`, and `summary`
// only exists because `summarizeImportResult` (importLgpdFormatters.ts)
// reads `Number(data.skipped) || 0` where `data = response.data.data` --
// i.e. the mocked shape below, `{ data: { data: { skipped, ... } } }`.
// Nothing rendered the component to pin that shape or the notice's
// presence/absence/pluralisation, so a backend field rename or a frontend
// refactor could drift silently. Modeled on
// AnalysisUploadModal.test.tsx's mocking and render approach.
vi.mock('../services/api', () => ({
  importLGPDService: {
    import: vi.fn(),
    downloadTemplate: vi.fn(),
  },
  // #1354: the picker's scope lookup. Left unresolved it rejects, and the
  // page shows no picker, which is what the #997 cases below rely on.
  organizationService: {
    getMine: vi.fn(),
    getAll: vi.fn(),
  },
}));

function mockImportResult(overrides: { skipped: number }) {
  vi.mocked(importLGPDService.import).mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        success: 1,
        errors: 0,
        duplicatesFound: 0,
        stagingBatchId: null,
        errorsDetails: [],
        ...overrides,
      },
    },
  } as any);
}

async function submitWithFile() {
  const user = userEvent.setup();
  const file = new File(['participantId\n'], 'amostras.csv', { type: 'text/csv' });
  const input = screen.getByTestId('import-lgpd-file');
  await user.upload(input, file);
  await user.click(screen.getByTestId('import-lgpd-submit'));
}

describe('ImportLGPDPage — blank-row "skipped" notice (#997)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the plural skipped-rows notice when the backend reports skipped > 1', async () => {
    mockImportResult({ skipped: 3 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-skipped')).toHaveTextContent(
        '3 linhas em branco ignoradas'
      );
    });
  });

  it('shows the singular skipped-rows notice when exactly one row was skipped', async () => {
    mockImportResult({ skipped: 1 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-skipped')).toHaveTextContent(
        '1 linha em branco ignorada'
      );
    });
  });

  it('renders no skipped-rows notice when nothing was skipped', async () => {
    mockImportResult({ skipped: 0 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    // Wait for the summary card (which the skipped notice lives inside) to
    // actually render before asserting the notice's absence -- otherwise a
    // still-pending submit would make this pass vacuously.
    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-counts')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('import-lgpd-skipped')).toBeNull();
  });
});

// #1354: a multi-organization user must name the organization an import
// stamps; the backend refuses one that names none.
describe('ImportLGPDPage — organization picker (#1354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockScope(scope: string, organizations: Array<{ organizationId: string; officialName: string }>) {
    vi.mocked(organizationService.getMine).mockResolvedValue({ data: { success: true, data: { scope, organizations } } } as any);
  }

  function sentOrganizationId() {
    const formData = vi.mocked(importLGPDService.import).mock.calls[0][1] as FormData;
    return formData.get('organizationId');
  }

  it('requires a multi-organization user to pick one, then sends it', async () => {
    mockScope('organization', [
      { organizationId: 'org-a', officialName: 'Hospital A' },
      { organizationId: 'org-b', officialName: 'Hospital B' },
    ]);
    mockImportResult({ skipped: 0 });
    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    const picker = await screen.findByTestId('import-lgpd-organization');
    await submitWithFile();
    expect(screen.getByTestId('import-lgpd-error').textContent).toMatch(/Selecione a organização/);
    expect(importLGPDService.import).not.toHaveBeenCalled();

    await userEvent.setup().selectOptions(picker, 'org-b');
    await userEvent.setup().click(screen.getByTestId('import-lgpd-submit'));
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(1));
    expect(sentOrganizationId()).toBe('org-b');
  });

  it('shows no picker to a single-organization user, and sends no organization', async () => {
    mockScope('organization', [{ organizationId: 'org-a', officialName: 'Hospital A' }]);
    mockImportResult({ skipped: 0 });
    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(organizationService.getMine).toHaveBeenCalled());
    await submitWithFile();
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('import-lgpd-organization')).toBeNull();
    expect(sentOrganizationId()).toBeNull();
  });
});

// The rest of the page: back and quarantine navigation, template download,
// type switch, client-side validation, failed imports and each outcome's
// panel. Each case pins one branch of ImportLGPDPage.tsx.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderRouted() {
  return render(
    <MemoryRouter initialEntries={['/previous', '/import-lgpd']} initialIndex={1}>
      <Routes>
        <Route path="/import-lgpd" element={<ImportLGPDPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockImportData(data: Record<string, unknown>) {
  vi.mocked(importLGPDService.import).mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 0,
        success: 0,
        errors: 0,
        skipped: 0,
        duplicatesFound: 0,
        stagingBatchId: null,
        errorsDetails: [],
        ...data,
      },
    },
  } as any);
}

describe('ImportLGPDPage — navigation, templates, validation and outcomes', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: the picker cases above leave
    // getMine resolving to an organization scope.
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('goes back one history entry from the back button', async () => {
    renderRouted();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/previous');
  });

  it('downloads the template named for the type and format', async () => {
    vi.mocked(importLGPDService.downloadTemplate).mockResolvedValue({ data: 'a,b\n' } as any);
    const createObjectURL = vi.fn(() => 'blob:template');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    renderRouted();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('import-lgpd-template-csv'));
    await waitFor(() => expect(downloads).toEqual(['modelo-amostras.csv']));
    expect(importLGPDService.downloadTemplate).toHaveBeenCalledWith('samples', 'csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:template');

    await user.selectOptions(screen.getByTestId('import-lgpd-type'), 'patients');
    await user.click(screen.getByTestId('import-lgpd-template-xlsx'));
    await waitFor(() => expect(downloads).toEqual(['modelo-amostras.csv', 'modelo-participantes.xlsx']));
    expect(importLGPDService.downloadTemplate).toHaveBeenLastCalledWith('patients', 'xlsx');
    expect(screen.queryByTestId('import-lgpd-error')).toBeNull();
  });

  it('says so when the template download fails, and clears it on a successful retry', async () => {
    vi.mocked(importLGPDService.downloadTemplate)
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce({ data: 'a,b\n' } as any);
    window.URL.createObjectURL = vi.fn(() => 'blob:template');
    window.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderRouted();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('import-lgpd-template-csv'));
    expect(await screen.findByTestId('import-lgpd-error')).toHaveTextContent('Não foi possível baixar o modelo.');

    await user.click(screen.getByTestId('import-lgpd-template-csv'));
    await waitFor(() => expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:template'));
    expect(screen.queryByTestId('import-lgpd-error')).toBeNull();
  });

  it('refuses to submit without a file, and after the picked file is cleared', async () => {
    renderRouted();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('import-lgpd-submit'));
    expect(screen.getByTestId('import-lgpd-error')).toHaveTextContent('Selecione um arquivo.');

    const input = screen.getByTestId('import-lgpd-file');
    await user.upload(input, new File(['x\n'], 'amostras.csv', { type: 'text/csv' }));
    expect(screen.queryByTestId('import-lgpd-error')).toBeNull();
    fireEvent.change(input, { target: { files: [] } });
    await user.click(screen.getByTestId('import-lgpd-submit'));
    expect(screen.getByTestId('import-lgpd-error')).toHaveTextContent('Selecione um arquivo.');
    expect(importLGPDService.import).not.toHaveBeenCalled();
  });

  it('switching type clears the result and the file, and imports the new type', async () => {
    mockImportData({ total: 1, success: 1 });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-counts')).toHaveTextContent('1 de 1 importadas');
    expect(importLGPDService.import).toHaveBeenLastCalledWith('samples', expect.any(FormData));

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('import-lgpd-type'), 'patients');
    expect(screen.queryByTestId('import-lgpd-counts')).toBeNull();
    expect((screen.getByTestId('import-lgpd-file') as HTMLInputElement).value).toBe('');
    await user.click(screen.getByTestId('import-lgpd-submit'));
    expect(screen.getByTestId('import-lgpd-error')).toHaveTextContent('Selecione um arquivo.');

    await submitWithFile();
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(2));
    expect(importLGPDService.import).toHaveBeenLastCalledWith('patients', expect.any(FormData));
    const sent = vi.mocked(importLGPDService.import).mock.calls[1][1] as FormData;
    expect(sent.get('file')).toBeInstanceOf(File);
    expect((sent.get('file') as File).name).toBe('amostras.csv');
  });

  it('a new file choice hides the previous result', async () => {
    mockImportData({ total: 1, success: 1 });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-counts')).toBeInTheDocument();

    await userEvent.setup().upload(
      screen.getByTestId('import-lgpd-file'),
      new File(['participantId\n'], 'outras.csv', { type: 'text/csv' })
    );
    expect(screen.queryByTestId('import-lgpd-counts')).toBeNull();
  });

  it('shows the busy label and disables submit while the import runs', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(importLGPDService.import).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as any);
    renderRouted();
    await submitWithFile();
    const button = screen.getByTestId('import-lgpd-submit');
    expect(button).toHaveTextContent('Importando…');
    expect(button).toBeDisabled();
    finish({ data: { data: { total: 1, success: 1, errors: 0 } } });
    await waitFor(() => expect(screen.getByTestId('import-lgpd-submit')).toHaveTextContent('Importar'));
    expect(screen.getByTestId('import-lgpd-submit')).not.toBeDisabled();
  });

  it.each([
    ['the backend message', { response: { data: { message: 'Cabeçalho inválido', error: 'BAD_HEADER' } } }, 'Cabeçalho inválido'],
    ['the backend error code when there is no message', { response: { data: { error: 'BAD_HEADER' } } }, 'BAD_HEADER'],
    ['the fallback when the failure has no response', new Error('Network Error'), 'A importação falhou. Nenhuma linha foi processada.'],
  ])('a failed import shows %s', async (_label, failure, expected) => {
    vi.mocked(importLGPDService.import).mockRejectedValue(failure);
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-error')).toHaveTextContent(expected);
    expect(screen.queryByTestId('import-lgpd-counts')).toBeNull();
    expect(screen.getByTestId('import-lgpd-submit')).not.toBeDisabled();
  });

  it('a successful resubmit clears the previous failure', async () => {
    vi.mocked(importLGPDService.import).mockRejectedValueOnce(new Error('Network Error'));
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-error')).toBeInTheDocument();

    mockImportData({ total: 1, success: 1 });
    await userEvent.setup().click(screen.getByTestId('import-lgpd-submit'));
    expect(await screen.findByTestId('import-lgpd-counts')).toBeInTheDocument();
    expect(screen.queryByTestId('import-lgpd-error')).toBeNull();
  });

  it('warns about an unrecognised response instead of reading it as a clean import', async () => {
    vi.mocked(importLGPDService.import).mockResolvedValue({ data: { success: true } } as any);
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-unknown')).toHaveTextContent('formato não reconhecido');
    expect(screen.queryByTestId('import-lgpd-counts')).toBeNull();
  });

  it('a partial import with a batch links to its quarantined rows and lists them', async () => {
    mockImportData({
      total: 3,
      success: 1,
      errors: 2,
      stagingBatchId: 'batch 7',
      errorsDetails: [
        { row: 2, participantId: 'P-1', errors: ['data inválida', 'sexo ausente'] },
        { errors: 'linha ilegível' },
      ],
    });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-counts')).toHaveTextContent('1 de 3 importadas · 2 rejeitadas');
    expect(screen.queryByTestId('import-lgpd-unretained')).toBeNull();
    const rows = screen.getByTestId('import-lgpd-rejected-rows').querySelectorAll('tr');
    expect(Array.from(rows, (row) => Array.from(row.cells, (cell) => cell.textContent))).toEqual([
      ['2', 'P-1', 'data inválida; sexo ausente'],
      ['—', '—', 'linha ilegível'],
    ]);

    await userEvent.setup().click(screen.getByTestId('import-lgpd-quarantine-link'));
    expect(screen.getByTestId('location')).toHaveTextContent('/import/quarantine?batchId=batch%207');
  });

  it('a partial import with no batch says the rejected rows are kept nowhere', async () => {
    mockImportData({
      total: 2,
      success: 1,
      errors: 1,
      errorsDetails: [{ row: 3, participantId: 'P-9', errors: ['cpf inválido'] }],
    });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-unretained')).toHaveTextContent('não mantém as linhas rejeitadas');
    expect(screen.queryByTestId('import-lgpd-quarantine-link')).toBeNull();
    expect(screen.getByTestId('import-lgpd-rejected-rows')).toHaveTextContent('cpf inválido');
  });

  it('a clean import shows its counts and no rejection panel or table', async () => {
    mockImportData({ total: 2, success: 2 });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-counts')).toHaveTextContent(/^2 de 2 importadas$/);
    expect(screen.queryByTestId('import-lgpd-unretained')).toBeNull();
    expect(screen.queryByTestId('import-lgpd-quarantine-link')).toBeNull();
    expect(screen.queryByTestId('import-lgpd-rejected-rows')).toBeNull();
    expect(screen.queryByTestId('import-lgpd-duplicates')).toBeNull();
  });

  it.each([
    [1, '1 duplicata encontrada'],
    [2, '2 duplicatas encontradas'],
  ])('reports %i duplicate(s) found', async (duplicatesFound, expected) => {
    mockImportData({ total: 2, success: 2, duplicatesFound });
    renderRouted();
    await submitWithFile();
    expect(await screen.findByTestId('import-lgpd-duplicates')).toHaveTextContent(expected);
  });

  it('offers a global caller an optional organization, and sends none unless picked', async () => {
    vi.mocked(organizationService.getMine).mockResolvedValue({ data: { success: true, data: { scope: 'global', organizations: [] } } } as any);
    vi.mocked(organizationService.getAll).mockResolvedValue({
      data: { success: true, data: [{ organizationId: 'org-a', officialName: 'Hospital A' }, { organizationId: 'org-z' }] },
    } as any);
    mockImportData({ total: 1, success: 1 });
    renderRouted();

    const picker = await screen.findByTestId('import-lgpd-organization');
    expect(picker.parentElement).toHaveTextContent('Organização (opcional)');
    expect(Array.from((picker as HTMLSelectElement).options, (option) => option.textContent)).toEqual([
      'Nenhuma',
      'Hospital A',
      'org-z',
    ]);
    await submitWithFile();
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(importLGPDService.import).mock.calls[0][1] as FormData;
    expect(formData.get('organizationId')).toBeNull();
  });
});
