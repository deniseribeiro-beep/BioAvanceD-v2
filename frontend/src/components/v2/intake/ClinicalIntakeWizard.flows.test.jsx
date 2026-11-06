import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ClinicalIntakeWizard, { _test } from './ClinicalIntakeWizard.jsx';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import { apiClient } from '../../../api/client';
import { consentService, organizationService } from '../../../services/api';
import { buildSampleMerkleRoot } from '../../../utils/sampleMerkleIntegrity';

// #1443: the wizard flows the other three suites leave out -- stale responses
// a newer query supersedes, API rows missing optional fields, the patient
// step's partial inputs, the sample step's processing toggle, and the
// submission's label and warning fallbacks.
vi.mock('../../../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() }, notifyApiToast: vi.fn() }));
vi.mock('../../../services/api', () => ({
  consentService: { getTemplates: vi.fn() },
  organizationService: { getMine: vi.fn(), getAll: vi.fn() },
}));
vi.mock('../../../utils/sampleMerkleIntegrity', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildSampleMerkleRoot: vi.fn(actual.buildSampleMerkleRoot) };
});

const DICT = { clinicalComorbidities: [{ slug: 'hypertension', label: 'Hipertensao' }], biomarkers: [{ slug: 'lyso_gb3', label: 'Lyso-Gb3' }] };
const HIT = { id: 'orpha-324', descricao: 'Doenca de Fabry', ORPHA: '324', Codigos_CID10: 'E75.2' };
const TEMPLATE = { _id: 'tpl-1', title: 'TCLE A', version: 'v1', active: true, content: 'Eu, {{NOME_PACIENTE}}' };
const VALID_CPF = '11144477735';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let routes;
function mockApi(overrides = {}) {
  routes = {
    search: () => Promise.resolve({ data: { results: [HIT] } }),
    relation: () => Promise.resolve({ data: { results: [] } }),
    match: () => Promise.resolve({ data: { matched: false } }),
    suggest: () => Promise.resolve({ data: {} }),
    atc: () => Promise.resolve({ data: { medications: [] } }),
    ...overrides,
  };
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/terminologies') return /^ORPHA:/.test(String(config?.params?.q || '')) ? routes.relation(config) : routes.search(config);
    if (url === '/intake-wizard/patient-match') return routes.match(config);
    if (url === '/dictionary/suggest') return routes.suggest(config);
    if (url === '/dictionary/atc/search') return routes.atc(config);
    return Promise.resolve({ data: {} });
  });
  consentService.getTemplates.mockResolvedValue({ data: { templates: [TEMPLATE] } });
  organizationService.getMine.mockResolvedValue({ data: { data: { scope: 'none' } } });
}

function renderWizard(props = {}) {
  return render(<LanguageProvider><ClinicalIntakeWizard dictionaries={DICT} dictionariesLoading={false} {...props} /></LanguageProvider>);
}

const set = (id, v) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const next = () => fireEvent.click(screen.getByTestId('wizard-next-button'));
const axis = (n) => screen.getByTestId(`wizard-sprec-axis-${n}`);

function fillPatient(document = VALID_CPF) {
  set('wizard-full-name', 'Maria Teste');
  set('wizard-birth-date', '01/01/1990');
  set('wizard-gender', 'M');
  set('wizard-email', 'maria@example.com');
  set('wizard-document', document);
}

async function toSample() {
  fillPatient();
  next();
  await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
}

function fillSample(axes = ['PL1', 'SED', 'A', 'A', 'N', 'N', 'A']) {
  set('wizard-sample-type', 'PLASMA');
  set('wizard-sample-origin', 'VENOUS_BLOOD');
  set('wizard-extraction-protocol', 'TUBE_EDTA');
  axes.forEach((v, i) => set(`wizard-sprec-axis-${i + 1}`, v));
  set('wizard-quantity', '5');
  set('wizard-linked-project', 'PROJ-1');
  set('wizard-institution-name', 'Hospital Teste');
}

async function toClinical() {
  await toSample();
  fillSample();
  next();
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
}

async function pickDiagnosis() {
  set('wizard-diagnosis-search', 'Fabry');
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument());
  fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
  await waitFor(() => expect(screen.getByDisplayValue('E75.2')).toBeInTheDocument());
}

