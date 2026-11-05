import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// The LGPD import quarantine page (/import/quarantine, #794 item 2, RNF011
// AC#4) over a mocked importLGPDService: the batch listing, one batch's
// rejected rows (#806's FAILED batch, #915's origin column, #792's retained
// file), and #1352's correct-and-resubmit form.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  listQuarantineBatches: vi.fn(),
  getQuarantineBatch: vi.fn(),
  resubmitQuarantinedRow: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  importLGPDService: {
    listQuarantineBatches: h.listQuarantineBatches,
    getQuarantineBatch: h.getQuarantineBatch,
    resubmitQuarantinedRow: h.resubmitQuarantinedRow,
  },
}));

import ImportQuarantinePage from '@/views/ImportQuarantinePage';

const CREATED = '2026-03-04T10:20:30.000Z';

const SAMPLE_BATCH = {
  _id: 'b1',
  type: 'LGPD_SAMPLE_CSV',
  fileName: 'amostras.csv',
  status: 'QUARANTINED',
  counts: { total: 10, success: 7, errors: 3 },
  createdAt: CREATED,
  sourceFile: { storageUri: 's3://bucket/amostras.csv' },
};

const PATIENT_BATCH = {
  _id: 'b2',
  type: 'LGPD_PATIENT_CSV',
  fileName: 'participantes.csv',
  status: 'QUARANTINED',
  counts: { total: 4, success: 4, errors: 0 },
  createdAt: null,
  sourceFile: null,
};

const ERROR_RECORD = {
  _id: 'r1',
  rowNumber: 3,
  status: 'ERROR',
  errors: ['CPF inválido', { field: 'volume', message: 'deve ser positivo' }],
  row: { codigo: 'A-1', volume: '-2', vazio: '' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderAt(path = '/import/quarantine') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ImportQuarantinePage />
      <LocationProbe />
    </MemoryRouter>
  );
}

function batchOk(batch: unknown, records: unknown[]) {
  return { data: { batch, records } };
}

function rowOf(fileName: string) {
  return screen.getByText(fileName).closest('tr') as HTMLElement;
}

function cellsOf(fileName: string) {
  return within(rowOf(fileName)).getAllByRole('cell').map((cell) => cell.textContent?.trim());
}

