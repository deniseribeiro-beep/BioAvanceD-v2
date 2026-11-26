import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Log } from '../types/models';

// #1337: the single audit-log screen -- how it loads one log by the route id,
// each error reading of that load, the hash copy, and how every field of the
// log is shown (ids, timestamps, severity, result, module, tracking, payload).

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'pt-BR' }),
}));
vi.mock('../services/api', () => ({
  logService: { getById: vi.fn() },
}));
vi.mock('../utils/logFormatter', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/logFormatter')>();
  return {
    ...real,
    formatPayload: vi.fn(real.formatPayload),
    formatMetadata: vi.fn(real.formatMetadata),
  };
});
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import { logService } from '../services/api';
import { formatPayload, formatMetadata } from '../utils/logFormatter';
import LogDetailPage from './LogDetailPage';

const getById = vi.mocked(logService.getById);

function log(overrides: Record<string, unknown> = {}): Log {
  return { action: 'CREATE', entity: 'Patient', result: 'success', severity: 'INFO', ...overrides } as Log;
}

function found(l: Log) {
  getById.mockResolvedValue({ data: { success: true, data: l } } as never);
}

function renderAt(path = '/logs/abc123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/logs/:id" element={<LogDetailPage />} />
        <Route path="/logs" element={<LogDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLog(overrides: Record<string, unknown> = {}) {
  found(log(overrides));
  renderAt();
  await screen.findByText('logs.detailPage.title');
}

// The value cell that sits beside a field's label.
function valueOf(labelKey: string): HTMLElement {
  return screen.getByText(labelKey).nextElementSibling as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LogDetailPage loading and errors', () => {
  it('shows the loading text while the log is on its way', () => {
    getById.mockReturnValue(new Promise(() => {}) as never);
    renderAt();
    expect(screen.getByText('logs.detailPage.loading')).toBeInTheDocument();
    expect(getById).toHaveBeenCalledWith('abc123');
  });

  it('says the id is missing and calls nothing when the route has no id', async () => {
    renderAt('/logs');
    expect(await screen.findByText('logs.detailPage.errors.missingId')).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty response', undefined, 'logs.detailPage.errors.invalidResponse'],
    ['a response with no data', {}, 'logs.detailPage.errors.invalidResponse'],
    ['a refusal that names its error', { data: { success: false, error: 'Log bloqueado' } }, 'Log bloqueado'],
    ['a refusal with no error', { data: { success: false } }, 'logs.detailPage.notFound'],
    ['a success with no log', { data: { success: true } }, 'logs.detailPage.notFound'],
  ])('shows %s as its error', async (_name, response, text) => {
    getById.mockResolvedValue(response as never);
    renderAt();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it.each([
    ['the response error', { response: { data: { error: 'Sem permissão' } } }, 'Sem permissão'],
    ['the response message', { response: { data: { message: 'Timeout do servidor' } } }, 'Timeout do servidor'],
    ['the error message', new Error('Network Error'), 'Network Error'],
    ['the generic load error', {}, 'logs.detailPage.errors.load'],
  ])('shows %s when the load fails', async (_name, err, text) => {
    getById.mockRejectedValue(err);
    renderAt();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('goes back to the logs list from the error screen', async () => {
    getById.mockResolvedValue({ data: { success: false } } as never);
    renderAt();
    fireEvent.click(await screen.findByText('logs.detailPage.back'));
    expect(navigateMock).toHaveBeenCalledWith('/logs');
  });
});

describe('LogDetailPage fields', () => {
  it('shows the basic fields of a found log and goes back from it', async () => {
    await renderLog({
      _id: 'abc123',
      message: 'Paciente criado',
      userName: 'ana.souza',
      entityID: 'PAT-0042',
      timestampISO: '2026-01-02T03:04:05.000Z',
    });
    expect(valueOf('logs.detailPage.labels.id')).toHaveTextContent('abc123');
    expect(valueOf('logs.detailPage.labels.message')).toHaveTextContent('Paciente criado');
    expect(valueOf('logs.detailPage.labels.user')).toHaveTextContent('ana.souza');
    expect(valueOf('logs.detailPage.labels.action')).toHaveTextContent('CREATE');
    expect(valueOf('logs.detailPage.labels.entity')).toHaveTextContent('Patient');
    expect(valueOf('logs.details.entityID')).toHaveTextContent('PAT-0042');
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent('2026-01-02T03:04:05.000Z');
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('2026');
    fireEvent.click(screen.getByText('logs.detailPage.back'));
    expect(navigateMock).toHaveBeenCalledWith('/logs');
  });

  it('falls back to N/A and the system user when the log carries little', async () => {
    await renderLog({ action: '', entity: '', result: '', severity: '' });
    expect(valueOf('logs.detailPage.labels.id')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.message')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.user')).toHaveTextContent('USR-SYSTEM');
    expect(valueOf('logs.detailPage.labels.action')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.entity')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.severity')).toHaveTextContent('INFO');
    expect(valueOf('logs.detailPage.labels.result')).toHaveTextContent('N/A');
    expect(valueOf('logs.details.module')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.ipSource')).toHaveTextContent('N/A');
    expect(screen.queryByText('logs.details.auditHash')).not.toBeInTheDocument();
    expect(screen.queryByText('logs.detailPage.sections.payload')).not.toBeInTheDocument();
    expect(screen.queryByText('logs.detailPage.sections.stack')).not.toBeInTheDocument();
    expect(screen.queryByText('logs.detailPage.sections.metadata')).not.toBeInTheDocument();
  });

  it.each([
    ['a numeric logID', { logID: 77 }, '77'],
    ['a serialized ObjectId', { _id: { _type: 'ObjectId', _value: '65f0aa' } }, '65f0aa'],
    ['an ObjectId with no value', { _id: { _type: 'ObjectId' } }, '[object Object]'],
    ['an object with its own toString', { _id: { toString: (): string => 'oid-9' } }, 'oid-9'],
  ])('shows the id from %s', async (_name, overrides, text) => {
    await renderLog(overrides);
    expect(valueOf('logs.detailPage.labels.id')).toHaveTextContent(text);
  });

  it.each([
    ['a timestamp string', { timestamp: '2026-03-04T05:06:07.000Z' }],
    ['a Date timestamp', { timestamp: new Date('2026-03-04T05:06:07.000Z') }],
    ['a serialized Date', { timestamp: { _type: 'Date', _value: '2026-03-04T05:06:07.000Z' } }],
    ['an epoch number', { timestamp: Date.parse('2026-03-04T05:06:07.000Z') }],
    ['an invalid ISO stamp', { timestampISO: 'not-a-date', timestamp: '2026-03-04T05:06:07.000Z' }],
  ])('reads the time from %s', async (_name, overrides) => {
    await renderLog(overrides);
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent(
      (overrides as { timestampISO?: string }).timestampISO ?? '2026-03-04T05:06:07.000Z',
    );
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('2026');
  });

  it('reads the time from dateTime when there is no timestamp, and N/A from a bad one', async () => {
    await renderLog({ dateTime: '2026-05-06T07:08:09.000Z' });
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('2026');
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent('N/A');
  });

  it('shows N/A for an unparseable timestamp and dateTime', async () => {
    await renderLog({ timestamp: 'garbage', dateTime: 'also garbage' });
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent('N/A');
  });

  it('shows N/A for both time rows when reading the timestamp throws', async () => {
    await renderLog({
      timestamp: {
        valueOf(): number {
          throw new Error('unreadable');
        },
      },
    });
    expect(valueOf('logs.detailPage.labels.dateTime')).toHaveTextContent('N/A');
    expect(valueOf('logs.detailPage.labels.timestampISO')).toHaveTextContent('N/A');
  });

  it.each([
    ['CRITICAL', 'rgb(220, 38, 38)'],
    ['error', 'var(--danger)'],
    ['WARNING', 'var(--warning)'],
    ['info', 'rgb(59, 130, 246)'],
    ['DEBUG', 'var(--text-light)'],
  ])('colours severity %s', async (severity, colour) => {
    await renderLog({ severity });
    const badge = valueOf('logs.detailPage.labels.severity');
    expect(badge).toHaveTextContent(severity);
    expect(badge.style.color).toBe(colour);
  });

  it.each([
    ['success', 'var(--success)'],
    ['error', 'var(--danger)'],
    ['failure', 'var(--danger)'],
    ['WARNING', 'var(--warning)'],
    ['pending', 'var(--text-light)'],
  ])('colours result %s', async (result, colour) => {
    await renderLog({ result });
    const badge = valueOf('logs.detailPage.labels.result');
    expect(badge).toHaveTextContent(result);
    expect(badge.style.color).toBe(colour);
  });

  it.each([
    ['auth', 'rgb(59, 130, 246)'],
    ['Cadastro de pacientes', 'rgb(16, 185, 129)'],
    ['samples', 'rgb(139, 92, 246)'],
    ['Importação FHIR', 'rgb(245, 158, 11)'],
    ['config', 'rgb(99, 102, 241)'],
    ['Segurança', 'rgb(239, 68, 68)'],
    ['reports', 'var(--text-light)'],
  ])('colours module %s', async (module, colour) => {
    await renderLog({ module });
    const badge = valueOf('logs.details.module');
    expect(badge).toHaveTextContent(module);
    expect(badge.style.color).toBe(colour);
  });

  it('shows the request tracking fields from the metadata', async () => {
    await renderLog({
      userID: 'USR-0009',
      metadata: {
        tracking: {
          ip: '10.0.0.7',
          ipOriginal: '200.1.2.3',
          forwardedFor: '200.1.2.3, 10.0.0.1',
          userAgent: 'Mozilla/5.0 Teste',
          referer: 'https://bio.example/logs',
          host: 'bio.example',
          protocol: 'https',
          secure: true,
        },
      },
    });
    expect(valueOf('logs.detailPage.labels.user')).toHaveTextContent('USR-0009');
    expect(valueOf('logs.detailPage.labels.ipSource')).toHaveTextContent('10.0.0.7');
    expect(valueOf('logs.detailPage.labels.ipOriginal')).toHaveTextContent('200.1.2.3');
    expect(valueOf('logs.detailPage.labels.forwardedFor')).toHaveTextContent('200.1.2.3, 10.0.0.1');
    expect(valueOf('logs.detailPage.labels.userAgent')).toHaveTextContent('Mozilla/5.0 Teste');
    expect(valueOf('logs.detailPage.labels.referer')).toHaveTextContent('https://bio.example/logs');
    expect(valueOf('logs.detailPage.labels.host')).toHaveTextContent('bio.example');
    expect(valueOf('logs.detailPage.labels.protocol')).toHaveTextContent('https');
    expect(valueOf('logs.detailPage.labels.secure')).toHaveTextContent('logs.detailPage.labels.secureYes');
    expect(screen.getByText('logs.detailPage.sections.metadata')).toBeInTheDocument();
  });

  it('shows N/A for each tracking field the metadata leaves out', async () => {
    await renderLog({ ipSource: '192.168.0.5', metadata: { tracking: {} } });
    expect(valueOf('logs.detailPage.labels.ipSource')).toHaveTextContent('192.168.0.5');
    for (const key of ['ipOriginal', 'forwardedFor', 'userAgent', 'referer', 'host', 'protocol']) {
      expect(valueOf(`logs.detailPage.labels.${key}`)).toHaveTextContent('N/A');
    }
    expect(valueOf('logs.detailPage.labels.secure')).toHaveTextContent('logs.detailPage.labels.secureNo');
  });

  it('shows the payload, the error stack and the metadata sections', async () => {
    await renderLog({
      sourceIP: '172.16.0.3',
      payload: { patientID: 'PAT-0042' },
      errorStack: 'Error: falhou\n    at handler (server.js:10)',
      metadata: { request: { method: 'POST' } },
    });
    expect(valueOf('logs.detailPage.labels.ipSource')).toHaveTextContent('172.16.0.3');
    expect(screen.queryByText('logs.detailPage.labels.ipOriginal')).not.toBeInTheDocument();
    expect(document.querySelector('.payload-content')).toHaveTextContent('PAT-0042');
    expect(document.querySelector('.error-stack-content')).toHaveTextContent('Error: falhou');
    expect(document.querySelector('.metadata-content')).toHaveTextContent('POST');
  });

  it('falls back to raw JSON when the payload or metadata formatter throws', async () => {
    vi.mocked(formatPayload).mockImplementation(() => {
      throw new Error('bad payload');
    });
    vi.mocked(formatMetadata).mockImplementation(() => {
      throw new Error('bad metadata');
    });
    await renderLog({ payload: { campo: 'valor-p' }, metadata: { campo: 'valor-m' } });
    expect(document.querySelector('.payload-content')?.textContent).toBe(JSON.stringify({ campo: 'valor-p' }, null, 2));
    expect(document.querySelector('.metadata-content')?.textContent).toBe(JSON.stringify({ campo: 'valor-m' }, null, 2));
  });
});

describe('LogDetailPage hash copy', () => {
  it('copies the audit hash to the clipboard and says so for two seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderLog({ auditHash: 'sha256-abcdef' });
    expect(valueOf('logs.details.auditHash')).toHaveTextContent('sha256-abcdef');
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('logs.details.copyHash'));
    });
    expect(writeText).toHaveBeenCalledWith('sha256-abcdef');
    expect(screen.getByText('logs.details.copied')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('logs.details.copied')).not.toBeInTheDocument();
  });

  it('copies through a hidden textarea when there is no clipboard API', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await renderLog({ auditHash: 'sha256-fallback' });
    fireEvent.click(screen.getByText('logs.details.copyHash'));
    expect(await screen.findByText('logs.details.copied')).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('says nothing was copied when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderLog({ auditHash: 'sha256-denied' });
    fireEvent.click(screen.getByText('logs.details.copyHash'));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Erro ao copiar hash:', expect.any(Error)));
    expect(screen.queryByText('logs.details.copied')).not.toBeInTheDocument();
  });
});
