import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ResultsPage from './ResultsPage';
import { importService, resultService, equipmentService } from '../services/api';
import { LanguageProvider } from '../contexts/LanguageContext';

// #1007: import-worker.js now OMITS `skippedRecords`/`duplicatesFound` (via a
// conditional spread) instead of writing a literal 0 when the worker counted
// neither. ResultsPage.tsx:385/399 gate the "Duplicados"/"Ignorados" report
// tiles on `!== undefined` precisely so an uncounted job renders no tile
// rather than a fabricated zero -- that false branch was unreachable before
// #1007 because the backend always wrote a defined value. Modeled on
// ImportLGPDPage.test.tsx's mocking/render approach (the repo's only other
// page-render RTL test).
vi.mock('../services/api', () => ({
  importService: {
    listJobs: vi.fn(),
    getImportReport: vi.fn(),
  },
  resultService: {
    getAll: vi.fn(),
    download: vi.fn(),
  },
  equipmentService: {
    getAll: vi.fn(),
  },
}));

// AnalysisUpload.jsx is unrelated to this subject -- it lives in the import
// section, entirely separate from the report modal this file tests -- so it is
// stubbed out as ordinary RTL isolation.
// #1019: this stub was ALSO load-bearing until vitest.config.js gained
// @vitejs/plugin-react; before that, rendering any .jsx threw
// `ReferenceError: React is not defined` and took the whole tree down. That is
// fixed at the config now (AnalysisUpload.test.tsx pins it), so the stub is
// isolation only and can be dropped if this file ever wants the real component.
vi.mock('../components/AnalysisUpload.jsx', () => ({
  default: ({ sampleId }: { sampleId: string }) => (
    <div data-testid="analysis-upload" data-sample-id={sampleId} />
  ),
}));

const baseJob = {
  jobID: 'job-1',
  userID: 'u1',
  userName: 'user',
  dataType: 'results',
  fileName: 'analysis.zip',
  filePath: '/tmp/analysis.zip',
  fileSize: 10,
  fileFormat: 'ZIP',
  status: 'completed',
};

function mockJobsList() {
  vi.mocked(importService.listJobs).mockResolvedValue({
    data: { success: true, data: { jobs: [baseJob], total: 1, limit: 20, skip: 0 } },
    status: 200,
  } as any);
}

function mockReport(metricOverrides: Record<string, unknown>) {
  vi.mocked(importService.getImportReport).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...baseJob,
        metrics: {
          totalRecords: 5,
          successfulRecords: 4,
          failedRecords: 1,
          ...metricOverrides,
        },
        errors: [],
      },
    },
    status: 200,
  } as any);
}

async function openReport() {
  const user = userEvent.setup();
  await waitFor(() => {
    expect(screen.getByText('analysis.zip')).toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: /Relatório/ }));
}

