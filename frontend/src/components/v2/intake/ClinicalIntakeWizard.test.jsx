import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClinicalIntakeWizard, { _test } from './ClinicalIntakeWizard.jsx';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import { apiClient } from '../../../api/client';
import { consentService } from '../../../services/api';

const {
  buildSubmissionPayload,
  applyIntakeOrganization,
  applyIntakeCollection,
  createClinicalStepSchema,
  getDictionarySlug,
  mapDictionaryOptions,
  getDiagnosisLocalizedLabel,
  getCidDisplayLabel,
  getCidAliases,
  normalizeCidOption,
  normalizeDiseaseBiomarker,
  normalizeDiseasePhenotype,
  buildBiomarkerValuesMap,
  normalizeCidCode,
  pickBestOrphaCandidate,
  filterAndRankDiagnosisResults,
  consolidateDiagnosisCandidates,
} = _test;

// #871's mocking approach: replace apiClient/consentService at the network
// boundary (not useSemanticCascade itself) so the real hook runs end to end
// and the retry proof exercises the actual re-fetch, not a stub of it.
vi.mock('../../../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  notifyApiToast: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  consentService: { getTemplates: vi.fn() },
  collectionsService: { getAll: vi.fn().mockResolvedValue({ data: { data: [] }, status: 200 }) },
}));

describe('ClinicalIntakeWizard createClinicalStepSchema contracts', () => {
  const t = (_key, fallback) => fallback;

  it('rejects a selected diagnosis that has neither CID-10 nor ORPHA code', () => {
    const schema = createClinicalStepSchema(t, []);
    const result = schema.safeParse({
      isHealthyControl: false,
      diagnosisCidId: 'local-row-42',
      diagnosisCidCode: '',
      diagnosisOrphaCode: '',
      treatmentStatus: 'NAIVE',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => String(issue.message).includes('ICD-10') || String(issue.message).includes('ORPHA'))).toBe(true);
  });

  it('accepts autofill when ORPHA is present without CID-10', () => {
    const schema = createClinicalStepSchema(t, []);
    const result = schema.safeParse({
      isHealthyControl: false,
      diagnosisCidId: 'ORPHA:324',
      diagnosisCidCode: '',
      diagnosisOrphaCode: 'ORPHA:324',
      treatmentStatus: 'NAIVE',
    });
    expect(result.success).toBe(true);
  });
});

