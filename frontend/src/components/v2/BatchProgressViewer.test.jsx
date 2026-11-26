import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import BatchProgressViewer from '@/components/v2/BatchProgressViewer';
import { getBatchImportStatus } from '@/api/import.service';

// #1443: the batch-import progress card. The status endpoint is replaced, and
// fake timers drive its 3 s polling loop, so each test reads what the card
// shows for one sequence of status responses.
vi.mock('@/api/import.service', () => ({
  getBatchImportStatus: vi.fn(),
}));

const POLL_MS = 3000;

// Lets the pending status promise settle and React commit its state.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const downloadButton = () => screen.getByRole('button', { name: /Baixar log de erros/ });
const progressFill = () => screen.getByLabelText('Progresso do lote').firstChild;
const finalSummaryValue = (label) =>
  within(screen.getByText('Resumo final da importação').parentElement).getByText(label).nextSibling;

describe('BatchProgressViewer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the pending card with a loading line before the first status arrives', async () => {
    const pending = deferred();
    getBatchImportStatus.mockReturnValueOnce(pending.promise);

    render(<BatchProgressViewer jobId="job-1" fileName="lote.csv" onReset={vi.fn()} />);

    expect(getBatchImportStatus).toHaveBeenCalledWith('job-1');
    expect(screen.getByRole('heading', { name: 'lote.csv' })).toBeInTheDocument();
    expect(screen.getByText('Job: job-1')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('Buscando o estado inicial do job...')).toBeInTheDocument();
    expect(screen.getByText('Última atualização: Aguardando atualização')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(downloadButton()).toBeDisabled();
    expect(progressFill().style.width).toBe('0%');
  });

  it('polls a processing job every 3 s until it completes, then stops', async () => {
    getBatchImportStatus
      .mockResolvedValueOnce({
        data: {
          data: {
            jobId: 'job-1',
            fileName: 'pacientes.csv',
            status: 'processing',
            totalRows: 10,
            processedRows: 4,
            errors: [{ row: 2, message: 'CPF inválido' }],
            updatedAt: '2026-11-05T12:00:00Z',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            jobId: 'job-1',
            fileName: 'pacientes.csv',
            status: 'COMPLETED',
            totalRows: 10,
            processedRows: 10,
            errors: [],
            rawData: { summary: { validRows: 8, invalidRows: 2 } },
          },
        },
      });

    render(<BatchProgressViewer jobId="job-1" fileName="lote.csv" onReset={vi.fn()} />);
    await flush();

    expect(screen.getByRole('heading', { name: 'pacientes.csv' })).toBeInTheDocument();
    expect(screen.getByText('Processando • 4/10 registros')).toBeInTheDocument();
    expect(progressFill().style.width).toBe('40%');
    expect(screen.queryByText('Buscando o estado inicial do job...')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText(/Aguardando atualização/)).toBeNull();
    // Válidos falls back to processed minus errors, Inválidos to the error count.
    const validCard = screen.getByText('Válidos').closest('div').parentElement;
    expect(validCard).toHaveTextContent('3');
    const invalidCard = screen.getByText('Inválidos').closest('div').parentElement;
    expect(invalidCard).toHaveTextContent('1');
    expect(downloadButton()).toBeDisabled();
    expect(screen.queryByText('Resumo final da importação')).toBeNull();

    await advancePoll();

    expect(getBatchImportStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Resumo final da importação')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    // The final summary takes both counts from rawData.summary, not the empty error list.
    expect(finalSummaryValue('Válidos')).toHaveTextContent(/^8$/);
    expect(finalSummaryValue('Inválidos')).toHaveTextContent(/^2$/);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(downloadButton()).toBeEnabled();
    expect(progressFill().style.width).toBe('100%');

    await advancePoll();
    await advancePoll();
    expect(getBatchImportStatus).toHaveBeenCalledTimes(2);
  });

  it('shows each polling error, keeps retrying, and clears the alert on the next good status', async () => {
    getBatchImportStatus
      .mockRejectedValueOnce({ response: { data: { message: 'Lote não encontrado' } } })
      .mockRejectedValueOnce({ response: { data: { error: 'Serviço indisponível' } } })
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { jobId: 'job-9', status: 'PROCESSING', totalRows: 4, processedRows: 1 } })
      .mockRejectedValueOnce({})
      .mockResolvedValueOnce({ data: { jobId: 'job-9', status: 'FAILED', totalRows: 0, processedRows: 0 } });

    render(<BatchProgressViewer jobId="job-9" onReset={vi.fn()} />);
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('O status ainda não pôde ser atualizado');
    expect(screen.getByRole('alert')).toHaveTextContent('Lote não encontrado');
    expect(screen.queryByText('Buscando o estado inicial do job...')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Importação em lote' })).toBeInTheDocument();

    await advancePoll();
    expect(screen.getByRole('alert')).toHaveTextContent('Serviço indisponível');

    await advancePoll();
    expect(screen.getByRole('alert')).toHaveTextContent('Network Error');

    // A good status while the job still runs clears the alert by itself.
    await advancePoll();
    expect(screen.getByText('Processando • 1/4 registros')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    await advancePoll();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível atualizar o status do lote');

    await advancePoll();
    expect(getBatchImportStatus).toHaveBeenCalledTimes(6);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('Falhou • 0/0 registros')).toBeInTheDocument();
    expect(progressFill().style.width).toBe('0%');
  });

  it('reads a bare response and a lower-case rawStatus, and treats an unknown status as pending', async () => {
    getBatchImportStatus
      .mockResolvedValueOnce({ jobId: 'job-3', status: 'queued', totalRows: 5, processedRows: 9 })
      .mockResolvedValueOnce({ jobId: 'job-3', rawStatus: 'completed', totalRows: 5, processedRows: 5 });

    render(<BatchProgressViewer jobId="job-3" fileName="x.csv" onReset={vi.fn()} />);
    await flush();

    expect(screen.getByText('Pendente • 9/5 registros')).toBeInTheDocument();
    expect(progressFill().style.width).toBe('100%');

    await advancePoll();
    expect(screen.getByText('Concluído')).toBeInTheDocument();
  });

  it('calls onReset from Nova importação', async () => {
    getBatchImportStatus.mockReturnValueOnce(deferred().promise);
    const onReset = vi.fn();

    render(<BatchProgressViewer jobId="job-1" fileName="lote.csv" onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: /Nova importação/ }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('downloads the final snapshot as a JSON error log once the job is final', async () => {
    getBatchImportStatus.mockResolvedValueOnce({
      data: {
        data: {
          jobId: 'job-7',
          status: 'FAILED',
          totalRows: 3,
          processedRows: 3,
          errors: [{ row: 1, message: 'Data inválida' }],
          rawData: { source: 'csv' },
        },
      },
    });
    const createObjectURL = vi.fn(() => 'blob:log');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    let clicked;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked = { href: this.getAttribute('href'), download: this.download, attached: document.body.contains(this) };
    });

    render(<BatchProgressViewer jobId="job-7" onReset={vi.fn()} />);
    await flush();

    fireEvent.click(downloadButton());

    expect(clicked).toEqual({ href: 'blob:log', download: 'batch-import-job-7-error-log.json', attached: true });
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:log');
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/json;charset=utf-8');
    // jsdom's Blob has no text(); FileReader reads it on real timers.
    vi.useRealTimers();
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    const log = JSON.parse(text);
    expect(log).toMatchObject({
      jobId: 'job-7',
      fileName: 'batch-import',
      status: 'FAILED',
      totalRows: 3,
      processedRows: 3,
      validRows: 2,
      invalidRows: 1,
      errors: [{ row: 1, message: 'Data inválida' }],
      rawData: { source: 'csv' },
    });
    expect(typeof log.generatedAt).toBe('string');
  });

  it('ignores a status or an error that arrives after unmount, and polls no more', async () => {
    const first = deferred();
    getBatchImportStatus.mockReturnValueOnce(first.promise);
    const { unmount } = render(<BatchProgressViewer jobId="job-1" onReset={vi.fn()} />);
    unmount();
    first.resolve({ jobId: 'job-1', status: 'PROCESSING', totalRows: 2, processedRows: 1 });
    await flush();

    const second = deferred();
    getBatchImportStatus.mockReturnValueOnce(second.promise);
    const view = render(<BatchProgressViewer jobId="job-2" onReset={vi.fn()} />);
    view.unmount();
    second.reject(new Error('late'));
    await flush();

    getBatchImportStatus.mockResolvedValueOnce({ jobId: 'job-4', status: 'PROCESSING', totalRows: 2, processedRows: 1 });
    const third = render(<BatchProgressViewer jobId="job-4" onReset={vi.fn()} />);
    await flush();
    third.unmount();

    await advancePoll();
    await advancePoll();
    expect(getBatchImportStatus).toHaveBeenCalledTimes(3);
  });
});