beforeEach(() => {
  h.listQuarantineBatches.mockResolvedValue({ data: { data: [SAMPLE_BATCH, PATIENT_BATCH] } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ImportQuarantinePage: batch listing', () => {
  it('shows the loading text until the listing answers, asking for 50 batches', async () => {
    const list = deferred<unknown>();
    h.listQuarantineBatches.mockReturnValue(list.promise);
    renderAt();
    expect(screen.getByText('Carregando lotes...')).toBeInTheDocument();
    expect(h.listQuarantineBatches).toHaveBeenCalledWith({ limit: 50 });
    await act(async () => list.resolve({ data: { data: [] } }));
    expect(screen.queryByText('Carregando lotes...')).not.toBeInTheDocument();
    expect(
      screen.getByText('Nenhum lote em quarentena. Importações sem linhas rejeitadas não geram lote.')
    ).toBeInTheDocument();
  });

  it('reads an absent data envelope as an empty listing', async () => {
    h.listQuarantineBatches.mockResolvedValue({});
    renderAt();
    expect(
      await screen.findByText('Nenhum lote em quarentena. Importações sem linhas rejeitadas não geram lote.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders each batch as a row: file, origin, date, counts and retention', async () => {
    renderAt();
    await screen.findByText('amostras.csv');
    expect(cellsOf('amostras.csv')).toEqual([
      'amostras.csv',
      'Amostras',
      new Date(CREATED).toLocaleString('pt-BR'),
      '10',
      '7',
      '3',
      'retido',
      'Ver linhas',
    ]);
    expect(cellsOf('participantes.csv')).toEqual([
      'participantes.csv',
      'Participantes',
      '--',
      '4',
      '4',
      '0',
      'não retido',
      'Ver linhas',
    ]);
    expect(screen.queryByRole('heading', { name: /Linhas rejeitadas/ })).not.toBeInTheDocument();
    expect(h.getQuarantineBatch).not.toHaveBeenCalled();
  });

  it('shows the listing error, then clears it when Atualizar succeeds', async () => {
    h.listQuarantineBatches.mockRejectedValueOnce(new Error('500'));
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os lotes em quarentena.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByText('amostras.csv');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(h.listQuarantineBatches).toHaveBeenCalledTimes(2);
  });

  it('Voltar navigates one step back', async () => {
    renderAt();
    await screen.findByText('amostras.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });
});

describe('ImportQuarantinePage: one batch', () => {
  it('Ver linhas puts the batch in the URL and loads its rows; Fechar clears both', async () => {
    h.getQuarantineBatch.mockResolvedValue(batchOk(PATIENT_BATCH, []));
    renderAt();
    await screen.findByText('participantes.csv');
    fireEvent.click(within(rowOf('participantes.csv')).getByRole('button', { name: 'Ver linhas' }));
    expect(
      await screen.findByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?batchId=b2');
    expect(h.getQuarantineBatch).toHaveBeenCalledWith('b2');
    expect(screen.getByText('Nenhuma linha rejeitada neste lote.')).toBeInTheDocument();

    fireEvent.click(within(rowOf('participantes.csv')).getByRole('button', { name: 'Fechar' }));
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: /Linhas rejeitadas/ })).not.toBeInTheDocument();
    expect(within(rowOf('participantes.csv')).getByRole('button', { name: 'Ver linhas' })).toBeInTheDocument();
    expect(h.getQuarantineBatch).toHaveBeenCalledTimes(1);
  });

  it('shows the loading text while the batch is read', async () => {
    const read = deferred<unknown>();
    h.getQuarantineBatch.mockReturnValue(read.promise);
    renderAt('/import/quarantine?batchId=b1');
    expect(screen.getByText('Carregando linhas...')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeInTheDocument();
    await act(async () => read.resolve(batchOk(SAMPLE_BATCH, [])));
    expect(screen.queryByText('Carregando linhas...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas — amostras.csv' })).toBeInTheDocument();
  });

  it('reads an absent batch envelope as no batch and no rows', async () => {
    h.getQuarantineBatch.mockResolvedValue({});
    renderAt('/import/quarantine?batchId=b1');
    expect(await screen.findByText('Nenhuma linha rejeitada neste lote.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeInTheDocument();
  });

  it('shows the not-found error when the batch read fails', async () => {
    h.getQuarantineBatch.mockRejectedValue(new Error('404'));
    renderAt('/import/quarantine?batchId=missing');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lote de quarentena não encontrado ou inacessível.'
    );
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma linha rejeitada neste lote.')).toBeInTheDocument();
  });

  it('says a FAILED batch never got past its headers, with its error', async () => {
    h.getQuarantineBatch.mockResolvedValue(
      batchOk({ ...SAMPLE_BATCH, status: 'FAILED', error: 'cabeçalho ausente: codigo' }, [])
    );
    renderAt('/import/quarantine?batchId=b1');
    expect(
      await screen.findByText('Esta importação falhou antes de processar qualquer linha: cabeçalho ausente: codigo')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma linha rejeitada neste lote.')).not.toBeInTheDocument();
  });

  it('ends the FAILED sentence with a full stop when the batch carries no error', async () => {
    h.getQuarantineBatch.mockResolvedValue(batchOk({ ...SAMPLE_BATCH, status: 'FAILED', error: null }, []));
    renderAt('/import/quarantine?batchId=b1');
    expect(
      await screen.findByText('Esta importação falhou antes de processar qualquer linha.')
    ).toBeInTheDocument();
  });

  it('renders each rejected row with its errors, status and non-empty retained fields', async () => {
    h.getQuarantineBatch.mockResolvedValue(
      batchOk(PATIENT_BATCH, [
        ERROR_RECORD,
        { _id: 'r2', rowNumber: 5, status: 'RESUBMITTED', errors: [], row: null },
        { rowNumber: undefined, status: 'ERROR', validationErrors: 'not-an-array', row: { nome: 'Ana' } },
      ])
    );
    renderAt('/import/quarantine?batchId=b2');

    const first = (await screen.findByText('Linha 3')).parentElement as HTMLElement;
    expect(within(first).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'CPF inválido',
      'volume: deve ser positivo',
    ]);
    expect(within(first).getAllByRole('row').map((row) => row.textContent)).toEqual(['codigoA-1', 'volume-2']);
    expect(within(first).queryByText('ERROR')).not.toBeInTheDocument();

    const second = screen.getByText('Linha 5').parentElement as HTMLElement;
    expect(within(second).getByText('RESUBMITTED')).toBeInTheDocument();
    expect(within(second).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Rejeitada sem mensagem registrada.',
    ]);
    expect(within(second).getByText('Conteúdo original não retido para esta linha.')).toBeInTheDocument();

    const third = screen.getByText('Linha --').parentElement as HTMLElement;
    expect(within(third).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Rejeitada sem mensagem registrada.',
    ]);
    expect(within(third).getAllByRole('row').map((row) => row.textContent)).toEqual(['nomeAna']);

    // A participant batch's rows are never resubmittable (#1352).
    expect(screen.queryByRole('button', { name: 'Corrigir e reenviar' })).not.toBeInTheDocument();
  });

  it('drops a batch answer that arrives after the selection moved on', async () => {
    const stale = deferred<unknown>();
    h.getQuarantineBatch.mockImplementation((id: string) =>
      id === 'b1' ? stale.promise : Promise.resolve(batchOk(PATIENT_BATCH, []))
    );
    renderAt('/import/quarantine?batchId=b1');
    await screen.findByText('participantes.csv');
    fireEvent.click(within(rowOf('participantes.csv')).getByRole('button', { name: 'Ver linhas' }));
    expect(
      await screen.findByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })
    ).toBeInTheDocument();

    await act(async () => stale.resolve(batchOk(SAMPLE_BATCH, [ERROR_RECORD])));
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })).toBeInTheDocument();
    expect(screen.queryByText('Linha 3')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma linha rejeitada neste lote.')).toBeInTheDocument();
  });

  it('empties the previous batch and its rows when the next batch read fails', async () => {
    h.getQuarantineBatch.mockImplementation((id: string) =>
      id === 'b2' ? Promise.resolve(batchOk(PATIENT_BATCH, [ERROR_RECORD])) : Promise.reject(new Error('404'))
    );
    renderAt('/import/quarantine?batchId=b2');
    expect(await screen.findByText('Linha 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })).toBeInTheDocument();

    fireEvent.click(within(rowOf('amostras.csv')).getByRole('button', { name: 'Ver linhas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lote de quarentena não encontrado ou inacessível.');
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas' })).toBeInTheDocument();
    expect(screen.queryByText('Linha 3')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma linha rejeitada neste lote.')).toBeInTheDocument();
  });

  it('clears an earlier error as soon as another batch starts loading', async () => {
    const next = deferred<unknown>();
    h.getQuarantineBatch.mockImplementation((id: string) =>
      id === 'b1' ? next.promise : Promise.reject(new Error('404'))
    );
    renderAt('/import/quarantine?batchId=missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lote de quarentena não encontrado ou inacessível.');

    fireEvent.click(within(rowOf('amostras.csv')).getByRole('button', { name: 'Ver linhas' }));
    expect(screen.getByText('Carregando linhas...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => next.resolve(batchOk(SAMPLE_BATCH, [])));
    expect(screen.queryByText('Carregando linhas...')).not.toBeInTheDocument();
  });

  it('keeps the loading text for the current batch when a dropped read settles', async () => {
    const stale = deferred<unknown>();
    const current = deferred<unknown>();
    h.getQuarantineBatch.mockImplementation((id: string) => (id === 'b1' ? stale.promise : current.promise));
    renderAt('/import/quarantine?batchId=b1');
    await screen.findByText('participantes.csv');
    fireEvent.click(within(rowOf('participantes.csv')).getByRole('button', { name: 'Ver linhas' }));
    expect(screen.getByText('Carregando linhas...')).toBeInTheDocument();

    await act(async () => stale.resolve(batchOk(SAMPLE_BATCH, [])));
    expect(screen.getByText('Carregando linhas...')).toBeInTheDocument();

    await act(async () => current.resolve(batchOk(PATIENT_BATCH, [])));
    expect(screen.queryByText('Carregando linhas...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })).toBeInTheDocument();
  });

  it('drops a batch failure that arrives after the selection moved on', async () => {
    const stale = deferred<unknown>();
    h.getQuarantineBatch.mockImplementation((id: string) =>
      id === 'b1' ? stale.promise : Promise.resolve(batchOk(PATIENT_BATCH, []))
    );
    renderAt('/import/quarantine?batchId=b1');
    await screen.findByText('participantes.csv');
    fireEvent.click(within(rowOf('participantes.csv')).getByRole('button', { name: 'Ver linhas' }));
    await screen.findByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' });

    await act(async () => stale.reject(new Error('late 404')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linhas rejeitadas — participantes.csv' })).toBeInTheDocument();
  });
});

describe('ImportQuarantinePage: correct and resubmit (#1352)', () => {
  async function openForm() {
    renderAt('/import/quarantine?batchId=b1');
    fireEvent.click(await screen.findByRole('button', { name: 'Corrigir e reenviar' }));
    return screen.getByRole('form', { name: 'Corrigir linha 3' });
  }

  beforeEach(() => {
    h.getQuarantineBatch.mockResolvedValue(batchOk(SAMPLE_BATCH, [ERROR_RECORD]));
  });

  it('opens a form holding every retained column, empty ones included, and Cancelar closes it', async () => {
    const form = await openForm();
    expect(within(form).getByLabelText('codigo')).toHaveValue('A-1');
    expect(within(form).getByLabelText('volume')).toHaveValue('-2');
    expect(within(form).getByLabelText('vazio')).toHaveValue('');
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corrigir e reenviar' })).toBeInTheDocument();
  });

  it('sends the edited row, then reloads the batch and the listing', async () => {
    const form = await openForm();
    h.resubmitQuarantinedRow.mockResolvedValue({ data: { ok: true } });
    h.getQuarantineBatch.mockResolvedValue(
      batchOk(SAMPLE_BATCH, [{ ...ERROR_RECORD, status: 'RESUBMITTED', errors: [] }])
    );
    fireEvent.change(within(form).getByLabelText('volume'), { target: { value: '2' } });
    fireEvent.submit(form);

    expect(await screen.findByText('RESUBMITTED')).toBeInTheDocument();
    expect(h.resubmitQuarantinedRow).toHaveBeenCalledWith('b1', 'r1', { codigo: 'A-1', volume: '2', vazio: '' });
    expect(h.getQuarantineBatch).toHaveBeenCalledTimes(2);
    expect(h.getQuarantineBatch).toHaveBeenLastCalledWith('b1');
    expect(h.listQuarantineBatches).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corrigir e reenviar' })).not.toBeInTheDocument();
  });

  it('disables both buttons while sending and shows the new errors a 422 answers with', async () => {
    const form = await openForm();
    const send = deferred<unknown>();
    h.resubmitQuarantinedRow.mockReturnValue(send.promise);
    fireEvent.submit(form);

    const sending = within(form).getByRole('button', { name: 'Reenviando...' });
    expect(sending).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    await act(async () =>
      send.reject({ response: { status: 422, data: { errors: ['volume ainda inválido', { message: 'sem campo' }] } } })
    );
    const alert = within(form).getByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'volume ainda inválido',
      'sem campo',
    ]);
    expect(within(form).getByRole('button', { name: 'Reenviar linha' })).toBeEnabled();
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(h.getQuarantineBatch).toHaveBeenCalledTimes(1);
    expect(h.listQuarantineBatches).toHaveBeenCalledTimes(1);
  });

  it('clears the previous errors on a new attempt and shows a single error message', async () => {
    const form = await openForm();
    h.resubmitQuarantinedRow.mockRejectedValueOnce({ response: { data: { errors: ['primeiro erro'] } } });
    fireEvent.submit(form);
    expect(await within(form).findByText('primeiro erro')).toBeInTheDocument();

    const second = deferred<unknown>();
    h.resubmitQuarantinedRow.mockReturnValueOnce(second.promise);
    fireEvent.submit(form);
    expect(within(form).getByRole('button', { name: 'Reenviando...' })).toBeDisabled();
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(form).queryByText('primeiro erro')).not.toBeInTheDocument();

    await act(async () => second.reject({ response: { data: { error: 'Lote não é de amostras' } } }));
    expect(within(form).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lote não é de amostras']);
  });

  it('falls back to the generic message when the failure carries no response', async () => {
    const form = await openForm();
    h.resubmitQuarantinedRow.mockRejectedValue(new Error('Network Error'));
    fireEvent.submit(form);
    const alert = await within(form).findByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Não foi possível reenviar a linha.',
    ]);
  });
});