describe('ClinicalIntakeWizard buildSubmissionPayload', () => {
  it('#167: diagnosis payload only carries canonical camelCase keys, no legacy snake_case duplicates', () => {
    const formData = {
      isHealthyControl: false,
      patientID: '12345678',
      patientName: 'Paciente Teste',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      diagnosisCidDescription: 'Some Disease',
      diagnosisDefinition: 'A rare condition',
      diagnosisCidCode: 'E70.0',
      diagnosisOrphaCode: 'ORPHA:123',
      diagnosisOmimCode: '123456',
    };

    const payload = buildSubmissionPayload(formData);

    expect(payload.diagnosis).toEqual({
      diagnosisName: 'Some Disease',
      icdCode: 'E70.0',
      orphaCode: 'ORPHA:123',
      omimCode: '123456',
      definition: 'A rare condition',
    });
  });

  it('#522: clinical.charlsonConditions carries the checked comorbidity slugs as an array, matching what buildClinicalData reads (api/backend/src/routes/intakeWizard.js)', () => {
    const comorbidityDefinitions = [
      { slug: 'diabetes', label: 'Diabetes' },
      { slug: 'hypertension', label: 'Hypertension' },
      { slug: 'ckd', label: 'Chronic Kidney Disease' },
    ];
    const formData = {
      isHealthyControl: false,
      patientID: '12345678',
      patientName: 'Paciente Teste',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      diabetes: true,
      hypertension: false,
      ckd: true,
    };

    const payload = buildSubmissionPayload(formData, comorbidityDefinitions);

    expect(payload.clinical.charlsonConditions).toEqual(['diabetes', 'ckd']);
    expect(payload.clinical.comorbidities).toBeUndefined();
  });

  it('#699: participant/specimen match the canonical.v1.intake AJV contract shape', () => {
    const formData = {
      isHealthyControl: true,
      patientID: '',
      patientName: 'Paciente Teste',
      birthDate: '01011990',
      prontuario: 'PRONT-1',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      sprecCode: 'BLD-PL1-A-N-N-A-N',
      sprecMatrixType: 'fluid',
      sprecSampleType: 'BLD',
    };

    const payload = buildSubmissionPayload(formData);

    // recordNumber, not the legacy prontuario field name (additionalProperties: false).
    expect(payload.participant.recordNumber).toBe('PRONT-1');
    expect(payload.participant.prontuario).toBeUndefined();
    // bare date, not a full ISO datetime (format: 'date').
    expect(payload.participant.birthDate).toBe('1990-01-01');
    // required, non-empty even for a new patient the server hasn't assigned an id to yet.
    expect(payload.participant.participantId).toBe('placeholder');
    expect(payload.specimen.participantId).toBe('placeholder');
    expect(payload.specimen.specimenId).toBe('placeholder');
    // no equivalent in the contract -- dropped, not sent.
    expect(payload.specimen.collectionInstitution).toBeUndefined();
    expect(payload.specimen.collectionInstitutionAcronym).toBeUndefined();
    // flat strings with a top-level code/version, not nested {code, label} axis objects.
    expect(payload.specimen.sprec.code).toBe('BLD-PL1-A-N-N-A-N');
    expect(payload.specimen.sprec.version).toBe('SPREC-2.0');
    expect(payload.specimen.sprec.sampleType).toBe('BLD');
    expect(typeof payload.specimen.sprec.sampleType).toBe('string');
  });

  it('#701: specimen.sampleType/sampleOrigin/extractionProtocol carry the real MIABIS selections, not the SPREC axis codes', () => {
    const formData = {
      isHealthyControl: true,
      patientID: '',
      patientName: 'Paciente Teste',
      birthDate: '01011990',
      prontuario: 'PRONT-1',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      sprecCode: 'BLD-PL1-A-N-N-A-N',
      sprecMatrixType: 'fluid',
      // SPREC axis values -- a different, larger vocabulary than MIABIS
      // (real SPREC codes, e.g. BLD/PL1), never a substitute for the
      // MIABIS-coded fields below (#701).
      sprecSampleType: 'BLD',
      sprecPrimaryContainer: 'PL1',
      // Real MIABIS-coded selections, distinct from the SPREC axis fields.
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
    };

    const payload = buildSubmissionPayload(formData);

    expect(payload.specimen.sampleType).toBe('PLASMA');
    expect(payload.specimen.sampleOrigin).toBe('VENOUS_BLOOD');
    expect(payload.specimen.extractionProtocol).toBe('TUBE_EDTA');
    // The SPREC axis codes still travel separately, untouched, under sprec.*.
    expect(payload.specimen.sprec.sampleType).toBe('BLD');
    expect(payload.specimen.sprec.primaryContainer).toBe('PL1');
  });

  it('#1371: specimen.parentSpecimenIds splits the field on whitespace, commas and semicolons, trimmed and de-duplicated in order', () => {
    const formData = {
      isHealthyControl: true,
      patientName: 'Paciente Teste',
      linkedProject: 'PROJ-1',
      parentSpecimenIds: ' SP-1, SP-2;SP-1 ',
    };

    const payload = buildSubmissionPayload(formData);

    expect(payload.specimen.parentSpecimenIds).toEqual(['SP-1', 'SP-2']);
    // dict-02 ELM-0120 is parentSpecimenIds; the singular names are refused by the server.
    expect(payload.specimen).not.toHaveProperty('parentSpecimenId');
    expect(payload.specimen).not.toHaveProperty('parentSampleId');
  });

  it('#1371: an empty or absent parentSpecimenIds field leaves specimen without the parentSpecimenIds key', () => {
    for (const parentSpecimenIds of [undefined, '']) {
      const formData = {
        isHealthyControl: true,
        patientName: 'Paciente Teste',
        linkedProject: 'PROJ-1',
        ...(parentSpecimenIds === undefined ? {} : { parentSpecimenIds }),
      };

      const payload = buildSubmissionPayload(formData);

      expect(payload.specimen).not.toHaveProperty('parentSpecimenIds');
    }
  });

  it('#1376: the organization pick goes in the top-level organizationId and leaves specimen.collectionSite as the form built it', () => {
    const payload = buildSubmissionPayload({ isHealthyControl: true, patientName: 'Paciente Teste', linkedProject: 'PROJ-1' });
    payload.specimen.collectionSite = 'partner-x';

    applyIntakeOrganization(payload, 'org-b');

    expect(payload.organizationId).toBe('org-b');
    expect(payload.specimen.collectionSite).toBe('partner-x');
  });

  it('#1376: with no organization pick the payload carries no organizationId and no collectionSite', () => {
    const payload = applyIntakeOrganization(buildSubmissionPayload({ isHealthyControl: true, patientName: 'Paciente Teste', linkedProject: 'PROJ-1' }), '');

    expect(payload).not.toHaveProperty('organizationId');
    expect(payload.specimen).not.toHaveProperty('collectionSite');
  });

  it('RF004 AC2 (#1497): the collection pick goes in specimen.collectionId', () => {
    const payload = applyIntakeCollection(buildSubmissionPayload({ isHealthyControl: true, patientName: 'Paciente Teste', linkedProject: 'PROJ-1' }), 'COL-1');

    expect(payload.specimen.collectionId).toBe('COL-1');
  });

  it('RF004 AC2 (#1497): with no collection pick the specimen carries no collectionId', () => {
    const payload = applyIntakeCollection(buildSubmissionPayload({ isHealthyControl: true, patientName: 'Paciente Teste', linkedProject: 'PROJ-1' }), '');

    expect(payload.specimen).not.toHaveProperty('collectionId');
  });
});

