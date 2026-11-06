import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Log } from '../types/models';

// #1337: the Logs screen's own behaviour -- the client-side search, filters,
// sort and pagination over the rows the audit reader returned, the Merkle
// proof check, the Excel export and its error readings, and the row details.

const hook = vi.hoisted(() => ({
  state: { logs: [] as Log[], loading: false, error: null as string | null },
  loadLogs: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const tOverrides = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock('../hooks/useLogs', () => ({
  useLogs: () => ({ ...hook.state, loadLogs: hook.loadLogs, queryLogs: vi.fn() }),
}));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string, fb?: string) => tOverrides[k] ?? fb ?? k, language: 'pt-BR' }),
}));
vi.mock('../components/audit/SessionAuditPanel', () => ({
  default: () => <div>session-audit-panel</div>,
}));
vi.mock('../services/api', () => ({
  logService: { exportExcel: vi.fn(), exportCSV: vi.fn() },
  auditService: { getReport: vi.fn(), verify: vi.fn() },
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import { logService, auditService } from '../services/api';
import LogsPage from './LogsPage';

const exportExcel = vi.mocked(logService.exportExcel);
const getReport = vi.mocked(auditService.getReport);
const verify = vi.mocked(auditService.verify);

function log(overrides: Partial<Log> = {}): Log {
  return {
    action: 'CREATE',
    entity: 'Patient',
    result: 'success',
    severity: 'INFO',
    ...overrides,
  } as Log;
}

// jsdom 26 gives Blob no text(); the page reads an error body with it.
function jsonBlob(body: unknown): Blob {
  const text = JSON.stringify(body);
  const blob = new Blob([text], { type: "application/json" });
  Object.defineProperty(blob, "text", { value: () => Promise.resolve(text) });
  return blob;
}

function renderPage(logs: Log[], extra: Partial<typeof hook.state> = {}) {
  hook.state = { logs, loading: false, error: null, ...extra };
  return render(
    <MemoryRouter>
      <LogsPage />
    </MemoryRouter>,
  );
}

function bodyRows() {
  return Array.from(document.querySelectorAll('tbody tr.log-row')) as HTMLElement[];
}

function messages() {
  return bodyRows().map((r) => within(r).getByText((_, el) => !!el?.classList.contains('message-text')).textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tOverrides)) delete tOverrides[k];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LogsPage: loading, errors and the empty table', () => {
  it('asks the audit reader for logs on mount and shows the loading card', () => {
    renderPage([], { loading: true });
    expect(hook.loadLogs).toHaveBeenCalled();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('logs.searchPlaceholder')).not.toBeInTheDocument();
    expect(screen.getByText('session-audit-panel')).toBeInTheDocument();
  });

  it('shows the hook error and hides the table', () => {
    renderPage([], { error: 'Banco indisponível' });
    expect(screen.getByText('Banco indisponível')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('an empty list offers a reload that calls the audit reader again', async () => {
    renderPage([]);
    expect(screen.getByText('Nenhum log disponível.')).toBeInTheDocument();
    hook.loadLogs.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(hook.loadLogs).toHaveBeenCalledTimes(1);
  });
});

describe('LogsPage: search, filters and sort', () => {
  const rows = [
    log({ _id: 'a', message: 'alpha', userName: 'USR-ANA', action: 'LOGIN', entity: 'User', severity: 'WARNING', result: 'error', ipSource: '10.0.0.1', module: 'auth', timestampISO: '2026-01-10T10:00:00Z' }),
    log({ _id: 'b', message: 'bravo', userName: 'USR-BEN', action: 'CREATE', entity: 'Patient', severity: 'INFO', result: 'success', sourceIP: '192.168.1.5', module: 'patient', timestamp: '2026-02-10T10:00:00Z', resourceType: 'Consent', status: 'pending' }),
    log({ _id: 'c', message: 'charlie', userName: 'USR-CAI', action: 'EXPORT', entity: '0123456789abcdef01234567', severity: 'CRITICAL', result: 'failure', module: 'sample', dateTime: '2026-03-10T10:00:00Z' }),
  ];

  it('a free-text search narrows the rows and the clear button restores them', async () => {
    renderPage(rows);
    expect(bodyRows()).toHaveLength(3);
    await userEvent.type(screen.getByPlaceholderText('logs.searchPlaceholder'), '192.168');
    expect(messages()).toEqual(['bravo']);
    await userEvent.click(screen.getByTitle('logs.clearSearch'));
    expect(bodyRows()).toHaveLength(3);
  });

  it('a search that matches nothing reads as no result and clears from the empty row', async () => {
    renderPage(rows);
    await userEvent.type(screen.getByPlaceholderText('logs.searchPlaceholder'), 'zzz');
    expect(screen.getByText('logs.noLogsFound')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'logs.filters.clearFilters' }));
    expect(bodyRows()).toHaveLength(3);
  });

  it('each select filter keeps only the rows whose field equals the choice', async () => {
    renderPage(rows);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));

    // Entity options leave out an ObjectId-shaped entity.
    const entity = screen.getByLabelText('logs.filters.entity');
    expect(within(entity).queryByText('0123456789abcdef01234567')).toBeNull();
    expect(within(entity).getAllByRole('option').map((o) => o.textContent)).toEqual(['logs.filters.allEntities', 'Patient', 'User']);

    // Action options put semantic actions first, in their fixed order.
    const action = screen.getByLabelText('logs.filters.action');
    expect(within(action).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['', 'CREATE', 'LOGIN', 'EXPORT']);

    await userEvent.selectOptions(action, 'LOGIN');
    expect(messages()).toEqual(['alpha']);
    expect(screen.getByRole('button', { name: /common\.filter \(1\)/ })).toBeInTheDocument();
    await userEvent.selectOptions(action, '');

    await userEvent.selectOptions(entity, 'Patient');
    expect(messages()).toEqual(['bravo']);
    await userEvent.selectOptions(entity, '');

    await userEvent.selectOptions(screen.getByLabelText('Resource Type'), 'Consent');
    expect(messages()).toEqual(['bravo']);
    await userEvent.selectOptions(screen.getByLabelText('Resource Type'), '');

    await userEvent.selectOptions(screen.getByLabelText('logs.filters.severity'), 'critical');
    expect(messages()).toEqual(['charlie']);
    await userEvent.selectOptions(screen.getByLabelText('logs.filters.severity'), '');

    await userEvent.selectOptions(screen.getByLabelText('logs.filters.result'), 'error');
    expect(messages()).toEqual(['alpha']);
    await userEvent.selectOptions(screen.getByLabelText('logs.filters.result'), '');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'pending');
    expect(messages()).toEqual(['bravo']);
    await userEvent.selectOptions(screen.getByLabelText('Status'), '');

    await userEvent.selectOptions(screen.getByLabelText('logs.filters.module'), 'sample');
    expect(messages()).toEqual(['charlie']);
  });

  it('the user and IP text filters match by substring, and clear filters resets every one', async () => {
    renderPage(rows);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));
    await userEvent.type(screen.getByPlaceholderText('logs.filters.userIdentifierPlaceholder'), 'usr-a');
    expect(messages()).toEqual(['alpha']);
    await userEvent.click(screen.getAllByRole('button', { name: 'logs.filters.clearFilters' })[0]);
    expect(bodyRows()).toHaveLength(3);
    await userEvent.type(screen.getByPlaceholderText('logs.filters.sourceIPPlaceholder'), '10.0');
    expect(messages()).toEqual(['alpha']);
  });

  it('the date range reads timestampISO, timestamp and dateTime alike', async () => {
    renderPage([...rows, log({ _id: 'd', message: 'nodate' })]);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));
    const [start, end] = Array.from(document.querySelectorAll('.filters-panel input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(start, { target: { value: '2026-02-01' } });
    expect(messages().sort()).toEqual(['bravo', 'charlie']);
    fireEvent.change(end, { target: { value: '2026-02-28' } });
    expect(messages()).toEqual(['bravo']);
    fireEvent.change(start, { target: { value: '' } });
    expect(messages().sort()).toEqual(['alpha', 'bravo']);
  });

  it('newest first by default; a header click sorts ascending, a second click descending', async () => {
    renderPage(rows);
    expect(messages()).toEqual(['charlie', 'bravo', 'alpha']);
    await userEvent.click(screen.getByText('logs.tableHeaders.dateTime'));
    expect(messages()).toEqual(['alpha', 'bravo', 'charlie']);
    await userEvent.click(screen.getByText('logs.tableHeaders.action'));
    expect(messages()).toEqual(['bravo', 'charlie', 'alpha']);
    await userEvent.click(screen.getByText('logs.tableHeaders.action'));
    expect(messages()).toEqual(['alpha', 'charlie', 'bravo']);
    await userEvent.click(screen.getByText('logs.tableHeaders.severity'));
    expect(messages()).toEqual(['charlie', 'bravo', 'alpha']);
    await userEvent.click(screen.getByText('logs.tableHeaders.result'));
    expect(messages()).toEqual(['alpha', 'charlie', 'bravo']);
  });
});

