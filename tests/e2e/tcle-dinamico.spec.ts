import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { MongoClient, ObjectId } from 'mongodb';

// Real backend only — see specimen-quality-inventory.spec.ts for the same
// skip rationale. Run via `npm run test:e2e:docker` (or a locally running
// backend), never the mocked suite above.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.describe('TCLE builder (/admin/tcle/new)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
  });

  test('renders the builder form and accepts template metadata', async ({ page }) => {
    await page.goto('/admin/tcle/new');

    const nameInput = page.getByLabel('Nome do Modelo');
    const caaeInput = page.getByLabel('CAAE');

    await expect(nameInput).toBeVisible();
    await nameInput.fill('TCLE E2E Teste');
    await caaeInput.fill('12345678.9.0000.0000');

    await expect(nameInput).toHaveValue('TCLE E2E Teste');
    await expect(caaeInput).toHaveValue('12345678.9.0000.0000');
  });

  test('creating a template posts the filled-in metadata', async ({ page }) => {
    let createdPayload: Record<string, unknown> | null = null;
    await page.route('**/api/e-consent/consent-templates', async (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      createdPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { _id: 'tcle-e2e-1', ...createdPayload } }),
      });
    });

    await page.goto('/admin/tcle/new');
    await page.getByLabel('Nome do Modelo').fill('TCLE E2E Teste');
    await page.getByLabel('CAAE').fill('12345678.9.0000.0000');
    await page.getByLabel('Data de Início da Vigência').fill('2026-01-01');
    await page.getByLabel('Data Final de Vigência').fill('2027-01-01');

    // Submit stays disabled until the rich-text body and at least one
    // granular consent item are filled in too (see disabled= condition on
    // the submit Button in TcleBuilderPage.tsx) — drive both.
    await page.getByRole('textbox', { name: 'Editor do corpo do TCLE' }).fill('Corpo do termo de consentimento para o teste e2e.');
    // A default consent item already exists on a fresh template — just fill it in.
    await page.getByPlaceholder('Ex.: Aceito ceder minhas amostras para estudos genéticos').first().fill('Aceito participar do estudo e2e');

    await page.getByRole('button', { name: 'Criar versão do TCLE' }).click();

    await expect.poll(() => createdPayload?.title ?? (createdPayload as any)?.name).toBeTruthy();
  });
});

test.describe('RF010 Consent versioned by consentId — real backend, red-first (#328)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

  test.afterAll(async () => {
    await closeSeedDb();
  });

  // dict-07_ALINHAMENTO_CODIGO.md row 3 / dict-02_DICIONARIO.md ELM-0088: the
  // target model requires each consent manifestation to be identified by an
  // internal `consentId` distinct from the Mongo `_id` (`Identidade interna
  // da instância de consentimento`). consent.service.js's
  // createPatientConsent (PatientConsentModel.create, models/PatientConsent.js)
  // never assigns such a field — the API/collection only ever expose Mongo's
  // `_id`. Expected to fail against current main; the failure is the proof
  // of the gap (RF010 AC#2). Do not weaken this assertion to make it pass —
  // file the consentId model/migration as a separate follow-up once it's red.
  test('AC#2: a signed consent is identified by an explicit consentId distinct from _id', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const consentResponse = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        signatureName: 'RF010 e2e signatory',
        // 1x1 transparent PNG — normalizeSignaturePayload (consent.service.js)
        // requires a valid image/* payload once signatureImageBase64 is present.
        signatureImageBase64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    });
    expect(consentResponse.status()).toBe(201);
    const consent = (await consentResponse.json()).data;

    expect(consent.consentId).toBeTruthy();
    expect(consent.consentId).not.toBe(String(consent._id));

    // Confirm the field is actually persisted on the document, not just
    // synthesized in the API response.
    const client = new MongoClient(mongoUri);
    await client.connect();
    try {
      const stored = await client.db(mongoDbName).collection('patientConsents').findOne({ _id: new ObjectId(consent._id) });
      expect(stored?.consentId).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  // RNF018 (multi-layer validation, bucket A for this spec per the
  // traceability plan): a malformed consent payload must be rejected with
  // 422, not a generic 400. consent.controller.js's createPatientConsent
  // catches every validation error (missing participantId, bad
  // consentTemplateId, schema failures) and always responds 400 — expected
  // to fail against current main.
  test('RNF018: a malformed consent payload (missing participantId) is rejected with 422', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        consentTemplateId: participant.consentTemplateId,
        responses: {},
      },
    });

    expect(response.status()).toBe(422);
  });
});