const FIXTURE_DICTIONARIES = {
  clinicalComorbidities: [{ slug: 'diabetes', label: 'Diabetes' }],
  biomarkers: [{ slug: 'lyso_gb3', label: 'Lyso-Gb3' }],
};

// A single /terminologies search hit for "Fabry" -- shaped so
// normalizeCidOption (ClinicalIntakeWizard.jsx) derives a non-empty
// orphaCode ("ORPHA:324") and displayName ("Doenca de Fabry"), the two
// things handleDiagnosisSelect needs to treat it as selectable.
const DIAGNOSIS_SEARCH_ITEM = {
  id: 'orpha-324',
  descricao: 'Doenca de Fabry',
  ORPHA: '324',
  Codigos_CID10: 'E75.2',
};

function mockApiClient({ suggestImpl, terminologyItems = [DIAGNOSIS_SEARCH_ITEM] } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === '/terminologies') {
      return Promise.resolve({ data: { results: terminologyItems }, status: 200 });
    }
    if (url === '/dictionary/disease-profile') {
      return Promise.resolve({ data: { disease: null }, status: 200 });
    }
    if (url === '/dictionary/suggest') {
      return suggestImpl ? suggestImpl() : Promise.resolve({ data: {}, status: 200 });
    }
    if (url === '/intake-wizard/patient-match') {
      return Promise.resolve({ data: { matched: false }, status: 200 });
    }
    return Promise.resolve({ data: {}, status: 200 });
  });
  consentService.getTemplates.mockResolvedValue({ data: { templates: [] }, status: 200 });
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
  // A checksum-valid CPF (isValidCpfDocument, ClinicalIntakeWizard.jsx)
  // -- "1114447773 5" is a commonly used valid test CPF.
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
  fireEvent.click(screen.getByTestId('wizard-next-button'));
  await waitFor(() => expect(screen.getByTestId('wizard-diagnosis-search')).toBeInTheDocument());
}

async function selectDiagnosis(term = 'Fabry') {
  fireEvent.change(screen.getByTestId('wizard-diagnosis-search'), { target: { value: term } });
  await waitFor(
    () => expect(screen.getByTestId('wizard-diagnosis-option-0')).toBeInTheDocument(),
    { timeout: 2000 }
  );
  // The result button wires its handler to onMouseDown (with
  // preventDefault, so the input's onBlur doesn't close the list first) --
  // a plain click would never fire it.
  fireEvent.mouseDown(screen.getByTestId('wizard-diagnosis-option-0'));
}

