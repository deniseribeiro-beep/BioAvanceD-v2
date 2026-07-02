import type { Page, Route } from '@playwright/test';

type PatientRecord = {
  patientID: string;
  consentStatus: string;
  status: string;
  patientName: string;
};

export async function mockPatientsApi(page: Page, initialPatients: PatientRecord[]) {
  let patients = [...initialPatients];

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (method === 'GET' && /\/patients(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { patients } }),
      });
    }

    if (method === 'POST' && /\/patients(?:\?.*)?$/.test(url)) {
      const body = request.postDataJSON?.() || {};
      const created = {
        patientID: String(body.patientID || '12345678'),
        consentStatus: 'PENDING',
        status: 'PENDING',
        patientName: String(body.patientName || 'Paciente QA'),
      };
      patients = [created];

      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: created }),
      });
    }

    if (method === 'POST' && url.includes('/patients/find-for-edit')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            patientID: '12345678',
            patientName: 'Paciente QA',
          },
        }),
      });
    }

    if (method === 'GET' && /\/patients\/12345678(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            patientID: '12345678',
            patientName: 'Paciente QA',
          },
        }),
      });
    }

    if (method === 'POST' && /\/patients\/12345678\/consent\/resend(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }

    return route.fallback();
  });
}

type WizardMockOptions = {
  withActiveTcle?: boolean;
  qualityAssessment?: Record<string, unknown>;
};

const DEFAULT_QUALITY_ASSESSMENT = {
  model_version: 'RCS-GOV-1.0',
  matrix_type: 'fluid',
  governance_status: 1,
  governance_failure_reasons: [],
  p_bio: 6,
  rcs_score: 94,
  score_based_grade: 'A',
  final_grade: 'A',
  grade_route: 'Score-based certification',
  axis_penalties: [{ axis_code: 'Ppre', sprec_code: 'A', weight: 30, severity: 0, penalty: 0 }],
  calculation_trace: { source: 'playwright-persisted-response' },
};

export async function mockWizardDomainApis(page: Page, options: WizardMockOptions = { withActiveTcle: true }) {
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (url.includes('/consent-templates') || url.includes('/consent/templates')) {
      const templates = options.withActiveTcle
        ? [{ _id: 'tcle-001', title: 'TCLE BioAvanceD', version: 'v1', active: true, content: 'Conteudo TCLE' }]
        : [];

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: templates }),
      });
    }

    if (url.includes('/terminologies')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'orpha-324',
              code: 'ORPHA:324',
              orphaCode: 'ORPHA:324',
              omimCode: '301500',
              cidCode: 'E75.2',
              description: 'Doenca de Fabry',
              displayName: 'Doenca de Fabry',
              relacoes: { orpha: '324', cid10: 'E75.2', omim: '301500' },
            },
          ],
        }),
      });
    }

    if (url.includes('/dictionary/suggest')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          disease: { system: 'http://www.orpha.net', code: '324', display: 'Doenca de Fabry' },
          phenotypes: [
            { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001066', display: 'Angioqueratoma' },
            { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0012471', display: 'Acroparestesia' },
          ],
          biomarkers: [
            { system: 'http://loinc.org', code: 'alphaGal', display: 'Alpha-galactosidase A' },
            { system: 'http://loinc.org', code: 'lysoGb3', display: 'Lyso-Gb3' },
          ],
        }),
      });
    }

    if (url.includes('/intake-wizard/patient-match')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          matched: true,
          patient: {
            patientID: '87654321',
            patientName: 'Paciente QA Wizard',
            birthDate: '1990-10-10',
          },
        }),
      });
    }

    if (url.includes('/dictionary/atc/search') || url.includes('/drugs/search') || url.includes('/chembl/search')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          medications: [
            {
              generic_name: 'Migalastat',
              atc_code: 'A16AX14',
              drug_class: 'A',
              name: 'Migalastat',
              synonyms: ['Galafold'],
              atc_level_1: 'A',
            },
          ],
        }),
      });
    }

    if (method === 'POST' && /\/patients(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { patientID: '12345678' } }),
      });
    }

    if (method === 'POST' && /\/samples(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { sampleID: 'S-1001', _id: 'sample-1001' } }),
      });
    }

    if (method === 'POST' && /\/intake-wizard(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Cadastro integrado concluído com sucesso e TCLE enviado por e-mail.',
          consentEmail: { success: true },
          qualityAssessment: options.qualityAssessment || DEFAULT_QUALITY_ASSESSMENT,
          sample: {
            sampleID: 'S-1001',
            barcode: 'BC-S-1001',
            sampleType: 'PLASMA',
            registrationDate: '2026-05-18T12:00:00.000Z',
          },
        }),
      });
    }

    if (method === 'POST' && /\/patients\/[^/]+\/observations(?:\?.*)?$/.test(url)) {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 'obs-1' } }),
      });
    }

    return route.fallback();
  });
}
