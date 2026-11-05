import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// #1443: the temperature-incident page (Facility Management's incidents tab):
// its status filter, list order, pagination, detail panel and the four
// actions each status offers, read through what the user sees and the
// requests each action sends.
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user-1' } }),
}));
vi.mock('../api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => h.get(...args),
    put: (...args: unknown[]) => h.put(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));

import IncidentManagement from './IncidentManagementPage';

function incident(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    sensorKey: `key-${id}`,
    sensorName: `Sensor ${id}`,
    openedAt: '2026-10-01T10:00:00.000Z',
    closedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    currentTemperature: -60.25,
    maxTemperature: -55.04,
    minTemperature: -80.5,
    samplesOutOfRange: 7,
    status: 'open',
    notes: [],
    escalationLevel: 0,
    lastEscalatedAt: null,
    ...extra,
  };
}

function served(incidents: unknown[]) {
  h.get.mockResolvedValue({ data: { incidents } });
}

function lastParams() {
  const call = h.get.mock.calls[h.get.mock.calls.length - 1];
  return (call[1] as { params: URLSearchParams }).params.toString();
}

async function openDetails(id: string) {
  fireEvent.click(await screen.findByTestId(`incident-details-button-${id}`));
  return screen.findByText('Detalhes do Incidente');
}

let alertSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  served([]);
  h.put.mockResolvedValue({ data: {} });
  h.post.mockResolvedValue({ data: {} });
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('IncidentManagementPage: list', () => {
  it('loads open incidents first and shows the per-status empty state', async () => {
    render(<IncidentManagement />);
    expect(await screen.findByText('Nenhum incidente aberto')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/incidents', expect.objectContaining({ suppressErrorToast: true }));
    expect(lastParams()).toBe('status=open&limit=100');
    expect(document.querySelector('.history-pagination')).toBeNull();
  });

  it('drops the status param for "all" and keeps a missing incidents field as an empty list', async () => {
    render(<IncidentManagement />);
    await screen.findByText('Nenhum incidente aberto');
    h.get.mockResolvedValue({ data: {} });
    fireEvent.change(screen.getByTestId('incidents-status-filter'), { target: { value: 'all' } });
    expect(await screen.findByText('Nenhum incidente')).toBeInTheDocument();
    expect(lastParams()).toBe('limit=100');
  });

  it('lists incidents newest first with status label, temperature and occurrences', async () => {
    served([
      incident('old', { openedAt: '2026-09-01T10:00:00.000Z', status: 'acknowledged' }),
      incident('new', { openedAt: '2026-10-05T10:00:00.000Z', status: 'escalated' }),
      incident('odd', { openedAt: '2026-08-01T10:00:00.000Z', status: 'mystery' }),
    ]);
    render(<IncidentManagement />);
    await screen.findByTestId('incident-row-new');
    const ids = screen.getAllByTestId(/^incident-row-/).map((r) => r.getAttribute('data-testid'));
    expect(ids).toEqual(['incident-row-new', 'incident-row-old', 'incident-row-odd']);
    const newRow = screen.getByTestId('incident-row-new');
    expect(within(newRow).getByText('Escalado')).toBeInTheDocument();
    expect(within(newRow).getByText('-60.3°C')).toBeInTheDocument();
    expect(within(newRow).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('incident-row-old')).getByText('Reconhecido')).toBeInTheDocument();
    // An unknown status falls back to its raw value.
    expect(within(screen.getByTestId('incident-row-odd')).getByText('mystery')).toBeInTheDocument();
  });

  it('pages ten rows at a time', async () => {
    served(
      Array.from({ length: 12 }, (_, i) =>
        incident(`i${i}`, { openedAt: new Date(Date.UTC(2026, 9, 20 - i)).toISOString() }),
      ),
    );
    render(<IncidentManagement />);
    await screen.findByTestId('incident-row-i0');
    const summary = () => document.querySelector('.history-pagination__summary')!.textContent!.replace(/\s+/g, ' ');
    const page = () => document.querySelector('.history-pagination__page')!.textContent;
    expect(screen.getAllByTestId(/^incident-row-/)).toHaveLength(10);
    expect(summary()).toBe('Mostrando 1-10 de 12');
    expect(page()).toBe('Página 1 de 2');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getAllByTestId(/^incident-row-/)).toHaveLength(2);
    expect(summary()).toBe('Mostrando 11-12 de 12');
    expect(page()).toBe('Página 2 de 2');
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(page()).toBe('Página 1 de 2');

    // A filter change goes back to the first page of the new list.
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(page()).toBe('Página 2 de 2');
    fireEvent.change(screen.getByTestId('incidents-status-filter'), { target: { value: 'all' } });
    await waitFor(() => expect(lastParams()).toBe('limit=100'));
    expect(page()).toBe('Página 1 de 2');
    expect(screen.getAllByTestId(/^incident-row-/)).toHaveLength(10);
  });

  it('shows the loading label while a refresh is in flight and refetches on click', async () => {
    render(<IncidentManagement />);
    await screen.findByText('Nenhum incidente aberto');
    let release!: (v: unknown) => void;
    h.get.mockReturnValueOnce(new Promise((r) => { release = r; }));
    fireEvent.click(screen.getByTestId('incidents-refresh-button'));
    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
    expect(screen.getByTestId('incidents-refresh-button')).toBeDisabled();
    release({ data: { incidents: [incident('r1')] } });
    expect(await screen.findByTestId('incident-row-r1')).toBeInTheDocument();
    expect(screen.getByText('Atualizar Lista')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the server message', { response: { data: { message: 'msg do servidor' } } }, 'msg do servidor'],
    ['the server error field', { response: { data: { error: 'erro do servidor' } } }, 'erro do servidor'],
    ['the error message', { message: 'Network Error' }, 'Network Error'],
    ['the fallback text', {}, 'Erro ao carregar incidentes'],
  ])('shows %s when loading fails', async (_label, err, shown) => {
    h.get.mockRejectedValue(err);
    render(<IncidentManagement />);
    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith('Erro ao buscar incidentes:', err);
  });

  it('clears the load error when a refresh succeeds', async () => {
    h.get.mockRejectedValueOnce({ message: 'Network Error' });
    render(<IncidentManagement />);
    expect(await screen.findByText('Network Error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('incidents-refresh-button'));
    expect(await screen.findByText('Nenhum incidente aberto')).toBeInTheDocument();
    expect(screen.queryByText('Network Error')).toBeNull();
  });
});

describe('IncidentManagementPage: detail panel', () => {
  it('shows the incident facts and history, and closes', async () => {
    served([
      incident('d1', {
        escalationLevel: 1,
        notes: [
          { timestamp: '2026-10-01T11:00:00.000Z', userId: 'u', action: 'acknowledged', message: 'Porta fechada' },
        ],
      }),
    ]);
    render(<IncidentManagement />);
    const title = await openDetails('d1');
    const panel = title.closest('.incident-detail-panel') as HTMLElement;
    expect(within(panel).getByText('Supervisor')).toBeInTheDocument();
    expect(within(panel).getByText('-55.0°C / -80.5°C')).toBeInTheDocument();
    expect(within(panel).getByText('Histórico')).toBeInTheDocument();
    expect(within(panel).getByText('Porta fechada')).toBeInTheDocument();
    expect(within(panel).getByText('acknowledged')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('Detalhes do Incidente')).toBeNull();
  });

  it('reads an out-of-range escalation level as Normal and offers no action on a resolved incident', async () => {
    served([incident('d2', { status: 'resolved', escalationLevel: 9 })]);
    render(<IncidentManagement />);
    const panel = (await openDetails('d2')).closest('.incident-detail-panel') as HTMLElement;
    expect(within(panel).getByText('Normal')).toBeInTheDocument();
    expect(within(panel).queryByText('Histórico')).toBeNull();
    expect(screen.queryByTestId('incident-note-input')).toBeNull();
    expect(screen.queryByTestId('incident-resolve-button')).toBeNull();
  });

  it('offers acknowledge, escalate and resolve on an open incident, and no escalate at level 2', async () => {
    served([incident('o1'), incident('o2', { escalationLevel: 2, openedAt: '2026-09-01T00:00:00.000Z' })]);
    render(<IncidentManagement />);
    await openDetails('o1');
    expect(screen.getByTestId('incident-acknowledge-button')).toBeInTheDocument();
    expect(screen.getByTestId('incident-escalate-button')).toBeInTheDocument();
    expect(screen.getByTestId('incident-resolve-button')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-add-note-button')).toBeNull();
    fireEvent.click(screen.getByTestId('incident-details-button-o2'));
    expect(screen.getByText('Crítico')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-escalate-button')).toBeNull();
  });
});

describe('IncidentManagementPage: actions', () => {
  it('acknowledges an open incident, refetches and closes the panel', async () => {
    served([incident('a1')]);
    render(<IncidentManagement />);
    await openDetails('a1');
    fireEvent.click(screen.getByTestId('incident-acknowledge-button'));
    await waitFor(() => expect(screen.queryByText('Detalhes do Incidente')).toBeNull());
    expect(h.put).toHaveBeenCalledWith(
      '/incidents/a1/acknowledge',
      { userId: 'user-1', notes: 'Incidente reconhecido' },
      { suppressErrorToast: true },
    );
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('escalates an open incident', async () => {
    served([incident('e1')]);
    render(<IncidentManagement />);
    await openDetails('e1');
    fireEvent.click(screen.getByTestId('incident-escalate-button'));
    await waitFor(() => expect(screen.queryByText('Detalhes do Incidente')).toBeNull());
    expect(h.put).toHaveBeenCalledWith(
      '/incidents/e1/escalate',
      { userId: 'user-1', notes: 'Incidente escalado' },
      { suppressErrorToast: true },
    );
  });

  it('resolves with the typed note, or the default note when none is typed', async () => {
    served([incident('s1', { status: 'acknowledged' })]);
    render(<IncidentManagement />);
    await openDetails('s1');
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: 'Compressor trocado' } });
    fireEvent.click(screen.getByTestId('incident-resolve-button'));
    await waitFor(() => expect(screen.queryByText('Detalhes do Incidente')).toBeNull());
    expect(h.put).toHaveBeenLastCalledWith(
      '/incidents/s1/resolve',
      { userId: 'user-1', notes: 'Compressor trocado' },
      { suppressErrorToast: true },
    );

    await openDetails('s1');
    expect(screen.getByTestId('incident-note-input')).toHaveValue('');
    fireEvent.click(screen.getByTestId('incident-resolve-button'));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(h.put).toHaveBeenLastCalledWith(
      '/incidents/s1/resolve',
      { userId: 'user-1', notes: 'Incidente resolvido' },
      { suppressErrorToast: true },
    );
  });

  it('adds a note on an escalated incident, keeping the panel open', async () => {
    served([incident('n1', { status: 'escalated', escalationLevel: 1 })]);
    render(<IncidentManagement />);
    await openDetails('n1');
    const add = screen.getByTestId('incident-add-note-button');
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: '   ' } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: 'Equipe acionada' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByTestId('incident-note-input')).toHaveValue(''));
    expect(h.post).toHaveBeenCalledWith(
      '/incidents/n1/notes',
      { userId: 'user-1', message: 'Equipe acionada' },
      { suppressErrorToast: true },
    );
    expect(screen.getByText('Detalhes do Incidente')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('shows the refetched incident, new note included, in the open panel after adding a note (#1449)', async () => {
    served([incident('h1', { status: 'acknowledged' })]);
    render(<IncidentManagement />);
    const panel = (await openDetails('h1')).closest('.incident-detail-panel') as HTMLElement;
    expect(within(panel).queryByText('Histórico')).toBeNull();
    served([
      incident('h1', {
        status: 'acknowledged',
        notes: [{ timestamp: '2026-10-02T09:00:00.000Z', userId: 'user-1', action: 'note', message: 'Porta selada' }],
      }),
    ]);
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: 'Porta selada' } });
    fireEvent.click(screen.getByTestId('incident-add-note-button'));
    expect(await within(panel).findByText('Porta selada')).toBeInTheDocument();
    expect(within(panel).getByText('Histórico')).toBeInTheDocument();
    expect(screen.getByTestId('incident-note-input')).toHaveValue('');
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('adds a note after a filter change dropped the open incident from the list, keeping the panel open', async () => {
    served([incident('f1', { status: 'acknowledged' })]);
    render(<IncidentManagement />);
    await openDetails('f1');
    served([]);
    fireEvent.change(screen.getByTestId('incidents-status-filter'), { target: { value: 'resolved' } });
    expect(await screen.findByText(/Nenhum incidente/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: 'Sensor recalibrado' } });
    fireEvent.click(screen.getByTestId('incident-add-note-button'));
    await waitFor(() => expect(screen.getByTestId('incident-note-input')).toHaveValue(''));
    expect(h.post).toHaveBeenCalledWith(
      '/incidents/f1/notes',
      { userId: 'user-1', message: 'Sensor recalibrado' },
      { suppressErrorToast: true },
    );
    expect(screen.getByText('Detalhes do Incidente')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(3);
  });

  it('offers resolve and add note on an acknowledged incident, with escalate only below level 2', async () => {
    served([incident('k1', { status: 'acknowledged', escalationLevel: 2 })]);
    render(<IncidentManagement />);
    await openDetails('k1');
    expect(screen.queryByTestId('incident-escalate-button')).toBeNull();
    expect(screen.queryByTestId('incident-acknowledge-button')).toBeNull();
    expect(screen.getByTestId('incident-add-note-button')).toBeInTheDocument();
  });

  it.each([
    ['acknowledge', 'open', 'incident-acknowledge-button', 'put', { response: { data: { message: 'sem permissão' } } }, 'sem permissão'],
    ['escalate', 'acknowledged', 'incident-escalate-button', 'put', { response: { data: { error: 'nível máximo' } } }, 'nível máximo'],
    ['resolve', 'escalated', 'incident-resolve-button', 'put', { message: 'timeout' }, 'timeout'],
    ['acknowledge', 'open', 'incident-acknowledge-button', 'put', {}, 'Erro ao reconhecer incidente'],
    ['escalate', 'open', 'incident-escalate-button', 'put', {}, 'Erro ao escalar incidente'],
    ['resolve', 'open', 'incident-resolve-button', 'put', {}, 'Erro ao resolver incidente'],
    ['add note', 'acknowledged', 'incident-add-note-button', 'post', {}, 'Erro ao adicionar nota'],
    ['add note', 'acknowledged', 'incident-add-note-button', 'post', { message: 'falhou' }, 'falhou'],
  ] as const)('alerts when %s fails on a %s incident (%#)', async (_a, status, testId, method, err, shown) => {
    served([incident('x1', { status })]);
    h[method].mockRejectedValue(err);
    render(<IncidentManagement />);
    await openDetails('x1');
    fireEvent.change(screen.getByTestId('incident-note-input'), { target: { value: 'nota' } });
    fireEvent.click(screen.getByTestId(testId));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(shown));
    // A failed action keeps the panel open and does not refetch.
    expect(screen.getByText('Detalhes do Incidente')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(1);
  });
});
