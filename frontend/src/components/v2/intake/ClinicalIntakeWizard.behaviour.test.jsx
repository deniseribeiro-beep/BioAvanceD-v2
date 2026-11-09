import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ClinicalIntakeWizard, { _test } from './ClinicalIntakeWizard.jsx';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import { apiClient, notifyApiToast } from '../../../api/client';
import { consentService, organizationService } from '../../../services/api';

const { buildSubmissionPayload } = _test;

// #1337: the wizard's patient step, sample step, consent template, navigation,
// submit and sample label, driven through the rendered form. The network
// boundary is mocked as in ClinicalIntakeWizard.test.jsx, plus the
// organization lookup the organization picker reads.
vi.mock('../../../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() }, notifyApiToast: vi.fn() }));
vi.mock('../../../services/api', () => ({
  consentService: { getTemplates: vi.fn() },
  organizationService: { getMine: vi.fn(), getAll: vi.fn() },
}));

const DICT = { clinicalComorbidities: [{ slug: 'diabetes', label: 'Diabetes' }], biomarkers: [{ slug: 'lyso_gb3', label: 'Lyso-Gb3' }] };
const HIT = { id: 'orpha-324', descricao: 'Doenca de Fabry', ORPHA: '324', Codigos_CID10: 'E75.2' };
const TEMPLATE = { _id: 'tpl-1', title: 'TCLE A', version: 'v1', active: true, content: 'Eu, {{NOME_PACIENTE}}, doc {{DOC_PACIENTE}}, rep {{NOME_REPRESENTANTE}}' };
const VALID_CPF = '11144477735';
const REP_CPF = '52998224725';

let patientMatch;

function mockApi() {
  patientMatch = () => Promise.resolve({ data: { matched: true, patient: { patientID: '12345678' } }, status: 200 });
  apiClient.get.mockImplementation((url) => {
    if (url === '/terminologies') return Promise.resolve({ data: { results: [HIT] }, status: 200 });
    if (url === '/intake-wizard/patient-match') return patientMatch();
    return Promise.resolve({ data: {}, status: 200 });
  });
  consentService.getTemplates.mockResolvedValue({ data: { templates: [TEMPLATE] }, status: 200 });
  organizationService.getMine.mockResolvedValue({ data: { data: { scope: 'none' } } });
}

function renderWizard(props = {}) {
  return render(<LanguageProvider><ClinicalIntakeWizard dictionaries={DICT} dictionariesLoading={false} {...props} /></LanguageProvider>);
}

const set = (id, v) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const next = () => fireEvent.click(screen.getByTestId('wizard-next-button'));
const back = () => fireEvent.click(screen.getByTestId('wizard-back-button'));
const onSampleStep = () => screen.queryByTestId('wizard-sample-type') !== null;
const deceasedBox = () => screen.getByLabelText(/Deceased patient|Paciente falecido/);
const repName = () => screen.getByLabelText(/Legal representative name|Nome do representante legal/);
const repEmail = () => screen.getByLabelText(/Legal representative email|Email do representante legal/);
const repDocument = () => screen.getByLabelText(/Legal representative document|Documento do representante legal/);
const axisValues = (n) => Array.from(screen.getByTestId(`wizard-sprec-axis-${n}`).options).map((o) => o.value);
const quantityUnit = () => screen.getByTestId('wizard-quantity').closest('.items-center').querySelector('span.inline-flex').textContent;
const todayCode = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

function fillPatientStep(overrides = {}) {
  const values = { name: 'Maria Teste', birth: '01/01/1990', gender: 'M', email: 'maria@example.com', document: VALID_CPF, ...overrides };
  set('wizard-full-name', values.name);
  set('wizard-birth-date', values.birth);
  set('wizard-gender', values.gender);
  set('wizard-email', values.email);
  set('wizard-document', values.document);
}

function fillSampleStep(overrides = {}) {
  const values = { axes: ['PL1', 'SED', 'A', 'A', 'N', 'N', 'A'], institution: 'Hospital Teste', ...overrides };
  set('wizard-sample-type', 'PLASMA');
  set('wizard-sample-origin', 'VENOUS_BLOOD');
  set('wizard-extraction-protocol', 'TUBE_EDTA');
  values.axes.forEach((v, i) => set(`wizard-sprec-axis-${i + 1}`, v));
  set('wizard-quantity', '5');
  set('wizard-linked-project', 'PROJ-1');
  set('wizard-institution-name', values.institution);
}

// The patient-match (350 ms) and diagnosis (250 ms) debounces run on fake
// timers, so a flow case jumps past them instead of waiting them out.
const passDebounce = () => act(async () => { vi.advanceTimersByTime(400); });

async function selectDiagnosisAndNaive() {
  set('wizard-diagnosis-search', 'Fabry');
  await passDebounce();
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument());
  fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
  await waitFor(() => expect(screen.getByDisplayValue('E75.2')).toBeInTheDocument());
  set('wizard-treatment-status', 'NAIVE');
}