describe('ClinicalIntakeWizard -- suggest-error retry (#871)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an error + retry action instead of "no suggestions" when /dictionary/suggest fails', async () => {
    mockApiClient({ suggestImpl: () => Promise.reject(new Error('Network error')) });
    renderWizard();
    await fillStep1();
    await fillStep2();
    await selectDiagnosis();

    await waitFor(
      () => expect(screen.getByTestId('wizard-suggest-error-phenotypes')).toBeInTheDocument(),
      { timeout: 2000 }
    );
    expect(screen.getByTestId('wizard-suggest-retry-phenotypes')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-suggest-error-biomarkers')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-suggest-retry-biomarkers')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum fenótipo sugerido para esta doença.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum biomarcador sugerido para esta doença.')).not.toBeInTheDocument();
  });

  it('clicking retry re-fetches and renders the suggested phenotype/biomarker once the endpoint recovers', async () => {
    let callCount = 0;
    mockApiClient({
      suggestImpl: () => {
        callCount += 1;
        // handleDiagnosisSelect's initial cascade fetch always makes two
        // /dictionary/suggest calls when the first comes back empty (the
        // normalizedOrphaCode fallback, ClinicalIntakeWizard.jsx) -- both
        // fail here, so the retry button's own fetch is call #3.
        if (callCount <= 2) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          data: {
            disease: { system: 'http://www.orpha.net', code: '324', display: 'Doenca de Fabry' },
            phenotypes: [{ code: 'HP:0001066', display: 'Angioqueratoma' }],
            biomarkers: [{ code: 'LOINC:12345', display: 'Biomarcador Teste' }],
          },
          status: 200,
        });
      },
    });
    renderWizard();
    await fillStep1();
    await fillStep2();
    await selectDiagnosis();

    await waitFor(
      () => expect(screen.getByTestId('wizard-suggest-retry-phenotypes')).toBeInTheDocument(),
      { timeout: 2000 }
    );

    fireEvent.click(screen.getByTestId('wizard-suggest-retry-phenotypes'));

    await waitFor(
      () => expect(screen.getByText('Angioqueratoma')).toBeInTheDocument(),
      { timeout: 2000 }
    );
    expect(screen.getByText('Biomarcador Teste')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-suggest-error-phenotypes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard-suggest-error-biomarkers')).not.toBeInTheDocument();
  });
});

describe('ClinicalIntakeWizard -- suggested phenotype terminology version (#885)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the HPO release version /dictionary/suggest resolved beside the code, and the bare code when it resolved none', async () => {
    mockApiClient({
      suggestImpl: () => Promise.resolve({
        data: {
          disease: { system: 'http://www.orpha.net', code: '324', display: 'Doenca de Fabry' },
          phenotypes: [
            { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001066', display: 'Angioqueratoma', version: '2026-08-01' },
            { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0012471', display: 'Acroparestesia' },
          ],
          biomarkers: [],
        },
        status: 200,
      }),
    });
    renderWizard();
    await fillStep1();
    await fillStep2();
    await selectDiagnosis();

    await waitFor(
      () => expect(screen.getByText('Angioqueratoma')).toBeInTheDocument(),
      { timeout: 2000 }
    );
    expect(screen.getByText('HPO 2026-08-01 · HP:0001066')).toBeInTheDocument();
    expect(screen.getByText('HP:0012471')).toBeInTheDocument();
  });
});

// A /terminologies hit carrying only an ICD-10 code: normalizeCidOption
// derives code 'G71.0' from Codigos_CID10 and an empty orphaCode.
const CID10_ONLY_SEARCH_ITEM = {
  id: 'cid-g71-0',
  descricao: 'Distrofia muscular',
  Codigos_CID10: 'G71.0',
};

