import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// #1443: the samples page: the details route, the inventory/storage switch,
// the role gate on the external-document action, and the consent, document,
// pending-summary and inline-storage handlers it passes to the list view.
const h = vi.hoisted(() => ({
  page: {} as Record<string, any>,
  user: null as Record<string, unknown> | null,
  resend: vi.fn(),
  attach: vi.fn(),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.user }),
}));
vi.mock('../hooks/samples/useSamplesPage', () => ({
  useSamplesPage: () => h.page,
}));
vi.mock('../services/api', () => ({
  patientService: { resendConsentNotification: (...a: unknown[]) => h.resend(...a) },
  sampleService: { marker: 'sampleService' },
}));
vi.mock('../hooks/samples/attachExternalDocument', () => ({
  attachExternalDocument: (...a: unknown[]) => h.attach(...a),
}));
vi.mock('./SampleDetailsPage', () => ({
  default: () => <div data-testid="details-stub">details</div>,
}));
vi.mock('../components/SampleLocator', () => ({
  SampleLocator: () => <div data-testid="locator-stub">locator</div>,
}));
vi.mock('../components/samples/InlineStorageMovementPanel', () => ({
  default: ({ sample, onCancel, onCompleted }: any) => (
    <div data-testid={`inline-panel-${sample.id}`}>
      <button type="button" onClick={onCancel}>stub-cancel</button>
      <button type="button" onClick={onCompleted}>stub-complete</button>
    </div>
  ),
}));

import SamplesPage from './SamplesPage';

const blocked = (fields: Record<string, unknown> = {}) => ({
  id: 's1',
  specimenStatus: 'quarantined',
  participantId: 'P-1',
  ...fields,
});

function page(overrides: Record<string, unknown> = {}) {
  h.page = {
    loading: false,
    error: null,
    search: '',
    searchInput: '',
    setSearchInput: vi.fn(),
    submitSearch: vi.fn(),
    selectedSampleIds: [],
    filteredSamples: [blocked()],
    selectedSamples: [],
    allSelected: false,
    toggleSelectAll: vi.fn(),
    toggleSelect: vi.fn(),
    handleBatchDelete: vi.fn(async () => {}),
    printModalOpen: false,
    openPrintModal: vi.fn(),
    closePrintModal: vi.fn(),
    refreshSamples: vi.fn(),
    currentPage: 1,
    totalPages: 1,
    pageSize: 10,
    setCurrentPage: vi.fn(),
    ...overrides,
  };
  // The list shows one page of the filtered samples; these fixtures fit on one.
  if (!('pagedSamples' in overrides)) h.page.pagedSamples = h.page.filteredSamples;
  return h.page;
}