async function goToSampleStep(overrides) {
  fillPatientStep(overrides);
  await passDebounce();
  await waitFor(() => expect(screen.getByTestId('wizard-patient-match-alert')).toBeInTheDocument());
  next();
  await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
}

async function goToClinicalStep(patientOverrides, sampleOverrides) {
  await goToSampleStep(patientOverrides);
  fillSampleStep(sampleOverrides);
  next();
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
}

async function reachSubmit() {
  await goToClinicalStep();
  await selectDiagnosisAndNaive();
  await waitFor(() => expect(screen.getByTestId('wizard-submit-button')).not.toBeDisabled());
}

async function submitWith(respond) {
  apiClient.post.mockImplementation(respond);
  renderWizard();
  await reachSubmit();
  fireEvent.click(screen.getByTestId('wizard-submit-button'));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.clearAllMocks();
  mockApi();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// RNF018 AC1 (#1525): the wizard refuses a quantity at or below zero, and says so.
describe('ClinicalIntakeWizard sample quantity', () => {
  it.each(['0', '-1'])('shows the quantity message for %s and stays on the sample step', async (quantity) => {
    renderWizard();
    await goToSampleStep();
    fillSampleStep();
    set('wizard-quantity', quantity);
    expect(screen.queryByText(/Enter a quantity greater than zero|Informe um volume maior que zero/)).not.toBeInTheDocument();
    next();
    expect(await screen.findByText(/Enter a quantity greater than zero|Informe um volume maior que zero/)).toBeInTheDocument();
    expect(onSampleStep()).toBe(true);
  });
});

describe('ClinicalIntakeWizard submit and sample label', () => {
  it('submits the three steps, shows the sample label and the unsaved clinical entities, and prints the label', async () => {
    await submitWith(() => Promise.resolve({ data: { message: 'ok', sample: { specimenId: 'SP-9', sampleType: 'PLASMA', collectionDate: '2026-01-02T00:00:00Z' }, clinicalEntities: { failed: [{ entity: 'allergy', reference: 'A1' }] } }, status: 201 }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith('/intake-wizard', expect.objectContaining({ consent: expect.objectContaining({ consentTemplateId: 'tpl-1' }) }));
    expect(apiClient.post.mock.calls[0][1].participant.participantId).toBe('12345678');
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent('SP-9');
    expect(screen.getByTestId('clinical-entities-warning-item')).toHaveTextContent('allergy (A1)');
    expect(notifyApiToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('sample-label-print-button'));
    expect(open).toHaveBeenCalledWith('/samples/SP-9/label', '_blank', 'noopener,noreferrer');
  });

  it('a success with no failed clinical entity toasts the response message, returns to step 1 and clears the form', async () => {
    await submitWith(() => Promise.resolve({ data: { message: 'Cadastro salvo', sample: { specimenId: 'SP-1' } }, status: 201 }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(notifyApiToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cadastro salvo', type: 'success' }));
    expect(screen.queryByTestId('clinical-entities-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-full-name')).toHaveValue('');
    expect(screen.getByTestId('wizard-document')).toHaveValue('');
  });

  it.each([
    ['response.data.message', { response: { data: { message: 'Mensagem do servidor' } } }, 'Mensagem do servidor'],
    ['response.data.error', { response: { data: { error: 'Erro do servidor' } } }, 'Erro do servidor'],
    ['a bare Error', new Error('x'), 'x'],
  ])('a rejected POST carrying %s shows that message and toasts it as an error', async (_label, failure, message) => {
    await submitWith(() => Promise.reject(failure));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(notifyApiToast).toHaveBeenCalledWith(expect.objectContaining({ message, type: 'error' }));
    expect(screen.queryByTestId('sample-label')).not.toBeInTheDocument();
  });

  it('a clinical step made invalid after reaching it keeps the wizard on step 3 with no POST', async () => {
    renderWizard();
    await reachSubmit();
    set('wizard-treatment-status', '');
    fireEvent.click(screen.getByTestId('wizard-submit-button'));
    expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('a sample step made invalid after reaching step 3 returns submit to step 2 with no POST', async () => {
    const view = renderWizard();
    await reachSubmit();
    view.rerender(<LanguageProvider><ClinicalIntakeWizard dictionaries={DICT} dictionariesLoading={false} dictionariesError="offline" /></LanguageProvider>);
    fireEvent.click(screen.getByTestId('wizard-submit-button'));
    await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('labelData barcode, specimenId and collectionDate win over the sample fields, and the storage assignment fills the location', async () => {
    await submitWith(() => Promise.resolve({
      data: {
        sample: {
          specimenId: 'SP-1',
          barcode: 'BC-1',
          collectionDate: '2026-01-02T12:00:00Z',
          labelData: { barcode: 'LBL-BC', specimenId: 'LBL-SP', collectionDate: '2025-06-15T12:00:00Z' },
        },
        storageAssignment: { positionCode: 'F1-R2-B3' },
        storageLocation: { readable: 'Freezer A' },
      },
    }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label-code')).toHaveTextContent('LBL-BC');
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent('LBL-SP');
    expect(screen.getByTestId('sample-label-date')).toHaveTextContent(new Date('2025-06-15T12:00:00Z').toLocaleDateString('pt-BR'));
    expect(screen.getByTestId('sample-label')).toHaveTextContent('F1-R2-B3');
    expect(screen.getByTestId('sample-label')).not.toHaveTextContent('Freezer A');
  });

  it('a response with no sample falls back to the date-participant-type code, and the readable storage location fills the location', async () => {
    await submitWith(() => Promise.resolve({ data: { message: 'ok', storageLocation: { readable: 'Freezer A' } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    const code = `${todayCode()}-12345678-PLASMA`;
    expect(screen.getByTestId('sample-label-code')).toHaveTextContent(code);
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent(code);
    expect(screen.getByTestId('sample-label-type')).toHaveTextContent('PLASMA');
    expect(screen.getByTestId('sample-label')).toHaveTextContent('Freezer A');
  });

  it('an unparseable collection date falls back to today', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { specimenId: 'SP-3', collectionDate: 'not-a-date' } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label-date')).toHaveTextContent(new Date().toLocaleDateString('pt-BR'));
  });

  it('print opens nothing when the label has neither a specimenId nor a code', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { specimenId: 'SP-4' }, label: { specimenId: '', code: '' } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('sample-label-print-button'));
    expect(open).not.toHaveBeenCalled();
  });
});

describe('ClinicalIntakeWizard patient step', () => {
  it('refuses an invalid email, then an empty one', () => {
    renderWizard();
    fillPatientStep({ email: 'maria@' });
    next();
    expect(onSampleStep()).toBe(false);
    set('wizard-email', '');
    next();
    expect(onSampleStep()).toBe(false);
  });

  it.each([
    ['repeated digits', '11111111111'],
    ['a bad first check digit', '11144477705'],
    ['a bad second check digit', '11144477734'],
  ])('refuses a CPF with %s and shows the document error', (_label, cpf) => {
    renderWizard();
    fillPatientStep({ document: cpf });
    next();
    expect(onSampleStep()).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent(/CPF/);
  });

  it('strips the letters from a typed document and refuses what is left', () => {
    renderWizard();
    fillPatientStep({ document: 'AB12345' });
    expect(screen.getByTestId('wizard-document')).toHaveValue('12345');
    next();
    expect(onSampleStep()).toBe(false);
  });

  it('a deceased patient needs the representative name, a valid email and a valid document, and no patient email', () => {
    renderWizard();
    fillPatientStep({ email: '' });
    fireEvent.click(deceasedBox());
    next();
    expect(onSampleStep()).toBe(false);
    fireEvent.change(repName(), { target: { value: 'Joao Rep' } });
    fireEvent.change(repEmail(), { target: { value: 'joao@' } });
    fireEvent.change(repDocument(), { target: { value: REP_CPF } });
    next();
    expect(onSampleStep()).toBe(false);
    fireEvent.change(repEmail(), { target: { value: 'joao@example.com' } });
    fireEvent.change(repDocument(), { target: { value: '12345' } });
    next();
    expect(onSampleStep()).toBe(false);
    fireEvent.change(repDocument(), { target: { value: REP_CPF } });
    next();
    expect(onSampleStep()).toBe(true);
  });

  it('a deceased patient with a bad patient email is refused', () => {
    renderWizard();
    fillPatientStep({ email: 'maria@' });
    fireEvent.click(deceasedBox());
    fireEvent.change(repName(), { target: { value: 'Joao Rep' } });
    fireEvent.change(repEmail(), { target: { value: 'joao@example.com' } });
    fireEvent.change(repDocument(), { target: { value: REP_CPF } });
    next();
    expect(onSampleStep()).toBe(false);
  });

  it('formats the representative document to its digits', () => {
    renderWizard();
    fireEvent.click(deceasedBox());
    fireEvent.change(repDocument(), { target: { value: '529.982.247-25' } });
    expect(repDocument()).toHaveValue(REP_CPF);
  });

  it('shows no patient-match alert when the match lookup is rejected', async () => {
    patientMatch = () => Promise.reject(new Error('down'));
    renderWizard();
    fillPatientStep();
    await passDebounce();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/intake-wizard/patient-match', expect.anything()));
    await waitFor(() => expect(screen.queryByText(/Verificando|Checking/)).not.toBeInTheDocument());
    expect(screen.queryByTestId('wizard-patient-match-alert')).not.toBeInTheDocument();
  });

  it('does not look the patient up for a name shorter than 3 characters', async () => {
    renderWizard();
    fillPatientStep({ name: 'Al' });
    await passDebounce();
    expect(apiClient.get).not.toHaveBeenCalledWith('/intake-wizard/patient-match', expect.anything());
    expect(screen.queryByTestId('wizard-patient-match-alert')).not.toBeInTheDocument();
  });
});

describe('ClinicalIntakeWizard sample step', () => {
  it('refuses next while the sample step is incomplete', async () => {
    renderWizard();
    await goToSampleStep();
    set('wizard-sample-type', 'PLASMA');
    next();
    expect(screen.queryByTestId('wizard-diagnosis-search')).not.toBeInTheDocument();
    expect(onSampleStep()).toBe(true);
  });

  it('the solid matrix swaps the axis options and the quantity unit follows the axis-1 label', async () => {
    renderWizard();
    await goToSampleStep();
    expect(axisValues(1)).toContain('BLD');
    set('wizard-sprec-axis-1', 'PL1');
    expect(quantityUnit()).toBe('mL');
    set('wizard-sprec-axis-1', 'ZZZ');
    expect(quantityUnit()).toBe('mL');
    set('wizard-sprec-matrix', 'solid');
    expect(axisValues(1)).toContain('TIS');
    expect(axisValues(1)).not.toContain('BLD');
    expect(axisValues(5)).toContain('SNP');
    set('wizard-sprec-axis-1', 'TIS');
    expect(quantityUnit()).toBe('mg');
    set('wizard-sprec-axis-1', 'FNA');
    expect(quantityUnit()).toBe('mL');
  });

  it('derives the institution acronym without the stop words', async () => {
    renderWizard();
    await goToSampleStep();
    set('wizard-institution-name', 'Hospital das Clinicas');
    expect(screen.getByLabelText(/Institution acronym|Sigla da Institui/)).toHaveValue('HC');
  });

  it('unknown processing forces axes 3-6 to the unknown code with a banner, and unchecking restores the chosen values', async () => {
    renderWizard();
    await goToSampleStep();
    fillSampleStep();
    fireEvent.click(screen.getByTestId('wizard-processing-unknown'));
    [3, 4, 5, 6].forEach((n) => expect(screen.getByTestId(`wizard-sprec-axis-${n}`)).toHaveValue('X'));
    expect(screen.getByTestId('wizard-sprec-axis-3')).toBeDisabled();
    expect(screen.getByText(/Segurança de governança ativa/)).toBeInTheDocument();
    expect(screen.getAllByText('PL1-SED-X-X-X-X-A').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('wizard-processing-unknown'));
    expect(['A', 'A', 'N', 'N'].map((_, i) => screen.getByTestId(`wizard-sprec-axis-${i + 3}`).value)).toEqual(['A', 'A', 'N', 'N']);
    expect(screen.queryByText(/Segurança de governança ativa/)).not.toBeInTheDocument();
  });

  it('unknown processing on the solid matrix uses XXX where the axis has no X', async () => {
    renderWizard();
    await goToSampleStep();
    set('wizard-sprec-matrix', 'solid');
    fireEvent.click(screen.getByTestId('wizard-processing-unknown'));
    expect(screen.getByTestId('wizard-sprec-axis-3')).toHaveValue('X');
    expect(screen.getByTestId('wizard-sprec-axis-4')).toHaveValue('X');
    expect(screen.getByTestId('wizard-sprec-axis-5')).toHaveValue('XXX');
    expect(screen.getByTestId('wizard-sprec-axis-6')).toHaveValue('X');
  });

  it('back returns to step 1 with the values kept, and onStepChange gets 1 then 0', async () => {
    const onStepChange = vi.fn();
    renderWizard({ onStepChange });
    await goToSampleStep();
    back();
    expect(screen.getByTestId('wizard-full-name')).toHaveValue('Maria Teste');
    expect(screen.getByTestId('wizard-document')).toHaveValue(VALID_CPF);
    expect(onStepChange.mock.calls).toEqual([[1], [0]]);
  });
});

describe('ClinicalIntakeWizard organization picker', () => {
  const twoOrgs = () => organizationService.getMine.mockResolvedValue({
    data: { data: { scope: 'organization', organizations: [{ organizationId: 'org-a', officialName: 'Org A' }, { organizationId: 'org-b', officialName: 'Org B' }] } },
  });

  it('refuses a submit with no organization picked when the account has two, back on step 2 with no POST', async () => {
    twoOrgs();
    renderWizard();
    await goToSampleStep();
    await waitFor(() => expect(screen.getByTestId('wizard-organization')).toBeInTheDocument());
    expect(screen.getByText('Organização da coleta')).toBeInTheDocument();
    fillSampleStep();
    next();
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
    await selectDiagnosisAndNaive();
    await waitFor(() => expect(screen.getByTestId('wizard-submit-button')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wizard-submit-button'));
    await waitFor(() => expect(screen.getByText('Selecione a organização da coleta: sua conta pertence a mais de uma.')).toBeInTheDocument());
    expect(onSampleStep()).toBe(true);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('sends the picked organization as organizationId', async () => {
    twoOrgs();
    apiClient.post.mockResolvedValue({ data: { sample: { specimenId: 'SP-5' } } });
    renderWizard();
    await goToSampleStep();
    await waitFor(() => expect(screen.getByTestId('wizard-organization')).toBeInTheDocument());
    fillSampleStep();
    set('wizard-organization', 'org-b');
    next();
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
    await selectDiagnosisAndNaive();
    await waitFor(() => expect(screen.getByTestId('wizard-submit-button')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wizard-submit-button'));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post.mock.calls[0][1].organizationId).toBe('org-b');
  });

  it('a global account gets an optional picker over every organization', async () => {
    organizationService.getMine.mockResolvedValue({ data: { data: { scope: 'global' } } });
    organizationService.getAll.mockResolvedValue({ data: { success: true, data: [{ organizationId: 'org-g', officialName: 'Global Org' }] } });
    renderWizard();
    await goToSampleStep();
    await waitFor(() => expect(screen.getByTestId('wizard-organization')).toBeInTheDocument());
    expect(screen.getByText('Organização da coleta (opcional)')).toBeInTheDocument();
    expect(Array.from(screen.getByTestId('wizard-organization').options).map((o) => o.textContent)).toEqual(['Nenhuma', 'Global Org']);
  });
});

describe('ClinicalIntakeWizard consent template', () => {
  it('auto-selects the active template and fills the preview placeholders', async () => {
    consentService.getTemplates.mockResolvedValue({
      data: { templates: [{ _id: 'tpl-old', title: 'TCLE antigo', version: 'v0', content: 'antigo' }, { ...TEMPLATE, _id: 'tpl-new', title: 'TCLE novo' }] },
    });
    renderWizard();
    await goToClinicalStep();
    expect(screen.getByText('TCLE novo')).toBeInTheDocument();
    expect(screen.getByText(/^Eu, Maria Teste, doc .+, rep Not applicable$/)).toBeInTheDocument();
  });

  it('a deceased patient fills the representative placeholder with the representative name', async () => {
    renderWizard();
    fillPatientStep();
    fireEvent.click(deceasedBox());
    fireEvent.change(repName(), { target: { value: 'Joao Rep' } });
    fireEvent.change(repEmail(), { target: { value: 'joao@example.com' } });
    fireEvent.change(repDocument(), { target: { value: REP_CPF } });
    next();
    await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
    fillSampleStep();
    next();
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
    expect(screen.getByText(/rep Joao Rep$/)).toBeInTheDocument();
  });

  it('uses a template that has only htmlContent', async () => {
    consentService.getTemplates.mockResolvedValue({ data: { templates: [{ _id: 'tpl-h', title: 'TCLE html', active: true, htmlContent: 'Html para {{NOME_PACIENTE}}' }] } });
    renderWizard();
    await goToClinicalStep();
    expect(screen.getByText('Html para Maria Teste')).toBeInTheDocument();
  });

  it('a template with no content shows the no-content text', async () => {
    consentService.getTemplates.mockResolvedValue({ data: { templates: [{ _id: 'tpl-e', title: 'TCLE vazio', active: true }] } });
    renderWizard();
    await goToClinicalStep();
    expect(screen.getByText(/No informed consent content|Nenhum conteúdo de TCLE/)).toBeInTheDocument();
  });

  it('an empty template list says none is registered and keeps submit disabled', async () => {
    consentService.getTemplates.mockResolvedValue({ data: { templates: [] } });
    renderWizard();
    await goToClinicalStep();
    await selectDiagnosisAndNaive();
    expect(screen.getByText('Nenhum TCLE cadastrado.')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-submit-button')).toBeDisabled();
  });

  it('a rejected template lookup shows its error message', async () => {
    consentService.getTemplates.mockRejectedValue(new Error('TCLE indisponível'));
    renderWizard();
    await waitFor(() => expect(screen.getByText('TCLE indisponível')).toBeInTheDocument());
  });

  it('onValidityChange gets true once all three steps are valid', async () => {
    const onValidityChange = vi.fn();
    renderWizard({ onValidityChange });
    await waitFor(() => expect(onValidityChange).toHaveBeenCalledWith(false));
    expect(onValidityChange).not.toHaveBeenCalledWith(true);
    await reachSubmit();
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
  });
});

describe('ClinicalIntakeWizard buildSubmissionPayload arms', () => {
  const base = { patientName: 'Paciente Teste', linkedProject: 'PROJ-1' };

  it('a healthy control has no diagnosis', () => {
    expect(buildSubmissionPayload({ ...base, isHealthyControl: true }).diagnosis).toBeNull();
  });

  it('a deceased patient builds the legal representative', () => {
    const payload = buildSubmissionPayload({
      ...base,
      isDeceased: true,
      representativeName: ' Joao Rep ',
      representativeEmail: ' Joao@Example.com ',
      representativeCpf: ' 52998224725 ',
      representativePhone: '(11) 98765-4321',
    });
    expect(payload.legalRepresentative).toEqual({ name: 'Joao Rep', email: 'joao@example.com', identityDocument: '52998224725', phone: '11987654321' });
    expect(buildSubmissionPayload(base).legalRepresentative).toBeNull();
  });

  it('keeps a numeric dictionary biomarker and drops a non-numeric or empty one', () => {
    const payload = buildSubmissionPayload(
      { ...base, b_num: '1,5', b_text: 'abc', b_empty: '' },
      [],
      [{ slug: 'b_num', unit: 'ng/mL' }, { slug: 'b_text' }, { slug: 'b_empty' }],
    );
    expect(payload.biomarkers).toEqual([expect.objectContaining({ biomarkerType: 'b_num', value: 1.5, unit: 'ng/mL', source: 'patient' })]);
  });

  it('reads a disease biomarker value by code, by label or from the biomarker, and drops one with no code or a non-numeric value', () => {
    const payload = buildSubmissionPayload({
      ...base,
      biomarkers_values: { C1: '2', 'Label 2': '3,5' },
      diseaseBiomarkers: [
        { code: 'C1', label: 'Label 1', unit: 'nmol/L' },
        { code: 'C2', label: 'Label 2' },
        { code: 'C3', value: '4' },
        { label: 'Sem codigo', value: '5' },
        { code: 'C5', value: 'abc' },
      ],
    });
    expect(payload.biomarkers.map(({ biomarkerType, biomarkerLabel, value, unit }) => ({ biomarkerType, biomarkerLabel, value, unit }))).toEqual([
      { biomarkerType: 'C1', biomarkerLabel: 'Label 1', value: 2, unit: 'nmol/L' },
      { biomarkerType: 'C2', biomarkerLabel: 'Label 2', value: 3.5, unit: '' },
      { biomarkerType: 'C3', biomarkerLabel: 'C3', value: 4, unit: '' },
    ]);
  });

  it('a solid matrix sends the solid SPREC axes', () => {
    const payload = buildSubmissionPayload({
      ...base,
      sprecMatrixType: 'Solid',
      sprecSampleType: 'TIS',
      sprecPrimaryContainer: 'SRG',
      sprecPreCentrifugation: 'A',
      sprecCentrifugation: 'B',
      sprecSecondCentrifugation: 'NBF',
      sprecPostCentrifugationDelay: 'C',
      sprecLongTermStorage: 'P',
      sprecCode: 'TIS-SRG-A-B-NBF-C-P',
    });
    expect(payload.specimen.sprec).toEqual(expect.objectContaining({
      code: 'TIS-SRG-A-B-NBF-C-P',
      matrixType: 'solid',
      sampleType: 'TIS',
      collectionType: 'SRG',
      warmIschemia: 'A',
      coldIschemia: 'B',
      fixationType: 'NBF',
      fixationTime: 'C',
      longTermStorage: 'P',
    }));
    expect(payload.specimen.sprec).not.toHaveProperty('primaryContainer');
  });
});