describe('ClinicalIntakeWizard -- a diagnosis hit with no ORPHA code (#1433)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a CID-10-only hit gets no ORPHA value and queries no ORPHA-keyed lookup', async () => {
    mockApiClient({ terminologyItems: [CID10_ONLY_SEARCH_ITEM] });
    renderWizard();
    await fillStep1();
    await fillStep2();
    await selectDiagnosis('Distrofia');

    await waitFor(() => expect(screen.getByPlaceholderText('CID-10')).toHaveValue('G71.0'));
    expect(screen.getByPlaceholderText('ORPHA')).toHaveValue('');

    const urls = apiClient.get.mock.calls.map(([url]) => url);
    expect(urls).not.toContain('/dictionary/disease-profile');
    expect(urls).not.toContain('/dictionary/suggest');
    const orphaQueries = apiClient.get.mock.calls.filter(
      ([url, options]) => url === '/terminologies' && /^ORPHA:/i.test(String(options?.params?.q || ''))
    );
    expect(orphaQueries).toEqual([]);
  });
});

describe('ClinicalIntakeWizard dictionary option helpers', () => {
  it('takes the slug from slug, value or code, in that order, and an empty slug from none', () => {
    expect(getDictionarySlug({ slug: ' s ', value: 'v', code: 'c' })).toBe('s');
    expect(getDictionarySlug({ value: 'v', code: 'c' })).toBe('v');
    expect(getDictionarySlug({ code: 'c' })).toBe('c');
    expect(getDictionarySlug(undefined)).toBe('');
  });

  it('maps label or name into options and drops a row missing its value or label', () => {
    expect(mapDictionaryOptions([
      { slug: 'a', label: 'Alpha' },
      { code: 'b', name: 'Beta' },
      { code: 'c' },
      { label: 'No value' },
    ])).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ]);
    expect(mapDictionaryOptions('not a list')).toEqual([]);
  });
});

describe('ClinicalIntakeWizard diagnosis label helpers', () => {
  it('prefers a Portuguese name and marks it as the primary language', () => {
    expect(getDiagnosisLocalizedLabel({ nameEn: 'Asthma', namePt: ' Asma ' })).toEqual({
      label: 'Asma',
      language: 'pt',
      isEnglishFallback: false,
    });
  });

  it('marks an English-only name with [EN] and language en when the item names no language', () => {
    expect(getDiagnosisLocalizedLabel({ nameEn: 'Asthma' })).toEqual({
      label: '[EN] Asthma',
      language: 'en',
      isEnglishFallback: true,
    });
  });

  it('keeps an unmarked label when the item says its language is pt', () => {
    expect(getDiagnosisLocalizedLabel({ label: 'Asma brônquica', lang: 'PT' })).toEqual({
      label: 'Asma brônquica',
      language: 'pt',
      isEnglishFallback: false,
    });
  });

  it('falls back to displayName and keeps the language the item names', () => {
    expect(getDiagnosisLocalizedLabel({ displayName: 'Asma', language: 'es' })).toEqual({
      label: '[EN] Asma',
      language: 'es',
      isEnglishFallback: true,
    });
  });

  it('returns an empty label, with the item language or none, when the item has no name', () => {
    expect(getDiagnosisLocalizedLabel({})).toEqual({ label: '', language: '', isEnglishFallback: false });
    expect(getDiagnosisLocalizedLabel({ lang: 'en' })).toEqual({ label: '', language: 'en', isEnglishFallback: false });
  });

  it('joins the code and description, or shows whichever exists, or a placeholder', () => {
    expect(getCidDisplayLabel({ Codigo_Tabulacao: 'J45', namePt: 'Asma' })).toBe('J45 - Asma');
    expect(getCidDisplayLabel({ Codigos_CID10: 'J45.0' })).toBe('J45.0');
    expect(getCidDisplayLabel({ codigo: 'E10' })).toBe('E10');
    expect(getCidDisplayLabel({ code: 'E11' })).toBe('E11');
    expect(getCidDisplayLabel({ descricao: 'Diabetes' })).toBe('Diabetes');
    expect(getCidDisplayLabel(null)).toBe('Doença sem descrição');
  });

  it('collects aliases, synonyms and alternative names, trimmed, dropping empty entries', () => {
    expect(getCidAliases({
      aliases: [' a ', null],
      synonyms: ['s'],
      alternativeNames: ['t', ''],
    })).toEqual(['a', 's', 't']);
    expect(getCidAliases({ aliases: 'x', synonyms: 'y', alternativeNames: 'z' })).toEqual([]);
  });
});

