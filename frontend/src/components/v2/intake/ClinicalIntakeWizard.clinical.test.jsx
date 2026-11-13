import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ClinicalIntakeWizard from './ClinicalIntakeWizard.jsx';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import { apiClient } from '../../../api/client';
import { consentService } from '../../../services/api';

// #1337: step 3's clinical sub-forms -- diagnosis search and select, the
// suggestion cascade, treatment/medication, the five clinical lists, blood
// pressure and comorbidities. apiClient and the services are replaced at the
// network boundary so the wizard's own handlers run end to end.
vi.mock('../../../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  notifyApiToast: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  consentService: { getTemplates: vi.fn() },
  organizationService: {
    getMine: vi.fn().mockResolvedValue({ data: { data: { scope: 'none' } } }),
    getAll: vi.fn(),
  },
  // RF004 AC2 (#1497): the wizard's collection pick lists one governed collection.
  collectionsService: { getAll: vi.fn().mockResolvedValue({ data: { success: true, data: [{ collectionId: 'COL-1', collectionName: 'Coleção Governada' }] }, status: 200 }) },
}));

const FIXTURE_DICTIONARIES = {
  clinicalComorbidities: [{ slug: 'diabetes', label: 'Diabetes' }],
  biomarkers: [{ slug: 'lyso_gb3', label: 'Lyso-Gb3' }],
};

const FABRY_HIT = {
  id: 'orpha-324',
  descricao: 'Doenca de Fabry',
  ORPHA: '324',
  Codigos_CID10: 'E75.2',
};

const SUGGESTED_CASCADE = {
  disease: { system: 'http://www.orpha.net', code: '324', display: 'Doenca de Fabry' },
  phenotypes: [{ system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001066', display: 'Angioqueratoma' }],
  biomarkers: [{ system: 'http://loinc.org', code: 'LOINC:12345', display: 'Lyso-Gb3 plasmático' }],
};

const MEDICATION = { name: 'Agalsidase beta', atc_code: 'ATC:a16ab04', atc_level_1: 'a' };

// Routes apiClient.get by URL. The diagnosis search and the ORPHA relation
// lookup share /terminologies; the relation lookup's q starts with "ORPHA:".
function mockApiClient({
  searchImpl = () => Promise.resolve({ data: { results: [FABRY_HIT] }, status: 200 }),
  relationImpl = () => Promise.resolve({ data: { results: [] }, status: 200 }),
  profileImpl = () => Promise.resolve({ data: { disease: null }, status: 200 }),
  suggestImpl = () => Promise.resolve({ data: {}, status: 200 }),
  atcImpl = () => Promise.resolve({ data: { medications: [MEDICATION] } }),
  templates = [],
} = {}) {
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/terminologies') {
      return /^ORPHA:/.test(String(config?.params?.q || '')) ? relationImpl(config) : searchImpl(config);
    }
    if (url === '/dictionary/disease-profile') {
      return profileImpl(config);
    }
    if (url === '/dictionary/suggest') {
      return suggestImpl(config);
    }
    if (url === '/dictionary/atc/search') {
      return atcImpl(config);
    }
    if (url === '/intake-wizard/patient-match') {
      return Promise.resolve({ data: { matched: false }, status: 200 });
    }
    return Promise.resolve({ data: {}, status: 200 });
  });
  consentService.getTemplates.mockResolvedValue({ data: { templates }, status: 200 });
}

function renderWizard() {
  render(
    <LanguageProvider>
      <ClinicalIntakeWizard dictionaries={FIXTURE_DICTIONARIES} dictionariesLoading={false} />
    </LanguageProvider>
  );
}

async function fillStep1() {
  fireEvent.change(screen.getByTestId('wizard-full-name'), { target: { value: 'Maria Teste' } });
  fireEvent.change(screen.getByTestId('wizard-birth-date'), { target: { value: '01/01/1990' } });
  fireEvent.change(screen.getByTestId('wizard-gender'), { target: { value: 'M' } });
  fireEvent.change(screen.getByTestId('wizard-email'), { target: { value: 'maria@example.com' } });
  fireEvent.change(screen.getByTestId('wizard-document'), { target: { value: '11144477735' } });
  fireEvent.click(screen.getByTestId('wizard-next-button'));
  await waitFor(() => expect(screen.getByTestId('wizard-sample-type')).toBeInTheDocument());
}