async function submitWith(respond) {
  apiClient.post.mockImplementation(respond);
  renderWizard();
  await toClinical();
  await pickDiagnosis();
  set('wizard-treatment-status', 'NAIVE');
  await waitFor(() => expect(screen.getByTestId('wizard-submit-button')).not.toBeDisabled());
  fireEvent.click(screen.getByTestId('wizard-submit-button'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClinicalIntakeWizard patient step inputs', () => {
  it.each([
    ['a first check digit of 0', '10000000108'],
    ['a second check digit of 0', '10000000280'],
  ])('accepts a CPF with %s', async (_, cpf) => {
    renderWizard();
    fillPatient(cpf);
    next();
    await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
  });

  it('formats a four-digit birth date as DD/MM', () => {
    renderWizard();
    set('wizard-birth-date', '0101');
    expect(screen.getByTestId('wizard-birth-date')).toHaveValue('01/01');
  });

  it('shows the checking text while the patient lookup is pending', async () => {
    const pending = deferred();
    mockApi({ match: () => pending.promise });
    renderWizard();
    fillPatient();
    await waitFor(() => expect(screen.getByText(/Checking positive patient identification|Verificando identifica/)).toBeInTheDocument());
    await act(async () => { pending.resolve({ data: { matched: true } }); });
    await waitFor(() => expect(screen.getByTestId('wizard-patient-match-alert')).toBeInTheDocument());
  });

  it.each([
    ['answer', (stale) => stale.resolve({ data: { matched: false } })],
    ['failure', (stale) => stale.reject(new Error('late'))],
  ])('a late lookup %s for a name since changed leaves the newer match alert', async (_, settle) => {
    const stale = deferred();
    const answers = [stale.promise, Promise.resolve({ data: { matched: true } })];
    mockApi({ match: () => answers.shift() });
    renderWizard();
    fillPatient();
    await waitFor(() => expect(answers).toHaveLength(1));
    set('wizard-full-name', 'Maria Teste Silva');
    await waitFor(() => expect(screen.getByTestId('wizard-patient-match-alert')).toBeInTheDocument());
    await act(async () => { settle(stale); });
    expect(screen.getByTestId('wizard-patient-match-alert')).toBeInTheDocument();
  });
});

describe('ClinicalIntakeWizard sample step inputs', () => {
  it('unknown processing on an empty sample step sets axes 3-6 to X, and unchecking empties them again', async () => {
    renderWizard();
    await toSample();
    fireEvent.click(screen.getByTestId('wizard-processing-unknown'));
    await waitFor(() => expect(axis(3)).toHaveValue('X'));
    [4, 5, 6].forEach((n) => expect(axis(n)).toHaveValue('X'));
    fireEvent.click(screen.getByTestId('wizard-processing-unknown'));
    [3, 4, 5, 6].forEach((n) => expect(axis(n)).toHaveValue(''));
  });

  it('a centrifugation of I or J shows the protocol risk warning', async () => {
    renderWizard();
    await toSample();
    expect(screen.queryByLabelText(/10,000g|10.000g/)).not.toBeInTheDocument();
    set('wizard-sprec-axis-4', 'I');
    expect(screen.getByLabelText(/10,000g|10.000g/)).toBeInTheDocument();
  });

  it('an organization with no official name is listed by its id', async () => {
    organizationService.getMine.mockResolvedValue({ data: { data: { scope: 'organization', organizations: [{ organizationId: 'org-a' }, { organizationId: 'org-b', officialName: 'Org B' }] } } });
    renderWizard();
    await toSample();
    await waitFor(() => expect(screen.getByTestId('wizard-organization')).toBeInTheDocument());
    expect(Array.from(screen.getByTestId('wizard-organization').options).map((o) => o.textContent).slice(1)).toEqual(['org-a', 'Org B']);
  });

  it('back with no onStepChange still returns to step 1', async () => {
    renderWizard();
    await toSample();
    fireEvent.click(screen.getByTestId('wizard-back-button'));
    expect(screen.getByTestId('wizard-full-name')).toHaveValue('Maria Teste');
  });
});

describe('ClinicalIntakeWizard dictionaries and consent templates', () => {
  it('without dictionaries props shows the terminology loading card', () => {
    render(<LanguageProvider><ClinicalIntakeWizard /></LanguageProvider>);
    expect(screen.getByTestId('wizard-loading-terminologies')).toBeInTheDocument();
  });

  it('a rejected template lookup with no message shows the default consent error', async () => {
    consentService.getTemplates.mockRejectedValue({});
    renderWizard();
    await waitFor(() => expect(screen.getByText(/Error communicating with consent server|Erro ao comunicar com o servidor de consentimentos/)).toBeInTheDocument());
  });

  it('with no active template auto-selects the first, labelling a template with no version or title', async () => {
    consentService.getTemplates.mockResolvedValue({ data: { templates: [{ _id: 'tpl-x', title: 'Old', version: 'v0', active: false }, { _id: 'tpl-y' }] } });
    renderWizard();
    await toClinical();
    const select = screen.getByDisplayValue('v0 - Old');
    expect(Array.from(select.options).map((o) => o.textContent).slice(1)).toEqual(['v0 - Old', 'v? - TCLE']);
  });

  it('a first template with no id selects nothing and keeps submit disabled', async () => {
    consentService.getTemplates.mockResolvedValue({ data: { templates: [{ title: 'Sem id', version: 'v9' }] } });
    renderWizard();
    await toClinical();
    expect(screen.getByTestId('wizard-submit-button')).toBeDisabled();
  });
});

describe('ClinicalIntakeWizard diagnosis search and select', () => {
  it('focusing an empty search opens no result list; refocusing a two-letter search reopens it', async () => {
    renderWizard();
    await toClinical();
    const search = screen.getByTestId('wizard-diagnosis-search');
    fireEvent.focus(search);
    expect(screen.queryByTestId('wizard-diagnosis-results')).not.toBeInTheDocument();
    set('wizard-diagnosis-search', 'Fabry');
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-results')).toBeInTheDocument());
    fireEvent.blur(search);
    await waitFor(() => expect(screen.queryByTestId('wizard-diagnosis-results')).not.toBeInTheDocument());
    fireEvent.focus(search);
    expect(screen.getByTestId('wizard-diagnosis-results')).toBeInTheDocument();
  });

  it('lists a hit with no id or code, drops an empty row, and selecting a hit with no id still fills the codes', async () => {
    mockApi({ search: () => Promise.resolve({ data: { results: [{ descricao: 'Fabry sem codigo' }, {}, { descricao: 'Doenca de Fabry', ORPHA: '324', Codigos_CID10: 'E75.2' }] } }) });
    renderWizard();
    await toClinical();
    set('wizard-diagnosis-search', 'Fabry');
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-1')).toBeInTheDocument());
    expect(screen.queryByTestId('wizard-diagnosis-option-2')).not.toBeInTheDocument();
    const withCode = screen.getAllByRole('button').find((b) => /E75\.2/.test(b.textContent));
    fireEvent.mouseDown(withCode);
    await waitFor(() => expect(screen.getByDisplayValue('E75.2')).toBeInTheDocument());
  });

  it('a late search answer for a query since changed does not replace the newer empty result', async () => {
    const stale = deferred();
    const answers = [stale.promise, Promise.resolve({ data: { results: [] } })];
    mockApi({ search: () => answers.shift() });
    renderWizard();
    await toClinical();
    set('wizard-diagnosis-search', 'Fab');
    await waitFor(() => expect(answers).toHaveLength(1));
    set('wizard-diagnosis-search', 'Fabr');
    await waitFor(() => expect(answers).toHaveLength(0));
    await act(async () => { stale.resolve({ data: { results: [HIT] } }); });
    expect(screen.queryByTestId('wizard-diagnosis-option-0')).not.toBeInTheDocument();
  });

  it('a late search failure for a query since changed leaves the newer results and shows no error', async () => {
    const stale = deferred();
    const answers = [stale.promise, Promise.resolve({ data: { results: [HIT] } })];
    mockApi({ search: () => answers.shift() });
    renderWizard();
    await toClinical();
    set('wizard-diagnosis-search', 'Fab');
    await waitFor(() => expect(answers).toHaveLength(1));
    set('wizard-diagnosis-search', 'Fabr');
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument());
    await act(async () => { stale.reject(new Error('stale failure')); });
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument();
  });

  it('a value typed into one of two suggested biomarkers leaves the other empty', async () => {
    mockApi({ suggest: () => Promise.resolve({ data: { biomarkers: [{ system: 'http://loinc.org', code: 'B1', display: 'Bio one' }, { system: 'http://loinc.org', code: 'B2', display: 'Bio two' }] } }) });
    renderWizard();
    await toClinical();
    await pickDiagnosis();
    await waitFor(() => expect(screen.getByTestId('wizard-biomarker-value-1')).toBeInTheDocument());
    set('wizard-biomarker-value-0', '3');
    expect(screen.getByTestId('wizard-biomarker-value-0')).toHaveValue(3);
    expect(screen.getByTestId('wizard-biomarker-value-1')).toHaveValue(null);
  });
});