describe('ClinicalIntakeWizard normalizeCidOption', () => {
  it('builds an option with no id from a bare cid field, using the CID as its code', () => {
    const option = normalizeCidOption({ cid: 'J45', namePt: 'Asma' });
    expect(option.id).toBe('');
    expect(option.code).toBe('J45');
    expect(option.cidCode).toBe('J45');
    expect(option.description).toBe('Asma');
    expect(option.displayName).toBe('Asma');
    expect(option.orphaCode).toBe('');
  });

  it('gives an empty item empty fields and the no-description placeholder as display name', () => {
    const option = normalizeCidOption({});
    expect(option.description).toBe('');
    expect(option.displayName).toBe('Doença sem descrição');
    expect(option.metaLabel).toBe('CID: - | ORPHA: - | OMIM: -');
    expect(option.definition).toBe('');
    expect(option.language).toBe('');
    expect(option.isEnglishFallback).toBe(false);
  });

  it('reads an ORPHA code from the code of an item whose system is ORPHA', () => {
    const option = normalizeCidOption({ sistema: 'orpha', code: '558', descricao: 'Síndrome de Marfan' });
    expect(option.orphaCode).toBe('ORPHA:558');
    expect(option.description).toBe('Síndrome de Marfan');
    expect(option.language).toBe('pt');
  });

  it('lists translation and names-object entries as localized names', () => {
    const option = normalizeCidOption({ code: 'Q87.4', translations: { pt: 'Marfan', en: 'Marfan syndrome', es: 'Síndrome de Marfan' }, names: { en: 'MFS' } });
    expect(option.localizedNames).toEqual(['Marfan', 'Marfan syndrome', 'Síndrome de Marfan', 'MFS']);
    expect(option.description).toBe('Marfan');
  });

  it('merges sinonimos and synonyms, trimmed, dropping empty entries', () => {
    const option = normalizeCidOption({ code: 'E10', sinonimos: [' tipo 1 ', null], synonyms: ['T1D'] });
    expect(option.synonyms).toEqual(['tipo 1', 'T1D']);
  });
});

describe('ClinicalIntakeWizard disease biomarker and phenotype helpers', () => {
  it('takes the biomarker code from code, biomarkerType or hpoId and the label from display, label or name', () => {
    expect(normalizeDiseaseBiomarker({ biomarkerType: 'BT', name: 'Glucose', value: 5 })).toEqual({
      code: 'BT', label: 'Glucose', unit: '', value: '5',
    });
    expect(normalizeDiseaseBiomarker({ code: 'C', biomarkerType: 'BT', display: 'D', label: 'L', name: 'N', unit: 'mg' })).toEqual({
      code: 'C', label: 'D', unit: 'mg', value: '',
    });
    expect(normalizeDiseaseBiomarker({ biomarkerType: 'BT', hpoId: 'HP:0002', label: 'L', name: 'N' })).toEqual({
      code: 'BT', label: 'L', unit: '', value: '',
    });
    expect(normalizeDiseaseBiomarker({ hpoId: 'HP:0001' })).toEqual({ code: 'HP:0001', label: '', unit: '', value: '' });
    expect(normalizeDiseaseBiomarker(undefined)).toEqual({ code: '', label: '', unit: '', value: '' });
  });

  it('gives an empty phenotype with no version key when the item has nothing', () => {
    expect(normalizeDiseasePhenotype({})).toEqual({ hpoId: '', label: '' });
  });

  it('seeds a value per biomarker key, keeping values already set and skipping keyless rows', () => {
    expect(buildBiomarkerValuesMap(
      [{ label: 'Glucose', value: 7 }, { code: 'C1' }, { code: 'KEEP', value: 'new' }, {}],
      { KEEP: 'old' },
    )).toEqual({ KEEP: 'old', Glucose: '7', C1: '' });
    expect(buildBiomarkerValuesMap('not a list', null)).toEqual({});
  });
});

