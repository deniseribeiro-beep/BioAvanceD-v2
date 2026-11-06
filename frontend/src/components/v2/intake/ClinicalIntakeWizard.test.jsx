import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClinicalIntakeWizard, { _test } from './ClinicalIntakeWizard.jsx';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import { apiClient } from '../../../api/client';
import { consentService } from '../../../services/api';

const { buildSubmissionPayload, applyIntakeOrganization, createClinicalStepSchema } = _test;

// #871's mocking approach: replace apiClient/consentService at the network
// boundary (not useSemanticCascade itself) so the real hook runs end to end
// and the retry proof exercises the actual re-fetch, not a stub of it.
vi.mock('../../../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  notifyApiToast: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  consentService: { getTemplates: vi.fn() },
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
    expect(screen.queryByText(/Nenhum fenótipo HPO encontrado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma associação de biomarcador/)).not.toBeInTheDocument();
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
