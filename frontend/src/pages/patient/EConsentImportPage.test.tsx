import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// #1443: the participant page for the FHIR import consent link (#822): the
// validate load and its fallbacks, a route with no token, the validate error
// arms, accepting with its in-flight state, the accept error arms, and a stale
// validate after the link changes.
const h = vi.hoisted(() => ({ validate: vi.fn(), accept: vi.fn() }));

vi.mock('../../services/api', () => ({
  eConsentService: {
    validateImportConsent: (...args: unknown[]) => h.validate(...args),
    acceptImportConsent: (...args: unknown[]) => h.accept(...args),
  },
}));

import EConsentImportPage from './EConsentImportPage';

const LOADING = 'Carregando...';
const BUTTON = 'Aceitar consentimento';

function payload(extra: Record<string, unknown> = {}) {
  return { success: true, patientName: 'Maria', patientEmail: 'maria@example.org', status: 'PENDING', ...extra };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function GoTo({ path }: { path: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(path)}>go</button>;
}

function renderAt(path: string, goTo?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {goTo && <GoTo path={goTo} />}
      <Routes>
        <Route path="/patient/e-consent/import/:token" element={<EConsentImportPage />} />
        <Route path="/patient/e-consent/import" element={<EConsentImportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EConsentImportPage', () => {
  beforeEach(() => {
    h.validate.mockReset();
    h.accept.mockReset();
  });

  it('shows the loading state while the token is validated', () => {
    h.validate.mockReturnValue(new Promise(() => {}));
    renderAt('/patient/e-consent/import/tok');
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(h.validate).toHaveBeenCalledWith('tok');
  });

  it('shows the patient, e-mail and status the link carries', async () => {
    h.validate.mockResolvedValue({ data: payload() });
    renderAt('/patient/e-consent/import/tok');
    expect(await screen.findByText('Paciente: Maria')).toBeInTheDocument();
    expect(screen.getByText('E-mail: maria@example.org')).toBeInTheDocument();
    expect(screen.getByText('Status atual: PENDING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('falls back to placeholders when the link carries no name, e-mail or status', async () => {
    h.validate.mockResolvedValue({ data: { success: true } });
    renderAt('/patient/e-consent/import/tok');
    expect(await screen.findByText('Paciente: Paciente')).toBeInTheDocument();
    expect(screen.getByText('E-mail: Não informado')).toBeInTheDocument();
    expect(screen.getByText('Status atual: DESCONHECIDO')).toBeInTheDocument();
  });

  it('says the link is invalid without calling the backend when the route has no token', async () => {
    renderAt('/patient/e-consent/import');
    expect(await screen.findByText('Link inválido ou expirado. Solicite novo acesso.')).toBeInTheDocument();
    expect(h.validate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
  });

  it.each([
    ['a 401', { response: { status: 401 } }, 'Link inválido ou expirado. Solicite novo acesso.'],
    ['a 404', { response: { status: 404 } }, 'Não encontramos seu cadastro.'],
    ['a timeout', { code: 'ECONNABORTED' }, 'Não foi possível falar com o serviço de consentimento.'],
    ['a local fault', new Error('boom'), 'Não foi possível carregar seu termo de consentimento.'],
  ])('maps %s on validate to its message', async (_label, failure, message) => {
    h.validate.mockRejectedValue(failure);
    renderAt('/patient/e-consent/import/tok');
    expect(await screen.findByText(message, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
  });

  it('accepts once, disables the button while sending, then confirms', async () => {
    h.validate.mockResolvedValue({ data: payload() });
    const pending = deferred<unknown>();
    h.accept.mockReturnValue(pending.promise);
    renderAt('/patient/e-consent/import/tok');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));

    const sending = screen.getByRole('button', { name: 'Enviando...' });
    expect(sending).toBeDisabled();
    fireEvent.click(sending);
    expect(h.accept).toHaveBeenCalledTimes(1);
    expect(h.accept).toHaveBeenCalledWith('tok');
    expect(screen.queryByText('Consentimento de importação assinado com sucesso!')).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({ data: payload({ status: 'SIGNED', consentSigned: true }) });
    });
    expect(screen.getByText('Consentimento de importação assinado com sucesso!')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['a 400', { response: { status: 400 } }, 'Link inválido ou expirado. Solicite novo acesso.'],
    ['a 422', { response: { status: 422 } }, 'A equipe do biobanco foi notificada.'],
    ['a timeout', { code: 'ECONNABORTED' }, 'Não foi possível confirmar o registro do seu consentimento.'],
    ['a 500', { response: { status: 500 } }, 'Erro ao atualizar consentimento.'],
  ])('maps %s on accept to its message and shows no success', async (_label, failure, message) => {
    h.validate.mockResolvedValue({ data: payload() });
    h.accept.mockRejectedValue(failure);
    renderAt('/patient/e-consent/import/tok');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    expect(await screen.findByText(message, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Consentimento de importação assinado com sucesso!')).not.toBeInTheDocument();
  });

  it.each([
    ['resolves', (d: ReturnType<typeof deferred<unknown>>) => d.resolve({ data: payload({ patientName: 'Antiga' }) })],
    ['fails', (d: ReturnType<typeof deferred<unknown>>) => d.reject({ response: { status: 404 } })],
  ])('ignores a validate that %s after the link changed', async (_how, settle) => {
    const stale = deferred<unknown>();
    h.validate.mockImplementation((token: string) =>
      token === 'old' ? stale.promise : Promise.resolve({ data: payload({ patientName: 'Nova' }) }),
    );
    renderAt('/patient/e-consent/import/old', '/patient/e-consent/import/new');
    fireEvent.click(screen.getByText('go'));
    expect(await screen.findByText('Paciente: Nova')).toBeInTheDocument();

    await act(async () => {
      settle(stale);
    });
    expect(screen.getByText('Paciente: Nova')).toBeInTheDocument();
    expect(screen.queryByText('Não encontramos seu cadastro.', { exact: false })).not.toBeInTheDocument();
  });

  it.each([
    ['resolves', (d: ReturnType<typeof deferred<unknown>>) => d.resolve({ data: payload({ patientName: 'Antiga' }) })],
    ['fails', (d: ReturnType<typeof deferred<unknown>>) => d.reject({ response: { status: 404 } })],
  ])('keeps loading the new link when a stale validate %s first', async (_how, settle) => {
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    h.validate.mockImplementation((token: string) => (token === 'old' ? stale.promise : fresh.promise));
    renderAt('/patient/e-consent/import/old', '/patient/e-consent/import/new');
    fireEvent.click(screen.getByText('go'));

    await act(async () => {
      settle(stale);
    });
    expect(screen.getByText(LOADING)).toBeInTheDocument();

    await act(async () => {
      fresh.resolve({ data: payload({ patientName: 'Nova' }) });
    });
    expect(screen.getByText('Paciente: Nova')).toBeInTheDocument();
  });
});
