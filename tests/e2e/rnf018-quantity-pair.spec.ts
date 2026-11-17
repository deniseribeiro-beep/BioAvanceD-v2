import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsentTemplate,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { generateValidCpf } from './helpers/cpf';
import { waitForIntakeWizardReady } from './helpers/waitForIntakeWizardReady';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// RNF018 AC1 (#1525): a quantity rule the UI checks is also enforced by the
// backend. Each case drives the UI check on the real app, then sends the same
// value to the API and reads the refusal.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const QUANTITY_MESSAGE = /Enter a quantity greater than zero|Informe um volume maior que zero/;

let mongoClient: MongoClient;
let seededStorageBox: SeededStorageBox | null = null;

test.beforeAll(async () => {
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  await seedActiveConsentTemplate(mongoClient.db(mongoDbName));
});

test.afterAll(async () => {
  if (seededStorageBox) {
    await cleanupStorageBoxLocation(seededStorageBox).catch(() => {});
  }
  await closeSeedDb();
  await mongoClient?.close();
});

// RNF018 C7: neither case relies on the client alone; the backend refuses
// each quantity the UI refuses and nothing is written.
test.describe('RNF018 AC1: each quantity check the UI makes, the backend makes too (#1525)', () => {
  // #1497 (RF004 AC2): the collection these specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`rnf018-quantity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
  });

  test('the intake wizard refuses a quantity at or below zero, and POST /api/intake-wizard refuses the same quantity before writing', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto('/next/intake');
    await waitForIntakeWizardReady(page);
    await page.getByTestId('wizard-full-name').fill(`#1525 e2e patient ${suffix}`);
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');
    await page.getByTestId('wizard-email').fill(`e2e-1525-${suffix}@example.com`);
    await page.getByTestId('wizard-document').fill(generateValidCpf());
    await page.getByTestId('wizard-next-button').click();

    await expect(page.getByTestId('wizard-quantity')).toBeVisible();
    await page.getByTestId('wizard-quantity').fill('0');
    await page.getByTestId('wizard-next-button').click();
    await expect(page.locator('#wizard-quantity-error')).toHaveText(QUANTITY_MESSAGE);
    await expect(page.getByTestId('wizard-diagnosis-search')).not.toBeVisible();

    const linkedProject = `E2E-1525-${suffix}`;
    for (const quantity of [0, -1]) {
      const response = await request.post(`${apiBaseURL}/api/intake-wizard`, {
        headers: { Authorization: `Bearer ${session.token}` },
        data: {
          participant: { participantId: '15250001', patientName: `#1525 e2e patient ${suffix}`, birthDate: '1990-01-01' },
          consent: { consentTemplateId: 'e2e-1525' },
          specimen: {
            specimenId: `E2E-1525-${suffix}`,
            participantId: '15250001',
            sampleType: 'PLASMA',
            sampleOrigin: 'VENOUS_BLOOD',
            extractionProtocol: 'TUBE_EDTA',
            quantity,
            linkedProject,
            collectionId: governed!.collectionId,
          },
          clinical: {},
          biomarkers: [],
        },
      });
      expect(response.status(), `quantity ${quantity}`).toBe(422);
      expect(await response.json()).toEqual({
        success: false,
        error: 'INVALID_QUANTITY',
        fields: ['specimen.quantity'],
        details: ['specimen.quantity deve ser um número maior que zero'],
      });
    }
    expect(await mongoClient.db(mongoDbName).collection('samples').countDocuments({ linkedProject })).toBe(0);
  });

  test('the sample page refuses a negative quantity without a request, and PUT /api/samples/:id refuses the same quantity', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const auth = { Authorization: `Bearer ${session.token}` };

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    seededStorageBox = await seedStorageBoxLocation();
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: auth,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RNF018 AC1 e2e fixture project',
        registeredAt: new Date().toISOString(),
        boxId: seededStorageBox.boxId,
        positionCode: seededStorageBox.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId: string = (await create.json()).data.specimenId;

    const puts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/api/samples/')) puts.push(req.url());
    });

    await page.goto(`/samples/${specimenId}`);
    await expect(page.getByTestId('sample-detail-page-title')).toBeVisible();
    await page.getByTestId('sample-detail-edit-button').click();
    const quantityInput = page.locator('input[type="number"]');
    await expect(quantityInput).toHaveCount(1);
    await quantityInput.fill('-1');
    await page.getByTestId('sample-detail-save-button').click();
    await expect(page.getByText('Quantidade disponível inválida')).toBeVisible();
    expect(puts).toEqual([]);

    const refused = await request.put(`${apiBaseURL}/api/samples/${specimenId}`, { headers: auth, data: { currentQuantity: -1 } });
    expect(refused.status()).toBe(422);
    const refusedBody = await refused.json();
    expect(refusedBody.error).toBe('INVALID_QUANTITY');
    expect(refusedBody.fields).toEqual(['currentQuantity']);

    const after = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers: auth });
    expect((await after.json()).data.currentQuantity).toBe(5);
  });
});
