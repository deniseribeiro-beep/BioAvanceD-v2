import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionAuditPage, SessionAuditRow } from '../../services/api';

// #1005: the session audit panel on the Logs screen -- the filters it sends,
// how each row's dates, status, reason, actor, IP and client read, the error
// and empty readings, and the pagination over the backend's pages.

vi.mock('../../services/api', () => ({
  logService: { getSessions: vi.fn() },
}));

import { logService } from '../../services/api';
import SessionAuditPanel from './SessionAuditPanel';

const getSessions = vi.mocked(logService.getSessions);

function row(overrides: Partial<SessionAuditRow> = {}): SessionAuditRow {
  return {
    id: 's1',
    user: 'USR-0001',
    ipAddress: '10.0.x.x',
    browser: 'Chrome',
    os: 'Windows',
    deviceType: 'desktop',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastActivity: '2026-10-01T11:00:00.000Z',
    expiresAt: null,
    isActive: false,
    isRevoked: true,
    revokedAt: '2026-10-01T12:00:00.000Z',
    revokedBy: 'USR-0002',
    revocationReason: 'password_change',
    ...overrides,
  };
}

function page(sessions: SessionAuditRow[], extra: Partial<SessionAuditPage> = {}): SessionAuditPage {
  return { sessions, total: sessions.length, page: 1, limit: 25, totalPages: 1, ...extra };
}

function respond(data: SessionAuditPage) {
  getSessions.mockResolvedValue({ data: { success: true, data } } as any);
}

function cells(index = 0) {
  const rows = screen.getAllByTestId('session-audit-row');
  return within(rows[index]).getAllByRole('cell').map((cell) => cell.textContent);
}

beforeEach(() => {
  getSessions.mockReset();
});

describe('SessionAuditPanel loading', () => {
  it('asks for the first page of revoked sessions on mount, without an empty reason', async () => {
    respond(page([row()]));
    render(<SessionAuditPanel />);
    await screen.findByTestId('session-audit-row');
    expect(getSessions).toHaveBeenCalledTimes(1);
    expect(getSessions).toHaveBeenCalledWith({ page: 1, limit: 25, isRevoked: 'true' });
  });

  it('sends the chosen reason and drops the status filter when it is set to all', async () => {
    const user = userEvent.setup();
    respond(page([row()]));
    render(<SessionAuditPanel />);
    await screen.findByTestId('session-audit-row');

    await user.selectOptions(screen.getByLabelText('Motivo da revogação'), 'risk');
    await waitFor(() =>
      expect(getSessions).toHaveBeenLastCalledWith({ page: 1, limit: 25, revocationReason: 'risk', isRevoked: 'true' }),
    );

    await user.selectOptions(screen.getByLabelText('Situação da sessão'), '');
    await waitFor(() =>
      expect(getSessions).toHaveBeenLastCalledWith({ page: 1, limit: 25, revocationReason: 'risk' }),
    );
  });

  it('reloads with the same filters when Atualizar is clicked', async () => {
    const user = userEvent.setup();
    respond(page([row()]));
    render(<SessionAuditPanel />);
    await screen.findByTestId('session-audit-row');

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2));
    expect(getSessions).toHaveBeenLastCalledWith({ page: 1, limit: 25, isRevoked: 'true' });
  });

  it('disables Atualizar while a load is in flight', async () => {
    getSessions.mockReturnValue(new Promise(() => {}) as any);
    render(<SessionAuditPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled());
  });
});

