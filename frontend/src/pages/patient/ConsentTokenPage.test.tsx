import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// #1443: the participant page for the bulk consent token (#809, #821): the
// incomplete-link guard, the validate load and its error arms, the no-term
// state, the granular purposes with the required-purpose gate, the accept call
// and its success and error states, and a stale validate after the link changes.
const h = vi.hoisted(() => ({ validate: vi.fn(), accept: vi.fn() }));

vi.mock('../../services/api', () => ({
  consentTokenService: {
    validate: (...args: unknown[]) => h.validate(...args),
    accept: (...args: unknown[]) => h.accept(...args),
  },
}));

import ConsentTokenPage from './ConsentTokenPage';

function template(extra: Record<string, unknown> = {}) {
  return {
    id: 'T1',
    title: 'Termo do Biobanco',
    content: 'Texto do termo.',
    version: '2.0',
    permissions: [
      { key: 'storage', label: 'Armazenamento', required: true },
      { key: 'future', label: 'Pesquisas futuras' },
    ],
    ...extra,
  };
}

function validated(tpl: unknown) {
  return Promise.resolve({ data: { data: { valid: true, participantId: 'P1', template: tpl } } });
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
        <Route path="/patients/:id/consent" element={<ConsentTokenPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConsentTokenPage', () => {
  beforeEach(() => {
    h.validate.mockReset();
    h.accept.mockReset();
  });

  it('reports an incomplete link without calling the API', async () => {
    renderAt('/patients/undefined/consent?token=abc');
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent(
      'Este link de consentimento está incompleto.',
    );
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('shows the loading state while the token is validated', () => {
    h.validate.mockReturnValue(new Promise(() => {}));
    renderAt('/patients/P1/consent?token=tok');
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(h.validate).toHaveBeenCalledWith('P1', 'tok');
  });

  it('says no term is active when the token validates with no template', async () => {
    h.validate.mockReturnValue(validated(null));
    renderAt('/patients/P1/consent?token=tok');
    expect(await screen.findByTestId('consent-token-no-template')).toHaveTextContent(
      'Nenhum termo de consentimento está ativo no momento.',
    );
    expect(screen.queryByTestId('consent-token-accept')).not.toBeInTheDocument();
  });

  it('renders the term with its version and purposes, every purpose unticked', async () => {
    h.validate.mockReturnValue(validated(template()));
    renderAt('/patients/P1/consent?token=tok');
    expect(await screen.findByTestId('consent-token-title')).toHaveTextContent('Termo do Biobanco');
    expect(screen.getByText('Versão 2.0')).toBeInTheDocument();
    expect(screen.getByTestId('consent-token-content')).toHaveTextContent('Texto do termo.');
    expect(screen.getByTestId('consent-token-permissions')).toHaveTextContent('Armazenamento (obrigatória)');
    expect(screen.getByTestId('consent-token-permissions')).toHaveTextContent('Pesquisas futuras (opcional)');
    expect(screen.getByTestId('consent-token-permission-storage')).not.toBeChecked();
    expect(screen.getByTestId('consent-token-permission-future')).not.toBeChecked();
  });

  it('keeps accept disabled until every required purpose is ticked', async () => {
    h.validate.mockReturnValue(validated(template()));
    renderAt('/patients/P1/consent?token=tok');
    const button = await screen.findByTestId('consent-token-accept');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('consent-token-required-hint')).toHaveTextContent(
      'marque as finalidades obrigatórias: Armazenamento.',
    );

    fireEvent.click(screen.getByTestId('consent-token-permission-future'));
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByTestId('consent-token-permission-storage'));
    expect(button).toBeEnabled();
    expect(screen.queryByTestId('consent-token-required-hint')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('consent-token-permission-storage'));
    expect(button).toBeDisabled();
  });

  it('accepts with the term id and the answers, then confirms', async () => {
    h.validate.mockReturnValue(validated(template()));
    const pending = deferred<unknown>();
    h.accept.mockReturnValue(pending.promise);
    renderAt('/patients/P1/consent?token=tok');
    fireEvent.click(await screen.findByTestId('consent-token-permission-storage'));
    fireEvent.click(screen.getByTestId('consent-token-accept'));

    expect(h.accept).toHaveBeenCalledWith('P1', 'tok', {
      consentTemplateId: 'T1',
      responses: { storage: true, future: false },
    });
    expect(screen.getByTestId('consent-token-accept')).toHaveTextContent('Enviando...');
    expect(screen.getByTestId('consent-token-accept')).toBeDisabled();

    await act(async () => {
      pending.resolve({ data: { success: true } });
    });
    expect(screen.getByTestId('consent-token-success')).toHaveTextContent('Seu aceite foi confirmado');
  });

  it('enables accept at once for a term with no purposes and no version', async () => {
    h.validate.mockReturnValue(validated(template({ version: null, permissions: [] })));
    renderAt('/patients/P1/consent?token=tok');
    expect(await screen.findByTestId('consent-token-accept')).toBeEnabled();
    expect(screen.queryByText(/^Versão/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('consent-token-permissions')).not.toBeInTheDocument();
  });

  it('maps a rejected accept to the republished-term message', async () => {
    h.validate.mockReturnValue(validated(template({ permissions: [] })));
    h.accept.mockRejectedValue({ response: { status: 422 } });
    renderAt('/patients/P1/consent?token=tok');
    fireEvent.click(await screen.findByTestId('consent-token-accept'));
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent(
      'O termo de consentimento foi atualizado',
    );
  });

  it('maps an expired token to the invalid-link message', async () => {
    h.validate.mockRejectedValue({ response: { status: 400 } });
    renderAt('/patients/P1/consent?token=tok');
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent(
      'Link inválido ou expirado.',
    );
  });

  it('maps a validate timeout to the link-still-valid message', async () => {
    h.validate.mockRejectedValue({ code: 'ECONNABORTED' });
    renderAt('/patients/P1/consent?token=tok');
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent(
      'Não foi possível falar com o serviço de consentimento.',
    );
  });

  it('ignores a validate that resolves after the link changed', async () => {
    const stale = deferred<unknown>();
    h.validate.mockImplementation((_id: string, token: string) =>
      token === 'old' ? stale.promise : validated(template({ title: 'Termo novo' })),
    );
    renderAt('/patients/P1/consent?token=old', '/patients/P1/consent?token=new');
    fireEvent.click(screen.getByText('go'));
    expect(await screen.findByTestId('consent-token-title')).toHaveTextContent('Termo novo');

    await act(async () => {
      stale.resolve({ data: { data: { template: template({ title: 'Termo antigo' }) } } });
    });
    expect(screen.getByTestId('consent-token-title')).toHaveTextContent('Termo novo');
  });

  it('ignores a validate that fails after the link changed', async () => {
    const stale = deferred<unknown>();
    h.validate.mockImplementation((_id: string, token: string) =>
      token === 'old' ? stale.promise : validated(template({ title: 'Termo novo' })),
    );
    renderAt('/patients/P1/consent?token=old', '/patients/P1/consent?token=new');
    fireEvent.click(screen.getByText('go'));
    expect(await screen.findByTestId('consent-token-title')).toHaveTextContent('Termo novo');

    await act(async () => {
      stale.reject({ response: { status: 400 } });
    });
    await waitFor(() => expect(screen.queryByTestId('consent-token-error')).not.toBeInTheDocument());
    expect(screen.getByTestId('consent-token-title')).toHaveTextContent('Termo novo');
  });
});
