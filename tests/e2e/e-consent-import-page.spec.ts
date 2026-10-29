import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { mintImportConsentToken } from './helpers/consentJwt';

// #1173: real-backend proof for EConsentImportPage
// (`/patient/e-consent/import/:token`), the page a participant reaches from a
// FHIR-import consent email. It was the one participant page no spec opened;
// its siblings are participant-e-consent-page.spec.ts and
// consent-token-page.spec.ts, and this follows their shape.
//
// Seeding: the real link is built by sendConsents
// (fhir-import-staging.service.js) and exists only inside the email, so --
// like the siblings -- the token is minted locally (helpers/consentJwt.ts),
// signed exactly as buildImportConsentToken signs it. The batch and staging
// record it points at are inserted directly, in the shape sendConsents leaves
// a record in after a successful send: status PENDING_CONSENT, not yet signed.
// validateImportConsentToken needs the batch to carry the FHIR_BUNDLE
// discriminator (#799) and the record's participantId to match the token's.
//
// The page has no data-testids; it renders one button and fixed copy, so the
// locators are role and text.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const IMPORT_PAGE = /\/patient\/e-consent\/import\//;

let client: MongoClient | null = null;
let db: Db;
const seededBatchIds: ObjectId[] = [];

async function seedPendingImportRecord(): Promise<{
  batchId: ObjectId;
  recordId: ObjectId;
  participantId: string;
  patientName: string;
  token: string;
}> {
  const participantId = `117${String(Date.now()).slice(-4)}${seededBatchIds.length}`;
  const patientName = `Participante e2e 1173 ${participantId}`;
  const now = new Date();

  const batchId = new ObjectId();
  await db.collection('import_batches').insertOne({
    _id: batchId,
    type: 'FHIR_BUNDLE',
    status: 'PENDING_CONSENT',
    fileName: 'e2e-1173.json',
    createdAt: now,
    updatedAt: now,
  });
  seededBatchIds.push(batchId);

  const recordId = new ObjectId();
  await db.collection('import_staging_records').insertOne({
    _id: recordId,
    batchId,
    rowNumber: 1,
    status: 'PENDING_CONSENT',
    normalized: {
      participantId,
      patientName,
      patientEmail: `e2e-1173-${participantId}@example.test`,
      consentSigned: false,
    },
    errors: [],
    warnings: [{ field: 'consent', message: 'Aguardando assinatura do TCLE.' }],
    consentStatus: 'PENDING',
    consentTracking: { sentAt: now },
    quarantineStatus: 'QUARANTINED',
    availabilityStatus: 'BLOCKED',
    createdAt: now,
    updatedAt: now,
  });

  const token = mintImportConsentToken({
    batchId: batchId.toHexString(),
    recordId: recordId.toHexString(),
    participantId,
  });

  return { batchId, recordId, participantId, patientName, token };
}

function importLinkPath(token: string): string {
  return `/patient/e-consent/import/${encodeURIComponent(token)}`;
}