describe('ClinicalIntakeWizard normalizeCidCode and pickBestOrphaCandidate', () => {
  it('skips ORPHA, OMIM and empty parts and returns the first CID-like part', () => {
    expect(normalizeCidCode('ORPHA:123;;OMIM:456|J45')).toBe('J45');
    expect(normalizeCidCode('ABC-1')).toBe('ABC-1');
  });

  it('never takes a bare number for a CID code', () => {
    expect(normalizeCidCode('12345')).toBe('');
  });

  it('returns null without an ORPHA number', () => {
    expect(pickBestOrphaCandidate([{ orphaCode: 'ORPHA:5' }], undefined)).toBeNull();
  });

  it('falls back to the whole list when no candidate has the ORPHA number', () => {
    const only = { orphaCode: 'ORPHA:9', displayName: 'Other' };
    expect(pickBestOrphaCandidate([only], '5')).toBe(only);
  });

  it('scores a CID code read from the raw relations above a bare display name', () => {
    const plain = { orphaCode: 'ORPHA:5', displayName: 'Plain' };
    const coded = { orphaCode: 'ORPHA:5', raw: { relacoes: { cid10: 'J45' } } };
    expect(pickBestOrphaCandidate([plain, coded], '5')).toBe(coded);
  });

  it('scores an OMIM code read from the raw relations above a bare display name', () => {
    const plain = { orphaCode: 'ORPHA:5', displayName: 'Plain' };
    const coded = { orphaCode: 'ORPHA:5', raw: { relacoes: { omim: '100100' } } };
    expect(pickBestOrphaCandidate([plain, coded], '5')).toBe(coded);
  });
});

describe('ClinicalIntakeWizard filterAndRankDiagnosisResults', () => {
  it('returns nothing for an empty query or a non-list', () => {
    expect(filterAndRankDiagnosisResults([{ displayName: 'Asma' }], undefined)).toEqual([]);
    expect(filterAndRankDiagnosisResults('not a list', 'asma')).toEqual([]);
  });

  it('matches on aliases, synonyms, sinonimos and localized names', () => {
    const items = [
      { code: 'A1', aliases: ['alpha'] },
      { code: 'A2', synonyms: ['beta'] },
      { code: 'A3', sinonimos: ['gama'] },
      { code: 'A4', localizedNames: ['delta'] },
    ];
    expect(filterAndRankDiagnosisResults(items, 'beta').map((item) => item.code)).toEqual(['A2']);
    expect(filterAndRankDiagnosisResults(items, 'gama').map((item) => item.code)).toEqual(['A3']);
    expect(filterAndRankDiagnosisResults(items, 'delta').map((item) => item.code)).toEqual(['A4']);
    expect(filterAndRankDiagnosisResults(items, 'alpha').map((item) => item.code)).toEqual(['A1']);
  });

  it('ranks an exact code match above a code-prefix match, and strips the search index', () => {
    const items = [
      { code: 'E101', description: 'prefix only' },
      { code: 'E10', description: 'exact code' },
    ];
    const result = filterAndRankDiagnosisResults(items, 'e10');
    expect(result.map((item) => item.code)).toEqual(['E10', 'E101']);
    expect(result[0]).not.toHaveProperty('_searchIndex');
  });

  it('caps the results at six when max is not a number', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ code: `X${index}`, description: 'match' }));
    expect(filterAndRankDiagnosisResults(items, 'match', 'many')).toHaveLength(6);
  });
});

describe('ClinicalIntakeWizard consolidateDiagnosisCandidates', () => {
  it('returns an empty list for a non-list', () => {
    expect(consolidateDiagnosisCandidates('not a list')).toEqual([]);
  });

  it('keys rows by code or id when they carry no terminology code, and drops keyless rows', () => {
    const byCode = { code: 'LOCAL-1' };
    const byId = { id: 'row-2' };
    expect(consolidateDiagnosisCandidates([byCode, byId, {}])).toEqual([byCode, byId]);
  });

  it('keeps the richer of two rows with the same key', () => {
    const bare = { displayName: 'K1' };
    const richer = { displayName: 'K1', definition: 'Defined' };
    expect(consolidateDiagnosisCandidates([bare, richer])).toEqual([richer]);
    expect(consolidateDiagnosisCandidates([richer, bare])).toEqual([richer]);
  });
});
