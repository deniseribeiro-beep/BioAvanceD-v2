import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PatientsPage from './PatientsPage';
import { consentService, patientService } from '../services/api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../services/api', () => ({
  patientService: {
    search: vi.fn(),
    findForEdit: vi.fn(),
    getById: vi.fn(),
    resendConsentNotification: vi.fn(),
  },
  consentService: {
    getActiveTemplate: vi.fn(),
    createPatientConsent: vi.fn(),
  },
  dataImportService: {},
}));

vi.mock('../utils/fhirExcelImport', () => ({
  convertExcelFileToFhirBundle: vi.fn(),
  downloadFhirExcelTemplate: vi.fn(),
}));

// The real pad draws on a canvas jsdom cannot paint, so its Confirm never fires.
vi.mock('../components/Consent/SignaturePad', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: (d: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onConfirm('data:image/png;base64,AAAA')}>pad-confirm</button>
      <button type="button" onClick={onCancel}>pad-cancel</button>
    </div>
  ),
}));

const lang = { language: 'pt-BR' };
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: lang.language }),
}));

const auth: { user: any } = { user: null };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

const hook = {
  patients: [] as any[],
  loading: false,
  error: null as string | null,
  deletePatient: vi.fn(),
  loadPatients: vi.fn(),
  refreshPatients: vi.fn(),
};
vi.mock('../hooks/usePatients', () => ({
  usePatients: () => hook,
}));

const mocked = vi.mocked(patientService);
const consentApi = vi.mocked(consentService);
const ADMIN = { roleName: 'Administrador', accessType: 4 };
const TECH = { roleName: 'Técnico', accessType: 2 };

function renderPage() {
  return render(
    <MemoryRouter>
      <PatientsPage />
    </MemoryRouter>
  );
}