async function fillStep2() {
  fireEvent.change(screen.getByTestId('wizard-sample-type'), { target: { value: 'PLASMA' } });
  fireEvent.change(screen.getByTestId('wizard-sample-origin'), { target: { value: 'VENOUS_BLOOD' } });
  fireEvent.change(screen.getByTestId('wizard-extraction-protocol'), { target: { value: 'TUBE_EDTA' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-1'), { target: { value: 'BLD' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-2'), { target: { value: 'SED' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-3'), { target: { value: 'A' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-4'), { target: { value: 'A' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-5'), { target: { value: 'N' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-6'), { target: { value: 'N' } });
  fireEvent.change(screen.getByTestId('wizard-sprec-axis-7'), { target: { value: 'A' } });
  fireEvent.change(screen.getByTestId('wizard-quantity'), { target: { value: '5' } });
  fireEvent.change(screen.getByTestId('wizard-linked-project'), { target: { value: 'PROJ-1' } });
  fireEvent.change(screen.getByTestId('wizard-institution-name'), { target: { value: 'Hospital Teste' } });
  fireEvent.change(screen.getByTestId('wizard-collection'), { target: { value: 'COL-1' } });
  fireEvent.click(screen.getByTestId('wizard-next-button'));
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
}

async function reachStep3() {
  renderWizard();
  await fillStep1();
  await fillStep2();
}

async function searchDiagnosis(query) {
  fireEvent.change(screen.getByTestId('wizard-diagnosis-search'), { target: { value: query } });
  await waitFor(
    () => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument(),
    { timeout: 2000 }
  );
}

async function selectDiagnosis(query = 'Fabry') {
  await searchDiagnosis(query);
  // The option handles onMouseDown (a click would never fire it).
  fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
}

function getCalls(url) {
  return apiClient.get.mock.calls.filter(([calledUrl]) => calledUrl === url);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const textbox = (name) => screen.getByRole('textbox', { name });

describe('ClinicalIntakeWizard step 3 -- diagnosis search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes no /terminologies call for a one-character query', async () => {
    mockApiClient();
    await reachStep3();

    fireEvent.change(screen.getByTestId('wizard-diagnosis-search'), { target: { value: 'F' } });
    await wait(400);

    expect(getCalls('/terminologies')).toHaveLength(0);
    expect(screen.queryByTestId('wizard-diagnosis-results')).not.toBeInTheDocument();
  });

  it('clearing the search input empties the ORPHA, OMIM and CID-10 codes and the description', async () => {
    mockApiClient({
      relationImpl: () => Promise.resolve({
        data: { results: [{ ORPHA: '324', descricao: 'Doenca de Fabry', relacoes: { cid10: 'E75.2', omim: '301500' } }] },
        status: 200,
      }),
    });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(textbox('OMIM')).toHaveValue('OMIM:301500'));
    expect(textbox('ORPHA')).toHaveValue('ORPHA:324');
    expect(textbox('ICD-10')).toHaveValue('E75.2');
    expect(screen.getByPlaceholderText('Select disease in Orphadata to fill fields.')).toHaveValue('Doenca de Fabry');

    fireEvent.change(screen.getByTestId('wizard-diagnosis-search'), { target: { value: '' } });

    expect(textbox('ORPHA')).toHaveValue('');
    expect(textbox('OMIM')).toHaveValue('');
    expect(textbox('ICD-10')).toHaveValue('');
    expect(screen.getByPlaceholderText('Select disease in Orphadata to fill fields.')).toHaveValue('');
  });

  it('shows the rejection message, falling back from message to error to Error.message to the default text', async () => {
    const rejections = [
      { response: { data: { message: 'Mensagem do servidor' } } },
      { response: { data: { error: 'Erro do servidor' } } },
      new Error('Falha de rede'),
      {},
    ];
    let rejection = rejections[0];
    mockApiClient({ searchImpl: () => Promise.reject(rejection) });
    await reachStep3();

    const expectations = [
      ['Fa', 'Mensagem do servidor'],
      ['Fab', 'Erro do servidor'],
      ['Fabr', 'Falha de rede'],
      ['Fabry', 'Could not load diseases.'],
    ];
    for (const [index, [query, message]] of expectations.entries()) {
      rejection = rejections[index];
      fireEvent.change(screen.getByTestId('wizard-diagnosis-search'), { target: { value: query } });
      await waitFor(() => expect(screen.getByText(message)).toHaveClass('text-red-600'), { timeout: 2000 });
    }
  });

  it('consolidates hits sharing an ORPHA code, filters non-matching hits and ranks the rest', async () => {
    mockApiClient({
      searchImpl: () => Promise.resolve({
        data: {
          results: [
            { ORPHA: '324', namePt: 'Doença de Fabry', relacoes: { cid10: 'E75.2', omim: '301500' } },
            { ORPHA: '324', descricao: 'Doenca de Fabry' },
            { ORPHA: '93', namePt: 'Fabry variante cardíaca', aliases: ['Fabry cardíaca'] },
            { ORPHA: '555', nameEn: 'Fabry-like disease', lang: 'en' },
            { Codigo_Tabulacao: 'E752', Descricao: 'Fabry sem ORPHA' },
            { ORPHA: '355', namePt: 'Doença de Gaucher' },
          ],
        },
        status: 200,
      }),
    });
    await reachStep3();
    await searchDiagnosis('fabry');

    const results = screen.getByTestId('wizard-diagnosis-results');
    expect(within(results).getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByText('Doença de Gaucher')).not.toBeInTheDocument();

    const first = screen.getByTestId('wizard-diagnosis-option-0');
    expect(within(first).getByText('Fabry sem ORPHA')).toBeInTheDocument();
    expect(first).toHaveTextContent('CID-10: E752 | ORPHA: - | OMIM: -');

    expect(screen.getByTestId('wizard-diagnosis-option-1')).toHaveTextContent('Fabry variante cardíaca');

    // The two ORPHA:324 hits collapse into the one that carries both codes.
    const consolidated = screen.getByTestId('wizard-diagnosis-option-2');
    expect(within(consolidated).getByText('Doença de Fabry')).toBeInTheDocument();
    expect(consolidated).toHaveTextContent('CID-10: E75.2 | ORPHA: ORPHA:324 | OMIM: OMIM:301500');

    // An English-only hit is marked as the English fallback.
    expect(screen.getByTestId('wizard-diagnosis-option-3')).toHaveTextContent('[EN] Fabry-like disease');
  });

  it('closes the result list 120 ms after blur and reopens it on focus', async () => {
    mockApiClient();
    await reachStep3();
    await searchDiagnosis('Fabry');

    const input = screen.getByTestId('wizard-diagnosis-search');
    fireEvent.blur(input);
    expect(screen.getByTestId('wizard-diagnosis-results')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('wizard-diagnosis-results')).not.toBeInTheDocument());

    fireEvent.focus(input);
    expect(screen.getByTestId('wizard-diagnosis-results')).toBeInTheDocument();
  });

  it('shows the "select a result" hint while a query is typed and no diagnosis is chosen', async () => {
    mockApiClient();
    await reachStep3();
    const hint = 'Select a result to auto-fill ORPHA, OMIM and ICD-10.';
    expect(screen.queryByText(hint)).not.toBeInTheDocument();

    await searchDiagnosis('Fabry');
    expect(screen.getByText(hint)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
    await waitFor(() => expect(screen.queryByText(hint)).not.toBeInTheDocument());
  });
});

describe('ClinicalIntakeWizard step 3 -- diagnosis select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fills the disease category from /dictionary/disease-profile', async () => {
    mockApiClient({
      profileImpl: () => Promise.resolve({ data: { disease: { disease_category: 'Lisossomal' } }, status: 200 }),
    });
    await reachStep3();
    expect(textbox('Disease category')).toHaveValue('Categoria não mapeada');

    await selectDiagnosis();

    await waitFor(() => expect(textbox('Disease category')).toHaveValue('Lisossomal'));
    expect(getCalls('/dictionary/disease-profile')[0][1].params).toEqual({ orphaCode: '324' });
  });

  it('leaves the category unmapped when /dictionary/disease-profile rejects', async () => {
    mockApiClient({ profileImpl: () => Promise.reject(new Error('profile down')) });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(getCalls('/dictionary/suggest').length).toBeGreaterThan(0));
    expect(textbox('Disease category')).toHaveValue('Categoria não mapeada');
  });

  it('looks up CID-10 and OMIM by ORPHA code when the selected hit carries neither', async () => {
    mockApiClient({
      searchImpl: () => Promise.resolve({ data: { results: [{ ORPHA: '324', descricao: 'Doenca de Fabry' }] }, status: 200 }),
      relationImpl: () => Promise.resolve({
        data: { results: [{ ORPHA: '324', descricao: 'Doenca de Fabry', relacoes: { cid10: 'E75.2', omim: '301500' } }] },
        status: 200,
      }),
    });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(textbox('ICD-10')).toHaveValue('E75.2'));
    expect(textbox('OMIM')).toHaveValue('OMIM:301500');
    const relationCall = getCalls('/terminologies').find(([, config]) => config.params.q === 'ORPHA:324');
    expect(relationCall[1].params).toEqual({ q: 'ORPHA:324', limit: 30 });

    // The identifiers card shows the same codes.
    expect(screen.getByText('ORPHA', { selector: 'span' }).nextSibling).toHaveTextContent('ORPHA:324');
    expect(screen.getByText('OMIM', { selector: 'span' }).nextSibling).toHaveTextContent('OMIM:301500');
    expect(screen.getByText('CID-10', { selector: 'span' }).nextSibling).toHaveTextContent('E75.2');
  });

  it('leaves the codes empty and still loads suggestions when the relation lookup rejects', async () => {
    mockApiClient({
      searchImpl: () => Promise.resolve({ data: { results: [{ ORPHA: '324', descricao: 'Doenca de Fabry' }] }, status: 200 }),
      relationImpl: () => Promise.reject(new Error('relation down')),
      suggestImpl: () => Promise.resolve({ data: SUGGESTED_CASCADE, status: 200 }),
    });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(screen.getByText('Angioqueratoma')).toBeInTheDocument(), { timeout: 2000 });
    expect(textbox('ORPHA')).toHaveValue('ORPHA:324');
    expect(textbox('ICD-10')).toHaveValue('');
    expect(textbox('OMIM')).toHaveValue('');
  });

  it('a hit with no code at all makes no disease-profile and no suggest call', async () => {
    // A hit with no orphaCode and no raw.ORPHA leaves the ORPHA code empty.
    mockApiClient({
      searchImpl: () => Promise.resolve({ data: { results: [{ id: 'local-7', descricao: 'Distrofia muscular' }] }, status: 200 }),
    });
    await reachStep3();
    await selectDiagnosis('Distrofia');

    await waitFor(() => expect(screen.getByPlaceholderText('Select disease in Orphadata to fill fields.')).toHaveValue('Distrofia muscular'));
    expect(textbox('ORPHA')).toHaveValue('');
    expect(textbox('ICD-10')).toHaveValue('');
    expect(screen.getByText('No HPO phenotype found in the graph or terminologies for this disease.')).toBeInTheDocument();
    expect(getCalls('/dictionary/disease-profile')).toHaveLength(0);
    expect(getCalls('/dictionary/suggest')).toHaveLength(0);
  });

  it('shows the loading text for phenotypes and biomarkers while /dictionary/suggest is pending', async () => {
    mockApiClient({ suggestImpl: () => new Promise(() => {}) });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(screen.getByText('Buscando fenótipos...')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Buscando biomarcadores...')).toBeInTheDocument();
  });

  it('retries suggest with the ORPHA-prefixed code when the first comes back empty, then shows the empty messages', async () => {
    mockApiClient({ suggestImpl: () => Promise.resolve({ data: { phenotypes: [], biomarkers: [] }, status: 200 }) });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(screen.getByText('No HPO phenotype found in the graph or terminologies for this disease.')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/No biomarker association in the graph or catalog for this disease/)).toBeInTheDocument();
    expect(getCalls('/dictionary/suggest').map(([, config]) => config.params.orphaCode)).toEqual(['324', 'ORPHA:324']);
  });
});