function renderPage() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ResultsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('ResultsPage — skipped/duplicates report tiles (#1007)', () => {
  beforeEach(() => {
    // initLanguage() falls back to navigator.language, which is
    // environment-dependent (jsdom's default resolved to en-US here) --
    // pin pt-BR explicitly so the assertions below are deterministic
    // regardless of what runs the suite.
    localStorage.setItem('app_language', 'pt-BR');
    vi.mocked(resultService.getAll).mockResolvedValue({
      data: { success: true, data: [] },
      status: 200,
    } as any);
    vi.mocked(equipmentService.getAll).mockResolvedValue({
      data: { success: true, data: [] },
      status: 200,
    } as any);
    mockJobsList();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('omits both tiles when the report carries neither key (the branch #1007 unblocked)', async () => {
    // No skippedRecords/duplicatesFound keys at all -- the real production
    // shape for a `results`-dataType job now that import-worker.js spreads
    // conditionally instead of writing `|| 0`.
    mockReport({});
    renderPage();
    await openReport();

    // Guard against a vacuous pass: prove the metrics section itself
    // actually rendered before asserting the tiles' absence.
    await waitFor(() => {
      expect(screen.getByText('Total de Registros')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('results-metric-skipped')).toBeNull();
    expect(screen.queryByTestId('results-metric-duplicates')).toBeNull();
  });

  // Gate-guard, NOT coverage of a live path. ResultsPage.tsx:121 filters the
  // job list to `dataType === 'results'`, and
  // `git grep -nE "skipped|duplicates" -- api/backend/src/workers/workers/result-worker.js`
  // returned no matches -- result-worker.js's accumulator/return object never
  // mentions either field in any of its branches. So no job this view can
  // currently display reaches the present branch below. These two tests only
  // pin that the `!== undefined` gate still renders a real value (including
  // a genuine zero) when the fields ARE present, guarding against a future
  // simplification of the gate into a truthiness check -- they are not proof
  // that a live job takes this path today.
  it('renders a genuine measured zero for both tiles when the fields are present', async () => {
    mockReport({ skippedRecords: 0, duplicatesFound: 0 });
    renderPage();
    await openReport();

    await waitFor(() => {
      expect(screen.getByTestId('results-metric-skipped')).toBeInTheDocument();
    });
    expect(screen.getByTestId('results-metric-skipped')).toHaveTextContent('0');
    expect(screen.getByTestId('results-metric-duplicates')).toHaveTextContent('0');
  });

  it('renders a non-zero measured value for both tiles', async () => {
    mockReport({ skippedRecords: 7, duplicatesFound: 3 });
    renderPage();
    await openReport();

    await waitFor(() => {
      expect(screen.getByTestId('results-metric-skipped')).toBeInTheDocument();
    });
    expect(screen.getByTestId('results-metric-skipped')).toHaveTextContent('7');
    expect(screen.getByTestId('results-metric-duplicates')).toHaveTextContent('3');
  });
});

// #1443: the page's own paths beyond the report tiles above -- the jobs-list
// response shapes, each job status's icon, label and buttons, the importJobID
// filter, the results table's equipment/sample cells and download, and the
// report modal's error rows. Every case asserts what a user sees or what the
// page sent, so it fails with the behaviour it names removed.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <ResultsPage />
        <LocationProbe />
      </LanguageProvider>
    </MemoryRouter>
  );
}

function listJobsResolves(data: unknown) {
  vi.mocked(importService.listJobs).mockResolvedValue({ data, status: 200 } as any);
}

function resultsResolve(items: unknown[]) {
  vi.mocked(resultService.getAll).mockResolvedValue({
    data: { success: true, data: items },
    status: 200,
  } as any);
}

describe('ResultsPage — page paths (#1443)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('app_language', 'pt-BR');
    resultsResolve([]);
    vi.mocked(equipmentService.getAll).mockResolvedValue({
      data: { success: true, data: [] },
      status: 200,
    } as any);
    listJobsResolves({ success: true, data: { jobs: [baseJob], total: 1, limit: 20, skip: 0 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('jobs-list response shapes', () => {
    it('reads a bare array body', async () => {
      listJobsResolves([{ ...baseJob, fileName: 'bare.zip' }]);
      renderAt('/results');
      expect(await screen.findByText('bare.zip')).toBeInTheDocument();
    });

    it('reads an array under data', async () => {
      listJobsResolves({ data: [{ ...baseJob, fileName: 'nested.zip' }] });
      renderAt('/results');
      expect(await screen.findByText('nested.zip')).toBeInTheDocument();
    });

    it('reads an array under jobs', async () => {
      listJobsResolves({ jobs: [{ ...baseJob, fileName: 'jobs-key.zip' }] });
      renderAt('/results');
      expect(await screen.findByText('jobs-key.zip')).toBeInTheDocument();
    });

    it('keeps only results-type jobs', async () => {
      listJobsResolves({
        data: {
          jobs: [
            { ...baseJob, jobID: 'r', fileName: 'kept.zip' },
            { ...baseJob, jobID: 's', fileName: 'samples.csv', dataType: 'samples' },
          ],
        },
      });
      renderAt('/results');
      expect(await screen.findByText('kept.zip')).toBeInTheDocument();
      expect(screen.queryByText('samples.csv')).toBeNull();
    });

    it('logs an unrecognised shape with its keys and shows the empty history', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      listJobsResolves({ items: [baseJob] });
      renderAt('/results');
      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Unrecognised /api/import/jobs response shape'),
          ['items']
        );
      });
      expect(screen.getByText('Nenhuma importação realizada ainda')).toBeInTheDocument();
    });

    it('shows the empty history when the body is missing', async () => {
      listJobsResolves(undefined);
      renderAt('/results');
      await waitFor(() => {
        expect(importService.listJobs).toHaveBeenCalledWith({ limit: 20 });
      });
      expect(screen.getByText('Nenhuma importação realizada ainda')).toBeInTheDocument();
      expect(screen.queryByText('analysis.zip')).toBeNull();
    });

    it('logs a failed request and shows the empty history', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('network down');
      vi.mocked(importService.listJobs).mockRejectedValue(failure);
      renderAt('/results');
      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith('Erro ao carregar jobs:', failure);
      });
      expect(screen.getByText('Nenhuma importação realizada ainda')).toBeInTheDocument();
    });

    it('polls the jobs list every 10 s and stops on unmount', async () => {
      const setSpy = vi.spyOn(window, 'setInterval');
      const clearSpy = vi.spyOn(window, 'clearInterval');
      const { unmount } = renderAt('/results');
      await screen.findByText('analysis.zip');
      const pollCall = setSpy.mock.calls.find(([, ms]) => ms === 10000);
      expect(pollCall).toBeDefined();
      const callsBefore = vi.mocked(importService.listJobs).mock.calls.length;
      await act(async () => {
        (pollCall![0] as () => void)();
      });
      expect(vi.mocked(importService.listJobs).mock.calls.length).toBe(callsBefore + 1);
      const pollId = setSpy.mock.results[setSpy.mock.calls.indexOf(pollCall!)].value;
      unmount();
      expect(clearSpy).toHaveBeenCalledWith(pollId);
    });
  });

  describe('job rows by status', () => {
    const statuses = [
      { status: 'completed', label: 'Concluído', icon: '.status-icon.completed', view: true, report: true },
      { status: 'completed_no_data', label: 'Concluído sem dados', icon: '.status-icon.completed_no_data', view: false, report: true },
      { status: 'failed', label: 'Falhou', icon: '.status-icon.failed', view: false, report: true },
      { status: 'processing', label: 'Processando', icon: '.status-icon.processing', view: false, report: false },
      { status: 'pending', label: 'Pendente', icon: '.status-icon.pending', view: false, report: false },
      { status: 'cancelled', label: 'Cancelado', icon: null, view: false, report: false },
    ];

    it.each(statuses)('$status: label, icon and buttons', async ({ status, label, icon, view, report }) => {
      listJobsResolves({ data: { jobs: [{ ...baseJob, status }] } });
      const { container } = renderAt('/results');
      await screen.findByText('analysis.zip');
      const row = container.querySelector('.job-item') as HTMLElement;
      expect(within(row).getByText(label)).toHaveClass('status-badge', status);
      if (icon) {
        expect(row.querySelector(icon)).not.toBeNull();
      } else {
        // The default arm: a bare status-icon with no status class.
        expect(row.querySelector('.status-icon')?.getAttribute('class')).toMatch(/status-icon$/);
      }
      expect(within(row).queryByRole('button', { name: /Ver/ }) !== null).toBe(view);
      expect(within(row).queryByRole('button', { name: /Relatório/ }) !== null).toBe(report);
    });

    it('shows an unknown status as its raw value', async () => {
      listJobsResolves({ data: { jobs: [{ ...baseJob, status: 'archived' }] } });
      const { container } = renderAt('/results');
      await screen.findByText('analysis.zip');
      expect(within(container.querySelector('.job-item') as HTMLElement).getByText('archived')).toBeInTheDocument();
    });

    it('shows the failures count only when it is above zero', async () => {
      listJobsResolves({
        data: {
          jobs: [
            { ...baseJob, jobID: 'a', fileName: 'a.zip', totalRecords: 5, successCount: 3, errorCount: 2 },
            { ...baseJob, jobID: 'b', fileName: 'b.zip', totalRecords: 4, successCount: 4, errorCount: 0 },
          ],
        },
      });
      const { container } = renderAt('/results');
      await screen.findByText('a.zip');
      const [first, second] = Array.from(container.querySelectorAll('.job-metrics')) as HTMLElement[];
      expect(first).toHaveTextContent('Total: 5');
      expect(first).toHaveTextContent('Sucesso: 3');
      expect(first).toHaveTextContent('Falhas: 2');
      expect(second).toHaveTextContent('Total: 4');
      expect(second).not.toHaveTextContent('Falhas');
    });
  });

  describe('importJobID filter', () => {
    it('Ver filters the results by the job and Limpar Filtro clears it', async () => {
      const user = userEvent.setup();
      renderAt('/results?sampleId=S-1');
      await screen.findByText('analysis.zip');
      expect(screen.queryByRole('button', { name: /Limpar Filtro/ })).toBeNull();
      expect(screen.getByText('Arquivos de análises laboratoriais')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Ver/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('importJobID=job-1');
      expect(screen.getByTestId('location')).toHaveTextContent('sampleId=S-1');
      expect(screen.getByText('Arquivos de análise da importação job-1')).toBeInTheDocument();
      await waitFor(() => {
        expect(resultService.getAll).toHaveBeenLastCalledWith('job-1');
      });

      await user.click(screen.getByRole('button', { name: /Limpar Filtro/ }));
      expect(screen.getByTestId('location')).not.toHaveTextContent('importJobID');
      expect(screen.getByTestId('location')).toHaveTextContent('sampleId=S-1');
      expect(screen.getByText('Arquivos de análises laboratoriais')).toBeInTheDocument();
    });

    it('passes sampleId, else sampleID, to the upload panel', async () => {
      const first = renderAt('/results?sampleId=S-1');
      expect(screen.getByTestId('analysis-upload')).toHaveAttribute('data-sample-id', 'S-1');
      first.unmount();
      renderAt('/results?sampleID=S-2');
      expect(screen.getByTestId('analysis-upload')).toHaveAttribute('data-sample-id', 'S-2');
      await screen.findByText('analysis.zip');
    });
  });

  describe('results table', () => {
    it('names the equipment from the list, by fallback id, by name, or as not linked', async () => {
      vi.mocked(equipmentService.getAll).mockResolvedValue({
        data: { success: true, data: [{ equipmentID: 1, equipmentDescription: 'Sequenciador X' }] },
        status: 200,
      } as any);
      resultsResolve([
        { _id: 'm1', resultID: 11, fileType: 'FASTQ', description: 'd1', specimenId: 'SP-1', equipmentID: 1 },
        { _id: 'm2', resultID: 12, fileType: 'VCF', description: 'd2', specimenId: 'SP-2', equipmentID: 9 },
        { _id: 'm3', resultID: 13, fileType: 'BAM', description: 'd3', specimenId: 'SP-3', equipmentName: 'Leitor Y' },
        { _id: 'm4', resultID: 14, fileType: 'CSV', description: 'd4', specimenId: 'SP-4' },
      ]);
      renderAt('/results');
      await screen.findByText('d4');
      const body = screen.getAllByRole('row').filter((r) => within(r).queryByText(/^d[1-4]$/));
      expect(body).toHaveLength(4);
      await waitFor(() => {
        expect(body[0]).toHaveTextContent('Sequenciador X');
      });
      expect(body[0]).toHaveTextContent('11');
      expect(body[0]).toHaveTextContent('Amostra #SP-1');
      expect(body[1]).toHaveTextContent('Equipamento #9');
      expect(body[2]).toHaveTextContent('Leitor Y');
      expect(body[3]).toHaveTextContent('Não vinculado');
    });

    it('shows the mongo id when resultID is absent and downloads by it', async () => {
      const user = userEvent.setup();
      vi.mocked(resultService.download).mockResolvedValue(undefined as any);
      resultsResolve([{ _id: 'mongo-7', fileType: 'FASTQ', description: 'only-id', specimenId: 'SP-7' }]);
      renderAt('/results');
      const row = (await screen.findByText('only-id')).closest('tr') as HTMLElement;
      expect(row).toHaveTextContent('mongo-7');
      await user.click(within(row).getByRole('button', { name: /Download/ }));
      expect(resultService.download).toHaveBeenCalledWith('mongo-7');
    });

    it('downloads by _id before resultID when a row has both', async () => {
      const user = userEvent.setup();
      vi.mocked(resultService.download).mockResolvedValue(undefined as any);
      resultsResolve([{ _id: 'mongo-7', resultID: 77, fileType: 'FASTQ', description: 'both-ids', specimenId: 'SP-7' }]);
      renderAt('/results');
      const row = (await screen.findByText('both-ids')).closest('tr') as HTMLElement;
      expect(row).toHaveTextContent('77');
      expect(row).not.toHaveTextContent('mongo-7');
      await user.click(within(row).getByRole('button', { name: /Download/ }));
      expect(resultService.download).toHaveBeenCalledWith('mongo-7');
      expect(resultService.download).not.toHaveBeenCalledWith(77);
    });

    it('alerts the download error message, or the unknown-error text', async () => {
      const user = userEvent.setup();
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      resultsResolve([{ resultID: 21, fileType: 'FASTQ', description: 'dl', specimenId: 'SP-9' }]);
      vi.mocked(resultService.download).mockRejectedValueOnce(new Error('gone'));
      vi.mocked(resultService.download).mockRejectedValueOnce({});
      renderAt('/results');
      const row = (await screen.findByText('dl')).closest('tr') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: /Download/ }));
      expect(resultService.download).toHaveBeenCalledWith(21);
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Erro ao fazer download: gone');
      });
      await user.click(within(row).getByRole('button', { name: /Download/ }));
      await waitFor(() => {
        expect(alertSpy).toHaveBeenLastCalledWith('Erro ao fazer download: Erro desconhecido');
      });
    });

    it('shows the loading text, then the load error', async () => {
      let reject!: (e: Error) => void;
      vi.mocked(resultService.getAll).mockReturnValue(
        new Promise((_, r) => {
          reject = r;
        }) as any
      );
      renderAt('/results');
      expect(screen.getByText('Carregando...')).toBeInTheDocument();
      await act(async () => {
        reject(new Error('backend down'));
      });
      expect(screen.queryByText('Carregando...')).toBeNull();
      expect(screen.getByText('Erro: backend down')).toBeInTheDocument();
    });
  });

  describe('report modal', () => {
    function reportResolves(job: Record<string, unknown>) {
      vi.mocked(importService.getImportReport).mockResolvedValue({
        data: { success: true, data: { ...baseJob, ...job } },
        status: 200,
      } as any);
    }

    it('shows the load error when the report request fails', async () => {
      vi.mocked(importService.getImportReport).mockRejectedValue(new Error('500'));
      renderAt('/results');
      await openReport();
      expect(await screen.findByText('Erro ao carregar relatório')).toBeInTheDocument();
      expect(importService.getImportReport).toHaveBeenCalledWith('job-1');
      expect(screen.queryByText('Relatório de Importação')).toBeNull();
    });

    it('lists row, code, file and message for each error, ten at most', async () => {
      const errors = [
        { row: 0, code: 'E1', fileName: 'a.fastq', error: 'first' },
        { code: 'E2', filePath: '/up/b.vcf', error: 'second' },
        { error: 'third' },
        ...Array.from({ length: 9 }, (_, i) => ({ row: i + 10, error: `bulk-${i}` })),
      ];
      reportResolves({ errors, metrics: undefined });
      renderAt('/results');
      await openReport();
      const items = await screen.findAllByText(
        (_, el) => el?.classList.contains('error-item') ?? false
      );
      expect(items).toHaveLength(10);
      expect(items[0]).toHaveTextContent('Linha 0: E1: a.fastq: first');
      expect(items[1]).toHaveTextContent('E2: /up/b.vcf: second');
      expect(items[1]).not.toHaveTextContent('Linha');
      expect(items[2].textContent).toBe('third');
      expect(screen.getByText('... e mais 2 erros')).toBeInTheDocument();
      expect(screen.queryByText('Total de Registros')).toBeNull();
    });

    it('omits the more-line at exactly ten and shows 1.50s', async () => {
      reportResolves({
        errors: Array.from({ length: 10 }, (_, i) => ({ error: `e${i}` })),
        metrics: { totalRecords: 1, successfulRecords: 1, failedRecords: 0, processingTime: 1.5 },
      });
      renderAt('/results');
      await openReport();
      expect(await screen.findByText('e9')).toBeInTheDocument();
      expect(screen.queryByText(/e mais/)).toBeNull();
      expect(screen.getByText('1.50s')).toBeInTheDocument();
    });

    it('renders no stray 0 and no time tile when processingTime is 0', async () => {
      // The worker writes `processingTime: result.processingTime || 0`, so 0
      // means "not measured"; a bare `0 &&` gate rendered the literal 0 as a
      // text node inside the metrics grid.
      reportResolves({
        metrics: { totalRecords: 2, successfulRecords: 1, failedRecords: 1, processingTime: 0 },
        errors: [],
      });
      const { baseElement } = renderAt('/results');
      await openReport();
      await screen.findByText('Total de Registros');
      const grid = baseElement.querySelector('.metrics-grid') as HTMLElement;
      const strayText = Array.from(grid.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE);
      expect(strayText.map((n) => n.textContent)).toEqual([]);
      expect(screen.queryByText('Tempo de Processamento')).toBeNull();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      reportResolves({ metrics: { totalRecords: 1, successfulRecords: 1, failedRecords: 0 }, errors: [] });
      renderAt('/results');
      await openReport();
      expect(await screen.findByText('Relatório de Importação')).toBeInTheDocument();
      expect(screen.queryByText('Erros')).toBeNull();
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByText('Relatório de Importação')).toBeNull();
      });
    });
  });
});