describe('LogsPage: rows', () => {
  it('a long message is truncated until expanded', async () => {
    const long = 'x'.repeat(130);
    renderPage([log({ _id: 'l', message: long })]);
    expect(messages()[0]).toBe(`${'x'.repeat(120)}...`);
    await userEvent.click(screen.getByText('logs.actions.viewMore'));
    expect(messages()[0]).toBe(long);
    await userEvent.click(screen.getByText('logs.actions.viewLess'));
    expect(messages()[0]).toHaveLength(123);
  });

  it('shows the formatted action, the severity and the status, with N/A for a missing timestamp', () => {
    renderPage([log({ _id: 'r', action: 'PATCH', status: 'FAILURE', severity: 'ERROR' })]);
    const row = bodyRows()[0];
    expect(within(row).getByText('Atualizar Parcialmente')).toBeInTheDocument();
    expect(within(row).getByText('ERROR')).toBeInTheDocument();
    expect(within(row).getByText('failure')).toBeInTheDocument();
    expect(within(row).getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('the details row shows user, module, entity, IP, hash, payload and metadata, and opens the full log', async () => {
    renderPage([
      log({
        _id: 'det-1',
        message: 'm',
        userName: 'USR-77',
        module: 'security',
        entityID: 'ENT-1',
        resourceId: 42,
        auditHash: 'abc123',
        payload: 'payload text',
        metadata: { tracking: { ip: '172.16.0.9', userAgent: 'UA' } } as any,
      }),
    ]);
    await userEvent.click(screen.getByTitle('logs.actions.viewDetails'));
    const details = document.querySelector('.log-details-row') as HTMLElement;
    expect(within(details).getByText('USR-77')).toBeInTheDocument();
    expect(within(details).getByText('security')).toBeInTheDocument();
    expect(within(details).getByText('172.16.0.9')).toHaveAttribute('title', expect.stringContaining('User-Agent: UA'));
    expect(within(details).getByText('42')).toBeInTheDocument();
    expect(within(details).getByText('payload text')).toBeInTheDocument();
    expect(within(details).getByText(/"userAgent": "UA"/)).toBeInTheDocument();

    await userEvent.click(within(details).getByRole('button', { name: /logs\.actions\.viewFullDetails/ }));
    expect(navigateMock).toHaveBeenCalledWith('/logs/det-1');

    await userEvent.click(screen.getByTitle('logs.actions.hideDetails'));
    expect(document.querySelector('.log-details-row')).toBeNull();
  });

  it('copies the audit hash to the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage([log({ _id: 'h', auditHash: 'feedbeef' })]);
    await userEvent.click(screen.getByTitle('logs.actions.viewDetails'));
    await userEvent.click(screen.getByRole('button', { name: 'logs.details.copyHash' }));
    expect(writeText).toHaveBeenCalledWith('feedbeef');
    expect(await screen.findByText('logs.details.copied')).toBeInTheDocument();
  });
});

describe('LogsPage: pagination', () => {
  const many = Array.from({ length: 60 }, (_, i) => log({ _id: `p${i}`, message: `msg-${String(i).padStart(2, '0')}`, timestampISO: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));

  it('pages 50 at a time, moves between pages and changes the page size', async () => {
    renderPage(many);
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByText('logs.pagination.page')).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: /logs\.pagination\.previous/ });
    const next = screen.getByRole('button', { name: /logs\.pagination\.next/ });
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    expect(bodyRows()).toHaveLength(10);
    expect(next).toBeDisabled();
    await userEvent.click(prev);
    expect(bodyRows()).toHaveLength(50);
    await userEvent.selectOptions(screen.getByLabelText('logs.pagination.itemsPerPage'), '25');
    expect(bodyRows()).toHaveLength(25);
  });
});

