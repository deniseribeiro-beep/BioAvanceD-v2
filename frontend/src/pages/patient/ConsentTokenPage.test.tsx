import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConsentTokenPage from './ConsentTokenPage';
import { consentTokenService } from '../../services/api';

vi.mock('../../services/api', () => ({
  consentTokenService: {
    validate: vi.fn(),
    accept: vi.fn(),
    revoke: vi.fn(),
    signedTcle: vi.fn(),
  },
}));

const mocked = vi.mocked(consentTokenService);

const template = {
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
        template: templateOverride === undefined ? template : templateOverride,
        consent,
      },
    },
  } as any;
}

describe('ConsentTokenPage', () => {
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
          template,
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
          template,
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