describe('ClinicalIntakeWizard step 3 -- suggested phenotypes and biomarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unchecking a suggested phenotype removes its card', async () => {
    mockApiClient({ suggestImpl: () => Promise.resolve({ data: SUGGESTED_CASCADE, status: 200 }) });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(screen.getByText('Angioqueratoma')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByRole('checkbox', { name: /Angioqueratoma/ }));

    expect(screen.queryByText('Angioqueratoma')).not.toBeInTheDocument();
    expect(screen.getByText('No HPO phenotype found in the graph or terminologies for this disease.')).toBeInTheDocument();
  });

  it('renders clinical dictionary biomarker inputs on step 3', async () => {
    mockApiClient({ suggestImpl: () => Promise.resolve({ data: {}, status: 200 }) });
    await reachStep3();
    expect(screen.getByTestId('wizard-dictionary-biomarkers-section')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-dictionary-biomarker-lyso_gb3')).toBeInTheDocument();
  });

  it('typing a biomarker value sets it and clearing it empties the input', async () => {
    mockApiClient({ suggestImpl: () => Promise.resolve({ data: SUGGESTED_CASCADE, status: 200 }) });
    await reachStep3();
    await selectDiagnosis();

    await waitFor(() => expect(screen.getByTestId('wizard-biomarker-value-0')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Lyso-Gb3 plasmático')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('wizard-biomarker-value-0'), { target: { value: '12.5' } });
    expect(screen.getByTestId('wizard-biomarker-value-0')).toHaveValue(12.5);

    fireEvent.change(screen.getByTestId('wizard-biomarker-value-0'), { target: { value: '' } });
    expect(screen.getByTestId('wizard-biomarker-value-0')).toHaveValue(null);
  });
});

describe('ClinicalIntakeWizard step 3 -- treatment and medication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TREATED searches /dictionary/atc/search and selecting a medication fills the ATC code and class', async () => {
    mockApiClient();
    await reachStep3();
    expect(screen.queryByTestId('wizard-medication-search')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('wizard-treatment-status'), { target: { value: 'TREATED' } });
    fireEvent.change(screen.getByTestId('wizard-medication-search'), { target: { value: 'Agal' } });

    await waitFor(() => expect(screen.getByTestId('wizard-medication-option-0')).toHaveTextContent('Agalsidase beta'));
    expect(getCalls('/dictionary/atc/search').at(-1)[1].params).toEqual({ query: 'Agal', limit: 20 });

    fireEvent.mouseDown(screen.getByTestId('wizard-medication-option-0'));

    expect(screen.getByTestId('wizard-atc-code')).toHaveValue('A16AB04');
    expect(screen.getByTestId('wizard-atc-level1')).toHaveValue('A');
    expect(screen.getByTestId('wizard-medication-search')).toHaveValue('Agalsidase beta');
    expect(screen.queryByTestId('wizard-medication-results')).not.toBeInTheDocument();
  });

  it('shows the medication error when the search rejects, and makes no call for a one-character query', async () => {
    mockApiClient({ atcImpl: () => Promise.reject(new Error('atc down')) });
    await reachStep3();
    fireEvent.change(screen.getByTestId('wizard-treatment-status'), { target: { value: 'TREATED' } });

    fireEvent.change(screen.getByTestId('wizard-medication-search'), { target: { value: 'A' } });
    await wait(50);
    expect(getCalls('/dictionary/atc/search')).toHaveLength(0);

    fireEvent.change(screen.getByTestId('wizard-medication-search'), { target: { value: 'Agal' } });
    await waitFor(() => expect(screen.getByText('Could not search medications at this moment.')).toBeInTheDocument());
  });

  it('switching TREATED to NAIVE hides the medication block and clears the medication fields', async () => {
    mockApiClient();
    await reachStep3();
    const status = screen.getByTestId('wizard-treatment-status');
    fireEvent.change(status, { target: { value: 'TREATED' } });
    fireEvent.change(screen.getByTestId('wizard-medication-search'), { target: { value: 'Agal' } });
    await waitFor(() => expect(screen.getByTestId('wizard-medication-option-0')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('wizard-medication-option-0'));
    expect(screen.getByTestId('wizard-atc-code')).toHaveValue('A16AB04');

    fireEvent.change(status, { target: { value: 'NAIVE' } });
    expect(screen.queryByTestId('wizard-medication-search')).not.toBeInTheDocument();

    fireEvent.change(status, { target: { value: 'TREATED' } });
    expect(screen.getByTestId('wizard-medication-search')).toHaveValue('');
    expect(screen.getByTestId('wizard-atc-code')).toHaveValue('');
    expect(screen.getByTestId('wizard-atc-level1')).toHaveValue('');
  });

  it('WASHOUT shows the two washout dates and no medication block', async () => {
    mockApiClient();
    await reachStep3();
    expect(screen.queryByLabelText('Washout Start Date')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('wizard-treatment-status'), { target: { value: 'WASHOUT' } });

    expect(screen.getByLabelText('Washout Start Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Washout End Date')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-medication-search')).not.toBeInTheDocument();
  });
});

describe('ClinicalIntakeWizard step 3 -- clinical lists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const change = (testId, value) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

  it('does not add an allergy that has a name but no code', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-allergy-name', 'Dipirona');
    fireEvent.click(screen.getByTestId('wizard-add-allergy'));

    // The disabled button is the guard a user meets; the handler's own check
    // repeats it and cannot be reached from the UI.
    expect(screen.getByTestId('wizard-add-allergy')).toBeDisabled();
    expect(screen.queryByTestId('wizard-allergy-item-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-allergy-name')).toHaveValue('Dipirona');

    change('wizard-allergy-code', '03730');
    expect(screen.getByTestId('wizard-add-allergy')).toBeEnabled();
  });

  it('adds an allergy, resets its draft and removes it', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-allergy-name', 'Dipirona');
    change('wizard-allergy-code', '03730');
    change('wizard-allergy-reaction', 'Urticária');
    fireEvent.click(screen.getByTestId('wizard-add-allergy'));

    expect(screen.getByTestId('wizard-allergy-item-0')).toHaveTextContent('DipironaDCB: 03730— Urticária');
    expect(screen.getByTestId('wizard-allergy-name')).toHaveValue('');
    expect(screen.getByTestId('wizard-allergy-code')).toHaveValue('');
    expect(screen.getByTestId('wizard-allergy-reaction')).toHaveValue('');

    fireEvent.click(screen.getByTestId('wizard-remove-allergy-0'));
    expect(screen.queryByTestId('wizard-allergy-item-0')).not.toBeInTheDocument();
  });

  it('does not add a family history without a relationship; adds, resets and removes one with it', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-family-condition-name', 'Síndrome de Marfan');
    fireEvent.click(screen.getByTestId('wizard-add-family-history'));
    expect(screen.getByTestId('wizard-add-family-history')).toBeDisabled();
    expect(screen.queryByTestId('wizard-family-history-item-0')).not.toBeInTheDocument();

    change('wizard-family-relationship', 'mother');
    change('wizard-family-condition-orpha', 'ORPHA:558');
    change('wizard-family-condition-onset', '30 anos');
    expect(screen.getByTestId('wizard-add-family-history')).toBeEnabled();
    fireEvent.click(screen.getByTestId('wizard-add-family-history'));

    expect(screen.getByTestId('wizard-family-history-item-0')).toHaveTextContent('mother— Síndrome de Marfan(ORPHA:558)· 30 anos');
    expect(screen.getByTestId('wizard-family-relationship')).toHaveValue('');
    expect(screen.getByTestId('wizard-family-condition-name')).toHaveValue('');
    expect(screen.getByTestId('wizard-family-condition-orpha')).toHaveValue('');
    expect(screen.getByTestId('wizard-family-condition-onset')).toHaveValue('');

    fireEvent.click(screen.getByTestId('wizard-remove-family-history-0'));
    expect(screen.queryByTestId('wizard-family-history-item-0')).not.toBeInTheDocument();
  });

  it('does not add a procedure without a code or date; adds, resets and removes one with both', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-procedure-name', 'Biópsia hepática');
    change('wizard-procedure-code', 'PRC-1');
    fireEvent.click(screen.getByTestId('wizard-add-procedure'));
    expect(screen.getByTestId('wizard-add-procedure')).toBeDisabled();
    expect(screen.queryByTestId('wizard-procedure-item-0')).not.toBeInTheDocument();

    change('wizard-procedure-performed', '2026-01-15');
    change('wizard-procedure-body-site', 'Fígado');
    expect(screen.getByTestId('wizard-add-procedure')).toBeEnabled();
    fireEvent.click(screen.getByTestId('wizard-add-procedure'));

    expect(screen.getByTestId('wizard-procedure-item-0')).toHaveTextContent('Biópsia hepáticaPRC-1· 2026-01-15(Fígado)');
    expect(screen.getByTestId('wizard-procedure-name')).toHaveValue('');
    expect(screen.getByTestId('wizard-procedure-code')).toHaveValue('');
    expect(screen.getByTestId('wizard-procedure-performed')).toHaveValue('');
    expect(screen.getByTestId('wizard-procedure-body-site')).toHaveValue('');

    fireEvent.click(screen.getByTestId('wizard-remove-procedure-0'));
    expect(screen.queryByTestId('wizard-procedure-item-0')).not.toBeInTheDocument();
  });

  it('does not add an observation without a LOINC code or date; adds, resets and removes one with both', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-observation-test-name', 'Hemoglobina');
    change('wizard-observation-loinc', '718-7');
    fireEvent.click(screen.getByTestId('wizard-add-observation'));
    expect(screen.getByTestId('wizard-add-observation')).toBeDisabled();
    expect(screen.queryByTestId('wizard-observation-item-0')).not.toBeInTheDocument();

    change('wizard-observation-value', '13.2');
    change('wizard-observation-unit', 'g/dL');
    change('wizard-observation-effective-date', '2026-02-01');
    expect(screen.getByTestId('wizard-add-observation')).toBeEnabled();
    fireEvent.click(screen.getByTestId('wizard-add-observation'));

    expect(screen.getByTestId('wizard-observation-item-0')).toHaveTextContent('Hemoglobina718-7= 13.2 g/dL· 2026-02-01');
    expect(screen.getByTestId('wizard-observation-test-name')).toHaveValue('');
    expect(screen.getByTestId('wizard-observation-loinc')).toHaveValue('');
    expect(screen.getByTestId('wizard-observation-value')).toHaveValue('');
    expect(screen.getByTestId('wizard-observation-unit')).toHaveValue('');
    expect(screen.getByTestId('wizard-observation-effective-date')).toHaveValue('');

    fireEvent.click(screen.getByTestId('wizard-remove-observation-0'));
    expect(screen.queryByTestId('wizard-observation-item-0')).not.toBeInTheDocument();
  });

  it('does not add an outcome without a type or date; adds, resets and removes one with both', async () => {
    mockApiClient();
    await reachStep3();

    change('wizard-outcome-type', 'remission');
    fireEvent.click(screen.getByTestId('wizard-add-outcome'));
    expect(screen.getByTestId('wizard-add-outcome')).toBeDisabled();
    expect(screen.queryByTestId('wizard-outcome-item-0')).not.toBeInTheDocument();

    change('wizard-outcome-date', '2026-03-10');
    expect(screen.getByTestId('wizard-add-outcome')).toBeEnabled();
    fireEvent.click(screen.getByTestId('wizard-add-outcome'));

    expect(screen.getByTestId('wizard-outcome-item-0')).toHaveTextContent('remission· 2026-03-10');
    expect(screen.getByTestId('wizard-outcome-type')).toHaveValue('');
    expect(screen.getByTestId('wizard-outcome-date')).toHaveValue('');

    fireEvent.click(screen.getByTestId('wizard-remove-outcome-0'));
    expect(screen.queryByTestId('wizard-outcome-item-0')).not.toBeInTheDocument();
  });
});