describe('SessionAuditPanel rows', () => {
  it('renders a revoked row with its reason label, actor, IP and client', async () => {
    respond(page([row()]));
    render(<SessionAuditPanel />);
    await screen.findByTestId('session-audit-row');
    const [user, created, last, status, revokedAt, reason, by, ip, client] = cells();
    expect(user).toBe('USR-0001');
    expect(created).toBe(new Date('2026-10-01T10:00:00.000Z').toLocaleString('pt-BR'));
    expect(last).toBe(new Date('2026-10-01T11:00:00.000Z').toLocaleString('pt-BR'));
    expect(status).toBe('Revogada');
    expect(revokedAt).toBe(new Date('2026-10-01T12:00:00.000Z').toLocaleString('pt-BR'));
    expect(reason).toBe('Troca de senha');
    expect(by).toBe('USR-0002');
    expect(ip).toBe('10.0.x.x');
    expect(client).toBe('Chrome / Windows');
  });

  it('reads an active row with no revocation as dashes, and a system revocation as Sistema', async () => {
    respond(
      page([
        row({
          id: null,
          isActive: true,
          isRevoked: false,
          revokedAt: null,
          revokedBy: null,
          revocationReason: null,
          ipAddress: null,
          browser: null,
          os: null,
          createdAt: 'not-a-date',
          lastActivity: null,
        }),
        row({ id: 's2', revokedBy: 'system', browser: null, os: 'Linux', isActive: true }),
        row({ id: 's3', isRevoked: false, isActive: false, revocationReason: 'legacy_reason' as any }),
      ]),
    );
    render(<SessionAuditPanel />);
    await screen.findAllByTestId('session-audit-row');

    const [, created, last, status, revokedAt, reason, by, ip, client] = cells(0);
    expect([created, last, revokedAt, reason, by, ip, client]).toEqual(['—', '—', '—', '—', '—', '—', '—']);
    expect(status).toBe('Ativa');

    const second = cells(1);
    expect(second[3]).toBe('Revogada');
    expect(second[6]).toBe('Sistema');
    expect(second[8]).toBe('Linux');

    const third = cells(2);
    expect(third[3]).toBe('Inativa');
    expect(third[5]).toBe('legacy_reason');
  });

  it('labels every revocation reason in the reason filter', async () => {
    respond(page([]));
    render(<SessionAuditPanel />);
    const options = within(screen.getByLabelText('Motivo da revogação'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      'Todos',
      'Solicitação do usuário',
      'Ação administrativa',
      'Troca de senha',
      'Risco',
      'Expiração',
    ]);
  });

  it('says no session matched when the page is empty, and shows no pager', async () => {
    respond(page([]));
    render(<SessionAuditPanel />);
    expect(await screen.findByText('Nenhuma sessão encontrada para os filtros.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próxima' })).not.toBeInTheDocument();
  });

  it('hides the empty-page message while a refresh is pending', async () => {
    const user = userEvent.setup();
    respond(page([]));
    render(<SessionAuditPanel />);
    await screen.findByText('Nenhuma sessão encontrada para os filtros.');

    getSessions.mockReturnValueOnce(new Promise(() => {}) as any);
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Nenhuma sessão encontrada para os filtros.')).not.toBeInTheDocument();
  });
});

describe('SessionAuditPanel errors', () => {
  it.each([
    ['the backend message', { response: { data: { message: 'Sem permissão' } } }, 'Sem permissão'],
    ['the backend error code', { response: { data: { error: 'FORBIDDEN' } } }, 'FORBIDDEN'],
    ['the fallback', new Error('network'), 'Erro ao carregar sessões'],
  ])('shows %s and clears the rows', async (_name, failure, text) => {
    const user = userEvent.setup();
    respond(page([row()]));
    render(<SessionAuditPanel />);
    await screen.findByTestId('session-audit-row');

    getSessions.mockRejectedValueOnce(failure);
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByTestId('session-audit-row')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhuma sessão encontrada para os filtros.')).not.toBeInTheDocument();
  });

  it('clears the error banner once a reload succeeds', async () => {
    const user = userEvent.setup();
    getSessions.mockRejectedValueOnce(new Error('network'));
    render(<SessionAuditPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao carregar sessões');

    respond(page([row()]));
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByTestId('session-audit-row');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('SessionAuditPanel pagination', () => {
  it('pages forward and back, bounding each button, and a filter change returns to page 1', async () => {
    const user = userEvent.setup();
    getSessions.mockImplementation(async (params) => {
      const current = params?.page ?? 1;
      return { data: { success: true, data: page([row({ id: `p${current}` })], { page: current, totalPages: 2, total: 30 }) } } as any;
    });
    render(<SessionAuditPanel />);

    expect(await screen.findByText('Página 1 de 2 (30 sessões)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Página 2 de 2 (30 sessões)')).toBeInTheDocument();
    expect(getSessions).toHaveBeenLastCalledWith({ page: 2, limit: 25, isRevoked: 'true' });
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Página 1 de 2 (30 sessões)')).toBeInTheDocument();
    expect(getSessions).toHaveBeenLastCalledWith({ page: 1, limit: 25, isRevoked: 'true' });

    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('Página 2 de 2 (30 sessões)');
    await user.selectOptions(screen.getByLabelText('Situação da sessão'), 'false');
    await waitFor(() =>
      expect(getSessions).toHaveBeenLastCalledWith({ page: 1, limit: 25, isRevoked: 'false' }),
    );
  });

  it('disables both pager buttons while a page is loading', async () => {
    const user = userEvent.setup();
    getSessions.mockResolvedValueOnce({
      data: { success: true, data: page([row()], { page: 2, totalPages: 3, total: 60 }) },
    } as any);
    render(<SessionAuditPanel />);
    await screen.findByText('Página 2 de 3 (60 sessões)');

    getSessions.mockReturnValueOnce(new Promise(() => {}) as any);
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });
});