function renderAt(path = '/samples') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/samples" element={<SamplesPage />} />
        <Route path="/samples/withdrawal-return" element={<div data-testid="withdrawal-stub" />} />
        <Route path="/samples/:id" element={<SamplesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;
let promptSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.user = { roleName: 'Administrador', userID: 'U-9', id: 9, username: 'ana' };
  h.resend.mockReset();
  h.attach.mockReset();
  page();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SamplesPage routing and sections', () => {
  it('renders the details page for /samples/:id and the list for /samples', () => {
    renderAt('/samples/abc');
    expect(screen.getByTestId('details-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('sample-list-root')).toBeNull();
  });

  it('links withdrawal-return from the samples hub', () => {
    renderAt();
    fireEvent.click(screen.getByTestId('samples-withdrawal-return-link'));
    expect(screen.getByTestId('withdrawal-stub')).toBeInTheDocument();
  });

  it('switches between the inventory list and the storage section', () => {
    renderAt();
    expect(screen.getByTestId('sample-list-root')).toBeInTheDocument();
    expect(screen.getByTestId('samples-view-inventory-button')).toHaveClass('active');
    fireEvent.click(screen.getByTestId('samples-view-storage-button'));
    expect(screen.getByTestId('samples-storage-section')).toBeInTheDocument();
    expect(screen.getByTestId('locator-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('sample-list-root')).toBeNull();
    expect(screen.getByTestId('samples-view-storage-button')).toHaveClass('active');
    expect(screen.getByTestId('samples-view-inventory-button')).not.toHaveClass('active');
    fireEvent.click(screen.getByTestId('samples-view-inventory-button'));
    expect(screen.getByTestId('sample-list-root')).toBeInTheDocument();
  });

  it('navigates to the sample details from the edit button', () => {
    page({ filteredSamples: [{ id: 's2', specimenStatus: 'available' }] });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-edit-button-s2'));
    expect(screen.getByTestId('details-stub')).toBeInTheDocument();
  });

  it('passes the hook state and callbacks through to the list', () => {
    const p = page({ searchInput: 'abc', selectedSampleIds: ['s1'], printModalOpen: true, selectedSamples: [blocked()] });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderAt();
    expect(screen.getByTestId('samples-search-input')).toHaveValue('abc');
    fireEvent.change(screen.getByTestId('samples-search-input'), { target: { value: 'xyz' } });
    expect(p.setSearchInput).toHaveBeenCalledWith('xyz');
    fireEvent.click(screen.getByTestId('samples-search-button'));
    expect(p.submitSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('samples-select-all-checkbox'));
    expect(p.toggleSelectAll).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('sample-checkbox-s1'));
    expect(p.toggleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    fireEvent.click(screen.getByTestId('samples-batch-delete'));
    expect(p.handleBatchDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByText('common.print'));
    expect(printSpy).toHaveBeenCalled();
    fireEvent.click(screen.getAllByText('common.close')[0]);
    expect(p.closePrintModal).toHaveBeenCalled();
  });
});

describe('SamplesPage role gate', () => {
  it.each([
    ['Administrador', false],
    ['Coordenador', false],
    ['Técnico', true],
  ])('role %s: attach button disabled=%s', (roleName, disabled) => {
    h.user = { roleName };
    renderAt();
    const button = screen.getByTestId('sample-attach-external-button-s1');
    if (disabled) expect(button).toBeDisabled();
    else expect(button).not.toBeDisabled();
  });

  it('treats a missing user as unable to edit', () => {
    h.user = null;
    renderAt();
    expect(screen.getByTestId('sample-attach-external-button-s1')).toBeDisabled();
  });
});

describe('SamplesPage consent resend', () => {
  it('refuses a sample with no participant and calls nothing', () => {
    page({ filteredSamples: [blocked({ participantId: '  ' })] });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-resend-consent-button-s1'));
    expect(h.resend).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Amostra sem paciente válido para envio de TCLE.');
  });

  it('resends to the trimmed patient participant id, refreshes and reports success', async () => {
    const p = page({ filteredSamples: [blocked({ participantId: undefined, patient: { participantId: ' P-7 ' } })] });
    h.resend.mockResolvedValue({});
    renderAt();
    fireEvent.click(screen.getByTestId('sample-resend-consent-button-s1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('TCLE enviado/reenviado com sucesso.'));
    expect(h.resend).toHaveBeenCalledWith('P-7');
    expect(p.refreshSamples).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ response: { data: { message: 'server says no' } }, message: 'net' }, 'server says no'],
    [{ message: 'net down' }, 'net down'],
    [{}, 'Falha ao enviar/reenviar TCLE.'],
  ])('reports a failed resend (%#)', async (rejection, shown) => {
    const p = page();
    h.resend.mockRejectedValue(rejection);
    renderAt();
    fireEvent.click(screen.getByTestId('sample-resend-consent-button-s1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(shown));
    expect(p.refreshSamples).not.toHaveBeenCalled();
  });
});

describe('SamplesPage external document', () => {
  it('attaches with the note as reason, the userID as actor, and echoes the note', async () => {
    const p = page();
    promptSpy.mockReturnValue('termo físico');
    h.attach.mockResolvedValue(undefined);
    renderAt();
    fireEvent.click(screen.getByTestId('sample-attach-external-button-s1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Documento externo anexado. termo físico'));
    expect(h.attach).toHaveBeenCalledWith(
      { marker: 'sampleService' },
      { id: 's1', specimenStatus: 'quarantined' },
      { actor: 'U-9', reason: 'termo físico' },
    );
    expect(p.refreshSamples).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ roleName: 'Administrador', id: 4, username: 'bob' }, 4],
    [{ roleName: 'Administrador', username: 'bob' }, 'bob'],
    [{ roleName: 'Administrador' }, null],
  ])('falls back through the actor fields (%#) and the default reason', async (user, actor) => {
    h.user = user;
    promptSpy.mockReturnValue(null);
    h.attach.mockResolvedValue(undefined);
    renderAt();
    fireEvent.click(screen.getByTestId('sample-attach-external-button-s1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Documento externo anexado e amostra liberada.'));
    expect(h.attach.mock.calls[0][2]).toEqual({ actor, reason: 'Documento externo de consentimento anexado' });
  });

  it.each([
    [{ response: { data: { message: 'conflict' } } }, 'conflict'],
    [{ message: 'timeout' }, 'timeout'],
    [{}, 'Falha ao anexar documento externo.'],
  ])('reports a failed attach (%#)', async (rejection, shown) => {
    const p = page();
    h.attach.mockRejectedValue(rejection);
    renderAt();
    fireEvent.click(screen.getByTestId('sample-attach-external-button-s1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(shown));
    expect(p.refreshSamples).not.toHaveBeenCalled();
  });
});

describe('SamplesPage pending summary', () => {
  it('upper-cases the status, consent and reason', () => {
    page({ filteredSamples: [blocked({ specimenStatus: 'quarantined', consentStatus: 'pending', quarantineReason: 'external_document_required' })] });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-view-pending-button-s1'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Pendência da amostra:\nStatus: QUARANTINED\nConsentimento: PENDING\nMotivo: EXTERNAL_DOCUMENT_REQUIRED',
    );
  });

  it('shows N/A for absent fields', () => {
    page({ filteredSamples: [{ id: 's1', canUse: false }] });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-view-pending-button-s1'));
    expect(alertSpy).toHaveBeenCalledWith('Pendência da amostra:\nStatus: N/A\nConsentimento: N/A\nMotivo: N/A');
  });
});

describe('SamplesPage inline storage', () => {
  const two = [
    { id: 'a', specimenStatus: 'available' },
    { id: 'b', specimenStatus: 'available' },
  ];

  it('opens one sample at a time and closes it on a second click', () => {
    page({ filteredSamples: two });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-storage-button-a'));
    expect(screen.getByTestId('inline-panel-a')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sample-storage-button-b'));
    expect(screen.queryByTestId('inline-panel-a')).toBeNull();
    expect(screen.getByTestId('inline-panel-b')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sample-storage-button-b'));
    expect(screen.queryByTestId('inline-panel-b')).toBeNull();
  });

  it('closes the panel on cancel without refreshing', () => {
    const p = page({ filteredSamples: two });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-storage-button-a'));
    fireEvent.click(screen.getByText('stub-cancel'));
    expect(screen.queryByTestId('inline-panel-a')).toBeNull();
    expect(p.refreshSamples).not.toHaveBeenCalled();
  });

  it('refreshes and closes the panel on completion', () => {
    const p = page({ filteredSamples: two });
    renderAt();
    fireEvent.click(screen.getByTestId('sample-storage-button-a'));
    fireEvent.click(screen.getByText('stub-complete'));
    expect(screen.queryByTestId('inline-panel-a')).toBeNull();
    expect(p.refreshSamples).toHaveBeenCalledTimes(1);
  });
});
