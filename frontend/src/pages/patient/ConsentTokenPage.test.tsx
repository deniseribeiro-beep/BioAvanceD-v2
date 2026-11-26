import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// #1443: the participant page for the bulk consent token (#809, #821): the
// incomplete-link guard, the validate load and its error arms, the no-term
// state, the granular purposes with the required-purpose gate, the accept call
// and its success and error states, and a stale validate after the link changes.
const h = vi.hoisted(() => ({ validate: vi.fn(), accept: vi.fn(), revoke: vi.fn(), signedTcle: vi.fn() }));

vi.mock('../../services/api', () => ({
  consentTokenService: {
    validate: h.validate,
    accept: h.accept,
    revoke: h.revoke,
    signedTcle: h.signedTcle,
  },
}));

import ConsentTokenPage from './ConsentTokenPage';
import { consentTokenService } from '../../services/api';

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
    expect(await screen.findByTestId('consent-token-success')).toHaveTextContent('Aceite registrado');
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

const mocked = vi.mocked(consentTokenService);

const panelTemplate = {
  id: 'tpl-1',
  title: 'TCLE Biobanco',
  content: 'Texto do termo de consentimento.',
  version: '2.0',
  permissions: [
    { key: 'research', label: 'Uso em pesquisa', required: true },
    { key: 'contact', label: 'Novo contato', required: false },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/patients/58354915/consent?token=tok']}>
      <Routes>
        <Route path="/patients/:id/consent" element={<ConsentTokenPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function validatePayload(panel: string, consent: Record<string, unknown> | null, templateOverride?: unknown) {
  return {
    data: {
      success: true,
      data: {
        valid: true,
        participantId: '58354915',
        panel,
        template: templateOverride === undefined ? panelTemplate : templateOverride,
        consent,
      },
    },
  } as any;
}

describe('ConsentTokenPage: signed term, panels and revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail?: () => void) => fail?.() },
    });
  });

  it('shows the term cards and opens or downloads the signed file', async () => {
    mocked.validate.mockResolvedValue({
      data: {
        success: true,
        data: {
          valid: true,
          participantId: '58354915',
          panel: 'manage',
          template: panelTemplate,
          consent: {
            participantId: '58354915',
            status: 'ACTIVE',
            currentStateDerived: 'active',
            signedAt: '2026-11-05T18:45:07.000Z',
            hasSignedTcle: true,
            effectivePermissions: { research: true, contact: true },
          },
        },
      },
    } as any);
    mocked.signedTcle.mockResolvedValue({ data: new Blob(['%PDF-'], { type: 'application/pdf' }) } as any);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tcle');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByTestId('consent-token-title')).toHaveTextContent('TCLE Biobanco');
    expect(screen.getByTestId('consent-token-participant')).toHaveTextContent('Participante 58354915');
    expect(screen.getByTestId('consent-token-content')).toHaveTextContent('Texto do termo de consentimento.');
    expect(screen.getByTestId('consent-token-signed')).toHaveTextContent('Termo assinado');
    expect(screen.getByTestId('consent-token-manage')).toBeInTheDocument();
    expect(screen.getByTestId('consent-token-revoke-all')).toBeInTheDocument();

    await user.click(screen.getByTestId('consent-token-view'));
    await waitFor(() => expect(mocked.signedTcle).toHaveBeenCalledWith('58354915', 'tok'));
    expect(open).toHaveBeenCalledWith('blob:tcle', '_blank', 'noopener');

    await user.click(screen.getByTestId('consent-token-download'));
    await waitFor(() => expect(mocked.signedTcle).toHaveBeenCalledTimes(2));
  });

  it('says when this consent has no signed file', async () => {
    mocked.validate.mockResolvedValue({
      data: {
        success: true,
        data: {
          valid: true,
          participantId: '58354915',
          panel: 'pending',
          template: panelTemplate,
          consent: null,
        },
      },
    } as any);

    renderPage();

    expect(await screen.findByTestId('consent-token-signed-missing')).toHaveTextContent('Não há termo assinado em arquivo.');
    expect(screen.getByTestId('consent-token-accept')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-token-view')).not.toBeInTheDocument();
  });

  it('refuses an incomplete link, a failed load and a term that is not published', async () => {
    const incomplete = render(
      <MemoryRouter initialEntries={['/patients/58354915/consent']}>
        <Routes>
          <Route path="/patients/:id/consent" element={<ConsentTokenPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('link de consentimento está incompleto');
    incomplete.unmount();

    mocked.validate.mockRejectedValueOnce({ response: { status: 400 } });
    const failed = renderPage();
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('Link inválido ou expirado');
    failed.unmount();

    mocked.validate.mockRejectedValueOnce({ code: 'ECONNABORTED', request: {} });
    const offline = renderPage();
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('Não foi possível falar com o serviço');
    offline.unmount();

    mocked.validate.mockResolvedValueOnce(validatePayload('pending', null, null));
    renderPage();
    expect(await screen.findByTestId('consent-token-no-template')).toHaveTextContent('Nenhum termo de consentimento está ativo');
  });

  it('records the acceptance once the required purpose is marked', async () => {
    mocked.validate.mockResolvedValue(validatePayload('pending', null));
    mocked.accept.mockResolvedValue({ data: { success: true } } as any);
    const actor = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId('consent-token-required-hint')).toHaveTextContent('Uso em pesquisa');
    expect(screen.getByTestId('consent-token-accept')).toBeDisabled();
    await actor.click(screen.getByTestId('consent-token-permission-research'));
    expect(screen.getByTestId('consent-token-accept')).toBeEnabled();

    mocked.validate.mockResolvedValueOnce(validatePayload('manage', {
      status: 'ACTIVE',
      currentStateDerived: 'active',
      hasSignedTcle: false,
      effectivePermissions: { research: true },
    }));
    await actor.click(screen.getByTestId('consent-token-accept'));
    expect(await screen.findByTestId('consent-token-notice')).toHaveTextContent('Aceite registrado');
    expect(mocked.accept).toHaveBeenCalledWith('58354915', 'tok', {
      consentTemplateId: 'tpl-1',
      responses: { research: true, contact: false },
    });
  });

  it('shows the accept failure and each closed state', async () => {
    mocked.validate.mockResolvedValue(validatePayload('pending', null));
    mocked.accept.mockRejectedValueOnce({ response: { status: 422 } });
    const actor = userEvent.setup();
    const pending = renderPage();
    await actor.click(await screen.findByTestId('consent-token-permission-research'));
    await actor.click(screen.getByTestId('consent-token-accept'));
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('termo de consentimento foi atualizado');
    pending.unmount();

    for (const [state, label] of [
      ['revoked', 'Revogado'],
      ['partially_revoked', 'Parcialmente revogado'],
      ['superseded', 'Substituído'],
      ['active', 'Ativo'],
    ] as const) {
      mocked.validate.mockResolvedValueOnce(validatePayload('closed', {
        status: 'REVOKED',
        currentStateDerived: state,
        signedAt: null,
        hasSignedTcle: false,
        effectivePermissions: {},
      }));
      const view = renderPage();
      expect(await screen.findByTestId('consent-token-closed')).toBeInTheDocument();
      expect(screen.getByText(`Estado: ${label}`)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('revokes the whole term or the marked permissions and reports a file that will not open', async () => {
    const manage = {
      status: 'ACTIVE',
      currentStateDerived: 'active',
      signedAt: '2026-11-05T18:45:07.000Z',
      hasSignedTcle: true,
      effectivePermissions: { research: true, contact: true },
    };
    mocked.validate.mockResolvedValue(validatePayload('manage', manage));
    mocked.revoke.mockResolvedValue({ data: { success: true } } as any);
    mocked.signedTcle.mockRejectedValueOnce(new Error('storage'));
    const actor = userEvent.setup();
    renderPage();

    await actor.click(await screen.findByTestId('consent-token-view'));
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('Não foi possível abrir o termo assinado');

    expect(screen.getByTestId('consent-token-revoke-selected')).toBeDisabled();
    await actor.click(screen.getByTestId('consent-token-revoke-research'));
    await actor.click(screen.getByTestId('consent-token-revoke-research'));
    await actor.click(screen.getByTestId('consent-token-revoke-research'));
    await actor.click(screen.getByTestId('consent-token-revoke-selected'));
    await waitFor(() => expect(mocked.revoke).toHaveBeenCalledWith('58354915', 'tok', expect.objectContaining({
      scope: ['research'],
      location: { status: 'unavailable' },
    })));
    expect(await screen.findByTestId('consent-token-notice')).toHaveTextContent('Revogação registrada');

    mocked.revoke.mockRejectedValueOnce({ response: { status: 503 } });
    await actor.click(screen.getByTestId('consent-token-revoke-all'));
    expect(await screen.findByTestId('consent-token-error')).toHaveTextContent('temporariamente indisponível');
  });
});