describe('PatientsPage', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lang.language = 'pt-BR';
    auth.user = ADMIN;
    hook.patients = [];
    hook.loading = false;
    hook.error = null;
    hook.deletePatient.mockResolvedValue(undefined);
    hook.loadPatients.mockResolvedValue(undefined);
    hook.refreshPatients.mockResolvedValue(undefined);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Modal restores the scroll position on close; jsdom does not implement it.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('page states', () => {
    it('shows the loading text while the hook loads', () => {
      hook.loading = true;
      renderPage();
      expect(screen.getByText('patients.loading')).toBeInTheDocument();
      expect(screen.queryByText('patients.noPatients')).not.toBeInTheDocument();
    });

    it('shows a load error with its message', () => {
      hook.error = 'Boom';
      renderPage();
      expect(screen.getByText('patients.loadErrorLabel:')).toBeInTheDocument();
      expect(screen.getByText(/Boom/)).toBeInTheDocument();
      expect(screen.queryByText('patients.connectionErrorTitle:')).not.toBeInTheDocument();
    });

    it.each(['connect ECONNREFUSED 127.0.0.1', 'Network Error', 'Backend não está disponível', 'backend is unavailable'])(
      'shows the connection error, not the raw message, for %s',
      (message) => {
        hook.error = message;
        renderPage();
        expect(screen.getByText('patients.connectionErrorTitle:')).toBeInTheDocument();
        expect(screen.getByText(/patients\.connectionErrorMessage/)).toBeInTheDocument();
        expect(screen.queryByText('patients.loadErrorLabel:')).not.toBeInTheDocument();
      }
    );

    it('shows the empty state when there are no patients', () => {
      renderPage();
      expect(screen.getByText('patients.noPatients')).toBeInTheDocument();
      expect(screen.getByText('patients.noPatientsHint')).toBeInTheDocument();
      expect(screen.queryByTestId('patients-table')).not.toBeInTheDocument();
    });

    it('refreshes the open directory every 15s and again when the tab returns', () => {
      vi.useFakeTimers();
      renderPage();
      expect(hook.refreshPatients).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(15_000); });
      expect(hook.refreshPatients).toHaveBeenCalledTimes(1);

      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      act(() => { vi.advanceTimersByTime(15_000); });
      expect(hook.refreshPatients).toHaveBeenCalledTimes(1);

      hidden.mockReturnValue(false);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(hook.refreshPatients).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('navigates back to the dashboard', async () => {
      renderPage();
      await userEvent.click(screen.getByTestId('patients-back-button'));
      expect(navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('offers LGPD import to an administrator and navigates to it', async () => {
      renderPage();
      expect(screen.getByTestId('patients-import-fhir-button')).toHaveTextContent('Importar dados');
      await userEvent.click(screen.getByTestId('patients-import-fhir-button'));
      expect(navigate).toHaveBeenCalledWith('/patients/import-fhir');
    });

    it.each([
      [{ roleName: 'Coordenador', accessType: 2 }],
      [{ roleName: 'Técnico', accessType: 3 }],
    ])('offers FHIR import to %o', (user) => {
      auth.user = user;
      renderPage();
      expect(screen.getByTestId('patients-import-fhir-button')).toBeInTheDocument();
    });

    it('hides FHIR import from a technician', () => {
      auth.user = TECH;
      renderPage();
      expect(screen.queryByTestId('patients-import-fhir-button')).not.toBeInTheDocument();
    });
  });

  describe('patient rows', () => {
    it('shows a view-only cell to a technician', () => {
      auth.user = TECH;
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      expect(screen.getByTestId('patient-row-12345678')).toHaveTextContent('patients.viewOnly');
      expect(screen.queryByTestId('collect-signature-button-12345678')).not.toBeInTheDocument();
    });

    it('drops rows with no id and falls back to id for the participant id', () => {
      hook.patients = [{ participantId: '', consentStatus: 'PENDING' }, { id: 'legacy-1', status: 'ACTIVE' }];
      renderPage();
      expect(screen.getByTestId('patient-row-legacy-1')).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(2);
    });

    it('shows the record number and the birth date on the row', () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING', recordNumber: 'PR-100', birthDate: '03/05/1990' }];
      renderPage();
      const row = screen.getByTestId('patient-row-12345678');
      expect(screen.getByText('patients.recordNumber')).toBeInTheDocument();
      expect(screen.getByText('patients.birthDate')).toBeInTheDocument();
      expect(row).toHaveTextContent('PR-100');
      expect(row).toHaveTextContent('03/05/1990');
    });

    it('offers signature and the email action for a pending consent, and no history', () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      expect(screen.getByTestId('collect-signature-button-12345678')).toHaveTextContent('patients.collectSignature');
      expect(screen.getByTestId('send-tcle-link-button-12345678')).toHaveTextContent('Enviar TCLE por e-mail');
      expect(screen.queryByTestId('resend-consent-button-12345678')).not.toBeInTheDocument();
      expect(screen.queryByTestId('consent-history-button-12345678')).not.toBeInTheDocument();
    });

    it('shows one signed badge and the consent history for a granted consent', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'ACTIVE' }];
      renderPage();
      expect(screen.getAllByText('Assinado')).toHaveLength(1);
      expect(screen.queryByText('patients.signed')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collect-signature-button-12345678')).not.toBeInTheDocument();
      expect(screen.queryByTestId('send-tcle-link-button-12345678')).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId('consent-history-button-12345678'));
      expect(navigate).toHaveBeenCalledWith('/consents?participantId=12345678');
    });

    it.each([
      ['en-US', 'Collect Signature'],
      ['es-ES', 'Recolectar firma'],
    ])('labels the consent action in %s', (language, collect) => {
      lang.language = language;
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      expect(screen.getByTestId('collect-signature-button-12345678')).toHaveTextContent(collect);
    });
  });

  describe('signature modal', () => {
    it('saves the in-person signature with the collection place and reloads the list', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      consentApi.getActiveTemplate.mockResolvedValue({
        data: { data: { _id: '507f1f77bcf86cd799439011', title: 'TCLE Biobanco', htmlContent: '<p>Termo</p>', permissions: [] } },
      } as any);
      consentApi.createPatientConsent.mockResolvedValue({} as any);
      renderPage();
      await userEvent.click(screen.getByTestId('collect-signature-button-12345678'));
      expect(await screen.findByTestId('collection-place-input')).toBeInTheDocument();
      await userEvent.type(screen.getByTestId('collection-place-input'), 'Laboratório Central');
      await userEvent.click(screen.getByText('pad-confirm'));
      await userEvent.click(screen.getByTestId('confirm-in-person-consent'));
      await waitFor(() => expect(consentApi.createPatientConsent).toHaveBeenCalledWith(expect.objectContaining({
        participantId: '12345678',
        templateId: '507f1f77bcf86cd799439011',
        consentTemplateId: '507f1f77bcf86cd799439011',
        collectionPlace: 'Laboratório Central',
        signatureImageBase64: 'data:image/png;base64,AAAA',
      })));
      expect(hook.loadPatients).toHaveBeenCalled();
    });

    it('closes on cancel and leaves the consent pending', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      await userEvent.click(screen.getByTestId('collect-signature-button-12345678'));
      await userEvent.click(screen.getByText('pad-cancel'));
      expect(screen.queryByText('patients.digitalSignature')).not.toBeInTheDocument();
      expect(screen.getByTestId('collect-signature-button-12345678')).toBeInTheDocument();
    });
  });

  describe('consent notifications', () => {
    it('sends the TCLE link, reloads and confirms', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      mocked.resendConsentNotification.mockResolvedValue({} as any);
      renderPage();
      await userEvent.click(screen.getByTestId('send-tcle-link-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('patients.notificationsResent'));
      expect(mocked.resendConsentNotification).toHaveBeenCalledWith('12345678');
      expect(hook.loadPatients).toHaveBeenCalled();
    });

    it('shows Resending while the TCLE link is in flight', async () => {
      lang.language = 'en-US';
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      let resolve!: (v: any) => void;
      mocked.resendConsentNotification.mockReturnValue(new Promise((r) => { resolve = r; }) as any);
      renderPage();
      await userEvent.click(screen.getByTestId('send-tcle-link-button-12345678'));
      expect(screen.getByTestId('send-tcle-link-button-12345678')).toHaveTextContent('Resending...');
      expect(screen.getByTestId('send-tcle-link-button-12345678')).toBeDisabled();
      await act(async () => { resolve({}); });
      expect(screen.getByTestId('send-tcle-link-button-12345678')).toHaveTextContent('Enviar TCLE por e-mail');
    });

    it.each([
      [{ response: { data: { message: 'Sem e-mail' } } }, 'Sem e-mail'],
      [new Error('Falhou'), 'Falhou'],
      [{}, 'patients.notificationsResendError'],
    ])('alerts the TCLE link failure %#', async (err, expected) => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      mocked.resendConsentNotification.mockRejectedValue(err);
      renderPage();
      await userEvent.click(screen.getByTestId('send-tcle-link-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expected));
    });

  });

  describe('edit', () => {
    it('loads an 8-digit participant for edit and opens the intake with it', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      const patient = { participantId: '12345678', name: 'X' };
      mocked.findForEdit.mockResolvedValue({ data: { data: patient } } as any);
      renderPage();
      await userEvent.click(screen.getByTestId('edit-patient-button-12345678'));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/next/intake', { state: { patient } }));
      expect(mocked.findForEdit).toHaveBeenCalledWith('12345678');
      expect(mocked.getById).not.toHaveBeenCalled();
    });

    it('falls back to getById for a non-8-digit id', async () => {
      hook.patients = [{ id: 'legacy-1', status: 'PENDING' }];
      const patient = { participantId: 'legacy-1' };
      mocked.getById.mockResolvedValue({ data: patient } as any);
      renderPage();
      await userEvent.click(screen.getByTestId('edit-patient-button-legacy-1'));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/next/intake', { state: { patient } }));
      expect(mocked.getById).toHaveBeenCalledWith('legacy-1');
    });

    it('alerts not found when the patient has neither an 8-digit id nor a fallback id', async () => {
      hook.patients = [{ participantId: 'ABC', consentStatus: 'PENDING' }];
      renderPage();
      await userEvent.click(screen.getByTestId('edit-patient-button-ABC'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('patients.patientNotFound'));
      expect(mocked.findForEdit).not.toHaveBeenCalled();
      expect(mocked.getById).not.toHaveBeenCalled();
    });

    it.each([
      [{ data: { data: { error: 'Bloqueado' } } }, 'Bloqueado'],
      [{ data: { data: { name: 'sem id' } } }, 'patients.patientNotFound'],
      [{ data: null }, 'patients.invalidServerResponse'],
    ])('alerts an unusable edit response %#', async (response, expected) => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      mocked.findForEdit.mockResolvedValue(response as any);
      renderPage();
      await userEvent.click(screen.getByTestId('edit-patient-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expected));
      expect(navigate).not.toHaveBeenCalled();
    });

    it.each([
      [{ response: { data: { error: 'E1' } } }, 'E1'],
      [{ response: { data: { message: 'M1' } } }, 'M1'],
      [{}, 'patients.editError'],
    ])('alerts a failed edit request %#', async (err, expected) => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      mocked.findForEdit.mockRejectedValue(err);
      renderPage();
      await userEvent.click(screen.getByTestId('edit-patient-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expected));
    });
  });

  describe('delete', () => {
    it('does nothing when the confirm is declined', async () => {
      confirmSpy.mockReturnValue(false);
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      await userEvent.click(screen.getByTestId('delete-patient-button-12345678'));
      expect(confirmSpy).toHaveBeenCalledWith('patients.deleteConfirm');
      expect(hook.deletePatient).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('refuses a participant id that is not 8 digits', async () => {
      hook.patients = [{ id: 'legacy-1', status: 'PENDING' }];
      renderPage();
      await userEvent.click(screen.getByTestId('delete-patient-button-legacy-1'));
      expect(alertSpy).toHaveBeenCalledWith('patients.invalidparticipantId');
      expect(hook.deletePatient).not.toHaveBeenCalled();
    });

    it('deletes, reloads and confirms', async () => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      renderPage();
      await userEvent.click(screen.getByTestId('delete-patient-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('patients.deleteSuccess'));
      expect(hook.deletePatient).toHaveBeenCalledWith('12345678');
      expect(hook.loadPatients).toHaveBeenCalled();
    });

    it.each([
      [{ response: { data: { error: 'E1' } } }, 'E1'],
      [{ response: { data: { message: 'M1' } } }, 'M1'],
      [new Error('X1'), 'X1'],
      [{}, 'patients.deleteError'],
    ])('alerts a failed delete %#', async (err, expected) => {
      hook.patients = [{ participantId: '12345678', consentStatus: 'PENDING' }];
      hook.deletePatient.mockRejectedValue(err);
      renderPage();
      await userEvent.click(screen.getByTestId('delete-patient-button-12345678'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expected));
    });
  });

  describe('search', () => {
    beforeEach(() => {
      hook.patients = [{ participantId: '11111111', consentStatus: 'PENDING' }];
    });

    it('searches on Enter and shows the results in place of the list', async () => {
      mocked.search.mockResolvedValue({ data: { data: { patients: [{ participantId: '22222222', consentStatus: 'ACTIVE' }, { id: 'legacy-2' }, { name: 'no id' }] } } } as any);
      renderPage();
      const input = screen.getByTestId('patients-search-input');
      await userEvent.type(input, 'J');
      await userEvent.keyboard('{Enter}');
      expect(await screen.findByTestId('patient-row-22222222')).toBeInTheDocument();
      expect(screen.queryByTestId('patient-row-11111111')).not.toBeInTheDocument();
      expect(mocked.search).toHaveBeenCalledWith('J');
      expect(screen.getByText('"J"')).toBeInTheDocument();
      expect(screen.getByTestId('patient-row-legacy-2')).toBeInTheDocument();
      expect(screen.getByText(/3 patients\.results\)/)).toBeInTheDocument();
    });

    it('counts a single search result in the singular', async () => {
      mocked.search.mockResolvedValue({ data: { patients: [{ participantId: '22222222' }] } } as any);
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), 'J{Enter}');
      expect(await screen.findByText(/1 patients\.result\)/)).toBeInTheDocument();
    });

    it('searches 500 ms after a change of two or more characters', async () => {
      vi.useFakeTimers();
      try {
        mocked.search.mockResolvedValue({ data: { patients: [{ participantId: '22222222' }, { participantId: '33333333' }] } } as any);
        renderPage();
        fireEvent.change(screen.getByTestId('patients-search-input'), { target: { value: ' Jo ' } });
        expect(mocked.search).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(mocked.search).toHaveBeenCalledWith('Jo');
        expect(screen.getByTestId('patient-row-33333333')).toBeInTheDocument();
        expect(screen.getByText(/2 patients\.results\)/)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not search a one-character change', async () => {
      vi.useFakeTimers();
      try {
        renderPage();
        fireEvent.change(screen.getByTestId('patients-search-input'), { target: { value: 'J' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(mocked.search).not.toHaveBeenCalled();
        expect(hook.loadPatients).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows Searching while a search is in flight', async () => {
      let resolve!: (v: any) => void;
      mocked.search.mockReturnValue(new Promise((r) => { resolve = r; }) as any);
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), 'J{Enter}');
      expect(screen.getByText('common.searching')).toBeInTheDocument();
      await act(async () => { resolve({ data: { patients: [] } }); });
      expect(screen.queryByText('common.searching')).not.toBeInTheDocument();
    });

    it('keeps the list when the search returns no patients', async () => {
      mocked.search.mockResolvedValue({ data: {} } as any);
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), 'J{Enter}');
      expect(await screen.findByText(/0 patients\.results\)/)).toBeInTheDocument();
      expect(screen.getByTestId('patient-row-11111111')).toBeInTheDocument();
    });

    it('hides the search bar when the response has no data', async () => {
      mocked.search.mockResolvedValue({ data: null } as any);
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), 'J{Enter}');
      await waitFor(() => expect(mocked.search).toHaveBeenCalled());
      expect(screen.queryByText('patients.clear')).not.toBeInTheDocument();
    });

    it('alerts a failed search', async () => {
      mocked.search.mockRejectedValue(new Error('down'));
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), 'J{Enter}');
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('patients.searchError'));
      expect(screen.queryByText('patients.clear')).not.toBeInTheDocument();
    });

    it('does not search a blank term on Enter', async () => {
      renderPage();
      await userEvent.type(screen.getByTestId('patients-search-input'), '   ');
      await userEvent.keyboard('{Enter}');
      expect(mocked.search).not.toHaveBeenCalled();
    });

    it.each(['clear-x', 'clear-bar', 'escape', 'emptied'])('clears the search and reloads (%s)', async (how) => {
      mocked.search.mockResolvedValue({ data: { patients: [{ participantId: '22222222' }] } } as any);
      renderPage();
      const input = screen.getByTestId('patients-search-input') as HTMLInputElement;
      await userEvent.type(input, 'J{Enter}');
      await screen.findByTestId('patient-row-22222222');
      hook.loadPatients.mockClear();
      if (how === 'clear-x') await userEvent.click(screen.getByTestId('patients-clear-search-button'));
      if (how === 'clear-bar') {
        const bar = screen.getByText('patients.clear');
        fireEvent.mouseEnter(bar);
        fireEvent.mouseLeave(bar);
        await userEvent.click(bar);
      }
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      if (how === 'emptied') await userEvent.clear(input);
      expect(hook.loadPatients).toHaveBeenCalled();
      expect(screen.getByTestId('patient-row-11111111')).toBeInTheDocument();
      expect(screen.queryByText('patients.clear')).not.toBeInTheDocument();
      expect(input.value).toBe('');
    });
  });
});