describe('ClinicalIntakeWizard step 3 inputs', () => {
  it('clearing blood pressure empties it', async () => {
    renderWizard();
    await toClinical();
    const bp = screen.getByRole('textbox', { name: 'Blood pressure' });
    fireEvent.change(bp, { target: { value: '12080' } });
    expect(bp).toHaveValue('120/80');
    fireEvent.change(bp, { target: { value: '' } });
    expect(bp).toHaveValue('');
  });

  it('a medication with only a code fills the ATC code and leaves name and class empty; a bare one shows dashes', async () => {
    mockApi({ atc: () => Promise.resolve({ data: { medications: [{ code: 'atc:b01', name: 'Only code' }, {}] } }) });
    renderWizard();
    await toClinical();
    set('wizard-treatment-status', 'TREATED');
    set('wizard-medication-search', 'Onl');
    await waitFor(() => expect(screen.getByTestId('wizard-medication-option-1')).toBeInTheDocument());
    expect(screen.getByTestId('wizard-medication-option-1')).toHaveTextContent('ATC: - • Nível 1: -');
    fireEvent.mouseDown(screen.getByTestId('wizard-medication-option-0'));
    expect(screen.getByTestId('wizard-atc-code')).toHaveValue('B01');
    expect(screen.getByTestId('wizard-atc-level1')).toHaveValue('');
    set('wizard-medication-search', 'Ot');
    await waitFor(() => expect(screen.getByTestId('wizard-medication-option-1')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('wizard-medication-option-1'));
    expect(screen.getByTestId('wizard-atc-code')).toHaveValue('');
    expect(screen.getByTestId('wizard-medication-search')).toHaveValue('');
  });

  it('ignores a medication search failure for a query that has since changed', async () => {
    const first = deferred();
    const answers = [first];
    mockApi({ atc: () => (answers.length ? answers.shift().promise : Promise.resolve({ data: { medications: [] } })) });
    renderWizard();
    await toClinical();
    set('wizard-treatment-status', 'TREATED');
    set('wizard-medication-search', 'Ag');
    await waitFor(() => expect(answers).toHaveLength(0));
    set('wizard-medication-search', 'Aga');
    await act(async () => { first.reject(new Error('late')); });
    expect(screen.queryByText(/Could not search medications|Não foi possível consultar medicamentos/)).not.toBeInTheDocument();
  });

  it('a re-submit after the diagnosis is cleared clears the last submit error, stays on step 3 and posts nothing more', async () => {
    await submitWith(() => Promise.reject(new Error('backend down')));
    await waitFor(() => expect(screen.getByText('backend down')).toBeInTheDocument());
    set('wizard-diagnosis-search', '');
    set('wizard-treatment-status', 'NAIVE');
    fireEvent.click(screen.getByTestId('wizard-submit-button'));
    await waitFor(() => expect(screen.queryByText('backend down')).not.toBeInTheDocument());
    expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});

describe('ClinicalIntakeWizard submission fallbacks', () => {
  it('a rejection with no message shows the default submit error', async () => {
    await submitWith(() => Promise.reject({}));
    await waitFor(() => expect(screen.getByText(/Error finishing integrated registration|Erro ao finalizar o cadastro integrado/)).toBeInTheDocument());
  });

  it('a Merkle root that cannot be built submits with a null root', async () => {
    buildSampleMerkleRoot.mockRejectedValue(new Error('no subtle crypto'));
    await submitWith(() => Promise.resolve({ data: { sample: { specimenId: 'SP-1' } } }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(JSON.stringify(apiClient.post.mock.calls[0][1])).toContain('"merkleRoot":null');
  });

  it('label ids fall back through labelData sampleId, patientCode and registeredAt', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { labelData: { sampleId: 'LS-1', patientCode: 'PC-1', registeredAt: '2025-03-04T12:00:00Z' } } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent('LS-1');
    expect(screen.getByTestId('sample-label-date')).toHaveTextContent(new Date('2025-03-04T12:00:00Z').toLocaleDateString('pt-BR'));
  });

  it('sample ids fall back through sampleId, _id, qrCode, registeredAt and createdAt', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { _id: 'mongo-1', qrCode: 'QR-1', participantId: 'P-1', createdAt: '2025-05-06T12:00:00Z' } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label-code')).toHaveTextContent('QR-1');
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent('mongo-1');
  });

  it('a label override with no SPREC, type, date or ids shows N/A and a warning with no specimen suffix', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { specimenId: 'SP-2' }, label: { specimenId: '', code: '', sprecCode: '', sampleType: '', collectionDate: '' }, clinicalEntities: { failed: [{}] } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label')).toHaveTextContent('SPREC N/A');
    expect(screen.getByTestId('sample-label-type')).toHaveTextContent('N/A');
    expect(screen.getByTestId('sample-label-date')).toHaveTextContent('N/A');
    expect(screen.getByTestId('clinical-entities-warning')).not.toHaveTextContent('—');
    expect(screen.getByTestId('clinical-entities-warning-item')).not.toHaveTextContent('(');
  });
});

describe('ClinicalIntakeWizard payload and schema helper arms', () => {
  const { buildSubmissionPayload, createClinicalStepSchema } = _test;
  const base = { patientName: 'Paciente Teste', linkedProject: 'PROJ-1' };
  const t = (_key, fallback) => fallback;

  it('a dictionary biomarker takes its unit from unit, then measurementUnit, else none', () => {
    const payload = buildSubmissionPayload({ ...base, b1: '1', b2: '2', b3: '3' }, [], [{ slug: 'b1', unit: 'mg' }, { slug: 'b2', measurementUnit: 'g' }, { slug: 'b3' }]);
    expect(payload.biomarkers.map((b) => b.unit)).toEqual(['mg', 'g', '']);
  });

  it('drops a coded disease biomarker that has no value anywhere', () => {
    const payload = buildSubmissionPayload({ ...base, diseaseBiomarkers: [{ code: 'C9', label: 'Nada' }] });
    expect(payload.biomarkers).toEqual([]);
  });

  it('a deceased patient with no representative name or phone sends both empty', () => {
    const payload = buildSubmissionPayload({ ...base, isDeceased: true, representativeEmail: 'r@x.com', representativeCpf: '52998224725' });
    expect(payload.legalRepresentative).toEqual(expect.objectContaining({ name: '', phone: '' }));
  });

  it('a healthy control passes the clinical schema with no diagnosis or treatment status', () => {
    const schema = createClinicalStepSchema(t, []);
    expect(schema.safeParse({ isHealthyControl: true }).success).toBe(true);
    expect(schema.safeParse({ isHealthyControl: false }).success).toBe(false);
  });
});

describe('ClinicalIntakeWizard API rows with blank or missing fields', () => {
  const todayCode = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };

  it('blank label ids fall back to the date-NOID-SAMPLE code', async () => {
    await submitWith(() => Promise.resolve({ data: { sample: { labelData: { barcode: ' ', specimenId: ' ', participantId: ' ', sampleType: ' ' } } } }));
    await waitFor(() => expect(screen.getByTestId('sample-label')).toBeInTheDocument());
    expect(screen.getByTestId('sample-label-code')).toHaveTextContent(`${todayCode()}-NOID-SAMPLE`);
    expect(screen.getByTestId('sample-label-sample-id')).toHaveTextContent(`${todayCode()}-NOID-SAMPLE`);
  });

  it('selecting a hit with codes but no description fills its codes and describes it by its code', async () => {
    mockApi({ search: () => Promise.resolve({ data: { results: [{ ORPHA: '324', Codigos_CID10: 'E75.2' }] } }) });
    renderWizard();
    await toClinical();
    set('wizard-diagnosis-search', 'E75');
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
    await waitFor(() => expect(screen.getByPlaceholderText('CID-10')).toHaveValue('E75.2'));
    expect(screen.getByPlaceholderText('ORPHA')).toHaveValue('ORPHA:324');
    expect(screen.getByPlaceholderText(/Select disease in Orphadata|Selecionar doença em Orphadata/)).toHaveValue('E75.2');
  });

  it('selecting a hit known only by its relation CID fills CID-10 and no ORPHA', async () => {
    mockApi({ search: () => Promise.resolve({ data: { results: [{ descricao: 'Fabry por relacao', relacoes: { cid10: 'E75.2' } }] } }) });
    renderWizard();
    await toClinical();
    await pickDiagnosis();
    expect(screen.getByPlaceholderText('ORPHA')).toHaveValue('');
  });

  it('selecting a hit with no code at all leaves every code empty and keeps the select hint', async () => {
    mockApi({ search: () => Promise.resolve({ data: { results: [{ descricao: 'Fabry sem codigo' }] } }) });
    renderWizard();
    await toClinical();
    set('wizard-diagnosis-search', 'Fabry');
    await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
    await waitFor(() => expect(screen.queryByTestId('wizard-diagnosis-results')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('CID-10')).toHaveValue('');
    expect(screen.getByText('Select a result to auto-fill ORPHA, OMIM and ICD-10.')).toBeInTheDocument();
  });

  it('a comorbidity dictionary row with no slug renders no checkbox', async () => {
    renderWizard({ dictionaries: { clinicalComorbidities: [{ slug: 'hypertension', label: 'Hipertensao' }, { label: 'Sem slug' }], biomarkers: DICT.biomarkers } });
    await toClinical();
    expect(screen.getByTestId('wizard-comorbidity-hypertension')).toBeInTheDocument();
    expect(screen.queryByText('Sem slug')).not.toBeInTheDocument();
  });
});
