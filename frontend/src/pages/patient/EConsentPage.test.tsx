import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// #1443: the participant page for the JWT e-consent link (#822): the
// validate load with its prior answers and its error arms, the
// no-term state, saving the ticked layers, "Revogar Todos", the submit error
// arms, and a stale validate after the link changes.
const h = vi.hoisted(() => ({ validate: vi.fn(), update: vi.fn() }));

vi.mock('../../services/api', () => ({
  eConsentService: {
    validate: (...args: unknown[]) => h.validate(...args),
    update: (...args: unknown[]) => h.update(...args),
  },
}));

import EConsentPage from './EConsentPage';

function template(extra: Record<string, unknown> = {}) {
  return {
    id: 'T1',
    title: 'Termo do Biobanco',
    permissions: [
      { key: 'storage', label: 'Armazenamento', required: true },
      { key: 'future', label: 'Pesquisas futuras' },
    ],
    ...extra,
  };
}

function validated(data: Record<string, unknown>) {
  return Promise.resolve({ data });
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
        <Route path="/patient/e-consent/:token" element={<EConsentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function box(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('EConsentPage', () => {
  beforeEach(() => {
    h.validate.mockReset();
    h.update.mockReset();
  });

  it('shows the loading state while the token is validated', () => {
    h.validate.mockReturnValue(new Promise(() => {}));
    renderAt('/patient/e-consent/tok');
    expect(screen.getByTestId('e-consent-loading')).toHaveTextContent('Carregando...');
    expect(h.validate).toHaveBeenCalledWith('tok');
  });

  it('greets the participant and pre-ticks only the layers already accepted', async () => {
    h.validate.mockReturnValue(
      validated({ patient: { patientName: 'Maria' }, template: template(), responses: { storage: true, future: false } }),
    );
    renderAt('/patient/e-consent/tok');
    expect(await screen.findByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Maria!');
    expect(box('Armazenamento')).toBeChecked();
    expect(box('Pesquisas futuras')).not.toBeChecked();
  });

  it('falls back to "Paciente" and unticked boxes when the link carries no name or answers', async () => {
    h.validate.mockReturnValue(validated({ patient: null, template: template(), responses: {} }));
    renderAt('/patient/e-consent/tok');
    expect(await screen.findByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Paciente!');
    expect(box('Armazenamento')).not.toBeChecked();
    expect(box('Pesquisas futuras')).not.toBeChecked();
  });

  it('says no term is active when the token validates with no template', async () => {
    h.validate.mockReturnValue(validated({ patient: { patientName: 'Maria' }, template: null, responses: {} }));
    renderAt('/patient/e-consent/tok');
    expect(await screen.findByTestId('e-consent-no-template')).toHaveTextContent(
      'Nenhum termo de consentimento ativo no momento.',
    );
    expect(screen.queryByTestId('e-consent-submit')).not.toBeInTheDocument();
  });

  it('maps a 404 validate to the not-found message', async () => {
    h.validate.mockRejectedValue({ response: { status: 404 } });
    renderAt('/patient/e-consent/tok');
    expect(await screen.findByTestId('e-consent-error')).toHaveTextContent('Não encontramos seu cadastro.');
  });

  it('maps a validate timeout to the link-still-valid message', async () => {
    h.validate.mockRejectedValue({ code: 'ECONNABORTED' });
    renderAt('/patient/e-consent/tok');
    expect(await screen.findByTestId('e-consent-error')).toHaveTextContent(
      'Não foi possível falar com o serviço de consentimento.',
    );
  });

  it('saves every layer of the term, ticked as ACCEPTED and unticked as REVOKED, then confirms', async () => {
    h.validate.mockReturnValue(validated({ patient: null, template: template(), responses: { storage: true } }));
    const pending = deferred<unknown>();
    h.update.mockReturnValue(pending.promise);
    renderAt('/patient/e-consent/tok');
    fireEvent.click(await screen.findByLabelText('Pesquisas futuras'));
    fireEvent.click(box('Armazenamento'));
    expect(box('Pesquisas futuras')).toBeChecked();
    expect(box('Armazenamento')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('e-consent-submit'));

    expect(h.update).toHaveBeenCalledWith('tok', [
      { key: 'storage', status: 'REVOKED' },
      { key: 'future', status: 'ACCEPTED' },
    ]);
    expect(screen.queryByTestId('e-consent-success')).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve({ data: { success: true } });
    });
    expect(screen.getByTestId('e-consent-success')).toHaveTextContent('Consentimento atualizado com sucesso!');
  });

  it('"Revogar Todos" unticks every layer and sends each one as REVOKED', async () => {
    h.validate.mockReturnValue(
      validated({ patient: null, template: template(), responses: { storage: true, future: true } }),
    );
    const pending = deferred<unknown>();
    h.update.mockReturnValue(pending.promise);
    renderAt('/patient/e-consent/tok');
    fireEvent.click(await screen.findByTestId('e-consent-revoke-all'));

    expect(h.update).toHaveBeenCalledWith('tok', [
      { key: 'storage', status: 'REVOKED' },
      { key: 'future', status: 'REVOKED' },
    ]);
    expect(box('Armazenamento')).not.toBeChecked();
    expect(box('Pesquisas futuras')).not.toBeChecked();
    await act(async () => {
      pending.resolve({ data: { success: true } });
    });
    expect(screen.getByTestId('e-consent-success')).toBeInTheDocument();
  });

  it('maps a 422 on save to the team-notified message', async () => {
    h.validate.mockReturnValue(validated({ patient: null, template: template(), responses: {} }));
    h.update.mockRejectedValue({ response: { status: 422 } });
    renderAt('/patient/e-consent/tok');
    fireEvent.click(await screen.findByTestId('e-consent-submit'));
    expect(await screen.findByTestId('e-consent-error')).toHaveTextContent(
      'A equipe do biobanco foi notificada.',
    );
    expect(screen.queryByTestId('e-consent-success')).not.toBeInTheDocument();
  });

  it('maps a save timeout to the could-not-confirm message', async () => {
    h.validate.mockReturnValue(validated({ patient: null, template: template(), responses: {} }));
    h.update.mockRejectedValue({ code: 'ECONNABORTED' });
    renderAt('/patient/e-consent/tok');
    fireEvent.click(await screen.findByTestId('e-consent-submit'));
    expect(await screen.findByTestId('e-consent-error')).toHaveTextContent(
      'Não foi possível confirmar o registro do seu consentimento.',
    );
  });

  it('ignores a validate that resolves after the link changed', async () => {
    const stale = deferred<unknown>();
    h.validate.mockImplementation((token: string) =>
      token === 'old' ? stale.promise : validated({ patient: { patientName: 'Nova' }, template: template(), responses: {} }),
    );
    renderAt('/patient/e-consent/old', '/patient/e-consent/new');
    fireEvent.click(screen.getByText('go'));
    expect(await screen.findByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Nova!');

    await act(async () => {
      stale.resolve({ data: { patient: { patientName: 'Antiga' }, template: template(), responses: {} } });
    });
    expect(screen.getByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Nova!');
  });

  it('ignores a validate that fails after the link changed', async () => {
    const stale = deferred<unknown>();
    h.validate.mockImplementation((token: string) =>
      token === 'old' ? stale.promise : validated({ patient: { patientName: 'Nova' }, template: template(), responses: {} }),
    );
    renderAt('/patient/e-consent/old', '/patient/e-consent/new');
    fireEvent.click(screen.getByText('go'));
    expect(await screen.findByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Nova!');

    await act(async () => {
      stale.reject({ response: { status: 404 } });
    });
    expect(screen.queryByTestId('e-consent-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Nova!');
  });

  it.each([
    ['resolves', (d: ReturnType<typeof deferred<unknown>>) =>
      d.resolve({ data: { patient: { patientName: 'Antiga' }, template: template(), responses: {} } })],
    ['fails', (d: ReturnType<typeof deferred<unknown>>) => d.reject({ response: { status: 404 } })],
  ])('keeps loading the new link when a stale validate %s first', async (_how, settle) => {
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    h.validate.mockImplementation((token: string) => (token === 'old' ? stale.promise : fresh.promise));
    renderAt('/patient/e-consent/old', '/patient/e-consent/new');
    fireEvent.click(screen.getByText('go'));

    await act(async () => {
      settle(stale);
    });
    expect(screen.getByTestId('e-consent-loading')).toBeInTheDocument();

    await act(async () => {
      fresh.resolve({ data: { patient: { patientName: 'Nova' }, template: template(), responses: {} } });
    });
    expect(screen.getByTestId('e-consent-patient')).toHaveTextContent('Bem-vindo, Nova!');
  });
});
