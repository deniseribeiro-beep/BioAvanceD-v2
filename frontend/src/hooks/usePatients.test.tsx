import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePatients } from './usePatients';
import { patientService } from '../services/api';

vi.mock('../services/api', () => ({
  patientService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(patientService.getAll);

function Harness() {
  const { patients, loading, error, refreshPatients } = usePatients();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="rows">{patients.map((patient) => `${patient.participantId}:${(patient as { consentStatus?: string }).consentStatus || ''}`).join(',')}</div>
      <button type="button" onClick={() => { void refreshPatients(); }}>refresh</button>
    </div>
  );
}

describe('usePatients silent refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAll.mockResolvedValue({ data: { data: { patients: [{ participantId: '12345678', consentStatus: 'PENDING' }], total: 1 } } } as any);
  });

  it('replaces the consent state without turning loading back on', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('12345678:PENDING'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    getAll.mockResolvedValueOnce({ data: { data: { patients: [{ participantId: '12345678', consentStatus: 'ACTIVE' }], total: 1 } } } as any);
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('12345678:ACTIVE'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('keeps the rows already on screen when the refresh fails', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('12345678:PENDING'));

    getAll.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('rows')).toHaveTextContent('12345678:PENDING');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('ignores a refresh that fails because the session is already gone', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('12345678:PENDING'));
    getAll.mockRejectedValueOnce({ code: 'NO_TOKEN_PROTECTED_REQUEST' });
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('rows')).toHaveTextContent('12345678:PENDING');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function FullHarness() {
  const api = usePatients();
  const [actionError, setActionError] = useState('');
  const rows = api.patients.map((patient) => patient.participantId).join(',');
  return (
    <div>
      <div data-testid="loading">{String(api.loading)}</div>
      <div data-testid="error">{api.error || ''}</div>
      <div data-testid="rows">{rows}</div>
      <div data-testid="total">{String(api.total)}</div>
      <div data-testid="action-error">{actionError}</div>
      <button type="button" onClick={() => { void api.loadPatients(); }}>load</button>
      <button type="button" onClick={() => { void api.createPatient({}).catch((err: Error) => setActionError(err.message)); }}>create</button>
      <button type="button" onClick={() => { void api.updatePatient('12345678', {}).catch((err: Error) => setActionError(err.message)); }}>update</button>
      <button type="button" onClick={() => { void api.deletePatient('12345678').catch((err: Error) => setActionError(err.message)); }}>delete</button>
    </div>
  );
}

describe('usePatients directory actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAll.mockResolvedValue({ data: { patients: [{ participantId: '12345678' }] } } as any);
    vi.mocked(patientService.create).mockResolvedValue({ data: { ok: true } } as any);
    vi.mocked(patientService.update).mockResolvedValue({ data: { ok: true } } as any);
    vi.mocked(patientService.delete).mockResolvedValue({ data: { ok: true } } as any);
  });

  it('reloads after create, update and delete', async () => {
    render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('12345678'));
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'create' }));
    await actor.click(screen.getByRole('button', { name: 'update' }));
    await actor.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(getAll.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(patientService.create).toHaveBeenCalled();
    expect(patientService.update).toHaveBeenCalledWith('12345678', {});
    expect(patientService.delete).toHaveBeenCalledWith('12345678');
  });

  it('wraps a network failure and rethrows an HTTP failure', async () => {
    vi.mocked(patientService.create).mockRejectedValueOnce(new Error('rede'));
    vi.mocked(patientService.update).mockRejectedValueOnce({ response: { data: { error: 'conflito' } }, message: 'conflito' });
    vi.mocked(patientService.delete).mockRejectedValueOnce(new Error('sumiu'));
    render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('rede'));
    await actor.click(screen.getByRole('button', { name: 'update' }));
    await actor.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('sumiu'));
  });

  it('shows the server message when the first load fails and stays quiet without a token', async () => {
    getAll.mockReset();
    getAll.mockRejectedValueOnce({ response: { data: { message: 'sem leitura' } } });
    const first = render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('sem leitura'));
    expect(screen.getByTestId('total')).toHaveTextContent('0');
    first.unmount();

    getAll.mockRejectedValueOnce({ code: 'NO_TOKEN_PROTECTED_REQUEST' });
    render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
    expect(screen.getByTestId('rows')).toHaveTextContent('');
  });

  it('keeps the newer list when an older load answers late', async () => {
    const late = deferred<{ data: { patients: { participantId: string }[] } }>();
    getAll.mockReset();
    getAll.mockImplementationOnce(() => late.promise);
    getAll.mockResolvedValue({ data: [{ participantId: '22222222' }] } as any);
    render(<FullHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'load' }));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('22222222'));
    late.resolve({ data: { patients: [{ participantId: '11111111' }] } });
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('rows')).toHaveTextContent('22222222');
  });

  it('reads a single participant object and an id used as the participant id', async () => {
    getAll.mockReset();
    getAll.mockResolvedValueOnce({ data: { participantId: '33333333' } } as any);
    const first = render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('33333333'));
    first.unmount();

    getAll.mockResolvedValueOnce({ data: { id: '44444444' } } as any);
    render(<FullHarness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('44444444'));
  });
});