describe('LogsPage: Merkle proof check', () => {
  function fillVerify(hash = ' h1 ') {
    const dateInput = document.querySelector('.logs-verify-date input') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByPlaceholderText('logs.verify.hashPlaceholder'), { target: { value: hash } });
  }

  it('asks for both fields before calling the service', async () => {
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(screen.getByText('logs.verify.errorRequired')).toBeInTheDocument();
    expect(getReport).not.toHaveBeenCalled();
  });

  it('verifies the trimmed hash against the saved root and shows the verdict', async () => {
    getReport.mockResolvedValue({ data: { data: { proof: ['p'], savedRoot: 'root-1', recalculatedRoot: 'root-2', tampered: false } } } as any);
    verify.mockResolvedValue({ data: { verified: true } } as any);
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('logs.verify.ok')).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledWith('2026-10-01', 'h1');
    expect(verify).toHaveBeenCalledWith('h1', ['p'], 'root-1');
    expect(screen.getByText('logs.verify.root: root-1')).toBeInTheDocument();
    expect(screen.getByText('logs.verify.tamperedNo')).toBeInTheDocument();
  });

  it('a failed verification against the recalculated root reads as fail and tampered', async () => {
    getReport.mockResolvedValue({ data: { data: { proof: [], recalculatedRoot: 'root-2', tampered: true } } } as any);
    verify.mockResolvedValue({ data: { verified: false } } as any);
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('logs.verify.fail')).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith('h1', [], 'root-2');
    expect(screen.getByText('logs.verify.tamperedYes')).toBeInTheDocument();
  });

  it('a report with no proof stops before verify', async () => {
    getReport.mockResolvedValue({ data: { data: { savedRoot: 'root-1' } } } as any);
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('logs.verify.errorNoProof')).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });

  it('shows the server error message when the report call fails', async () => {
    getReport.mockRejectedValue({ response: { data: { error: 'Data sem raiz' } } });
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('Data sem raiz')).toBeInTheDocument();
  });
});