test.describe('RF011 FHIR-import consent page (/patient/e-consent/import/:token) -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('import_staging_records').deleteMany({ batchId: { $in: seededBatchIds } });
    await db.collection('import_batches').deleteMany({ _id: { $in: seededBatchIds } });
    await db.collection('audit_logs').deleteMany({ module: 'FHIR_IMPORT', batchId: { $in: seededBatchIds } });
    await client.close();
    client = null;
  });

  test('a participant with no session opens the emailed link and sees their staged record', async ({ page }) => {
    const { patientName, token } = await seedPendingImportRecord();

    await page.goto(importLinkPath(token));

    await expect(page.getByRole('heading', { name: 'Consentimento de importação FHIR' })).toBeVisible({
      timeout: 15_000,
    });
    // Backend-resolved, not the page's 'Paciente' / 'DESCONHECIDO' fallbacks.
    await expect(page.getByText(`Paciente: ${patientName}`)).toBeVisible();
    await expect(page.getByText('Status atual: PENDING_CONSENT')).toBeVisible();
    // TOKEN_OPTIONAL_ROUTES: no bounce to the auth wall.
    await expect(page).toHaveURL(IMPORT_PAGE);
  });

  test('accepting releases the staged record for commit', async ({ page }) => {
    const { batchId, recordId, patientName, token } = await seedPendingImportRecord();

    await page.goto(importLinkPath(token));
    const accept = page.getByRole('button', { name: 'Aceitar consentimento' });
    await expect(accept).toBeVisible({ timeout: 15_000 });

    const acceptResponse = page.waitForResponse(
      (response) => response.url().includes('/accept') && response.request().method() === 'POST'
    );
    await accept.click();
    expect((await acceptResponse).status()).toBe(200);

    await expect(page.getByText('Consentimento de importação assinado com sucesso!')).toBeVisible();

    // acceptImportConsentToken's writes, read back from the store.
    const record = await db.collection('import_staging_records').findOne({ _id: recordId, batchId });
    // #1191: the update sealed the record, including the plaintext this spec
    // seeded -- normalized and consentTracking now live in one envelope, and
    // consentSigned is proven by the status and consentStatus it produced.
    expect(record?.sealedPayload).toBeTruthy();
    expect(record?.normalized ?? null).toBeNull();
    expect(JSON.stringify(record)).not.toContain(patientName);
    expect(record?.status).toBe('READY_TO_COMMIT');
    expect(record?.consentStatus).toBe('SIGNED');
    expect(record?.quarantineStatus).toBe('RELEASED');
    expect(record?.availabilityStatus).toBe('AVAILABLE');
    expect(record?.warnings).toEqual([]);
  });

  test('a bad token gets a real 401 from the backend and the invalid-link copy, not a login wall', async ({
    page,
  }) => {
    const apiOrigin = new URL(apiBaseURL as string).origin;
    const validateResponse = page.waitForResponse(
      (response) => response.url().includes('/e-consent/import/fhir/consent/'),
      { timeout: 15_000 }
    );

    await page.goto('/patient/e-consent/import/not-a-real-jwt');

    const response = await validateResponse;
    expect(new URL(response.url()).origin).toBe(apiOrigin);
    expect(response.status()).toBe(401);

    await expect(page.getByText(/Link inválido ou expirado/)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(IMPORT_PAGE);
    await expect(page.getByRole('button', { name: 'Aceitar consentimento' })).toHaveCount(0);
  });

  test('a validly signed token for a record that is gone renders the not-found copy', async ({ page }) => {
    const { recordId, batchId, token } = await seedPendingImportRecord();
    await db.collection('import_staging_records').deleteOne({ _id: recordId, batchId });

    await page.goto(importLinkPath(token));

    await expect(page.getByText(/Não encontramos seu cadastro/)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(IMPORT_PAGE);
  });

  // #1172's pattern (#1158): in a real outage the request gets no response at
  // all -- api.ts aborts at its own timeout before a backend 503 arrives.
  test('a load that gets no response tells the participant the link still works', async ({ page }) => {
    const { token } = await seedPendingImportRecord();
    await page.route('**/api/e-consent/import/fhir/consent/**', (route) => route.abort('timedout'));

    await page.goto(importLinkPath(token));

    await expect(page.getByText(/link continua válido/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(IMPORT_PAGE);
  });

  test('an accept that gets no response tells the participant the link still works', async ({ page }) => {
    const { recordId, batchId, token } = await seedPendingImportRecord();
    await page.route('**/api/e-consent/import/fhir/consent/**/accept', (route) => route.abort('timedout'));

    await page.goto(importLinkPath(token));
    await page.getByRole('button', { name: 'Aceitar consentimento' }).click({ timeout: 15_000 });

    const error = page.getByText(/Não foi possível confirmar o registro/);
    await expect(error).toBeVisible();
    await expect(error).toContainText(/link continua válido/i);
    await expect(page.getByText(/inválido ou expirado/i)).toHaveCount(0);

    // The request never reached the backend, so nothing was signed.
    const record = await db.collection('import_staging_records').findOne({ _id: recordId, batchId });
    expect(record?.normalized?.consentSigned).toBe(false);
  });
});