describe('ClinicalIntakeWizard step 3 -- blood pressure and comorbidities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats blood pressure digits as systolic/diastolic and drops letters', async () => {
    mockApiClient();
    await reachStep3();
    const input = textbox('Blood pressure');

    fireEvent.change(input, { target: { value: '12080' } });
    expect(input).toHaveValue('120/80');

    fireEvent.change(input, { target: { value: '120' } });
    expect(input).toHaveValue('120');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input).toHaveValue('');
  });

  it('toggles a comorbidity checkbox', async () => {
    mockApiClient();
    await reachStep3();
    const diabetes = screen.getByTestId('wizard-comorbidity-diabetes');
    expect(diabetes).not.toBeChecked();

    fireEvent.click(diabetes);
    expect(diabetes).toBeChecked();

    fireEvent.click(diabetes);
    expect(diabetes).not.toBeChecked();
  });
});

describe('ClinicalIntakeWizard step 3 -- submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the five clinical lists, the biomarker value and the pharmacology data', async () => {
    mockApiClient({
      suggestImpl: () => Promise.resolve({ data: SUGGESTED_CASCADE, status: 200 }),
      templates: [{ _id: 'tpl-1', title: 'TCLE Biobanco', version: 'v1', active: true }],
    });
    apiClient.post.mockResolvedValue({ data: { message: 'Cadastro concluído.', sample: {} }, status: 201 });
    await reachStep3();
    await selectDiagnosis();
    await waitFor(() => expect(screen.getByTestId('wizard-biomarker-value-0')).toBeInTheDocument(), { timeout: 2000 });

    const change = (testId, value) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
    change('wizard-biomarker-value-0', '7.4');

    change('wizard-treatment-status', 'TREATED');
    change('wizard-medication-search', 'Agal');
    await waitFor(() => expect(screen.getByTestId('wizard-medication-option-0')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('wizard-medication-option-0'));
    fireEvent.change(screen.getByLabelText('Last Dose Date'), { target: { value: '2026-04-01' } });

    change('wizard-allergy-name', 'Dipirona');
    change('wizard-allergy-code', '03730');
    fireEvent.click(screen.getByTestId('wizard-add-allergy'));
    change('wizard-family-relationship', 'father');
    fireEvent.click(screen.getByTestId('wizard-add-family-history'));
    change('wizard-procedure-code', 'PRC-1');
    change('wizard-procedure-performed', '2026-01-15');
    fireEvent.click(screen.getByTestId('wizard-add-procedure'));
    change('wizard-observation-loinc', '718-7');
    change('wizard-observation-effective-date', '2026-02-01');
    fireEvent.click(screen.getByTestId('wizard-add-observation'));
    change('wizard-outcome-type', 'response');
    change('wizard-outcome-date', '2026-03-10');
    fireEvent.click(screen.getByTestId('wizard-add-outcome'));

    await waitFor(() => expect(screen.getByTestId('wizard-submit-button')).toBeEnabled());
    fireEvent.click(screen.getByTestId('wizard-submit-button'));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/intake-wizard', expect.any(Object)));
    const { clinical } = apiClient.post.mock.calls[0][1];
    expect(clinical.allergies).toEqual([{ allergenName: 'Dipirona', allergenCode: '03730', reaction: '' }]);
    expect(clinical.familyHistories).toEqual([{ relationship: 'father', conditionName: '', orphaCode: '', onset: '' }]);
    expect(clinical.procedures).toEqual([{ procedureName: '', procedureCode: 'PRC-1', performed: '2026-01-15', bodySite: '' }]);
    expect(clinical.observationRecords).toEqual([{ testName: '', loincCode: '718-7', value: '', unit: '', effectiveDate: '2026-02-01' }]);
    expect(clinical.clinicalOutcomes).toEqual([{ outcomeType: 'response', outcomeDate: '2026-03-10' }]);
    expect(clinical.biomarkersValues).toEqual({ 'LOINC:12345': '7.4' });
    expect(clinical.pharmacologyData).toMatchObject({
      treatmentStatus: 'TREATED',
      medicationName: 'Agalsidase beta',
      atcCode: 'A16AB04',
      atcClass: 'A',
      lastDoseDate: '2026-04-01',
    });
  });
});
