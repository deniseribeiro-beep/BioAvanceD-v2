import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InPersonConsentModal from './InPersonConsentModal';
import { consentService } from '../../services/api';

vi.mock('./SignaturePad', () => ({
  default: ({ onConfirm }: { onConfirm: (value: string) => void }) => (
    <button type="button" onClick={() => onConfirm('data:image/png;base64,AAAA')}>pad-confirm</button>
  ),
}));

vi.mock('../../services/api', () => ({
  consentService: {
    getActiveTemplate: vi.fn(),
    createPatientConsent: vi.fn(),
  },
}));

const getActiveTemplate = vi.mocked(consentService.getActiveTemplate);
const createPatientConsent = vi.mocked(consentService.createPatientConsent);

const template = {
  _id: 'tpl-1',
  title: 'TCLE',
  content: 'Texto do termo',
  permissions: [
    { key: 'storage', label: 'Guarda', required: true },
    { key: 'contact', label: 'Contato', required: false },
  ],
};

describe('InPersonConsentModal', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    onSaved.mockResolvedValue(undefined);
  });

  it('shows the active term and saves after the required permission, the place and the signature', async () => {
    getActiveTemplate.mockResolvedValue({ data: { data: template } } as never);
    createPatientConsent.mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(
      <InPersonConsentModal
        isOpen
        participantId="12345678"
        title="Coletar assinatura"
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    expect(await screen.findByText('TCLE')).toBeInTheDocument();
    expect(screen.getByTestId('in-person-consent-term')).toHaveTextContent('Texto do termo');
    await user.click(screen.getByTestId('confirm-in-person-consent'));
    expect(window.alert).toHaveBeenCalledWith('Informe o local da coleta da assinatura.');

    await user.type(screen.getByTestId('collection-place-input'), '  Sala 2  ');
    await user.click(screen.getByTestId('confirm-in-person-consent'));
    expect(window.alert).toHaveBeenCalledWith('Confirme a assinatura no quadro antes de salvar.');

    await user.click(screen.getByText('pad-confirm'));
    await user.click(screen.getByTestId('confirm-in-person-consent'));
    expect(window.alert).toHaveBeenCalledWith('Aceite as permissões obrigatórias do TCLE.');

    await user.click(screen.getByTestId('in-person-permission-storage'));
    await user.click(screen.getByTestId('in-person-permission-contact'));
    await user.click(screen.getByTestId('in-person-permission-contact'));
    await user.click(screen.getByTestId('confirm-in-person-consent'));

    await waitFor(() => expect(createPatientConsent).toHaveBeenCalledWith(expect.objectContaining({
      participantId: '12345678',
      templateId: 'tpl-1',
      collectionPlace: 'Sala 2',
      responses: { storage: true, contact: false },
      signatureImageBase64: 'data:image/png;base64,AAAA',
    })));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reads a template returned at the top of the payload', async () => {
    getActiveTemplate.mockResolvedValue({ data: template } as never);
    render(
      <InPersonConsentModal isOpen participantId="12345678" title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    expect(await screen.findByText('TCLE')).toBeInTheDocument();
  });

  it('says when there is no active term', async () => {
    getActiveTemplate.mockResolvedValue({ data: { data: null } } as never);
    render(
      <InPersonConsentModal isOpen participantId="12345678" title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    expect(await screen.findByTestId('in-person-consent-error')).toHaveTextContent('Nenhum TCLE ativo para coletar a assinatura.');
  });

  it('says when the active term cannot be loaded', async () => {
    getActiveTemplate.mockRejectedValue(new Error('offline'));
    render(
      <InPersonConsentModal isOpen participantId="12345678" title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    expect(await screen.findByTestId('in-person-consent-error')).toHaveTextContent('Não foi possível carregar o TCLE ativo.');
  });

  it('shows the provider message when the signature is refused', async () => {
    getActiveTemplate.mockResolvedValue({
      data: { data: { _id: 'tpl-1', title: 'TCLE', htmlContent: '<p>Termo</p>', permissions: [] } },
    } as never);
    createPatientConsent.mockRejectedValue({ response: { data: { message: 'Termo recusado' } } });
    const user = userEvent.setup();
    render(
      <InPersonConsentModal isOpen participantId="12345678" title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    await screen.findByTestId('collection-place-input');
    await user.type(screen.getByTestId('collection-place-input'), 'Sala');
    await user.click(screen.getByText('pad-confirm'));
    await user.click(screen.getByTestId('confirm-in-person-consent'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Termo recusado'));
    expect(screen.getByTestId('confirm-in-person-consent')).toHaveTextContent('Salvar assinatura');
  });

  it('does not save without a participant', async () => {
    getActiveTemplate.mockResolvedValue({ data: { data: { _id: 'tpl-1', title: 'TCLE', permissions: [] } } } as never);
    const user = userEvent.setup();
    render(
      <InPersonConsentModal isOpen participantId={null} title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    await screen.findByTestId('collection-place-input');
    await user.type(screen.getByTestId('collection-place-input'), 'Sala');
    await user.click(screen.getByText('pad-confirm'));
    await user.click(screen.getByTestId('confirm-in-person-consent'));
    expect(createPatientConsent).not.toHaveBeenCalled();
  });

  it('does not load a term while the modal is closed', () => {
    render(
      <InPersonConsentModal isOpen={false} participantId="12345678" title="Coletar" onClose={onClose} onSaved={onSaved} />
    );
    expect(getActiveTemplate).not.toHaveBeenCalled();
  });
});
