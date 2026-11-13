import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ConsentHistoryPage from './ConsentHistoryPage';
import { consentService } from '../services/api';
import type { ConsentHistory, PatientConsent } from '../types/models';

vi.mock('../services/api', () => ({
  consentService: { getPatientConsent: vi.fn(), getConsentHistory: vi.fn(), revokeConsent: vi.fn(), getSignedTcle: vi.fn() },
}));

const CONSENT_ID = '68ab12cd34ef56ab78cd90ef';

const consent: PatientConsent = {
  _id: CONSENT_ID,
  consentId: 'c-uuid-1',
  participantId: 'P1',
  consentTemplateId: 'tpl-1',
  status: 'ACTIVE',
  responses: { storage: true, contact: true },
  effectivePermissions: { storage: true, contact: true },
  currentStateDerived: 'active',
};

const activeHistory: ConsentHistory = {
  consentId: 'c-uuid-1',
  participantId: 'P1',
  currentStateDerived: 'active',
  supersededByConsentId: null,
  supersedesConsentId: null,
  permissions: [
    { permissionCode: 'storage', purpose: { code: 'DUO:0000004', display: 'Armazenamento de amostras' }, decision: 'permit' },
    { permissionCode: 'contact', purpose: { code: 'DUO:0000045', display: 'Contato futuro' }, decision: 'permit' },
  ],
  decisionEvents: [{
    consentDecisionEventId: 'ev-1',
    decision: 'accepted',
    occurredAt: '2026-10-01T12:00:00.000Z',
    channel: 'staff_portal',
    signerRole: 'participant',
    signerId: 'P1',
    authenticationLevel: 'session',
  }],
  revocations: [],
};

const mocked = vi.mocked(consentService);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/consents?participantId=P1']}>
      <ConsentHistoryPage />
    </MemoryRouter>
  );
}