describe('LogsPage: Excel export', () => {
  it('downloads the blob with the current search and filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportExcel.mockResolvedValue({ data: new Blob(['x']), headers: { 'content-type': 'application/vnd.openxmlformats' }, status: 200 } as any);
    renderPage([log({ _id: 'e', message: 'exp' })]);
    await userEvent.type(screen.getByPlaceholderText('logs.searchPlaceholder'), 'exp');
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(exportExcel).toHaveBeenCalledWith(expect.objectContaining({ search: 'exp', action: '' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(screen.getByRole('button', { name: /common\.exporting/ })).toBeDisabled();
    click.mockRestore();
  });

  it('a JSON body in place of the file reads as the export error, and closes', async () => {
    exportExcel.mockResolvedValue({ data: jsonBlob({ error: 'Sem permissão' }), headers: { 'content-type': 'application/json' }, status: 200 } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Sem permissão')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(screen.queryByText('Sem permissão')).toBeNull();
  });

  it('a non-blob body reads as an invalid server response', async () => {
    exportExcel.mockResolvedValue({ data: 'oops', headers: {}, status: 200 } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Resposta inválida do servidor')).toBeInTheDocument();
  });

  it('a rejected call with a JSON blob body shows its message; an unreadable one shows the status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exportExcel.mockRejectedValueOnce({ response: { data: jsonBlob({ message: 'Limite excedido' }), status: 429 } });
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Limite excedido')).toBeInTheDocument();

    exportExcel.mockRejectedValueOnce({ response: { data: { error: 'Proibido' } } });
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Proibido')).toBeInTheDocument();

    exportExcel.mockRejectedValueOnce(new Error('rede caiu'));
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('rede caiu')).toBeInTheDocument();
  });
});

describe('LogsPage: the timestamp and id shapes the reader may return', () => {
  const shapes = [
    log({ _id: 's1', message: 'as-date', timestamp: new Date('2026-04-10T10:00:00Z') }),
    log({ _id: 's2', message: 'as-serialized', timestamp: { _type: 'Date', _value: '2026-05-10T10:00:00Z' } as any }),
    log({ _id: 's3', message: 'as-number', timestamp: Date.parse('2026-06-10T10:00:00Z') as any }),
    log({ _id: 's4', message: 'as-datetime', dateTime: new Date('2026-07-10T10:00:00Z') }),
    log({ _id: 's5', message: 'as-serialized-datetime', dateTime: { _type: 'Date', _value: '2026-08-10T10:00:00Z' } as any }),
    log({ _id: 's6', message: 'as-garbage', timestampISO: 'not a date' }),
  ];

  it('formats every shape, reads an unparseable one as N/A, and sorts them by time', async () => {
    renderPage(shapes);
    expect(messages()).toEqual(['as-serialized-datetime', 'as-datetime', 'as-number', 'as-serialized', 'as-date', 'as-garbage']);
    const stampOf = (m: string) => bodyRows().find((r) => r.textContent!.includes(m))!.querySelector('.log-timestamp')!.textContent;
    for (const m of ['as-date', 'as-serialized', 'as-number', 'as-datetime', 'as-serialized-datetime']) expect(stampOf(m)).not.toBe('N/A');
    expect(stampOf('as-garbage')).toBe('N/A');
  });

  it('the date filters read each shape and drop the unparseable one', async () => {
    renderPage(shapes);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));
    const [start, end] = Array.from(document.querySelectorAll('.filters-panel input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(start, { target: { value: '2026-05-01' } });
    fireEvent.change(end, { target: { value: '2026-07-31' } });
    expect(messages()).toEqual(['as-datetime', 'as-number', 'as-serialized']);
  });

  it('the date filters keep a serialized dateTime that falls inside the range', async () => {
    renderPage(shapes);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));
    const [start, end] = Array.from(document.querySelectorAll('.filters-panel input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(start, { target: { value: '2026-08-01' } });
    expect(messages()).toEqual(['as-serialized-datetime']);
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.change(end, { target: { value: '2026-08-31' } });
    expect(messages()).toEqual(['as-serialized-datetime', 'as-datetime', 'as-number', 'as-serialized', 'as-date']);
  });

  it('reads a serialized dateTime with a null value as no time: N/A, and dropped by an end-date filter', async () => {
    renderPage([
      log({ _id: 'n1', message: 'as-null-datetime', dateTime: { _type: 'Date', _value: null } as any }),
      log({ _id: 'n2', message: 'as-iso', timestampISO: '2026-08-10T10:00:00Z' }),
    ]);
    const stamp = bodyRows().find((r) => r.textContent!.includes('as-null-datetime'))!.querySelector('.log-timestamp')!.textContent;
    expect(stamp).toBe('N/A');
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));
    const [, end] = Array.from(document.querySelectorAll('.filters-panel input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(end, { target: { value: '2026-08-31' } });
    expect(messages()).toEqual(['as-iso']);
  });

  it('opens the full log by a serialized ObjectId or a numeric logID, and logs when there is no id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([
      log({ _id: { _type: 'ObjectId', _value: 'oid-1' } as any, message: 'oid', timestampISO: '2026-01-03T00:00:00Z' }),
      log({ logID: 7, message: 'num', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ message: 'none', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    for (const b of screen.getAllByTitle('logs.actions.viewDetails')) await userEvent.click(b);
    const open = screen.getAllByRole('button', { name: /logs\.actions\.viewFullDetails/ });
    await userEvent.click(open[0]);
    await userEvent.click(open[1]);
    await userEvent.click(open[2]);
    expect(navigateMock.mock.calls).toEqual([['/logs/oid-1'], ['/logs/7']]);
    expect(err).toHaveBeenCalledWith('Não foi possível extrair ID para navegação');
  });
});

describe('LogsPage: row readings', () => {
  it('reads the IP from ip or metadata tracking, and shows each module and severity', async () => {
    renderPage([
      log({ _id: 'i1', message: 'one', ip: '1.1.1.1', module: 'import', severity: 'WARNING', result: 'warning', timestampISO: '2026-01-03T00:00:00Z' }),
      log({ _id: 'i2', message: 'two', metadata: { tracking: { ip: '2.2.2.2' } } as any, module: 'config', severity: 'CRITICAL', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: 'i3', message: 'three', module: 'other', severity: '', result: '', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    for (const b of screen.getAllByTitle('logs.actions.viewDetails')) await userEvent.click(b);
    const details = Array.from(document.querySelectorAll('.log-details-row')) as HTMLElement[];
    expect(details.map((d) => d.querySelector('.ip-text')!.textContent)).toEqual(['1.1.1.1', '2.2.2.2', 'N/A']);
    expect(details.map((d) => d.querySelector('.module-badge')!.textContent)).toEqual(['import', 'config', 'other']);
    expect(bodyRows().map((r) => r.querySelector('.severity-badge')!.textContent)).toEqual(['WARNING', 'CRITICAL', 'INFO']);
    expect(bodyRows().map((r) => r.querySelector('.result-badge')!.textContent)).toEqual(['warning', 'success', 'n/a']);
  });

  it('copies the hash through a hidden textarea where the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    renderPage([log({ _id: 'h2', auditHash: 'cafe' })]);
    await userEvent.click(screen.getByTitle('logs.actions.viewDetails'));
    await userEvent.click(screen.getByRole('button', { name: 'logs.details.copyHash' }));
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByText('logs.details.copied')).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('LogsPage: export error readings', () => {
  it('an unreadable error blob reads as the status line; a bare status reads as Erro <status>', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = new Blob(['x']);
    Object.defineProperty(bad, 'text', { value: () => Promise.resolve('not json') });
    exportExcel.mockRejectedValueOnce({ response: { data: bad, status: 502, statusText: 'Bad Gateway' } });
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('logs.exportErrorStatus')).toBeInTheDocument();

    exportExcel.mockRejectedValueOnce({ response: { status: 500, statusText: 'Server Error' } });
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Erro 500: Server Error')).toBeInTheDocument();
  });

  it('a JSON error body with an HTTP error status reads as its own message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exportExcel.mockResolvedValue({ data: '{"message":"Cota"}', headers: { 'content-type': 'application/json' }, status: 403 } as any);
    renderPage([]);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(await screen.findByText('Cota')).toBeInTheDocument();
  });
});

describe('LogsPage: branch readings (#1443)', () => {
  function fillVerify() {
    const dateInput = document.querySelector('.logs-verify-date input') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByPlaceholderText('logs.verify.hashPlaceholder'), { target: { value: 'h1' } });
  }

  // Closes any open error card first, so each reading comes from a fresh export.
  async function exportAndRead(): Promise<string> {
    const close = screen.queryByRole('button', { name: 'common.close' });
    if (close) await userEvent.click(close);
    expect(document.querySelector('.error-message')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    await waitFor(() => expect(document.querySelector('.error-message')).not.toBeNull());
    return (document.querySelector('.error-message > div') as HTMLElement).textContent!;
  }

  it('filter options drop empty, null and undefined actions, put semantic actions first, and keep raw unknown labels', async () => {
    renderPage([
      log({ _id: 'a1', action: 'alpha', entity: '12345678' }),
      log({ _id: 'a2', action: 'EXPORT', entity: 'User' }),
      log({ _id: 'a3', action: 'zeta', entity: undefined, resourceType: undefined }),
      log({ _id: 'a4', action: 'LOGIN' }),
      log({ _id: 'a5', action: 'null' }),
      log({ _id: 'a6', action: 'undefined' }),
      log({ _id: 'a7', action: undefined }),
    ]);
    await userEvent.click(screen.getByRole('button', { name: /common\.filter/ }));

    const action = screen.getByLabelText('logs.filters.action');
    const actionOptions = within(action).getAllByRole('option') as HTMLOptionElement[];
    expect(actionOptions.map((o) => o.value)).toEqual(['', 'LOGIN', 'EXPORT', 'alpha', 'zeta']);
    expect(actionOptions.find((o) => o.value === 'alpha')!.textContent).toBe('alpha (alpha)');

    const entity = screen.getByLabelText('logs.filters.entity');
    expect(within(entity).getAllByRole('option').map((o) => o.textContent)).toEqual(['logs.filters.allEntities', 'Patient', 'User']);

    const resourceType = screen.getByLabelText('Resource Type');
    expect(within(resourceType).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['', '12345678', 'Patient', 'User']);
  });

  it('a log without action, entity, severity or result sorts first ascending and reads N/A in its row and details', async () => {
    renderPage([
      log({ _id: 'b1', message: 'full', action: 'CREATE', severity: 'INFO', result: 'success', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: 'b2', message: 'bare', action: undefined, entity: undefined, severity: undefined, result: undefined, timestampISO: '2026-01-01T00:00:00Z' }),
      log({ _id: 'b3', message: 'twin', action: 'CREATE', severity: 'INFO', result: 'success', timestampISO: '2026-01-03T00:00:00Z' }),
    ]);
    await userEvent.click(screen.getByText('logs.tableHeaders.action'));
    expect(messages()).toEqual(['bare', 'full', 'twin']);
    await userEvent.click(screen.getByText('logs.tableHeaders.severity'));
    expect(messages()).toEqual(['bare', 'full', 'twin']);
    await userEvent.click(screen.getByText('logs.tableHeaders.result'));
    expect(messages()).toEqual(['bare', 'full', 'twin']);

    const bare = bodyRows()[0];
    expect(bare.querySelector('.action-badge')!.textContent).toBe('N/A');
    await userEvent.click(within(bare).getByTitle('logs.actions.viewDetails'));
    const details = document.querySelector('.log-details-row') as HTMLElement;
    expect(Array.from(details.querySelectorAll('.entity-text')).map((s) => s.textContent)).toEqual(['N/A', 'N/A']);
  });

  it('module badges colour auth, patient and sample modules, and an unknown severity reads neutral', async () => {
    renderPage([
      log({ _id: 'c1', message: 'm-auth', module: 'auth', timestampISO: '2026-01-04T00:00:00Z' }),
      log({ _id: 'c2', message: 'm-patient', module: 'patient', timestampISO: '2026-01-03T00:00:00Z' }),
      log({ _id: 'c3', message: 'm-sample', module: 'sample', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: 'c4', message: 'm-debug', severity: 'DEBUG', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    for (const b of screen.getAllByTitle('logs.actions.viewDetails')) await userEvent.click(b);
    const badges = Array.from(document.querySelectorAll('.log-details-row .module-badge')) as HTMLElement[];
    expect(badges.slice(0, 3).map((b) => [b.textContent, b.style.color])).toEqual([
      ['auth', 'rgb(59, 130, 246)'],
      ['patient', 'rgb(16, 185, 129)'],
      ['sample', 'rgb(139, 92, 246)'],
    ]);

    const debugRow = bodyRows().find((r) => r.textContent!.includes('m-debug'))!;
    const severity = debugRow.querySelector('.severity-badge') as HTMLElement;
    expect(severity.textContent).toBe('DEBUG');
    expect(severity.style.color).toBe('var(--text-light)');
  });

  it('the IP title reads N/A for a tracking block without ip and for metadata without tracking', async () => {
    renderPage([
      log({ _id: 'd1', message: 'no-ip', metadata: { tracking: { userAgent: 'UA' } } as any, timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: 'd2', message: 'no-tracking', metadata: { source: 'cron' } as any, timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    for (const b of screen.getAllByTitle('logs.actions.viewDetails')) await userEvent.click(b);
    const titles = Array.from(document.querySelectorAll('.log-details-row .ip-text')).map((s) => s.getAttribute('title')!);
    expect(titles[0].startsWith('IP: N/A\nUser-Agent: UA')).toBe(true);
    expect(titles[1]).toBe('IP: N/A');
  });

  it('the full-log button skips an ObjectId with no value and opens a bare _value id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = renderPage([log({ _id: { _type: 'ObjectId', _value: null } as any, message: 'null-oid' })]);
    await userEvent.click(screen.getByTitle('logs.actions.viewDetails'));
    await userEvent.click(screen.getByRole('button', { name: /logs\.actions\.viewFullDetails/ }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith('Não foi possível extrair ID para navegação');
    first.unmount();

    renderPage([log({ _id: { _value: 'v-9' } as any, message: 'bare-value' })]);
    await userEvent.click(screen.getByTitle('logs.actions.viewDetails'));
    await userEvent.click(screen.getByRole('button', { name: /logs\.actions\.viewFullDetails/ }));
    expect(navigateMock).toHaveBeenCalledWith('/logs/v-9');
  });

  it('a report with neither root stops at no proof before verify', async () => {
    getReport.mockResolvedValue({ data: { data: { proof: ['p'] } } } as any);
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('logs.verify.errorNoProof')).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });

  it('a verdict without a tampered flag shows no tampered line', async () => {
    getReport.mockResolvedValue({ data: { data: { proof: ['p'], savedRoot: 'r1' } } } as any);
    verify.mockResolvedValue({ data: { verified: true } } as any);
    renderPage([]);
    fillVerify();
    await userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    expect(await screen.findByText('logs.verify.ok')).toBeInTheDocument();
    expect(screen.queryByText(/logs\.verify\.tamperedLabel/)).toBeNull();
  });

  it('a failed report reads the body message, then the error message, then the generic text', async () => {
    getReport
      .mockRejectedValueOnce({ response: { data: { message: 'Sem relatório' } } })
      .mockRejectedValueOnce(new Error('rede'))
      .mockRejectedValueOnce({});
    renderPage([]);
    fillVerify();
    const run = () => userEvent.click(screen.getByRole('button', { name: /logs\.verify\.action/ }));
    await run();
    expect(await screen.findByText('Sem relatório')).toBeInTheDocument();
    await run();
    expect(await screen.findByText('rede')).toBeInTheDocument();
    await run();
    expect(await screen.findByText('logs.verify.errorGeneric')).toBeInTheDocument();
  });

  it('a JSON export body read as an object, or with no message, reads as its error or the generic one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([]);
    exportExcel.mockResolvedValueOnce({ data: { error: 'Negado' }, headers: { 'content-type': 'application/json' }, status: 200 } as any);
    expect(await exportAndRead()).toBe('logs.exportError: Negado');

    exportExcel.mockResolvedValueOnce({ data: '{}', headers: { 'content-type': 'application/json' }, status: 200 } as any);
    expect(await exportAndRead()).toBe('logs.exportError: logs.exportError');
  });

  it('a rejected export with a message-only body, an empty body or a bare status reads each fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([]);
    exportExcel.mockRejectedValueOnce({ response: { data: { message: 'Só mensagem' } } });
    expect(await exportAndRead()).toBe('logs.exportError: Só mensagem');

    exportExcel.mockRejectedValueOnce({ response: { data: {} } });
    expect(await exportAndRead()).toBe('logs.exportError: logs.exportError');

    exportExcel.mockRejectedValueOnce({ response: { data: jsonBlob({}), status: 500 } });
    expect(await exportAndRead()).toBe('logs.exportError: logs.exportError');

    exportExcel.mockRejectedValueOnce({ response: { status: 503 } });
    expect(await exportAndRead()).toBe('logs.exportError: Erro 503: logs.exportError');
  });

  it('an unreadable error blob with no status reads the unknown-status template', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tOverrides['logs.exportErrorStatus'] = 'Falha {status} {statusText}';
    const bad = new Blob(['x']);
    Object.defineProperty(bad, 'text', { value: () => Promise.resolve('not json') });
    exportExcel.mockRejectedValueOnce({ response: { data: bad } });
    renderPage([]);
    expect(await exportAndRead()).toBe('logs.exportError: Falha logs.exportErrorUnknown logs.exportError');
  });

  it('the copied note clears after two seconds and a later copy keeps its own note', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage([
      log({ _id: 'h-a', auditHash: 'aaa', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: 'h-b', auditHash: 'bbb', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    for (const b of screen.getAllByTitle('logs.actions.viewDetails')) fireEvent.click(b);
    const [copyA, copyB] = screen.getAllByRole('button', { name: 'logs.details.copyHash' });
    const hashSpan = (hash: string) => screen.getByText(hash, { exact: false, selector: 'span.log-detail-value' });

    vi.useFakeTimers();
    fireEvent.click(copyA);
    await act(async () => {});
    expect(within(hashSpan('aaa')).getByText('logs.details.copied')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(copyB);
    await act(async () => {});
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.getAllByText('logs.details.copied')).toHaveLength(1);
    expect(within(hashSpan('bbb')).getByText('logs.details.copied')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('logs.details.copied')).toBeNull();
    expect(writeText.mock.calls).toEqual([['aaa'], ['bbb']]);
  });
});

describe('LogsPage: a raw object id (#1451)', () => {
  const keyWarnings = (err: { mock: { calls: unknown[][] } }) =>
    err.mock.calls.filter((c) => String(c[0]).includes('key'));

  it('opens a raw { $oid } id by its hex, and expanding one such row expands only it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([
      log({ _id: { $oid: '65a1b2c3d4e5f60718293a4b' } as any, message: 'raw-a', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: { $oid: '65a1b2c3d4e5f60718293a4c' } as any, message: 'raw-b', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    expect(keyWarnings(err)).toEqual([]);
    await userEvent.click(screen.getAllByTitle('logs.actions.viewDetails')[0]);
    expect(document.querySelectorAll('.log-details-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /logs\.actions\.viewFullDetails/ }));
    expect(navigateMock.mock.calls).toEqual([['/logs/65a1b2c3d4e5f60718293a4b']]);
  });

  it('a plain-object id with no hex is not linkable, and two such rows keep apart', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage([
      log({ _id: { foo: 1 } as any, message: 'plain-a', timestampISO: '2026-01-02T00:00:00Z' }),
      log({ _id: { bar: 2 } as any, message: 'plain-b', timestampISO: '2026-01-01T00:00:00Z' }),
    ]);
    expect(keyWarnings(err)).toEqual([]);
    await userEvent.click(screen.getAllByTitle('logs.actions.viewDetails')[0]);
    expect(document.querySelectorAll('.log-details-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /logs\.actions\.viewFullDetails/ }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith('Não foi possível extrair ID para navegação');
  });
});
