import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import crypto from 'crypto';

// #809: real-backend proof for the bulk consent-token page.
//
// This is the flow every bulk invitation actually uses: template publication,
// both LGPD import paths, the CSV/FHIR import, patient creation and
// resendConsentNotification all call NotificationService.buildConsentLink,
// which emails `${FRONTEND_URL}/patients/<participantId>/consent?token=<hex>`.
// Until this spec there was no page behind that URL at all -- the route
// pointed at the JWT page (an alias import), behind ProtectedRoute.
//
// Nothing here logs in. That is the point: a participant following an emailed
// invitation has no account, so any redirect to /login is a failure of the
// requirement, not of the fixture.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const TERM_CONTENT =
  'Termo de Consentimento Livre e Esclarecido para o teste e2e do link de convite em massa (#809).';

let client: MongoClient | null = null;
let db: Db;
const seededParticipantIds: string[] = [];
let templateId: string;

async function seedPendingParticipant(): Promise<{ participantId: string; token: string }> {
  const participantId = `809${String(Date.now()).slice(-8)}${seededParticipantIds.length}`;
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('patients').insertOne({
    participantId,
    status: 'PENDING_CONSENT',
    consentToken: token,
    consentTokenCreatedAt: new Date(),
    consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  seededParticipantIds.push(participantId);
  return { participantId, token };
}

test.describe('RF010 bulk consent-token page (/patients/:id/consent?token=) -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async ({ browser }) => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);

    // Canonical collection name is `consent_templates` (snake_case), not the
    // `consentTemplates` param name used across the API layer -- see
    // api/backend/src/config/collections.js's CANONICAL_COLLECTIONS.
    const inserted = await db.collection('consent_templates').insertOne({
      title: `TCLE e2e 809 ${Date.now()}`,
      content: TERM_CONTENT,
      version: 'e2e-809',
      active: true,
      permissions: [
        { key: 'research-809', label: 'Uso das amostras em pesquisa', required: true },
        { key: 'recontact-809', label: 'Novo contato para estudos futuros', required: false },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    templateId = inserted.insertedId.toString();

    // #819: the first spec to hit a lazy-loaded route on a cold Vite dev
    // server can fail on the on-demand compile, and this route is lazy. Warm
    // it once here so a compile stall cannot masquerade as a missing element
    // inside a test.
    const page = await browser.newPage();
    await page.goto('/patients/00000000/consent?token=warmup', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);
    await page.close();
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('patients').deleteMany({ participantId: { $in: seededParticipantIds } });
    await db.collection('consent_templates').deleteMany({ version: 'e2e-809' });
    await client.close();
    client = null;
  });

  test('a participant with no session can open the emailed link, read the term and accept it', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    // The auth wall is the failure #809 is about: this route used to sit
    // behind ProtectedRoute, and the shared API client cancels session-less
    // requests unless the endpoint is token-optional (#822).
    await expect(page).toHaveURL(new RegExp(`/patients/${participantId}/consent`));

    await expect(page.getByTestId('consent-token-content')).toContainText(TERM_CONTENT, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('consent-token-permissions')).toContainText(
      'Uso das amostras em pesquisa'
    );

    await page.getByTestId('consent-token-accept').click();
    await expect(page.getByTestId('consent-token-success')).toBeVisible();

    // The observable that matters is the persisted transition, not the banner.
    const stored = await db.collection('patients').findOne({ participantId });
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.consentAcceptedAt).toBeTruthy();
    // The token is single-use: acceptConsentToken nulls it.
    expect(stored?.consentToken).toBeNull();
  });

  test('a wrong token is rejected and leaves the participant pending', async ({ page }) => {
    const { participantId } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${'f'.repeat(64)}`);

    await expect(page.getByTestId('consent-token-error')).toContainText(/inválido|expirado/i, {
      timeout: 15_000,
    });
    // No accept button is offered for a token that did not validate.
    await expect(page.getByTestId('consent-token-accept')).toHaveCount(0);

    const stored = await db.collection('patients').findOne({ participantId });
    expect(stored?.status).toBe('PENDING_CONSENT');
    expect(stored?.consentAcceptedAt).toBeFalsy();
  });

  // #805 emailed `/patients/undefined/consent?token=...` from all four bulk
  // paths for as long as buildConsentLink read a field none of its callers
  // carried. Those links are still in participants' inboxes; they must not
  // reach the backend with the literal string, nor bounce to /login.
  test('a legacy 805 link with an undefined id reports an incomplete link, not a login wall', async ({ page }) => {
    await page.goto(`/patients/undefined/consent?token=${'a'.repeat(64)}`);

    await expect(page.getByTestId('consent-token-error')).toContainText(/incompleto/i, {
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('the term rendered is the active template, carrying its own version', async ({ page }) => {
    const { participantId, token } = await seedPendingParticipant();

    await page.goto(`/patients/${participantId}/consent?token=${token}`);

    await expect(page.getByTestId('consent-token-title')).toContainText('TCLE e2e 809', {
      timeout: 15_000,
    });
    await expect(page.getByText('Versão e2e-809')).toBeVisible();
    expect(templateId).toBeTruthy();
  });
});