describe('ConsentHistoryPage (#1375, RF010 AC5/AC6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocked.getPatientConsent.mockResolvedValue({ data: { success: true, data: consent } } as any);
    mocked.getConsentHistory.mockResolvedValue({ data: { success: true, data: activeHistory } } as any);
    mocked.revokeConsent.mockResolvedValue({ data: { success: true, data: consent } } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads from the participantId query parameter and shows the state, the permissions and the accepted event', async () => {
    renderPage();
    expect(await screen.findByTestId('consent-state')).toHaveTextContent('Ativo');
    expect(screen.getByTestId('signed-tcle-missing')).toBeInTheDocument();
    expect(mocked.getPatientConsent).toHaveBeenCalledWith('P1');
    expect(mocked.getConsentHistory).toHaveBeenCalledWith(CONSENT_ID);
    expect(screen.getByTestId('consent-permission-storage')).toHaveTextContent('Armazenamento de amostras');
    expect(screen.getByTestId('consent-permission-contact')).toHaveTextContent('Contato futuro');
    const events = within(screen.getByTestId('consent-decision-events'));
    expect(events.getByText('accepted')).toBeInTheDocument();
    expect(events.getByText('staff_portal')).toBeInTheDocument();
  });

  it('revokes the ticked permissions with the reason, then reloads the consent and its history', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('revoke-scope-contact'));
    await user.type(screen.getByLabelText('Motivo'), 'Pedido do participante');
    await user.click(screen.getByTestId('revoke-selected-button'));

    await waitFor(() => expect(mocked.getConsentHistory).toHaveBeenCalledTimes(2));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocked.revokeConsent).toHaveBeenCalledWith(CONSENT_ID, { scope: ['contact'], reason: 'Pedido do participante' });
    expect(mocked.getPatientConsent).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Revogação registrada.')).toBeInTheDocument();
  });

  it('revokes the whole consent with an empty body when the reason is blank', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Motivo'), '   ');
    await user.click(screen.getByTestId('revoke-all-button'));
    await waitFor(() => expect(mocked.revokeConsent).toHaveBeenCalledWith(CONSENT_ID, {}));
  });

  it('keeps the selected-permissions revoke disabled while no box is ticked', async () => {
    renderPage();
    expect(await screen.findByTestId('revoke-selected-button')).toBeDisabled();
  });

  it('shows the message of a refused revoke and lists its details', async () => {
    mocked.revokeConsent.mockRejectedValue({
      response: { status: 422, data: { message: 'Escopo inválido', details: [{ message: 'unknown não é uma permissão deste consentimento' }] } },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('revoke-all-button'));
    const alert = await screen.findByTestId('consent-error');
    expect(alert).toHaveTextContent('Escopo inválido');
    expect(alert).toHaveTextContent('unknown não é uma permissão deste consentimento');
  });

  it('hides the revoke form for a revoked consent and shows the revocation of every use', async () => {
    mocked.getPatientConsent.mockResolvedValue({
      data: { success: true, data: { ...consent, status: 'REVOKED', currentStateDerived: 'revoked', effectivePermissions: { storage: false, contact: false } } },
    } as any);
    mocked.getConsentHistory.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...activeHistory,
          currentStateDerived: 'revoked',
          revocations: [{ consentRevocationId: 'rv-1', scope: ['all'], reason: 'Retirada', effectiveAt: '2026-10-02T12:00:00.000Z', priorUseDisposition: null }],
        },
      },
    } as any);
    renderPage();
    expect(await screen.findByTestId('consent-state')).toHaveTextContent('Revogado');
    expect(screen.queryByTestId('consent-revoke-form')).not.toBeInTheDocument();
    const revocations = within(screen.getByTestId('consent-revocations'));
    expect(revocations.getByText('Todos os usos')).toBeInTheDocument();
    expect(revocations.getByText('Retirada')).toBeInTheDocument();
  });

  it('opens and downloads the signed term linked to the consent', async () => {
    mocked.getPatientConsent.mockResolvedValue({
      data: { success: true, data: { ...consent, signedAt: '2026-10-01T12:00:00.000Z', signedTcleDocumentUri: 'objstore://consents/c-uuid-1/tcle.pdf' } },
    } as any);
    mocked.getSignedTcle.mockResolvedValue({ data: new Blob(['%PDF-'], { type: 'application/pdf' }) } as any);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tcle');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/Assinado em/)).toBeInTheDocument();
    await user.click(screen.getByTestId('view-signed-tcle'));
    await waitFor(() => expect(mocked.getSignedTcle).toHaveBeenCalledWith(CONSENT_ID));
    expect(open).toHaveBeenCalledWith('blob:tcle', '_blank', 'noopener');
    await user.click(screen.getByTestId('download-signed-tcle'));
    await waitFor(() => expect(mocked.getSignedTcle).toHaveBeenCalledTimes(2));
  });

  it('shows the revocation location and the closure notice for this participant', async () => {
    mocked.getConsentHistory.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...activeHistory,
          revocations: [{
            consentRevocationId: 'rev-1',
            scope: ['all'],
            reason: 'Vencimento do termo',
            effectiveAt: '2026-11-01T12:00:00.000Z',
            priorUseDisposition: 'retain_history',
            channel: 'term_expiry',
            location: { status: 'captured', latitude: -23.5, longitude: -46.6 },
          }],
          communications: [{
            consentCommunicationEventId: 'com-1',
            participantId: 'P1',
            communicationType: 'notice',
            contentTemplateId: 'consent.term_expiry.v1',
            purpose: 'consent_term_expiry',
            deliveryStatus: 'delivered',
            sentAt: '2026-11-01T12:00:00.000Z',
          }],
        },
      },
    } as any);
    renderPage();
    expect(await screen.findByTestId('consent-participant-id')).toHaveTextContent('Participante P1');
    const revocation = await screen.findByTestId('consent-revocation-rev-1');
    expect(revocation).toHaveTextContent('Vencimento do termo');
    expect(revocation).toHaveTextContent('-23.5, -46.6');
    expect(screen.getByTestId('consent-communication-consent.term_expiry.v1')).toHaveTextContent('Aviso de encerramento');
  });

  it('refreshes the open consent every 15s and pauses while the tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    renderPage();
    expect(await screen.findByTestId('consent-state')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(mocked.getPatientConsent).toHaveBeenCalledTimes(2);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(mocked.getPatientConsent).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocked.getPatientConsent).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('says so when the participant has no consent', async () => {
    mocked.getPatientConsent.mockRejectedValue({ response: { status: 404, data: { message: 'Consentimento não encontrado' } } });
    renderPage();
    expect(await screen.findByText('Nenhum consentimento encontrado para este participante.')).toBeInTheDocument();
    expect(mocked.getConsentHistory).not.toHaveBeenCalled();
  });
});
